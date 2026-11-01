"""Turn the navy-background logo artwork into a transparent PNG for the site header."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "logo-deane-source.jpg"
OUT = ROOT / "assets" / "logo-deane.png"
# Output height; the header shows it at ≤72 CSS px, so this covers 3× screens.
OUT_HEIGHT = 240
# Colour distance from the backdrop at which a pixel becomes fully opaque.
SOFT, FULL = 12, 70
# styles.css --sign-yellow; the artwork's lemon yellow is pulled to this.
SITE_YELLOW = np.array([0xE9, 0xA3, 0x05], dtype=np.float64)


def match_site_yellow(color: np.ndarray) -> np.ndarray:
    """Scale yellow pixels so the artwork's main yellow lands exactly on SITE_YELLOW, keeping shading."""
    r, g, b = color[..., 0], color[..., 1], color[..., 2]
    core = (r > 200) & (g > 150) & (b < 90)
    ref = np.median(color[core], axis=0)
    gain = SITE_YELLOW / np.maximum(ref, 1)
    # White (r≈g≈b) and navy (b high) score 0; saturated yellow and its darker edges score up to 1.
    yellowness = np.clip(((r + g) / 2 - b) / 200, 0, 1)[..., None]
    return np.clip(color * (1 - yellowness) + color * gain * yellowness, 0, 255)


def backdrop_model(img: np.ndarray, band: int) -> np.ndarray:
    """Quadratic fit of the navy gradient from the image border."""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    edge = (xs < band) | (xs >= w - band) | (ys < band) | (ys >= h - band)

    def design(x, y):
        x = x / w
        y = y / h
        return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)

    coef, *_ = np.linalg.lstsq(design(xs[edge].astype(float), ys[edge].astype(float)), img[edge], rcond=None)
    return design(xs.astype(float), ys.astype(float)) @ coef


def main() -> None:
    img = np.array(Image.open(SOURCE).convert("RGB")).astype(np.float64)
    back = backdrop_model(img, band=max(6, img.shape[1] // 80))
    diff = img - back
    alpha = np.clip((np.abs(diff).max(axis=2) - SOFT) / (FULL - SOFT), 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    # Un-mix the backdrop so edges and drop shadows stay correct on any navy.
    color = match_site_yellow(np.clip(back + diff / safe, 0, 255))
    rgba = np.dstack([color, alpha * 255]).round().astype(np.uint8)
    out = Image.fromarray(rgba, "RGBA")
    bbox = out.getchannel("A").point(lambda v: 255 if v > 16 else 0).getbbox()
    pad = 6
    out = out.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(out.width, bbox[2] + pad), min(out.height, bbox[3] + pad)))
    out = out.resize((round(out.width * OUT_HEIGHT / out.height), OUT_HEIGHT), Image.Resampling.LANCZOS)
    # A 256-colour palette keeps the header image light; the artwork is flat colour.
    out = out.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    out.save(OUT, optimize=True)
    print(f"{OUT.name} {out.width}x{out.height}")


if __name__ == "__main__":
    main()
