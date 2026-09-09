from __future__ import annotations

import re

from okupy.models import SlideCard

TIKTOK_WIDTH = 1080
TIKTOK_HEIGHT = 1920
MAX_SLIDES = 8


def derive_title(tutorial: str, title: str | None) -> str:
    if title and title.strip():
        return title.strip()
    first = tutorial.strip().splitlines()[0].strip()
    first = re.sub(r"^#+\s*", "", first)
    return first[:72] if first else "Untitled tutorial"


def outline_tutorial(tutorial: str, title: str | None = None) -> list[SlideCard]:
    """Turn a tutorial into a short TikTok carousel outline."""
    heading = derive_title(tutorial, title)
    steps = _extract_steps(tutorial)
    cards: list[SlideCard] = [
        SlideCard(index=0, kind="hook", title=heading, body="Watch this. Then do it.")
    ]
    for i, step in enumerate(steps[: MAX_SLIDES - 2], start=1):
        cards.append(SlideCard(index=i, kind="step", title=f"Step {i}", body=step))
    cards.append(
        SlideCard(
            index=len(cards),
            kind="cta",
            title="Your turn",
            body="Save this. Try it once. Send me the tutorial you want next.",
        )
    )
    for i, card in enumerate(cards):
        card.index = i
    return cards


def _extract_steps(tutorial: str) -> list[str]:
    numbered = re.findall(
        r"(?:^|[\n\s])(?:\d+[\).:-]|[-*])\s+(.+?)(?=(?:[\n\s]+(?:\d+[\).:-]|[-*])\s+)|\s*$)",
        tutorial,
        flags=re.S,
    )
    numbered = [_clean(s) for s in numbered if _usable_step(s)]
    if len(numbered) >= 2:
        return numbered

    blocks = [b.strip() for b in re.split(r"\n\s*\n", tutorial) if b.strip()]
    if len(blocks) >= 2:
        return [_clean(b) for b in blocks[1:] if _usable_step(b)]

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", tutorial.strip()) if s.strip()]
    sentences = [_clean(s) for s in sentences if _usable_step(s)]
    if len(sentences) >= 3:
        return sentences[1:]

    cleaned = _clean(tutorial)
    return [cleaned] if cleaned else ["Follow along with the full tutorial."]


def _usable_step(text: str) -> bool:
    cleaned = _clean(text)
    if not cleaned:
        return False
    return not re.fullmatch(r"\d+[).:-]?", cleaned)


def _clean(text: str) -> str:
    text = re.sub(r"^#+\s*", "", text.strip())
    text = re.sub(r"\s+", " ", text)
    return text[:220]
