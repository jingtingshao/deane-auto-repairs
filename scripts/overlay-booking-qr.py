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


def make_sticker(
    qr_path: Path,
    out_path: Path,
    title: str = "SCAN TO BOOK",
    url: str = "www.deaneauto.co.nz/book",
) -> None:
    qr = Image.open(qr_path).convert("RGB")
    pad = 36
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


def make_box_card(
    qr_path: Path,
    width: int,
    height: int,
    s: int,
    title: str = "SCAN TO BOOK",
    url: str = "deaneauto.co.nz/book",
) -> Image.Image:
    card = Image.new("RGB", (width, height), NAVY)
    draw = ImageDraw.Draw(card)
    draw.rounded_rectangle((0, 0, width - 1, height - 1), radius=10 * s, fill=WHITE, outline=YELLOW, width=3 * s)
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


TYRE_CARD_TITLE = "SCAN FOR PRICES"
TYRE_CARD_URL = "deaneauto.co.nz/tyres"


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
    card = make_box_card(
        qr_path, bx1 - bx0, by1 - by0, s, title=TYRE_CARD_TITLE, url=TYRE_CARD_URL
    )
    poster.paste(card, (bx0, by0))

    out = ADS_DIR / TYRE_POSTER.replace(".jpg", "-qr.png")
    poster.save(out, "PNG")
    print(f"poster {out.name} ({poster.width}x{poster.height})")


TYRE_CN_POSTER = "deane-tyre-99-poster-cn.jpg"
# Coordinates measured on the 725×1024 source poster.
TYRE_CN_QR_BOX = (535, 815, 697, 986)
TYRE_CN_PHONE_TEXT = (30, 900, 506, 966)
TYRE_CN_PHONE_SCALE = 0.95 * 0.95
TYRE_CN_PHONE_TOP = 914
TYRE_CN_SUBLINE_XY = (37, 888)
TYRE_CN_SUBLINE_SIZE = 19


def load_cn_poster() -> Image.Image:
    src = Image.open(ADS_DIR / TYRE_CN_POSTER).convert("RGB")
    return src.resize((src.width * TYRE_SCALE, src.height * TYRE_SCALE), Image.Resampling.LANCZOS)


def tyre_poster_cn(qr_path: Path) -> None:
    finish_cn_poster(
        load_cn_poster(),
        qr_path,
        TYRE_CN_POSTER.replace(".jpg", "-qr.png"),
        title=TYRE_CARD_TITLE,
        url=TYRE_CARD_URL,
    )


def finish_cn_poster(
    poster: Image.Image,
    qr_path: Path,
    out_name: str,
    title: str = "SCAN TO BOOK",
    url: str = "deaneauto.co.nz/book",
) -> None:
    s = TYRE_SCALE
    px = poster.load()

    x0, y0, x1, y1 = (v * s for v in TYRE_CN_PHONE_TEXT)
    phone = poster.crop((x0, y0, x1, y1))
    # Yellow phone digits vs. navy background: the red channel works as an alpha mask.
    mask = phone.getchannel("R").point(lambda v: max(0, min(255, (v - 20) * 255 // 190)))
    size = (round(phone.width * TYRE_CN_PHONE_SCALE), round(phone.height * TYRE_CN_PHONE_SCALE))
    phone = phone.resize(size, Image.Resampling.LANCZOS)
    mask = mask.resize(size, Image.Resampling.LANCZOS)

    draw = ImageDraw.Draw(poster)
    for y in range(y0, y1):
        row = sorted(px[x, y] for x in range(x1, TYRE_CN_QR_BOX[0] * s - 4, 2))
        draw.line((x0, y, x1, y), fill=row[len(row) // 2])
    poster.paste(phone, (x0, TYRE_CN_PHONE_TOP * s), mask)

    sx, sy = TYRE_CN_SUBLINE_XY
    sub_font = font(TYRE_CN_SUBLINE_SIZE * s, bold=True)
    box = draw.textbbox((0, 0), TYRE_SUBLINE, font=sub_font)
    draw.text((sx * s - box[0], sy * s - box[1]), TYRE_SUBLINE, fill=WHITE, font=sub_font)

    bx0, by0, bx1, by1 = (v * s for v in TYRE_CN_QR_BOX)
    card = make_box_card(qr_path, bx1 - bx0, by1 - by0, s, title=title, url=url)
    poster.paste(card, (bx0, by0))

    out = ADS_DIR / out_name
    poster.save(out, "PNG")
    print(f"poster {out.name} ({poster.width}x{poster.height})")


WOF_CN_OUT = "deane-wof-49-poster-cn-qr.png"
# Boxes on the 725×1024 tyre poster: (x0, y0, x1, y1), inclusive text bounds.
CN_HEADLINE = (87, 320, 386, 420)
CN_PRICE = (174, 438, 389, 557)
CN_FROM = (84, 442, 155, 471)
CN_TYRE_PHOTO = (418, 293, 706, 572)
CN_TILE_ROW = (47, 607, 682, 758)
CN_DATES = "01/11/2026 – 31/12/2026"
CN_DATES_TOP = 600
CN_DATES_CAP = 30
BLACK_FONT = "ariblk.ttf"
PRICE_YELLOW = (255, 219, 8)


def erase_text(
    poster: Image.Image,
    box: tuple[int, int, int, int],
    s: int,
    pad: int = 10,
    band: int = 6,
    replace_all: bool = False,
) -> None:
    """Replace text + dark halo with a smooth navy gradient fitted from the surrounding band.

    Pixels lighter than the gradient (the hex pattern) are kept so the texture is not cut off,
    unless replace_all is set (for photos).
    """
    import cv2
    import numpy as np

    x0, y0, x1, y1 = ((box[0] - pad) * s, (box[1] - pad) * s, (box[2] + pad) * s, (box[3] + pad) * s)
    b = band * s
    arr = np.array(poster).astype(np.float64)
    ys, xs = np.mgrid[y0 - b : y1 + b, x0 - b : x1 + b]
    outer = arr[y0 - b : y1 + b, x0 - b : x1 + b]
    in_band = ~((ys >= y0) & (ys < y1) & (xs >= x0) & (xs < x1))
    clean = in_band & (outer[..., 0] < 55)

    def design(x, y):
        x = (x - x0) / (x1 - x0)
        y = (y - y0) / (y1 - y0)
        return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)

    coef, *_ = np.linalg.lstsq(design(xs[clean], ys[clean]), outer[clean], rcond=None)
    ry, rx = np.mgrid[y0:y1, x0:x1]
    model = design(rx.astype(float), ry.astype(float)) @ coef
    region = arr[y0:y1, x0:x1]
    lum = region @ [0.3, 0.5, 0.2]
    model_lum = model @ [0.3, 0.5, 0.2]
    if replace_all:
        mask = np.zeros(region.shape[:2], np.uint8)
        mask[2 * s : -2 * s, 2 * s : -2 * s] = 255
    else:
        replace = (region[..., 0] > 55) | (lum < model_lum - 3)
        mask = cv2.dilate(replace.astype(np.uint8) * 255, np.ones((3 * s, 3 * s), np.uint8))
    alpha = cv2.GaussianBlur(mask.astype(np.float64) / 255, (0, 0), s)[..., None]
    arr[y0:y1, x0:x1] = region * (1 - alpha) + model * alpha
    poster.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)))


def fitted_text_mask(text: str, ref: str, font_name: str, ref_w: int, ref_h: int) -> Image.Image:
    """Render `text` stretched the same way `ref` must be to fill ref_w × ref_h."""
    big = ImageFont.truetype(font_name, 400)
    rb = big.getbbox(ref)
    sx = ref_w / (rb[2] - rb[0])
    sy = ref_h / (rb[3] - rb[1])
    tb = big.getbbox(text)
    mask = Image.new("L", (tb[2] - tb[0], tb[3] - tb[1]), 0)
    ImageDraw.Draw(mask).text((-tb[0], -tb[1]), text, font=big, fill=255)
    return mask.resize((round(mask.width * sx), round(mask.height * sy)), Image.Resampling.LANCZOS)


def paste_text(poster: Image.Image, mask: Image.Image, xy: tuple[int, int], fill, s: int, shadow: int = 150) -> None:
    from PIL import ImageFilter

    if shadow:
        blurred = mask.filter(ImageFilter.GaussianBlur(2 * s)).point(lambda v: v * shadow // 255)
        poster.paste((0, 6, 20), (xy[0] + 3 * s, xy[1] + 4 * s), blurred)
    poster.paste(fill, xy, mask)


def wof_poster_cn(qr_path: Path) -> None:
    s = TYRE_SCALE
    poster = load_cn_poster()

    hx0, hy0, hx1, hy1 = CN_HEADLINE
    px0, py0, px1, py1 = CN_PRICE
    erase_text(poster, CN_HEADLINE, s)
    erase_text(poster, CN_PRICE, s)
    erase_text(poster, CN_FROM, s, pad=6)
    erase_text(poster, CN_TYRE_PHOTO, s, pad=10, band=8, replace_all=True)
    erase_text(poster, CN_TILE_ROW, s, pad=8, replace_all=True)

    center_x = poster.width // 2
    head = fitted_text_mask("WOF", "TYRE", BLACK_FONT, (hx1 - hx0 + 1) * s, (hy1 - hy0 + 1) * s)
    paste_text(poster, head, (center_x - head.width // 2, hy0 * s), WHITE, s, shadow=110)
    price = fitted_text_mask("$49", "$99", BLACK_FONT, (px1 - px0 + 1) * s, (py1 - py0 + 1) * s)
    paste_text(poster, price, (center_x - price.width // 2, py0 * s), PRICE_YELLOW, s)

    big = ImageFont.truetype("arialbd.ttf", 200)
    cap = big.getbbox("0")
    tb = big.getbbox(CN_DATES)
    dates = Image.new("L", (tb[2] - tb[0], cap[3] - cap[1]), 0)
    ImageDraw.Draw(dates).text((-tb[0], -cap[1]), CN_DATES, font=big, fill=255)
    scale = CN_DATES_CAP * s / dates.height
    dates = dates.resize((round(dates.width * scale), CN_DATES_CAP * s), Image.Resampling.LANCZOS)
    paste_text(poster, dates, (center_x - dates.width // 2, CN_DATES_TOP * s), WHITE, s, shadow=110)

    finish_cn_poster(poster, qr_path, WOF_CN_OUT)


SERVICE_CN_OUT = "deane-service-99-poster-cn-qr.png"
CN_HEADLINE_MAX_X = 405
SERVICE_TOP_LINE = "OIL & FILTER"
SERVICE_CAP = 64
SERVICE_TOP_LINE_GAP = 12
CN_HEADLINE_MIN_SQUEEZE = 0.8
CN_MID_TILE_ICON = (312, 612, 408, 705)
CN_MID_TILE_ICON_CENTER = (360, 658)
CN_TILE_ICON_D = 82
CN_MID_TILE_LABEL = (293, 725, 427, 756)
CN_MID_TILE_CENTER_X = 360.5
LABEL_FONT = "impact.ttf"
SERVICE_PRODUCTS = "service-products-castrol-navy.jpg"
# Where the product group lands on the 725×1024 poster (replaces the tyre photo).
SERVICE_PRODUCTS_CENTER = (562, 445)
SERVICE_PRODUCTS_HEIGHT = 330


def paste_on_navy(
    poster: Image.Image, photo_name: str, center: tuple[int, int], height: int, s: int, max_width: int | None = None
) -> None:
    """Blend a product photo shot on navy into the poster's navy by adding only its difference from its own backdrop."""
    import cv2
    import numpy as np

    img = np.array(Image.open(ADS_DIR / photo_name).convert("RGB")).astype(np.float64)
    h, w = img.shape[:2]
    band = max(8, w // 25)
    ys, xs = np.mgrid[0:h, 0:w]
    edge = (xs < band) | (xs >= w - band) | (ys < band) | (ys >= h - band)

    def design(x, y):
        x = x / w
        y = y / h
        return np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=-1)

    coef, *_ = np.linalg.lstsq(design(xs[edge].astype(float), ys[edge].astype(float)), img[edge], rcond=None)
    backdrop = design(xs.astype(float), ys.astype(float)) @ coef
    diff = img - backdrop
    alpha = np.clip((np.abs(diff).max(axis=2) - 14) / 26, 0, 1).astype(np.float32)
    alpha = cv2.GaussianBlur(cv2.dilate(alpha, np.ones((5, 5), np.uint8)), (0, 0), 2)

    ys_obj, xs_obj = np.nonzero(alpha > 0.5)
    obj_h = ys_obj.max() - ys_obj.min() + 1
    obj_w = xs_obj.max() - xs_obj.min() + 1
    obj_cx = (xs_obj.min() + xs_obj.max()) / 2
    obj_cy = (ys_obj.min() + ys_obj.max()) / 2
    k = height * s / obj_h
    if max_width:
        k = min(k, max_width * s / obj_w)
    size = (round(w * k), round(h * k))
    diff = cv2.resize(diff, size, interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(alpha, size, interpolation=cv2.INTER_AREA)[..., None]
    left = round(center[0] * s - obj_cx * k)
    top = round(center[1] * s - obj_cy * k)

    arr = np.array(poster).astype(np.float64)
    ph, pw = arr.shape[:2]
    x0, y0 = max(0, left), max(0, top)
    x1, y1 = min(pw, left + size[0]), min(ph, top + size[1])
    sub = (slice(y0 - top, y1 - top), slice(x0 - left, x1 - left))
    arr[y0:y1, x0:x1] += diff[sub] * alpha[sub]
    poster.paste(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)))


def erase_icon(poster: Image.Image, box: tuple[int, int, int, int], s: int) -> None:
    """Fill the icon box with the tile's flat yellow."""
    x0, y0, x1, y1 = (v * s for v in box)
    px = poster.load()
    samples = sorted(
        px[x, y]
        for y in range(y0, y1, 2)
        for x in list(range(x0 - 8 * s, x0 - 2 * s)) + list(range(x1 + 2 * s, x1 + 8 * s))
    )
    ImageDraw.Draw(poster).rectangle((x0, y0, x1, y1), fill=samples[len(samples) // 2])


def tyre_icon(diameter: int, color) -> Image.Image:
    """Side-on tyre + 5-spoke wheel, drawn 4× and downsampled for smooth edges."""
    import math

    d = diameter * 4
    c = d / 2
    icon = Image.new("L", (d, d), 0)
    draw = ImageDraw.Draw(icon)

    def disc(r: float, fill: int) -> None:
        draw.ellipse((c - r, c - r, c + r, c + r), fill=fill)

    def bar(a: float, r0: float, r1: float, half_w: float) -> None:
        nx, ny = -math.sin(a) * half_w, math.cos(a) * half_w
        draw.polygon(
            [
                (c + r0 * math.cos(a) + nx, c + r0 * math.sin(a) + ny),
                (c + r1 * math.cos(a) + nx, c + r1 * math.sin(a) + ny),
                (c + r1 * math.cos(a) - nx, c + r1 * math.sin(a) - ny),
                (c + r0 * math.cos(a) - nx, c + r0 * math.sin(a) - ny),
            ],
            fill=255,
        )

    disc(0.47 * d, 255)
    blocks = 20
    for i in range(blocks):
        a = 2 * math.pi * i / blocks
        half = math.pi / blocks * 0.55
        draw.polygon(
            [
                (c + r * math.cos(a + t), c + r * math.sin(a + t))
                for r, t in ((0.44 * d, -half), (0.5 * d, -half), (0.5 * d, half), (0.44 * d, half))
            ],
            fill=255,
        )
    disc(0.30 * d, 0)
    disc(0.255 * d, 255)
    disc(0.225 * d, 0)
    disc(0.085 * d, 255)
    for i in range(5):
        bar(2 * math.pi * i / 5 - math.pi / 2, 0.06 * d, 0.235 * d, 0.035 * d)
    disc(0.03 * d, 0)
    mask = icon.resize((diameter, diameter), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (diameter, diameter), tuple(color) + (0,))
    out.putalpha(mask)
    return out


def fit_width(mask: Image.Image, max_w: int, min_squeeze: float = 1.0) -> Image.Image:
    """Narrow (down to min_squeeze) then scale down uniformly until mask fits max_w."""
    if mask.width <= max_w:
        return mask
    squeeze = max(min_squeeze, max_w / mask.width)
    uniform = min(1.0, max_w / (mask.width * squeeze))
    return mask.resize((round(mask.width * squeeze * uniform), round(mask.height * uniform)), Image.Resampling.LANCZOS)


BRAKE_CN_OUT = "deane-brake-pad-139-poster-cn-qr.png"
BRAKE_PRODUCTS = "brake-pads-navy.jpg"
BRAKE_PRODUCTS_CENTER = (580, 495)
BRAKE_HEADLINE_MAX_X = 500
BRAKE_PRODUCTS_HEIGHT = 280
BRAKE_PRODUCTS_MAX_WIDTH = 272
CN_PRICE_MAX_X = 415
CN_THIRD_TILE_ICON = (548, 612, 652, 705)
CN_THIRD_TILE_LABEL = (523, 727, 679, 754)
CN_THIRD_TILE_CENTER_X = 599


def brake_poster_cn(qr_path: Path) -> None:
    s = TYRE_SCALE
    poster = load_cn_poster()
    original = poster.copy()

    hx0, hy0, hx1, hy1 = CN_HEADLINE
    px0, py0, px1, py1 = CN_PRICE
    erase_text(poster, CN_HEADLINE, s)
    erase_text(poster, CN_PRICE, s)
    erase_text(poster, CN_TYRE_PHOTO, s, pad=10, band=8, replace_all=True)
    erase_text(poster, CN_MID_TILE_LABEL, s, pad=6)
    erase_icon(poster, CN_MID_TILE_ICON, s)
    erase_text(poster, CN_THIRD_TILE_LABEL, s, pad=6)
    erase_icon(poster, CN_THIRD_TILE_ICON, s)
    paste_on_navy(poster, BRAKE_PRODUCTS, BRAKE_PRODUCTS_CENTER, BRAKE_PRODUCTS_HEIGHT, s, BRAKE_PRODUCTS_MAX_WIDTH)

    head = fit_width(
        fitted_text_mask("BRAKE PAD", "TYRE", BLACK_FONT, (hx1 - hx0 + 1) * s, (hy1 - hy0 + 1) * s),
        (BRAKE_HEADLINE_MAX_X - hx0) * s,
        CN_HEADLINE_MIN_SQUEEZE,
    )
    paste_text(poster, head, (hx0 * s, (hy1 + 1) * s - head.height), WHITE, s, shadow=110)
    price = fit_width(
        fitted_text_mask("$139", "$99", BLACK_FONT, (px1 - px0 + 1) * s, (py1 - py0 + 1) * s),
        (CN_PRICE_MAX_X - px0) * s,
    )
    paste_text(poster, price, (px0 * s, py0 * s), PRICE_YELLOW, s)

    # Middle tile: SERVICE → TYRE (same as the service poster).
    lx0, ly0, lx1, ly1 = CN_MID_TILE_LABEL
    label = fitted_text_mask("TYRE", "SERVICE", LABEL_FONT, (lx1 - lx0 + 1) * s, (ly1 - ly0 + 1) * s)
    paste_text(poster, label, (round(CN_MID_TILE_CENTER_X * s - label.width / 2), ly0 * s), WHITE, s, shadow=90)
    src_px = Image.open(ADS_DIR / TYRE_CN_POSTER).convert("RGB").load()
    x0, y0, x1, y1 = CN_MID_TILE_ICON
    navy = sorted(src_px[x, y] for y in range(y0, y1) for x in range(x0, x1) if src_px[x, y][0] < 60)
    icon = tyre_icon(CN_TILE_ICON_D * s, navy[len(navy) // 2])
    cx, cy = CN_MID_TILE_ICON_CENTER
    poster.paste(icon, (cx * s - icon.width // 2, cy * s - icon.height // 2), icon)

    # Third tile: BRAKE PAD → the original wrench + SERVICE label.
    wrench = original.crop(tuple(v * s for v in CN_MID_TILE_ICON))
    poster.paste(wrench, (round(CN_THIRD_TILE_CENTER_X * s - wrench.width / 2), y0 * s))
    service = original.crop((lx0 * s, ly0 * s, (lx1 + 1) * s, (ly1 + 1) * s))
    service_mask = service.getchannel("R").point(lambda v: max(0, min(255, (v - 60) * 255 // 150)))
    paste_text(
        poster,
        service_mask,
        (round(CN_THIRD_TILE_CENTER_X * s - service.width / 2), ly0 * s),
        WHITE,
        s,
        shadow=90,
    )

    finish_cn_poster(poster, qr_path, BRAKE_CN_OUT)


FULL_SERVICE_CN_OUT = "deane-full-service-199-poster-cn-qr.png"
FULL_SERVICE_NOTE = "Includes digital service report"
SERVICE_NOTE_GAP = 16
SERVICE_NOTE_SIZE = 22


def service_poster_cn(
    qr_path: Path,
    top_text: str = SERVICE_TOP_LINE,
    price_text: str | None = None,
    out_name: str = SERVICE_CN_OUT,
    match_width: bool = True,
    note: str | None = None,
) -> None:
    """Service poster: two-line headline over SERVICE; top line matches SERVICE width or cap height."""
    s = TYRE_SCALE
    poster = load_cn_poster()
    src_px = Image.open(ADS_DIR / TYRE_CN_POSTER).convert("RGB").load()
    x0, y0, x1, y1 = CN_MID_TILE_ICON
    navy = sorted(src_px[x, y] for y in range(y0, y1) for x in range(x0, x1) if src_px[x, y][0] < 60)
    icon_navy = navy[len(navy) // 2]

    hx0, hy0, hx1, hy1 = CN_HEADLINE
    px0, py0, px1, py1 = CN_PRICE
    erase_text(poster, CN_HEADLINE, s)
    if price_text:
        erase_text(poster, CN_PRICE, s)
    erase_text(poster, CN_TYRE_PHOTO, s, pad=10, band=8, replace_all=True)
    erase_text(poster, CN_MID_TILE_LABEL, s, pad=6)
    erase_icon(poster, CN_MID_TILE_ICON, s)
    paste_on_navy(poster, SERVICE_PRODUCTS, SERVICE_PRODUCTS_CENTER, SERVICE_PRODUCTS_HEIGHT, s)
    if price_text:
        price = fit_width(
            fitted_text_mask(price_text, "$99", BLACK_FONT, (px1 - px0 + 1) * s, (py1 - py0 + 1) * s),
            (CN_PRICE_MAX_X - px0) * s,
        )
        paste_text(poster, price, (px0 * s, py0 * s), PRICE_YELLOW, s)
        price_bottom = py0 * s + price.height
    else:
        price_bottom = (py1 + 1) * s
    if note:
        draw = ImageDraw.Draw(poster)
        note_font = font(SERVICE_NOTE_SIZE * s, bold=True)
        box = draw.textbbox((0, 0), note, font=note_font)
        draw.text((hx0 * s - box[0], price_bottom + SERVICE_NOTE_GAP * s - box[1]), note, fill=WHITE, font=note_font)

    def squeezed(text: str) -> Image.Image:
        mask = fitted_text_mask(text, "TYRE", BLACK_FONT, (hx1 - hx0 + 1) * s, (hy1 - hy0 + 1) * s)
        return mask.resize((round(mask.width * CN_HEADLINE_MIN_SQUEEZE), mask.height), Image.Resampling.LANCZOS)

    head = squeezed("SERVICE")
    k = SERVICE_CAP * s / head.height
    head = head.resize((round(head.width * k), SERVICE_CAP * s), Image.Resampling.LANCZOS)
    head_top = (hy1 + 1) * s - head.height
    paste_text(poster, head, (hx0 * s, head_top), WHITE, s, shadow=110)
    top_line = squeezed(top_text)
    if match_width:
        size = (head.width, round(top_line.height * head.width / top_line.width))
    else:
        size = (round(top_line.width * head.height / top_line.height), head.height)
    top_line = top_line.resize(size, Image.Resampling.LANCZOS)
    paste_text(
        poster, top_line, (hx0 * s, head_top - SERVICE_TOP_LINE_GAP * s - top_line.height), WHITE, s, shadow=110
    )

    lx0, ly0, lx1, ly1 = CN_MID_TILE_LABEL
    label = fitted_text_mask("TYRE", "SERVICE", LABEL_FONT, (lx1 - lx0 + 1) * s, (ly1 - ly0 + 1) * s)
    paste_text(poster, label, (round(CN_MID_TILE_CENTER_X * s - label.width / 2), ly0 * s), WHITE, s, shadow=90)

    icon = tyre_icon(CN_TILE_ICON_D * s, icon_navy)
    cx, cy = CN_MID_TILE_ICON_CENTER
    poster.paste(icon, (cx * s - icon.width // 2, cy * s - icon.height // 2), icon)

    finish_cn_poster(poster, qr_path, out_name)


WOF_POSTER = "deane-wof-49-poster.jpg"
# Dashed QR box measured on the 723×1024 source poster, padded to cover the dashes.
WOF_QR_BOX = (527, 826, 685, 985)


def wof_poster(qr_path: Path) -> None:
    s = TYRE_SCALE
    src = Image.open(ADS_DIR / WOF_POSTER).convert("RGB")
    poster = src.resize((src.width * s, src.height * s), Image.Resampling.LANCZOS)
    bx0, by0, bx1, by1 = (v * s for v in WOF_QR_BOX)
    poster.paste(make_box_card(qr_path, bx1 - bx0, by1 - by0, s), (bx0, by0))
    out = ADS_DIR / WOF_POSTER.replace(".jpg", "-qr.png")
    poster.save(out, "PNG")
    print(f"poster {out.name} ({poster.width}x{poster.height})")


def main() -> None:
    QR_DIR.mkdir(parents=True, exist_ok=True)
    general = QR_DIR / "book.png"
    tyre_prices = QR_DIR / "tyre-prices.png"
    make_sticker(general, QR_DIR / "scan-to-book-sticker.png")
    make_sticker(
        tyre_prices,
        QR_DIR / "scan-tyre-prices-sticker.png",
        title="SCAN FOR TYRE PRICES",
        url="www.deaneauto.co.nz/tyres",
    )
    for poster_name, qr_name, place in POSTERS:
        overlay_poster(ADS_DIR / poster_name, QR_DIR / qr_name, ADS_DIR / poster_name.replace(".png", "-qr.png"), place)
    # Tyre ads open the live price finder so customers can check their size.
    tyre_poster(tyre_prices)
    tyre_poster_cn(tyre_prices)
    wof_poster_cn(QR_DIR / "book-wof.png")
    wof_poster(QR_DIR / "book-wof.png")
    service_poster_cn(QR_DIR / "book-basic-service.png")
    service_poster_cn(
        QR_DIR / "book-service.png", "FULL", "$199", FULL_SERVICE_CN_OUT, match_width=False, note=FULL_SERVICE_NOTE
    )
    brake_poster_cn(QR_DIR / "book-brakes.png")


if __name__ == "__main__":
    main()
