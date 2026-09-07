from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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
