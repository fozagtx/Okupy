from fastapi.testclient import TestClient

from okupy.api import app

client = TestClient(app)


def test_health_reports_three_agents():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["agents"] == ["supervisor", "slideshow", "video"]


def test_architecture_endpoint():
    response = client.get("/v1/architecture")
    assert response.status_code == 200
    body = response.json()
    assert body["agents"] == ["supervisor", "slideshow", "video"]
    assert "Photon" in body["channels"][-1] or "Photon" in str(body["channels"])


def test_generate_slideshow_and_fetch_png():
    response = client.post(
        "/v1/generate",
        json={
            "title": "Clean a blender",
            "tutorial": "1. Fill halfway with warm water. 2. Drop in dish soap. 3. Blend. 4. Rinse.",
            "outputs": ["slideshow"],
        },
    )
    assert response.status_code == 200, response.text
    job = response.json()
    assert job["agents_used"][0] == "supervisor"
    assert job["slides"]
    png = job["slides"][0].replace("\\", "/").split("/")[-1]
    file_response = client.get(f"/v1/jobs/{job['job_id']}/files/slides/{png}")
    assert file_response.status_code == 200
    assert file_response.headers["content-type"].startswith("image/")


def test_register_custom_model_and_list():
    created = client.post(
        "/v1/models",
        json={"name": "team-key", "model_id": "claude-haiku-4-5", "api_key": "sk-ant-team"},
    )
    assert created.status_code == 200
    assert created.json()["api_key"] == "set"
    listed = client.get("/v1/models").json()["profiles"]
    assert any(item["name"] == "team-key" for item in listed)


def test_gmail_without_composio_key():
    response = client.post("/v1/auth/gmail", json={})
    assert response.status_code == 200
    assert "COMPOSIO_API_KEY" in response.json()["note"]


def test_ui_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "Turn any tutorial into slides" in response.text
