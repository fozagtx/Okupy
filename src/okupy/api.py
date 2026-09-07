from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from okupy.config import Settings, get_settings
from okupy.model_builder import ModelBuilder
from okupy.models import GenerateRequest, GenerateResult, ModelProfile
from okupy.orchestrator import Supervisor, job_tools, roster

settings = get_settings()
builder = ModelBuilder(settings)
supervisor = Supervisor(settings, builder)
app = FastAPI(title="Okupy", version="0.1.0")

STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


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


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (Path(__file__).parent / "static" / "index.html").read_text(encoding="utf-8")


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "agents": list(roster()),
        "mode": settings.agent_mode,
        "model": settings.okupy_model,
    }


@app.get("/v1/architecture")
def architecture() -> dict:
    return {
        "agents": list(roster()),
        "pattern": "supervisor plus two specialists via Claude Agent SDK Agent tool",
        "outputs": ["TikTok 9:16 slideshow", "Gemini Omni 9:16 video"],
        "sandbox": "Daytona screenshots after slideshow generation",
        "channels": ["HTTP", "Photon iMessage", "Composio Gmail"],
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


@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    path = job_tools(settings).job_dir(job_id) / "result.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Unknown job.")
    import json

    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/v1/jobs/{job_id}/files/{kind}/{name}")
def job_file(job_id: str, kind: str, name: str) -> FileResponse:
    if kind not in {"slides", "screenshots", "video"}:
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
    return {"ok": True, "note": "Gmail connected via Composio. You can return to Okupy."}


@app.post("/v1/imessage/inbound")
def imessage_inbound(payload: InboundMessage) -> GenerateResult:
    request = GenerateRequest(
        tutorial=payload.text,
        outputs=["slideshow"],
        notify_imessage=payload.from_number,
    )
    return supervisor.run(request)


def get_builder() -> ModelBuilder:
    return builder


def get_app_settings() -> Settings:
    return settings
