"""Overlay scannable booking QR badges onto Deane posters."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
QR_DIR = ROOT / "assets" / "qr"
ADS_DIR = ROOT / "exports" / "ads"
NAVY = (2, 21, 52)
WHITE = (255, 255, 255)

POSTERS = [
    ("deane-service-wof-199-poster.png", "book-service-wof.png", "br-high"),
    ("deane-brake-inspection-49-poster.png", "book-brakes.png", "photo-br"),
    ("deane-brake-pads-before-after-poster.png", "book-brakes.png", "photo-br"),
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        ["arialbd.ttf", "segoeuib.ttf", "calibrib.ttf"]
        if bold
        else ["arial.ttf", "segoeui.ttf", "calibri.ttf"]
    )
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def text_size(draw: ImageDraw.ImageDraw, text: str, used: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=used)
    return box[2] - box[0], box[3] - box[1]


def make_badge(qr_path: Path, qr_px: int = 144) -> Image.Image:
    # 720 → 144 is an exact 5× downsample, which keeps QR modules scannable.
    qr = Image.open(qr_path).convert("RGB").resize((qr_px, qr_px), Image.Resampling.NEAREST)
    pad = 14
    title = "SCAN TO BOOK"
    url = "deaneauto.co.nz/book"
    title_font = font(15, bold=True)
    url_font = font(11, bold=False)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    title_w, title_h = text_size(probe, title, title_font)
    url_w, url_h = text_size(probe, url, url_font)
    inner = max(qr_px, title_w, url_w)
    width = inner + pad * 2
    height = pad + title_h + 8 + qr_px + 6 + url_h + pad
    badge = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(badge)
    draw.rectangle((0, 0, width - 1, height - 1), outline=NAVY, width=3)
    draw.text(((width - title_w) / 2, pad), title, fill=NAVY, font=title_font)
    badge.paste(qr, ((width - qr_px) // 2, pad + title_h + 8))
    draw.text(((width - url_w) / 2, pad + title_h + 8 + qr_px + 6), url, fill=NAVY, font=url_font)
    return badge


def overlay_poster(poster_path: Path, qr_path: Path, out_path: Path, place: str) -> None:
    poster = Image.open(poster_path).convert("RGB")
    badge = make_badge(qr_path)
    margin = 28
    if place == "bl":
        x = margin + 8
        y = poster.height - badge.height - 28
    elif place == "photo-br":
        x = poster.width - badge.width - 36
        y = int(poster.height * 0.52)
    elif place == "br-higher":
        x = poster.width - badge.width - 36
        y = poster.height - badge.height - 280
    elif place == "br-high":
        x = poster.width - badge.width - 36
        y = poster.height - badge.height - 210
    elif place == "br-mid":
        x = poster.width - badge.width - margin
        y = poster.height - badge.height - 118
    else:
        x = poster.width - badge.width - margin
        y = poster.height - badge.height - 22
    poster.paste(badge, (x, y))
    poster.save(out_path, "PNG")
    print(f"poster {out_path.name} ({place})")


def make_sticker(qr_path: Path, out_path: Path) -> None:
    qr = Image.open(qr_path).convert("RGB")
    pad = 36
    title = "SCAN TO BOOK"
    url = "www.deaneauto.co.nz/book"
    title_font = font(36, bold=True)
    url_font = font(22, bold=False)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    title_w, title_h = text_size(probe, title, title_font)
    url_w, url_h = text_size(probe, url, url_font)
    width = max(qr.width, title_w, url_w) + pad * 2
    height = pad + title_h + 18 + qr.height + 14 + url_h + pad
    sticker = Image.new("RGB", (width, height), WHITE)
    draw = ImageDraw.Draw(sticker)
    draw.rectangle((0, 0, width - 1, height - 1), outline=NAVY, width=8)
    draw.text(((width - title_w) / 2, pad), title, fill=NAVY, font=title_font)
    sticker.paste(qr, ((width - qr.width) // 2, pad + title_h + 18))
    draw.text(((width - url_w) / 2, pad + title_h + 18 + qr.height + 14), url, fill=NAVY, font=url_font)
    sticker.save(out_path, "PNG")
    print(f"sticker {out_path.name}")


TYRE_POSTER = "deane-tyre-99-poster.jpg"
TYRE_SCALE = 2
# Coordinates measured on the 725×1024 source poster.
TYRE_QR_BOX = (535, 818, 697, 990)
TYRE_PHONE_BAND = (20, 900, 506, 972)
TYRE_PHONE_TEXT = (36, 908, 501, 964)
TYRE_ADDRESS_CAP_H = 32
TYRE_PHONE_TOP = 922
TYRE_SUBLINE_XY = (47, 893)
TYRE_SUBLINE_SIZE = 20
TYRE_SUBLINE = "(NEXT TO BP PETROL STATION)"
YELLOW = (255, 214, 0)


def make_box_card(qr_path: Path, width: int, height: int, s: int) -> Image.Image:
    card = Image.new("RGB", (width, height), NAVY)
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=10 * s, fill=WHITE, outline=YELLOW, width=3 * s)
    title = "SCAN TO BOOK"
    url = "deaneauto.co.nz/book"
    title_font = font(14 * s, bold=True)
    url_font = font(10 * s, bold=True)
    qr_px = 118 * s
    qr = Image.open(qr_path).convert("RGB").resize((qr_px, qr_px), Image.Resampling.NEAREST)
    t_box = draw.textbbox((0, 0), title, font=title_font)
    u_box = draw.textbbox((0, 0), url, font=url_font)
    title_h = t_box[3] - t_box[1]
    url_h = u_box[3] - u_box[1]
    gap = 5 * s
    top = (height - (title_h + gap + qr_px + gap + url_h)) // 2
    draw.text(((width - (t_box[2] - t_box[0])) / 2 - t_box[0], top - t_box[1]), title, fill=NAVY, font=title_font)
    card.paste(qr, ((width - qr_px) // 2, top + title_h + gap))
    url_y = top + title_h + gap + qr_px + gap
    draw.text(((width - (u_box[2] - u_box[0])) / 2 - u_box[0], url_y - u_box[1]), url, fill=NAVY, font=url_font)
    return card


def tyre_poster(qr_path: Path) -> None:
    s = TYRE_SCALE
    src = Image.open(ADS_DIR / TYRE_POSTER).convert("RGB")
    poster = src.resize((src.width * s, src.height * s), Image.Resampling.LANCZOS)
    px = poster.load()

    phone = poster.crop(tuple(v * s for v in TYRE_PHONE_TEXT))
    # Yellow phone digits vs. navy background: the red channel works as an alpha mask.
    mask = phone.getchannel("R").point(lambda v: max(0, min(255, (v - 20) * 255 // 190)))
    ratio = TYRE_ADDRESS_CAP_H / (TYRE_PHONE_TEXT[3] - TYRE_PHONE_TEXT[1])
    size = (round(phone.width * ratio), round(phone.height * ratio))
    phone = phone.resize(size, Image.Resampling.LANCZOS)
    mask = mask.resize(size, Image.Resampling.LANCZOS)

    x0, y0, x1, y1 = (v * s for v in TYRE_PHONE_BAND)
    draw = ImageDraw.Draw(poster)
    for y in range(y0, y1):
        row = sorted(px[x, y] for x in range(506 * s, 530 * s, 2))
        draw.line((x0, y, x1, y), fill=row[len(row) // 2])
    poster.paste(phone, (TYRE_PHONE_TEXT[0] * s, TYRE_PHONE_TOP * s), mask)

    sx, sy = TYRE_SUBLINE_XY
    sub_font = font(TYRE_SUBLINE_SIZE * s, bold=True)
    box = draw.textbbox((0, 0), TYRE_SUBLINE, font=sub_font)
    draw.text((sx * s - box[0], sy * s - box[1]), TYRE_SUBLINE, fill=WHITE, font=sub_font)

    bx0, by0, bx1, by1 = (v * s for v in TYRE_QR_BOX)
    card = make_box_card(qr_path, bx1 - bx0, by1 - by0, s)
    poster.paste(card, (bx0, by0))

    out = ADS_DIR / TYRE_POSTER.replace(".jpg", "-qr.png")
    poster.save(out, "PNG")
    print(f"poster {out.name} ({poster.width}x{poster.height})")


def main() -> None:
    QR_DIR.mkdir(parents=True, exist_ok=True)
    general = QR_DIR / "book.png"
    make_sticker(general, QR_DIR / "scan-to-book-sticker.png")
    for poster_name, qr_name, place in POSTERS:
        overlay_poster(ADS_DIR / poster_name, QR_DIR / qr_name, ADS_DIR / poster_name.replace(".png", "-qr.png"), place)
    tyre_poster(QR_DIR / "book-tyres.png")


if __name__ == "__main__":
    main()
