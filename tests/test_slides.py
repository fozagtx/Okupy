from __future__ import annotations

from PIL import Image

from okupy.slides import TIKTOK_HEIGHT, TIKTOK_WIDTH, outline_tutorial
from okupy.slides.render import render_cards


TUTORIAL = """How to film a tutorial on your phone
1. Lock exposure and put the phone on a stack of books.
2. Write three beats: hook, demo, CTA.
3. Cut dead air. Captions on every line.
4. Export 9:16 and post the carousel first.
"""


def test_outline_has_hook_steps_and_cta():
    cards = outline_tutorial(TUTORIAL)
    assert cards[0].kind == "hook"
    assert cards[-1].kind == "cta"
    assert any(card.kind == "step" for card in cards)
    assert "Lock exposure" in cards[1].body


def test_render_tiktok_dimensions(tmp_path):
    cards = outline_tutorial(TUTORIAL, title="Phone tutorials")
    paths = render_cards(cards, tmp_path)
    assert paths
    image = Image.open(paths[0])
    assert image.size == (TIKTOK_WIDTH, TIKTOK_HEIGHT)
    html = tmp_path / "slide-00.html"
    assert html.exists()
    assert "1080px" in html.read_text(encoding="utf-8")
