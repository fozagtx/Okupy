from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from okupy.video.omni import OmniJobError, build_omni_job


def _png(path: Path, color: tuple[int, int, int]) -> Path:
    Image.new("RGB", (64, 112), color).save(path)
    return path


def _clip(path: Path) -> Path:
    path.write_bytes(b"\x00\x00fake-mp4")
    return path


def test_keyframes_require_both_frames(tmp_path: Path):
    first = _png(tmp_path / "first.png", (255, 0, 0))
    with pytest.raises(OmniJobError, match="last_frame"):
        build_omni_job(mode="keyframes", prompt="sunrise to sunset", first_frame_path=first)


def test_keyframes_tag_first_and_last_frames(tmp_path: Path):
    first = _png(tmp_path / "first.png", (255, 0, 0))
    last = _png(tmp_path / "last.png", (0, 0, 255))
    spec = build_omni_job(
        mode="keyframes",
        prompt="smooth timelapse from sunrise to sunset",
        first_frame_path=first,
        last_frame_path=last,
    )
    assert spec.task == "image_to_video"
    assert spec.mode == "keyframes"
    assert "<FIRST_FRAME>" in spec.prompt
    assert "<LAST_FRAME>" in spec.prompt
    roles = [asset.role for asset in spec.assets]
    assert roles == ["first_frame", "last_frame"]
    payload = spec.interaction_payload("gemini-omni-1.1-flash")
    assert payload["generation_config"]["video_config"]["task"] == "image_to_video"
    assert payload["input"][0]["type"] == "text"


def test_inpaint_requires_dropped_clip():
    with pytest.raises(OmniJobError, match="video"):
        build_omni_job(mode="inpaint", prompt="remove the watermark")


def test_inpaint_and_edit_use_source_clip(tmp_path: Path):
    clip = _clip(tmp_path / "talking.mp4")
    mask = _png(tmp_path / "mask.png", (255, 255, 255))
    inpaint = build_omni_job(
        mode="inpaint",
        prompt="remove the logo in the corner",
        video_path=clip,
        mask_path=mask,
    )
    assert inpaint.task == "edit"
    assert "Inpaint" in inpaint.prompt
    assert any(asset.role == "mask" for asset in inpaint.assets)

    edited = build_omni_job(mode="edit", prompt="make this anime", video_path=clip)
    assert edited.task == "edit"
    assert edited.assets[0].role == "source_video"
    assert "<VIDEO_0>" in edited.prompt
