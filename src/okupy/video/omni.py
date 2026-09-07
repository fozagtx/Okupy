from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class VideoResult:
    path: Path | None
    prompt: str
    model: str
    note: str


class OmniVideoClient:
    """Gemini Omni video generation via the Interactions API."""

    def __init__(self, api_key: str = "", model: str = "gemini-omni-flash-preview") -> None:
        self.api_key = api_key
        self.model = model

    def generate(self, tutorial: str, title: str, output_dir: Path) -> VideoResult:
        prompt = (
            f"Vertical 9:16 tutorial video for TikTok. Title: {title}. "
            f"Teach this clearly with on-screen steps and no watermark: {tutorial[:1200]}"
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        dest = output_dir / "omni.mp4"
        if not self.api_key:
            return VideoResult(
                path=None,
                prompt=prompt,
                model=self.model,
                note="GEMINI_API_KEY is not set. Video prompt was prepared but not rendered.",
            )
        try:
            from google import genai
        except ImportError:
            return VideoResult(
                path=None,
                prompt=prompt,
                model=self.model,
                note="google-genai is not installed.",
            )

        client = genai.Client(api_key=self.api_key)
        interaction = client.interactions.create(
            model=self.model,
            input=prompt,
            response_format={"type": "video", "aspect_ratio": "9:16", "resolution": "720p"},
        )
        payload = getattr(interaction, "output_video", None)
        data = getattr(payload, "data", None) if payload is not None else None
        if not data:
            return VideoResult(path=None, prompt=prompt, model=self.model, note="Omni returned no video payload.")
        import base64

        dest.write_bytes(base64.b64decode(data))
        return VideoResult(path=dest, prompt=prompt, model=self.model, note="Rendered with Gemini Omni.")
