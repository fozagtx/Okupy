from __future__ import annotations

from pathlib import Path
from typing import Any

from okupy.agents.definitions import AGENT_NAMES, SUPERVISOR_PROMPT, specialist_definitions
from okupy.model_builder import ResolvedModel


async def run_claude_supervisor(prompt: str, resolved: ResolvedModel, cwd: Path) -> str:
    """Run the 3-agent Claude Agent SDK loop. Requires claude-agent-sdk + a key."""
    try:
        from claude_agent_sdk import ClaudeAgentOptions, create_sdk_mcp_server, query, tool
    except ImportError as exc:
        raise RuntimeError("claude-agent-sdk is not installed") from exc

    from okupy.orchestrator import job_tools

    @tool("generate_slideshow", "Generate a TikTok slideshow for a tutorial.", {"tutorial": str, "title": str, "job_id": str})
    async def generate_slideshow(args: dict[str, Any]) -> dict[str, Any]:
        result = job_tools().generate_slideshow(args["job_id"], args["tutorial"], args.get("title") or None)
        return {"content": [{"type": "text", "text": result}]}

    @tool("capture_screenshots", "Capture Daytona screenshots of generated HTML slides.", {"job_id": str})
    async def capture_screenshots(args: dict[str, Any]) -> dict[str, Any]:
        result = job_tools().capture_screenshots(args["job_id"])
        return {"content": [{"type": "text", "text": result}]}

    @tool("generate_omni_video", "Generate a Gemini Omni 9:16 tutorial video.", {"tutorial": str, "title": str, "job_id": str})
    async def generate_omni_video(args: dict[str, Any]) -> dict[str, Any]:
        result = job_tools().generate_video(args["job_id"], args["tutorial"], args.get("title") or "Tutorial")
        return {"content": [{"type": "text", "text": result}]}

    @tool(
        "run_omni_video",
        "Edit or generate a Gemini Omni video: edit, inpaint, keyframes, or generate.",
        {
            "job_id": str,
            "mode": str,
            "prompt": str,
            "video_path": str,
            "first_frame_path": str,
            "last_frame_path": str,
            "mask_path": str,
        },
    )
    async def run_omni_video(args: dict[str, Any]) -> dict[str, Any]:
        from okupy.models import VideoRequest

        job = job_tools().run_video_job(
            VideoRequest(
                mode=args.get("mode") or "edit",
                prompt=args["prompt"],
                video_path=args.get("video_path") or None,
                first_frame_path=args.get("first_frame_path") or None,
                last_frame_path=args.get("last_frame_path") or None,
                mask_path=args.get("mask_path") or None,
            ),
            job_id=args["job_id"],
        )
        return {"content": [{"type": "text", "text": job.model_dump_json()}]}

    server = create_sdk_mcp_server(
        name="okupy",
        tools=[generate_slideshow, capture_screenshots, generate_omni_video, run_omni_video],
    )
    options = ClaudeAgentOptions(
        system_prompt=SUPERVISOR_PROMPT,
        model=resolved.profile.model_id,
        agents=specialist_definitions(),
        mcp_servers={"okupy": server},
        allowed_tools=[
            "Agent",
            "mcp__okupy__generate_slideshow",
            "mcp__okupy__capture_screenshots",
            "mcp__okupy__generate_omni_video",
            "mcp__okupy__run_omni_video",
        ],
        permission_mode="bypassPermissions",
        cwd=str(cwd),
        env=resolved.agent_env(),
        fallback_model=resolved.profile.fallback_model,
    )

    chunks: list[str] = []
    async for message in query(prompt=prompt, options=options):
        text = getattr(message, "result", None)
        if text:
            chunks.append(str(text))
    return "\n".join(chunks) if chunks else "Supervisor finished with no text result."


def agent_roster() -> tuple[str, ...]:
    return AGENT_NAMES
