from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from okupy.config import Settings, get_settings
from okupy.model_builder import ModelBuilder
from okupy.models import GenerateRequest, GenerateResult, ModelProfile, VideoJobResult, VideoRequest
from okupy.orchestrator import Supervisor, job_tools, roster
from okupy.video.omni import OmniJobError, VideoMode

settings = get_settings()
builder = ModelBuilder(settings)
supervisor = Supervisor(settings, builder)
app = FastAPI(
    title="Okupy",
    version="0.1.0",
    description="Backend API for tutorial slideshows and Gemini Omni video generate/edit.",
)


class GmailAuthRequest(BaseModel):
    user_id: str | None = None


class ModelRegisterRequest(BaseModel):
    name: str
    model_id: str
    api_key: str | None = None
    base_url: str | None = None
    fallback_model: str | None = None


class InboundMessage(BaseModel):
    from_number: str = Field(alias="from")
    text: str
    model_config = {"populate_by_name": True}


@app.get("/")
def root() -> dict:
    return {
        "name": "okupy",
        "kind": "backend",
        "docs": "/docs",
        "health": "/health",
        "agents": list(roster()),
        "endpoints": {
            "generate": "POST /v1/generate",
            "video": "POST /v1/videos",
            "video_drop": "POST /v1/videos/drop",
            "models": "GET|POST /v1/models",
            "gmail": "POST /v1/auth/gmail",
            "imessage": "POST /v1/imessage/inbound",
        },
    }


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "kind": "backend",
        "agents": list(roster()),
        "mode": settings.agent_mode,
        "model": settings.okupy_model,
        "omni_model": settings.gemini_omni_model,
    }


@app.get("/v1/architecture")
def architecture() -> dict:
    return {
        "kind": "backend",
        "agents": list(roster()),
        "pattern": "supervisor plus two specialists via Claude Agent SDK Agent tool",
        "outputs": ["TikTok 9:16 slideshow", "Gemini Omni generate/edit/inpaint/keyframes"],
        "sandbox": "Daytona screenshots after slideshow generation",
        "channels": ["HTTP API", "Photon iMessage", "Composio Gmail"],
        "docs": "/docs/architecture.md",
    }


@app.get("/v1/models")
def list_models() -> dict:
    profiles = []
    for profile in builder.list_profiles():
        item = profile.model_dump()
        if item.get("api_key"):
            item["api_key"] = "set"
        else:
            item["api_key"] = None
        profiles.append(item)
    return {"profiles": profiles}


@app.post("/v1/models")
def register_model(payload: ModelRegisterRequest) -> dict:
    profile = builder.register(
        ModelProfile(
            name=payload.name,
            model_id=payload.model_id,
            api_key=payload.api_key,
            base_url=payload.base_url,
            fallback_model=payload.fallback_model,
        )
    )
    dumped = profile.model_dump()
    dumped["api_key"] = "set" if profile.api_key else None
    return dumped


@app.post("/v1/generate", response_model=GenerateResult)
def generate(payload: GenerateRequest) -> GenerateResult:
    if not payload.outputs:
        raise HTTPException(status_code=400, detail="Pick at least one output: slideshow or video.")
    return supervisor.run(payload)


@app.post("/v1/videos", response_model=VideoJobResult)
def create_video(payload: VideoRequest) -> VideoJobResult:
    try:
        return supervisor.run_video(payload)
    except OmniJobError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/v1/videos/drop", response_model=VideoJobResult)
async def drop_video(
    prompt: str = Form(...),
    mode: VideoMode = Form("edit"),
    aspect_ratio: str = Form("9:16"),
    resolution: str = Form("720p"),
    previous_interaction_id: str | None = Form(None),
    video: UploadFile | None = File(None),
    first_frame: UploadFile | None = File(None),
    last_frame: UploadFile | None = File(None),
    mask: UploadFile | None = File(None),
) -> VideoJobResult:
    job_id = uuid.uuid4().hex[:12]
    inbox = job_tools(settings).job_dir(job_id) / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    request = VideoRequest(
        mode=mode,
        prompt=prompt,
        aspect_ratio=aspect_ratio,
        resolution=resolution,
        previous_interaction_id=previous_interaction_id,
        video_path=_save_upload(video, inbox / "source.mp4"),
        first_frame_path=_save_upload(first_frame, inbox / f"first{_suffix(first_frame, '.png')}"),
        last_frame_path=_save_upload(last_frame, inbox / f"last{_suffix(last_frame, '.png')}"),
        mask_path=_save_upload(mask, inbox / f"mask{_suffix(mask, '.png')}"),
    )
    try:
        return supervisor.tools.run_video_job(request, job_id=job_id)
    except OmniJobError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    path = job_tools(settings).job_dir(job_id) / "result.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Unknown job.")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/v1/jobs/{job_id}/files/{kind}/{name}")
def job_file(job_id: str, kind: str, name: str) -> FileResponse:
    if kind not in {"slides", "screenshots", "video", "inbox"}:
        raise HTTPException(status_code=400, detail="Invalid artifact kind.")
    path = job_tools(settings).job_dir(job_id) / kind / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path)


@app.post("/v1/auth/gmail")
def gmail_auth(payload: GmailAuthRequest, request: Request) -> dict:
    callback = str(request.base_url).rstrip("/") + "/v1/auth/gmail/callback"
    result = supervisor.gmail.start_gmail_auth(payload.user_id, callback)
    return {"redirect_url": result.redirect_url, "user_id": result.user_id, "note": result.note}


@app.get("/v1/auth/gmail/callback")
def gmail_callback() -> dict:
    return {"ok": True, "note": "Gmail connected via Composio."}


@app.post("/v1/imessage/inbound")
def imessage_inbound(payload: InboundMessage) -> GenerateResult:
    request = GenerateRequest(
        tutorial=payload.text,
        outputs=["slideshow"],
        notify_imessage=payload.from_number,
    )
    return supervisor.run(request)


def _suffix(upload: UploadFile | None, default: str) -> str:
    if upload is None or not upload.filename:
        return default
    suffix = Path(upload.filename).suffix
    return suffix or default


def _save_upload(upload: UploadFile | None, dest: Path) -> str | None:
    if upload is None:
        return None
    dest.write_bytes(upload.file.read())
    return str(dest)


def get_builder() -> ModelBuilder:
    return builder


def get_app_settings() -> Settings:
    return settings
