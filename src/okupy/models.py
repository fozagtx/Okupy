from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class BuilderProfile(BaseModel):
    user_id: str = Field(min_length=1)
    name: str = ""
    project: str = Field(min_length=2)
    project_stage: str = "building"
    goals: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    location: str = Field(min_length=2)
    radius_miles: int = Field(default=25, ge=1, le=250)
    updated_at: datetime | None = None


class Event(BaseModel):
    title: str
    url: HttpUrl
    summary: str = ""
    date: str | None = None
    location: str | None = None
    free_food: bool = False
    networking: bool = False
    builder_credits: bool = False
    why: str = ""


class DiscoveryRequest(BaseModel):
    user_id: str = Field(min_length=1)
    message: str = "Find me something worthwhile this week"
    refresh: bool = False


class AgentReply(BaseModel):
    user_id: str
    reply: str
    needs_onboarding: bool = False
    events: list[Event] = Field(default_factory=list)


class InboundMessage(BaseModel):
    from_number: str = Field(alias="from")
    text: str = Field(min_length=1)
    model_config = {"populate_by_name": True}


class ConnectRequest(BaseModel):
    user_id: str = Field(min_length=1)
    app: Literal["gmail"] = "gmail"
