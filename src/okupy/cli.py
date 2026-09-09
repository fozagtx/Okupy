from __future__ import annotations

import argparse
import json
import sys

from okupy.config import get_settings
from okupy.model_builder import ModelBuilder
from okupy.models import GenerateRequest, OutputKind, VideoRequest
from okupy.orchestrator import Supervisor
from okupy.video.omni import OmniJobError


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "video":
        return _video_main(argv[1:])
    return _generate_main(argv)


def _generate_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Okupy backend CLI.")
    parser.add_argument("tutorial", nargs="?", help="Tutorial text")
    parser.add_argument("--title", default=None)
    parser.add_argument("--video", action="store_true", help="Also generate a Gemini Omni video")
    parser.add_argument("--model", default=None, help="Model profile name or raw model id")
    args = parser.parse_args(argv)
    if not args.tutorial:
        parser.print_help()
        return 2

    outputs: list[OutputKind] = ["slideshow"]
    if args.video:
        outputs.append("video")
    settings = get_settings()
    result = Supervisor(settings, ModelBuilder(settings)).run(
        GenerateRequest(tutorial=args.tutorial, title=args.title, outputs=outputs, model=args.model)
    )
    print(json.dumps(json.loads(result.model_dump_json()), indent=2))
    return 0


def _video_main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="okupy video", description="Gemini Omni generate/edit/inpaint/keyframes.")
    parser.add_argument("mode", choices=["generate", "edit", "inpaint", "keyframes"])
    parser.add_argument("prompt")
    parser.add_argument("--clip", default=None, help="Source video to drop in (edit/inpaint)")
    parser.add_argument("--first-frame", default=None)
    parser.add_argument("--last-frame", default=None)
    parser.add_argument("--mask", default=None)
    parser.add_argument("--aspect-ratio", default="9:16")
    args = parser.parse_args(argv)
    settings = get_settings()
    try:
        result = Supervisor(settings, ModelBuilder(settings)).run_video(
            VideoRequest(
                mode=args.mode,  # type: ignore[arg-type]
                prompt=args.prompt,
                video_path=args.clip,
                first_frame_path=args.first_frame,
                last_frame_path=args.last_frame,
                mask_path=args.mask,
                aspect_ratio=args.aspect_ratio,
            )
        )
    except OmniJobError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(json.loads(result.model_dump_json()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
