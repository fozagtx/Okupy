from __future__ import annotations

import argparse
import json

from okupy.config import get_settings
from okupy.model_builder import ModelBuilder
from okupy.models import GenerateRequest, OutputKind
from okupy.orchestrator import Supervisor


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate TikTok slideshows and Omni videos from a tutorial.")
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


if __name__ == "__main__":
    raise SystemExit(main())
