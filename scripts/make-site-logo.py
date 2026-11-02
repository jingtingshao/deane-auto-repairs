"""Build the site logo assets from the navy-background artwork:
transparent header PNG, social / search share image, favicon and app icons."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "logo-deane-source.jpg"
OUT = ROOT / "assets" / "logo-deane.png"
SHARE_OUT = ROOT / "assets" / "og-share.jpg"
FAVICON_OUT = ROOT / "favicon.ico"
ICON_OUTS = {
    ROOT / "assets" / "apple-touch-icon.png": 180,
    ROOT / "assets" / "icon-192.png": 192,
    ROOT / "assets" / "icon-512.png": 512,
}
# Output height; the header shows it at ≤72 CSS px, so this covers 3× screens.
OUT_HEIGHT = 240
# Colour distance from the backdrop at which a pixel becomes fully opaque.
SOFT, FULL = 12, 70
# styles.css --sign-yellow; the artwork's lemon yellow is pulled to this.
SITE_YELLOW = np.array([0xE9, 0xA3, 0x05], dtype=np.float64)
# styles.css --navy, used behind the logo on share images and icons.
SITE_NAVY = (0x02, 0x15, 0x34)
SHARE_SIZE = (1200, 630)
# Google crops result thumbnails to a square, so the logo stays inside the centre 630 px.
SHARE_LOGO_WIDTH = 600
ICON_LOGO_SHARE = 0.9


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


def cutout() -> Image.Image:
    """Full-resolution transparent logo, cropped to the artwork."""
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
    return out.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(out.width, bbox[2] + pad), min(out.height, bbox[3] + pad)))


def on_navy(logo: Image.Image, size: tuple[int, int], logo_width: int) -> Image.Image:
    """Logo centred on a solid site-navy canvas."""
    scaled = logo.resize((logo_width, round(logo.height * logo_width / logo.width)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, SITE_NAVY + (255,))
    canvas.alpha_composite(scaled, ((size[0] - scaled.width) // 2, (size[1] - scaled.height) // 2))
    return canvas.convert("RGB")


def main() -> None:
    logo = cutout()

    header = logo.resize((round(logo.width * OUT_HEIGHT / logo.height), OUT_HEIGHT), Image.Resampling.LANCZOS)
    # A 256-colour palette keeps the header image light; the artwork is flat colour.
    header = header.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    header.save(OUT, optimize=True)
    print(f"{OUT.name} {header.width}x{header.height}")

    share = on_navy(logo, SHARE_SIZE, SHARE_LOGO_WIDTH)
    share.save(SHARE_OUT, quality=90, optimize=True, progressive=True)
    print(f"{SHARE_OUT.name} {share.width}x{share.height}")

    icon = on_navy(logo, (512, 512), round(512 * ICON_LOGO_SHARE))
    for path, size in ICON_OUTS.items():
        icon.resize((size, size), Image.Resampling.LANCZOS).save(path, optimize=True)
        print(f"{path.name} {size}x{size}")
    icon.save(FAVICON_OUT, sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"{FAVICON_OUT.name} 16/32/48")


if __name__ == "__main__":
    main()
