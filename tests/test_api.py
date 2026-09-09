from pathlib import Path

from fastapi.testclient import TestClient

from okupy.api import agent, app
from okupy.integrations.exa import ExaSearch
from okupy.memory import BuilderMemory

client = TestClient(app)


def test_dashboard_and_health():
    page = client.get("/")
    assert page.status_code == 200
    assert "Free food" in page.text
    assert "Connect Gmail" in page.text
    health = client.get("/health").json()
    assert health == {"ok": True, "agent": "eve", "search": "exa", "channel": "photon-imessage", "memory": True}


def test_onboarding_then_memory(tmp_path):
    original = agent.memory
    agent.memory = BuilderMemory(tmp_path / "memory.sqlite3")
    try:
        reply = client.post("/v1/discover", json={"user_id": "new", "message": "tonight"}).json()
        assert reply["needs_onboarding"] is True
        profile = {
            "user_id": "new", "project": "a climate accounting API", "location": "Austin, TX",
            "goals": ["customers", "cofounder"], "interests": ["climate", "API"],
        }
        assert client.put("/v1/profile/new", json=profile).status_code == 200
        assert client.get("/v1/profile/new").json()["project"] == profile["project"]
    finally:
        agent.memory = original


def test_exa_result_is_classified(monkeypatch):
    search = ExaSearch("key")
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {"results": [{"title": "Founder dinner + AWS credits", "url": "https://example.com/e", "text": "Network over free food and get cloud credits."}]}
    monkeypatch.setattr("httpx.post", lambda *a, **k: Response())
    from okupy.models import BuilderProfile
    event = search.discover(BuilderProfile(user_id="u", project="devtool", location="NYC"))[0]
    assert event.free_food and event.networking and event.builder_credits


def test_composio_unconfigured():
    result = client.post("/v1/connections", json={"user_id": "u", "app": "gmail"})
    assert result.status_code == 200
    assert result.json()["status"] in {"not_configured", "pending"}


def test_render_blueprint_has_disk_and_services():
    text = Path("render.yaml").read_text()
    assert "okupy-memory" in text
    assert "okupy-photon" in text
    assert "EXA_API_KEY" in text
