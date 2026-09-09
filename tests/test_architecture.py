from pathlib import Path


def test_architecture_doc_pushes_back():
    text = Path("docs/architecture.md").read_text(encoding="utf-8")
    assert "Pushback on the original decisions" in text
    assert "not three processes" in text.lower() or "Do **not** run three separate" in text
    assert "Photon" in text
    assert "Daytona" in text
    assert "Composio" in text
    assert "render.yaml" in text
    assert "Opus" in text
    assert "backend" in text.lower()
    assert "inpaint" in text.lower()
    assert "keyframe" in text.lower()
