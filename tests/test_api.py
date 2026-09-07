from fastapi.testclient import TestClient

from okupy.api import app

client = TestClient(app)


def test_health_reports_three_agents():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["kind"] == "backend"
    assert body["agents"] == ["supervisor", "slideshow", "video"]


def test_root_is_backend_catalog_not_html():
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["kind"] == "backend"
    assert body["endpoints"]["video_drop"] == "POST /v1/videos/drop"
    assert "<html" not in response.text.lower()


def test_architecture_endpoint():
    response = client.get("/v1/architecture")
    assert response.status_code == 200
    body = response.json()
    assert body["agents"] == ["supervisor", "slideshow", "video"]
    assert "Photon" in str(body["channels"])
    assert body["kind"] == "backend"


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


def test_drop_clip_edit_without_gemini_key(tmp_path):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"\x00fake")
    response = client.post(
        "/v1/videos",
        json={"mode": "edit", "prompt": "make this anime", "video_path": str(clip)},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["agent"] == "video"
    assert body["mode"] == "edit"
    assert body["task"] == "edit"
    assert body["video_path"] is None
    assert "GEMINI_API_KEY" in body["note"]
    assert body["interaction"]["generation_config"]["video_config"]["task"] == "edit"


def test_keyframes_endpoint_plans_interpolation(tmp_path):
    from PIL import Image

    first = tmp_path / "first.png"
    last = tmp_path / "last.png"
    Image.new("RGB", (32, 32), (10, 10, 10)).save(first)
    Image.new("RGB", (32, 32), (200, 200, 200)).save(last)
    response = client.post(
        "/v1/videos",
        json={
            "mode": "keyframes",
            "prompt": "camera pushes in",
            "first_frame_path": str(first),
            "last_frame_path": str(last),
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["task"] == "image_to_video"
    assert "<FIRST_FRAME>" in body["prompt"]
    assert "<LAST_FRAME>" in body["prompt"]


def test_inpaint_without_clip_is_400():
    response = client.post("/v1/videos", json={"mode": "inpaint", "prompt": "remove the mic"})
    assert response.status_code == 400


def test_drop_multipart_clip():
    response = client.post(
        "/v1/videos/drop",
        data={"mode": "edit", "prompt": "make the lighting warmer"},
        files={"video": ("clip.mp4", b"\x00fake-mp4", "video/mp4")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "edit"
    assert body["spec"]["assets"][0]["role"] == "source_video"
