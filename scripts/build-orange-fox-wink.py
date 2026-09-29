"""Prepare the generated wink keys as a 12-frame, single-character bitmap clip.

Run with Pillow, NumPy, and OpenCV, for example:
uv run --no-project --with pillow --with numpy --with opencv-python-headless \
    python scripts/build-orange-fox-wink.py
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "generated/orange-fox-wink-heart-keys-v1.png"
NEUTRAL = ROOT / "frontend/assets/orange-fox-actions-clean-v3.png"
ATLAS = ROOT / "frontend/assets/orange-fox-wink-v1.png"
PREVIEW = ROOT / "generated"
CELL = 320
FRAMES = 12
GROUND = 301


def components(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    _, labels, stats, _ = cv2.connectedComponentsWithStats(
        np.uint8(rgba[:, :, 3] > 24), connectivity=8
    )
    body_id = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
    body_mask = cv2.dilate(np.uint8(labels == body_id), np.ones((3, 3), np.uint8))
    heart_ids = [
        index for index, stat in enumerate(stats)
        if index != body_id and index != 0 and stat[cv2.CC_STAT_AREA] > 500
    ]
    heart_mask = cv2.dilate(
        np.uint8(np.isin(labels, heart_ids)), np.ones((3, 3), np.uint8)
    )
    return stats[body_id], body_mask, heart_mask


def isolate(rgba: np.ndarray, mask: np.ndarray) -> np.ndarray:
    result = rgba.copy()
    result[:, :, 3] *= mask
    result[result[:, :, 3] < 16] = 0
    return result


def aligned_layer(source: np.ndarray, mask: np.ndarray, bottom: int) -> np.ndarray:
    layer = Image.fromarray(isolate(source, mask), "RGBA")
    source_cell = source.shape[0]
    # All generated keys share one fixed scale, so details never pulse in size.
    scale = 0.525
    target = round(source_cell * scale)
    layer = layer.resize((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CELL, CELL))
    left = round(CELL / 2 - source_cell / 2 * scale)
    top = round(GROUND - bottom * scale)
    canvas.alpha_composite(layer, (left, top))
    pixels = np.asarray(canvas).copy()
    pixels[pixels[:, :, 3] < 16] = 0
    return pixels


def feet_center(rgba: np.ndarray) -> float:
    # Use only the ground-level feet, not the tail or raised paw, as the anchor.
    alpha = rgba[GROUND - 26:GROUND + 2, :, 3]
    _, x = np.where(alpha > 128)
    if len(x) == 0:
        raise ValueError("No visible feet at the expected ground line")
    return float(x.mean())


def shift_horizontal(rgba: np.ndarray, amount: int) -> np.ndarray:
    result = np.zeros_like(rgba)
    if amount >= 0:
        result[:, amount:] = rgba[:, :CELL - amount]
    else:
        result[:, :CELL + amount] = rgba[:, -amount:]
    return result


def image_flow(start: np.ndarray, end: np.ndarray) -> np.ndarray:
    def gray(rgba: np.ndarray) -> np.ndarray:
        matte = rgba[:, :, 3:4].astype(np.float32) / 255
        rgb = rgba[:, :, :3].astype(np.float32) * matte + 255 * (1 - matte)
        return cv2.cvtColor(np.uint8(rgb), cv2.COLOR_RGB2GRAY)

    return cv2.calcOpticalFlowFarneback(
        gray(start), gray(end), None,
        pyr_scale=0.5, levels=4, winsize=31, iterations=6,
        poly_n=7, poly_sigma=1.5, flags=0,
    )


def between(start: np.ndarray, end: np.ndarray, amount: float) -> np.ndarray:
    if amount > 0.5:
        source, target, portion = end, start, 1 - amount
    else:
        source, target, portion = start, end, amount
    flow = image_flow(source, target)
    y, x = np.mgrid[:CELL, :CELL].astype(np.float32)
    warped = cv2.remap(
        source, x - flow[:, :, 0] * portion, y - flow[:, :, 1] * portion,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0),
    )
    warped[warped[:, :, 3] < 16] = 0
    return warped


def add_hearts(body: np.ndarray, heart: np.ndarray, dx: int, dy: int,
               opacity: float) -> np.ndarray:
    result = Image.fromarray(body, "RGBA")
    overlay = Image.fromarray(heart, "RGBA")
    if opacity < 1:
        overlay.putalpha(overlay.getchannel("A").point(lambda value: round(value * opacity)))
    result.alpha_composite(overlay, (dx, dy))
    return np.asarray(result).copy()


def preview(frames: list[np.ndarray], name: str, background: tuple[int, int, int]) -> None:
    contact = Image.new("RGB", (CELL * 4, CELL * 3), background)
    animation = []
    for index, pixels in enumerate(frames):
        plate = Image.new("RGBA", (CELL, CELL), (*background, 255))
        plate.alpha_composite(Image.fromarray(pixels, "RGBA"))
        contact.paste(plate.convert("RGB"), ((index % 4) * CELL, (index // 4) * CELL))
        frame = plate.resize((256, 256), Image.Resampling.LANCZOS).convert("RGB")
        animation.append(frame)
    contact.save(PREVIEW / f"orange-fox-wink-{name}-contact-v1.png", optimize=True)
    animation[0].save(
        PREVIEW / f"orange-fox-wink-{name}-preview-v1.webp",
        save_all=True, append_images=animation[1:], duration=[100] * FRAMES,
        loop=0, lossless=True, method=5,
    )


def main() -> None:
    source = np.asarray(Image.open(SOURCE).convert("RGBA"))
    half = source.shape[0] // 2
    keys = []
    hearts = None
    for index in range(4):
        x, y = index % 2, index // 2
        raw = source[y * half:(y + 1) * half, x * half:(x + 1) * half]
        stat, body_mask, heart_mask = components(raw)
        bottom = int(stat[cv2.CC_STAT_TOP] + stat[cv2.CC_STAT_HEIGHT] - 1)
        keys.append(aligned_layer(raw, body_mask, bottom))
        if index == 2:
            hearts = aligned_layer(raw, heart_mask, bottom)
    assert hearts is not None

    neutral = np.asarray(Image.open(NEUTRAL).convert("RGBA").crop((0, 0, CELL, CELL))).copy()
    neutral[neutral[:, :, 3] < 16] = 0
    anchor = feet_center(neutral)
    key_shifts = [round(anchor - feet_center(key)) for key in keys]
    keys = [shift_horizontal(key, shift) for key, shift in zip(keys, key_shifts)]
    # The first and final frame match the resting atlas exactly. A raised paw
    # anticipates the wink; the isolated hearts then rise and fade independently.
    poses = [
        neutral,
        between(neutral, keys[1], 0.35),
        keys[1],
        between(keys[1], keys[2], 0.55),
        keys[2], keys[2], keys[2],
        keys[3],
        between(keys[3], keys[1], 0.35),
        keys[1],
        between(keys[1], neutral, 0.5),
        neutral,
    ]
    effects = {
        4: (0, 3, 0.75),
        5: (1, 0, 1),
        6: (2, -7, 1),
        7: (7, -15, 0.95),
        8: (8, -23, 0.55),
    }
    frames = []
    for index, pose in enumerate(poses):
        if index in effects:
            dx, dy, opacity = effects[index]
            # Keep the hearts on one smooth screen-space path as the body key changes.
            pose = add_hearts(pose, hearts, dx + key_shifts[2], dy, opacity)
        frames.append(pose)

    atlas = Image.new("RGBA", (6 * CELL, 2 * CELL))
    for index, pixels in enumerate(frames):
        atlas.paste(Image.fromarray(pixels, "RGBA"),
                    ((index % 6) * CELL, (index // 6) * CELL))
    atlas.save(ATLAS, optimize=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    preview(frames, "light", (245, 247, 245))
    preview(frames, "dark", (32, 35, 38))


if __name__ == "__main__":
    main()
