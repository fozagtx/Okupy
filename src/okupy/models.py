from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from okupy.video.omni import OmniJobSpec, VideoMode


OutputKind = Literal["slideshow", "video"]
AgentName = Literal["supervisor", "slideshow", "video"]


class ModelProfile(BaseModel):
    """A swappable Anthropic (or Anthropic-compatible) model + key."""

    name: str
    model_id: str
    api_key: str | None = None
    base_url: str | None = None
    fallback_model: str | None = None


class SlideCard(BaseModel):
    index: int
    kind: Literal["hook", "step", "cta"] = "step"
    title: str
    body: str


class GenerateRequest(BaseModel):
    tutorial: str = Field(min_length=8)
    title: str | None = None
    outputs: list[OutputKind] = Field(default_factory=lambda: ["slideshow"])
    model: str | None = None
    user_id: str | None = None
    notify_imessage: str | None = None
    send_gmail: bool = False


class GenerateResult(BaseModel):
    job_id: str
    title: str
    supervisor: str = "supervisor"
    agents_used: list[AgentName]
    slides: list[str] = Field(default_factory=list)
    screenshots: list[str] = Field(default_factory=list)
    video_path: str | None = None
    model: ModelProfile | None = None
    notes: list[str] = Field(default_factory=list)


class VideoRequest(BaseModel):
    """Backend video job: generate, drop-in edit, inpaint, or keyframe interpolation."""

    mode: VideoMode = "generate"
    prompt: str = Field(min_length=3)
    video_path: str | None = None
    first_frame_path: str | None = None
    last_frame_path: str | None = None
    mask_path: str | None = None
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    previous_interaction_id: str | None = None


class VideoJobResult(BaseModel):
    job_id: str
    agent: AgentName = "video"
    mode: VideoMode
    task: str
    prompt: str
    video_path: str | None = None
    spec: OmniJobSpec | None = None
    interaction: dict[str, Any] = Field(default_factory=dict)
    interaction_id: str | None = None
    note: str
