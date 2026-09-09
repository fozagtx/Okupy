from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


VideoMode = Literal["generate", "edit", "inpaint", "keyframes"]


class OmniAsset(BaseModel):
    role: Literal["source_video", "first_frame", "last_frame", "mask"]
    kind: Literal["video", "image"]
    path: str
    mime_type: str


class OmniJobSpec(BaseModel):
    """Pure request plan for Gemini Omni. No network."""

    mode: VideoMode
    task: str
    prompt: str
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    previous_interaction_id: str | None = None
    assets: list[OmniAsset] = Field(default_factory=list)

    def interaction_payload(self, model: str) -> dict[str, Any]:
        parts: list[dict[str, Any]] = [{"type": "text", "text": self.prompt}]
        for asset in self.assets:
            parts.append(
                {
                    "type": asset.kind,
                    "path": asset.path,
                    "role": asset.role,
                    "mime_type": asset.mime_type,
                }
            )
        payload: dict[str, Any] = {
            "model": model,
            "input": parts,
            "generation_config": {"video_config": {"task": self.task}},
            "response_format": {
                "type": "video",
                "aspect_ratio": self.aspect_ratio,
                "resolution": self.resolution,
            },
        }
        if self.previous_interaction_id:
            payload["previous_interaction_id"] = self.previous_interaction_id
        return payload


@dataclass
class VideoResult:
    path: Path | None
    prompt: str
    model: str
    note: str
    spec: OmniJobSpec | None = None
    interaction_id: str | None = None


class OmniJobError(ValueError):
    pass


def _mime(path: Path, fallback: str) -> str:
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or fallback


def _require_file(path: str | Path | None, label: str) -> Path:
    if not path:
        raise OmniJobError(f"{label} is required.")
    resolved = Path(path)
    if not resolved.is_file():
        raise OmniJobError(f"{label} not found: {resolved}")
    return resolved


def build_omni_job(
    *,
    mode: VideoMode,
    prompt: str,
    video_path: str | Path | None = None,
    first_frame_path: str | Path | None = None,
    last_frame_path: str | Path | None = None,
    mask_path: str | Path | None = None,
    aspect_ratio: str = "9:16",
    resolution: str = "720p",
    previous_interaction_id: str | None = None,
) -> OmniJobSpec:
    """Build a Gemini Omni Interactions payload for generate / edit / inpaint / keyframes."""
    text = (prompt or "").strip()
    if not text:
        raise OmniJobError("prompt is required.")
    if aspect_ratio not in {"9:16", "16:9"}:
        raise OmniJobError("aspect_ratio must be 9:16 or 16:9.")

    if mode == "generate":
        return OmniJobSpec(
            mode=mode,
            task="text_to_video",
            prompt=text,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            previous_interaction_id=previous_interaction_id,
        )

    if mode == "keyframes":
        first = _require_file(first_frame_path, "first_frame")
        last = _require_file(last_frame_path, "last_frame")
        tagged = f"[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] {text}"
        return OmniJobSpec(
            mode=mode,
            task="image_to_video",
            prompt=tagged,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            previous_interaction_id=previous_interaction_id,
            assets=[
                OmniAsset(
                    role="first_frame",
                    kind="image",
                    path=str(first),
                    mime_type=_mime(first, "image/png"),
                ),
                OmniAsset(
                    role="last_frame",
                    kind="image",
                    path=str(last),
                    mime_type=_mime(last, "image/png"),
                ),
            ],
        )

    clip = _require_file(video_path, "video")
    assets = [
        OmniAsset(
            role="source_video",
            kind="video",
            path=str(clip),
            mime_type=_mime(clip, "video/mp4"),
        )
    ]
    if mode == "inpaint":
        instruction = f"[# Sources <VIDEO_0>@Video1] Inpaint: {text}. Keep everything else the same."
        if mask_path:
            mask = _require_file(mask_path, "mask")
            instruction = (
                f"[# Sources <VIDEO_0>@Video1] [# References <IMAGE_REF_0>@Image1] "
                f"Inpaint the masked region using <IMAGE_REF_0>: {text}. Keep everything else the same."
            )
            assets.append(
                OmniAsset(
                    role="mask",
                    kind="image",
                    path=str(mask),
                    mime_type=_mime(mask, "image/png"),
                )
            )
        return OmniJobSpec(
            mode=mode,
            task="edit",
            prompt=instruction,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            previous_interaction_id=previous_interaction_id,
            assets=assets,
        )

    if mode == "edit":
        return OmniJobSpec(
            mode=mode,
            task="edit",
            prompt=f"[# Sources <VIDEO_0>@Video1] {text}. Keep everything else the same.",
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            previous_interaction_id=previous_interaction_id,
            assets=assets,
        )

    raise OmniJobError(f"Unknown video mode: {mode}")


class OmniVideoClient:
    """Gemini Omni generate + edit via the Interactions API."""

    def __init__(self, api_key: str = "", model: str = "gemini-omni-1.1-flash") -> None:
        self.api_key = api_key
        self.model = model

    def generate(self, tutorial: str, title: str, output_dir: Path) -> VideoResult:
        prompt = (
            f"Vertical 9:16 tutorial video for TikTok. Title: {title}. "
            f"Teach this clearly with on-screen steps and no watermark: {tutorial[:1200]}"
        )
        spec = build_omni_job(mode="generate", prompt=prompt, aspect_ratio="9:16")
        return self.run(spec, output_dir / "omni.mp4")

    def run(self, spec: OmniJobSpec, dest: Path) -> VideoResult:
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not self.api_key:
            return VideoResult(
                path=None,
                prompt=spec.prompt,
                model=self.model,
                note="GEMINI_API_KEY is not set. Omni job was planned but not rendered.",
                spec=spec,
            )
        try:
            from google import genai
        except ImportError:
            return VideoResult(
                path=None,
                prompt=spec.prompt,
                model=self.model,
                note="google-genai is not installed.",
                spec=spec,
            )

        client = genai.Client(api_key=self.api_key)
        payload = spec.interaction_payload(self.model)
        payload["input"] = _materialize_inputs(client, spec)
        interaction = client.interactions.create(**{k: v for k, v in payload.items() if k != "model"}, model=payload["model"])
        data = _video_bytes(interaction)
        if not data:
            return VideoResult(
                path=None,
                prompt=spec.prompt,
                model=self.model,
                note="Omni returned no video payload.",
                spec=spec,
                interaction_id=getattr(interaction, "id", None),
            )
        dest.write_bytes(data)
        return VideoResult(
            path=dest,
            prompt=spec.prompt,
            model=self.model,
            note=f"Rendered with Gemini Omni ({spec.mode}).",
            spec=spec,
            interaction_id=getattr(interaction, "id", None),
        )


def _materialize_inputs(client: Any, spec: OmniJobSpec) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"type": "text", "text": spec.prompt}]
    for asset in spec.assets:
        path = Path(asset.path)
        uri = None
        mime = asset.mime_type
        if hasattr(client, "files") and hasattr(client.files, "upload"):
            uploaded = client.files.upload(file=str(path))
            uri = getattr(uploaded, "uri", None)
            mime = getattr(uploaded, "mime_type", None) or mime
        if uri:
            parts.append({"type": asset.kind, "uri": uri, "mime_type": mime})
        else:
            parts.append(
                {
                    "type": asset.kind,
                    "mime_type": mime,
                    "data": base64.b64encode(path.read_bytes()).decode("ascii"),
                }
            )
    return parts


def _video_bytes(interaction: Any) -> bytes | None:
    payload = getattr(interaction, "output_video", None)
    data = getattr(payload, "data", None) if payload is not None else None
    if data:
        return base64.b64decode(data)
    return None
