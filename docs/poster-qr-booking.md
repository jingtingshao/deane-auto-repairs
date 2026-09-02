# Poster QR — book online

Every promotional poster / flyer should include a **Scan to book** QR code so customers can open the website booking form on their phone.

## Canonical booking URL

```
https://www.deaneauto.co.nz/book
```

This short link opens the public site and scrolls to the booking form (`#book`). Prefer this over a long homepage URL or a `#book` fragment alone (some phone cameras handle `/book` more reliably).

## Print-ready assets

| File | Use |
|------|-----|
| `exports/ads/qr-book-deaneauto.png` | High-res QR only (navy on white) |
| `exports/ads/qr-book-deaneauto.svg` | Vector QR for Canva / Illustrator |
| `exports/ads/qr-book-plate.png` | Drop-in plate: QR + **SCAN TO BOOK** + `deaneauto.co.nz/book` |

Existing posters in `exports/ads/` already have the plate stamped on (bottom-right, above the footer).

## Design rules

1. Keep a **quiet zone** (white margin) around the QR — do not crop into the code.
2. Minimum print size: about **25–30 mm** wide for the code itself (larger on A3).
3. Place on a light / plain area, or use the white `qr-book-plate.png` card.
4. Keep phone `0800 625 9827` on the poster as a fallback.
5. Do not point the QR at GitHub Pages, localhost, or admin URLs.

## Regenerate the QR

If the live domain or path changes:

```bash
npx --yes qrcode -o exports/ads/qr-book-deaneauto.png -w 1024 -m 2 "https://www.deaneauto.co.nz/book"
npx --yes qrcode -t svg -o exports/ads/qr-book-deaneauto.svg -m 2 "https://www.deaneauto.co.nz/book"
```

Then rebuild `qr-book-plate.png` (or re-export from Canva) and re-stamp new posters.

## Copy line (optional)

> Scan to book · or call 0800 625 9827  
> Mon–Sat 8:30am – 5:30pm · Sunday closed
