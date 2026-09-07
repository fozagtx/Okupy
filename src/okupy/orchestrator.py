from __future__ import annotations

import json
import uuid
from pathlib import Path

from okupy.agents.definitions import AGENT_NAMES
from okupy.config import Settings
from okupy.integrations.composio_gmail import ComposioGmail
from okupy.integrations.photon import PhotonClient
from okupy.model_builder import ModelBuilder, ResolvedModel
from okupy.models import AgentName, GenerateRequest, GenerateResult, VideoJobResult, VideoRequest
from okupy.sandbox.daytona import DaytonaSandbox
from okupy.slides import outline_tutorial
from okupy.slides.render import render_cards
from okupy.video.omni import OmniVideoClient


class JobTools:
    """Tool surface used by both direct mode and the Claude Agent SDK MCP server."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.data_dir = settings.okupy_data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.sandbox = DaytonaSandbox(settings.daytona_api_key, settings.daytona_api_url)
        self.omni = OmniVideoClient(settings.gemini_api_key, settings.gemini_omni_model)

    def job_dir(self, job_id: str) -> Path:
        path = self.data_dir / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def generate_slideshow(self, job_id: str, tutorial: str, title: str | None) -> str:
        cards = outline_tutorial(tutorial, title)
        paths = render_cards(cards, self.job_dir(job_id) / "slides")
        return json.dumps({"slides": [str(p) for p in paths], "count": len(paths)})

    def capture_screenshots(self, job_id: str) -> str:
        html = sorted((self.job_dir(job_id) / "slides").glob("*.html"))
        captured = self.sandbox.capture_html(html, self.job_dir(job_id) / "screenshots")
        return json.dumps({"screenshots": [str(p) for p in captured.screenshots], "note": captured.note})

    def generate_video(self, job_id: str, tutorial: str, title: str) -> str:
        result = self.omni.generate(tutorial, title, self.job_dir(job_id) / "video")
        return json.dumps(
            {
                "video_path": str(result.path) if result.path else None,
                "model": result.model,
                "note": result.note,
            }
        )

    def run_video_job(self, request: VideoRequest, job_id: str | None = None) -> VideoJobResult:
        from okupy.video.omni import build_omni_job

        job_id = job_id or uuid.uuid4().hex[:12]
        spec = build_omni_job(
            mode=request.mode,
            prompt=request.prompt,
            video_path=request.video_path,
            first_frame_path=request.first_frame_path,
            last_frame_path=request.last_frame_path,
            mask_path=request.mask_path,
            aspect_ratio=request.aspect_ratio,
            resolution=request.resolution,
            previous_interaction_id=request.previous_interaction_id,
        )
        filename = {
            "generate": "omni.mp4",
            "edit": "edited.mp4",
            "inpaint": "inpainted.mp4",
            "keyframes": "keyframes.mp4",
        }[request.mode]
        result = self.omni.run(spec, self.job_dir(job_id) / "video" / filename)
        payload = VideoJobResult(
            job_id=job_id,
            mode=spec.mode,
            task=spec.task,
            prompt=spec.prompt,
            video_path=str(result.path) if result.path else None,
            spec=spec,
            interaction=spec.interaction_payload(self.omni.model),
            interaction_id=result.interaction_id,
            note=result.note,
        )
        (self.job_dir(job_id) / "result.json").write_text(payload.model_dump_json(indent=2), encoding="utf-8")
        return payload


_TOOLS: JobTools | None = None


def job_tools(settings: Settings | None = None) -> JobTools:
    global _TOOLS
    if settings is not None:
        _TOOLS = JobTools(settings)
        return _TOOLS
    if _TOOLS is None:
        from okupy.config import get_settings

        _TOOLS = JobTools(get_settings())
    return _TOOLS


class Supervisor:
    """Supervisor agent: routes work to slideshow and video specialists."""

    name: AgentName = "supervisor"

    def __init__(self, settings: Settings, builder: ModelBuilder | None = None) -> None:
        self.settings = settings
        self.builder = builder or ModelBuilder(settings)
        self.tools = JobTools(settings)
        self.photon = PhotonClient(settings.photon_sidecar_url, settings.photon_sidecar_token)
        self.gmail = ComposioGmail(settings.composio_api_key, settings.composio_user_id)

    def plan(self, request: GenerateRequest) -> list[AgentName]:
        used: list[AgentName] = ["supervisor"]
        if "slideshow" in request.outputs:
            used.append("slideshow")
        if "video" in request.outputs:
            used.append("video")
        return used

    def run(self, request: GenerateRequest) -> GenerateResult:
        job_id = uuid.uuid4().hex[:12]
        resolved = self.builder.resolve(request.model)
        agents_used = self.plan(request)
        from okupy.slides import derive_title

        title = derive_title(request.tutorial, request.title)
        notes: list[str] = [f"Model profile: {resolved.profile.name} ({resolved.profile.model_id})"]
        slides: list[str] = []
        screenshots: list[str] = []
        video_path: str | None = None

        if "slideshow" in agents_used:
            payload = json.loads(self.tools.generate_slideshow(job_id, request.tutorial, title))
            slides = payload["slides"]
            shot = json.loads(self.tools.capture_screenshots(job_id))
            screenshots = shot["screenshots"]
            notes.append(shot["note"])

        if "video" in agents_used:
            payload = json.loads(self.tools.generate_video(job_id, request.tutorial, title))
            video_path = payload["video_path"]
            notes.append(payload["note"])

        if request.notify_imessage:
            sent = self.photon.send(
                request.notify_imessage,
                f"Okupy finished '{title}'. Job {job_id}: {len(slides)} slides.",
            )
            notes.append(sent.note)

        if request.send_gmail and not self.settings.composio_api_key:
            notes.append("Gmail send skipped: Composio is not authenticated.")

        if self.settings.agent_mode == "agent" and self.settings.anthropic_api_key:
            notes.append(_run_agent_sync(request, resolved, self.tools.job_dir(job_id)))

        result = GenerateResult(
            job_id=job_id,
            title=title,
            agents_used=agents_used,
            slides=slides,
            screenshots=screenshots,
            video_path=video_path,
            model=resolved.profile.model_copy(update={"api_key": _redact(resolved.profile.api_key)}),
            notes=notes,
        )
        self._persist(result)
        return result

    def run_video(self, request: VideoRequest) -> VideoJobResult:
        return self.tools.run_video_job(request)

    def _persist(self, result: GenerateResult) -> None:
        path = self.tools.job_dir(result.job_id) / "result.json"
        path.write_text(result.model_dump_json(indent=2), encoding="utf-8")


def _redact(key: str | None) -> str | None:
    if not key:
        return None
    if len(key) < 8:
        return "***"
    return f"{key[:4]}…{key[-4:]}"


def _run_agent_sync(request: GenerateRequest, resolved: ResolvedModel, cwd: Path) -> str:
    import asyncio

    from okupy.agents.runner import run_claude_supervisor

    prompt = (
        f"Produce outputs {request.outputs} for this tutorial titled "
        f"{request.title or 'untitled'}:\n{request.tutorial}"
    )
    try:
        return asyncio.run(run_claude_supervisor(prompt, resolved, cwd))
    except RuntimeError as exc:
        return str(exc)


def roster() -> tuple[str, ...]:
    return AGENT_NAMES
