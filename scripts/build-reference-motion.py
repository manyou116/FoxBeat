"""Prepare aligned bitmap motion clips for the two reference companions.

Run with Pillow, NumPy, and OpenCV available. These libraries are only needed
while building art assets, not by the frontend at runtime.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "frontend/assets"
PREVIEWS = ROOT / "generated/reference-motion"
CELL = 320
SOURCE_GRID = 4
CLIP_COLUMNS = 6
CLIP_ROWS = 4


@dataclass(frozen=True)
class Companion:
    name: str
    sway: tuple[int, ...]
    step: tuple[int, ...]
    wave: tuple[int, ...]


COMPANIONS = (
    Companion("shy-fox", (0, 3, 6, 12, 0, 10, 13, 15),
              (0, 1, 3, 6, 2, 10, 12, 14),
              (0, 6, 13, 6, 12, 6, 13, 15)),
    Companion("yuexin-cat", (0, 3, 4, 5, 0, 10, 11, 12),
              (0, 4, 5, 8, 9, 11, 12, 0),
              (0, 2, 6, 7, 6, 2, 13, 15)),
)


def clear_hidden_rgb(rgba: np.ndarray) -> np.ndarray:
    rgba[rgba[:, :, 3] < 16] = 0
    return rgba


def clean_frame(frame: Image.Image) -> np.ndarray:
    rgba = np.asarray(frame.resize((CELL, CELL), Image.Resampling.LANCZOS)).copy()
    alpha = rgba[:, :, 3]
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        np.uint8(alpha > 24), connectivity=8
    )
    if count > 1:
        largest = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        # Preserve the antialiased outline but exclude detached motion ticks,
        # stray shadows, and small generated fragments.
        body = cv2.dilate(np.uint8(labels == largest), np.ones((5, 5), np.uint8))
        rgba[:, :, 3] *= body

    visible = np.argwhere(rgba[:, :, 3] > 96)
    if len(visible):
        top, left = visible.min(axis=0)
        bottom, right = visible.max(axis=0)
        dx = round(CELL / 2 - (left + right) / 2)
        dy = 300 - bottom
        rgba = cv2.warpAffine(
            rgba, np.float32([[1, 0, dx], [0, 1, dy]]), (CELL, CELL),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0, 0),
        )
    return clear_hidden_rgb(rgba)


def repair_cat_eye(frames: list[np.ndarray]) -> None:
    # The source drawing for pose 6 has a brown spot inside its right eye.
    # Pose 5 has the same eye contour 3px left and 8px above it.
    donor = cv2.warpAffine(
        frames[5], np.float32([[1, 0, 3], [0, 1, 8]]), (CELL, CELL),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    mask = np.zeros((CELL, CELL), dtype=np.uint8)
    cv2.ellipse(mask, (170, 152), (15, 26), 0, 0, 360, 255, -1)
    mix = cv2.GaussianBlur(mask, (0, 0), 1.5).astype(np.float32)[:, :, None] / 255
    frames[6] = np.uint8(np.round(frames[6] * (1 - mix) + donor * mix))


def normalize_fox_silhouette(frames: list[np.ndarray]) -> None:
    # Five source cells switch from the screenshot's bust sticker to a small
    # full-body drawing. Reuse the nearest bust expression at those indices so
    # every clip, including reaction clips, keeps a stable camera distance.
    for index, bust in ((4, 3), (5, 1), (8, 7), (9, 14), (11, 10)):
        frames[index] = frames[bust].copy()


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


def inbetween(start: np.ndarray, end: np.ndarray, forward: np.ndarray,
              backward: np.ndarray, fraction: float) -> np.ndarray:
    # Use only the nearer drawing. A blend of two whole characters doubles
    # the muzzle, face lines, ears, and tail in this sticker art style.
    source, flow, amount = (
        (start, forward, fraction) if fraction <= 0.5
        else (end, backward, 1 - fraction)
    )
    xy = np.stack(np.meshgrid(np.arange(CELL), np.arange(CELL)), axis=-1).astype(np.float32)
    warped = cv2.remap(
        source, xy[:, :, 0] - flow[:, :, 0] * amount,
        xy[:, :, 1] - flow[:, :, 1] * amount,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return clear_hidden_rgb(warped)


def save_atlas(frames: list[np.ndarray], columns: int, path: Path) -> None:
    rows = (len(frames) + columns - 1) // columns
    atlas = Image.new("RGBA", (columns * CELL, rows * CELL))
    for index, pixels in enumerate(frames):
        atlas.paste(Image.fromarray(pixels, "RGBA"),
                    ((index % columns) * CELL, (index // columns) * CELL))
    atlas.save(path, optimize=True)


def build_clip(keys: tuple[int, ...], frames: list[np.ndarray]) -> list[np.ndarray]:
    output: list[np.ndarray] = []
    for at, key in enumerate(keys):
        following = keys[(at + 1) % len(keys)]
        start, end = frames[key], frames[following]
        forward = image_flow(start, end)
        backward = image_flow(end, start)
        output.extend((
            start,
            inbetween(start, end, forward, backward, 1 / 3),
            inbetween(start, end, forward, backward, 2 / 3),
        ))
    assert len(output) == CLIP_COLUMNS * CLIP_ROWS
    return output


def lift_step(frames: list[np.ndarray]) -> list[np.ndarray]:
    # The source's planted-foot alignment is useful for neutral/sway clips;
    # a restrained lift makes the distinct stepping phrase read as footwork.
    rise = (0, 0, 1, 2, 3, 2, 0, 3, 6, 10, 8, 5,
            2, 0, 0, 2, 4, 6, 4, 2, 0, 0, 0, 0)
    side = (0, 0, -1, -2, -3, -3, -2, -1, 0, 0, 0, 1,
            2, 3, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0)
    return [
        clear_hidden_rgb(cv2.warpAffine(
            frame, np.float32([[1, 0, side[index]], [0, 1, -rise[index]]]),
            (CELL, CELL), flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0),
        ))
        for index, frame in enumerate(frames)
    ]


def composite(pixels: np.ndarray, background: tuple[int, int, int],
              size: int = 160) -> Image.Image:
    sticker = Image.fromarray(pixels, "RGBA").resize((size, size), Image.Resampling.LANCZOS)
    image = Image.new("RGBA", (size, size), background + (255,))
    image.alpha_composite(sticker)
    return image.convert("RGB")


def save_previews(name: str, clip: str, frames: list[np.ndarray]) -> None:
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    preview = [composite(frame, (232, 235, 231), 240) for frame in frames]
    preview[0].save(
        PREVIEWS / f"{name}-{clip}-preview-v1.webp",
        save_all=True, append_images=preview[1:], duration=[107] * 16 + [106] * 8,
        loop=0, lossless=True, method=5,
    )
    for label, background in (("light", (244, 246, 242)), ("dark", (39, 43, 49))):
        contact = Image.new("RGB", (CLIP_COLUMNS * 160, CLIP_ROWS * 180), background)
        draw = ImageDraw.Draw(contact)
        for index, frame in enumerate(frames):
            x, y = index % CLIP_COLUMNS * 160, index // CLIP_COLUMNS * 180
            contact.paste(composite(frame, background), (x, y))
            draw.text((x + 8, y + 160), f"{index:02d}",
                      fill=(20, 24, 26) if label == "light" else (238, 240, 236))
        contact.save(PREVIEWS / f"{name}-{clip}-{label}-contact-v1.png", optimize=True)


def build_companion(companion: Companion) -> None:
    original = Image.open(ASSETS / f"{companion.name}-action-sheet.png").convert("RGBA")
    bounds = [round(i * original.width / SOURCE_GRID) for i in range(SOURCE_GRID + 1)]
    frames = [
        clean_frame(original.crop((bounds[x], bounds[y], bounds[x + 1], bounds[y + 1])))
        for y in range(SOURCE_GRID) for x in range(SOURCE_GRID)
    ]
    if companion.name == "yuexin-cat":
        repair_cat_eye(frames)
    else:
        normalize_fox_silhouette(frames)
    save_atlas(frames, SOURCE_GRID, ASSETS / f"{companion.name}-actions-clean-v1.png")
    for clip, keys in (("sway", companion.sway), ("step", companion.step),
                       ("wave", companion.wave)):
        output = build_clip(keys, frames)
        if clip == "step":
            output = lift_step(output)
        save_atlas(output, CLIP_COLUMNS, ASSETS / f"{companion.name}-{clip}-v1.png")
        save_previews(companion.name, clip, output)


def main() -> None:
    for companion in COMPANIONS:
        build_companion(companion)


if __name__ == "__main__":
    main()
