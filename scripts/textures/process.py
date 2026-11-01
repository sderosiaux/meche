#!/usr/bin/env python3
"""Turn the raw GPT Image outputs (generate.sh) into game textures in public/textures.

Wood and paint become tileable (blend with a half-offset copy), get a normal map derived from
their luminance, and are encoded as WebP. The workshop panorama is only resized: the game blurs it.
Usage: python3 scripts/textures/process.py [raw_dir]
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAW = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/meche-tex")
OUT = Path(__file__).resolve().parents[2] / "public" / "textures"
OUT.mkdir(parents=True, exist_ok=True)

# name: (size, normal strength, tileable, colour quality)
SPECS = {
    "maple": (1024, 2.2, True, 82),
    "walnut": (1024, 2.6, True, 82),
    "bench": (1024, 2.0, True, 80),
    "painted": (512, 1.6, True, 80),
    "workshop": (None, None, False, 72),
}


def tileable(img: np.ndarray) -> np.ndarray:
    """Blend with a copy rolled by half: the rolled copy is continuous across the borders,
    the original covers the centre, a smooth window hides the rolled copy's own seam."""
    h, w = img.shape[:2]
    rolled = np.roll(np.roll(img, h // 2, axis=0), w // 2, axis=1)
    y = np.linspace(-1, 1, h)[:, None]
    x = np.linspace(-1, 1, w)[None, :]
    wy = np.clip(1.6 - np.abs(y) * 1.6, 0, 1)
    wx = np.clip(1.6 - np.abs(x) * 1.6, 0, 1)
    win = (np.minimum(wx, wy) ** 1.5)[..., None]
    return img * win + rolled * (1 - win)


def normal_map(rgb: np.ndarray, strength: float) -> np.ndarray:
    lum = rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
    blurred = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(12)), dtype=np.float32) / 255
    height = lum - blurred  # high-pass: grain, not lighting
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    n = np.stack([-gx, gy, np.ones_like(gx)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def webp(img: Image.Image, path: Path, quality: int) -> None:
    tmp = path.with_suffix(".png")
    img.save(tmp)
    subprocess.run(["cwebp", "-quiet", "-q", str(quality), "-m", "6", str(tmp), "-o", str(path)], check=True)
    tmp.unlink()


for name, (size, strength, tile, quality) in SPECS.items():
    src = RAW / f"{name}.png"
    if not src.exists():
        print(f"skip {name}: {src} missing")
        continue
    im = Image.open(src).convert("RGB")
    if size:
        im = im.resize((size, size), Image.LANCZOS)
    else:
        im = im.resize((2048, 1024), Image.LANCZOS)
    rgb = np.asarray(im, dtype=np.float32) / 255
    if tile:
        rgb = tileable(rgb)
    webp(Image.fromarray((rgb * 255).clip(0, 255).astype(np.uint8)), OUT / f"{name}.webp", quality)
    if strength:
        webp(Image.fromarray(normal_map(rgb, strength)), OUT / f"{name}-n.webp", 88)
    print(f"{name}: ok")
