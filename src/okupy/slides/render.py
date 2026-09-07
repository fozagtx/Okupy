from __future__ import annotations

from html import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from okupy.models import SlideCard
from okupy.slides import TIKTOK_HEIGHT, TIKTOK_WIDTH

BG = (10, 10, 14)
ACCENT = (255, 45, 85)
FG = (250, 250, 252)
MUTED = (180, 180, 190)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or [""]


def render_cards(cards: list[SlideCard], output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for card in cards:
        path = output_dir / f"slide-{card.index:02d}.png"
        _render_png(card, len(cards), path)
        paths.append(path)
        _write_html(card, len(cards), output_dir / f"slide-{card.index:02d}.html")
    return paths


def _render_png(card: SlideCard, total: int, path: Path) -> None:
    image = Image.new("RGB", (TIKTOK_WIDTH, TIKTOK_HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 18, TIKTOK_HEIGHT), fill=ACCENT)

    kicker_font = _font(28, bold=True)
    title_font = _font(72, bold=True)
    body_font = _font(40, bold=False)
    meta_font = _font(26, bold=False)

    kicker = {"hook": "TUTORIAL", "step": f"{card.index}/{total - 1}", "cta": "SAVE THIS"}[card.kind]
    draw.text((80, 160), kicker, font=kicker_font, fill=ACCENT)

    y = 260
    for line in _wrap(draw, card.title, title_font, TIKTOK_WIDTH - 160):
        draw.text((80, y), line, font=title_font, fill=FG)
        y += 88

    y += 40
    for line in _wrap(draw, card.body, body_font, TIKTOK_WIDTH - 160):
        draw.text((80, y), line, font=body_font, fill=MUTED)
        y += 56

    draw.text((80, TIKTOK_HEIGHT - 140), "Okupy · TikTok slideshow", font=meta_font, fill=(90, 90, 98))
    image.save(path, "PNG")


def _write_html(card: SlideCard, total: int, path: Path) -> None:
    kicker = {"hook": "TUTORIAL", "step": f"{card.index}/{total - 1}", "cta": "SAVE THIS"}[card.kind]
    path.write_text(
        f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1080" />
    <title>{escape(card.title)}</title>
    <style>
      html, body {{ margin: 0; padding: 0; }}
      body {{
        width: 1080px; height: 1920px; background: #0a0a0e; color: #fafafc;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box; padding: 160px 80px; border-left: 18px solid #ff2d55;
      }}
      .kicker {{ color: #ff2d55; font-weight: 700; letter-spacing: 0.12em; }}
      h1 {{ font-size: 72px; line-height: 1.15; margin: 48px 0; }}
      p {{ font-size: 40px; line-height: 1.4; color: #b4b4be; }}
    </style>
  </head>
  <body>
    <div class="kicker">{escape(kicker)}</div>
    <h1>{escape(card.title)}</h1>
    <p>{escape(card.body)}</p>
  </body>
</html>
""",
        encoding="utf-8",
    )
