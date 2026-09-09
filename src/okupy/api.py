from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse

from okupy.agent import EveFoodFinderAgent
from okupy.config import get_settings
from okupy.integrations.composio_gmail import ComposioGmail
from okupy.integrations.exa import ExaSearch
from okupy.memory import BuilderMemory
from okupy.models import AgentReply, BuilderProfile, ConnectRequest, DiscoveryRequest, InboundMessage

settings = get_settings()
memory = BuilderMemory(settings.okupy_data_dir / "memory.sqlite3")
agent = EveFoodFinderAgent(memory, ExaSearch(settings.exa_api_key, settings.exa_api_url))
composio = ComposioGmail(settings.composio_api_key, settings.composio_user_id)

app = FastAPI(title="Okupy", version="1.0.0", description="Your free-food and founder-opportunity agent.")


@app.get("/", response_class=HTMLResponse)
def dashboard() -> HTMLResponse:
    html = (settings.package_dir / "static" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "agent": "eve", "search": "exa", "channel": "photon-imessage", "memory": True}


@app.get("/v1/profile/{user_id}")
def get_profile(user_id: str) -> dict:
    return memory.public_snapshot(user_id)


@app.put("/v1/profile/{user_id}", response_model=BuilderProfile)
def save_profile(user_id: str, profile: BuilderProfile) -> BuilderProfile:
    if user_id != profile.user_id:
        raise HTTPException(400, "Path and profile user IDs must match.")
    return memory.save(profile)


@app.post("/v1/discover", response_model=AgentReply)
def discover(payload: DiscoveryRequest) -> AgentReply:
    try:
        return agent.run(payload)
    except Exception as exc:
        raise HTTPException(502, f"Event search failed: {exc}") from exc


@app.post("/v1/imessage/inbound", response_model=AgentReply)
def imessage_inbound(payload: InboundMessage) -> AgentReply:
    return agent.run(DiscoveryRequest(user_id=payload.from_number, message=payload.text))


@app.post("/v1/connections")
def connect(payload: ConnectRequest, request: Request) -> dict:
    callback = str(request.base_url).rstrip("/") + "/v1/connections/callback"
    result = composio.start_gmail_auth(payload.user_id, callback)
    return {"app": payload.app, "redirect_url": result.redirect_url, "status": result.status, "note": result.note}


@app.get("/v1/connections/callback", response_class=HTMLResponse)
def connection_callback() -> HTMLResponse:
    return HTMLResponse("<h1>Connected</h1><p>You can close this tab and return to Okupy.</p>")
