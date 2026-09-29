"""Build cleaned, aligned orange-fox bitmap clips from the original artwork.

This is a one-time art preparation tool. It needs Pillow, NumPy and OpenCV;
none of those libraries are required by the running application.
"""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/assets/orange-fox-action-sheet-v2.png"
OUTPUT = ROOT / "frontend/assets"
PREVIEW_OUTPUT = ROOT / "generated"
CELL = 320
SOURCE_GRID = 4
CLIP_COLUMNS = 6
CLIP_ROWS = 4


def clear_transparent_rgb(rgba: np.ndarray) -> np.ndarray:
    # The generated sheet stores bright red/yellow RGB in transparent pixels.
    # Discard negligible alpha and hidden RGB before a renderer resamples it.
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
        body = np.uint8(labels == largest)
        # Keep antialiased outline pixels while dropping detached generation noise.
        body = cv2.dilate(body, np.ones((5, 5), np.uint8))
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
    return clear_transparent_rgb(rgba)


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
    # Warp only the nearer key drawing. Blending two whole characters produces
    # the same doubled ears/eyes that the old runtime crossfade caused.
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
    return clear_transparent_rgb(warped)


def build_clip(keys: list[int], frames: list[np.ndarray], name: str) -> None:
    atlas = Image.new("RGBA", (CLIP_COLUMNS * CELL, CLIP_ROWS * CELL))
    output_frames = []
    for at, key in enumerate(keys):
        following = keys[(at + 1) % len(keys)]
        start, end = frames[key], frames[following]
        forward = image_flow(start, end)
        backward = image_flow(end, start)
        output_frames.extend((
            start,
            inbetween(start, end, forward, backward, 1 / 3),
            inbetween(start, end, forward, backward, 2 / 3),
        ))
    assert len(output_frames) == CLIP_COLUMNS * CLIP_ROWS
    for index, pixels in enumerate(output_frames):
        atlas.paste(Image.fromarray(pixels, "RGBA"),
                    ((index % CLIP_COLUMNS) * CELL, (index // CLIP_COLUMNS) * CELL))
    atlas.save(OUTPUT / name, optimize=True)

    if name == "orange-fox-sway-v3.png":
        PREVIEW_OUTPUT.mkdir(parents=True, exist_ok=True)
        preview_frames = []
        for pixels in output_frames:
            sticker = Image.fromarray(pixels, "RGBA").resize(
                (240, 240), Image.Resampling.LANCZOS
            )
            preview = Image.new("RGBA", (240, 240), (232, 235, 231, 255))
            preview.alpha_composite(sticker)
            preview_frames.append(preview.convert("RGB"))
        preview_frames[0].save(
            PREVIEW_OUTPUT / "orange-fox-sway-preview-v3.webp",
            save_all=True, append_images=preview_frames[1:],
            duration=[107] * 16 + [106] * 8, loop=0,
            lossless=True, method=5,
        )


def main() -> None:
    original = Image.open(SOURCE).convert("RGBA")
    bounds = [round(i * original.width / SOURCE_GRID) for i in range(SOURCE_GRID + 1)]
    frames = [clean_frame(original.crop((bounds[x], bounds[y], bounds[x + 1], bounds[y + 1])))
              for y in range(SOURCE_GRID) for x in range(SOURCE_GRID)]
    cleaned = Image.new("RGBA", (4 * CELL, 4 * CELL))
    for index, pixels in enumerate(frames):
        cleaned.paste(Image.fromarray(pixels, "RGBA"),
                      ((index % 4) * CELL, (index // 4) * CELL))
    cleaned.save(OUTPUT / "orange-fox-actions-clean-v3.png", optimize=True)

    # Each eight-pose phrase gets two locally warped in-betweens per pose.
    # The loop closes on the neutral pose without reversing a full-body jump.
    build_clip([0, 3, 4, 5, 0, 10, 11, 12], frames, "orange-fox-sway-v3.png")
    build_clip([0, 4, 8, 5, 0, 11, 8, 12], frames, "orange-fox-step-v3.png")
    # Keep the fox's half-lidded expression steady while one paw waves.
    build_clip([0, 13, 13, 12, 15, 13, 13, 0], frames, "orange-fox-wave-v3.png")


if __name__ == "__main__":
    main()
