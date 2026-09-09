"""Claude Agent SDK agent definitions: supervisor + two specialists."""

from __future__ import annotations

SUPERVISOR_PROMPT = """
You are the Okupy supervisor agent. You orchestrate tutorial generation
and video edits over a backend API. You never generate slides or videos
yourself. You delegate:

- slideshow: TikTok 9:16 carousel + Daytona screenshots
- video: Gemini Omni generate, drop-in edit, inpaint, and keyframe interpolation

Use the custom model profile already selected for this session.
After specialists finish, summarize artifact paths for the caller.
""".strip()

SLIDESHOW_PROMPT = """
You are the Okupy slideshow agent. Turn any tutorial into a TikTok
slideshow: 5-8 cards, 1080x1920, hook / steps / CTA. Call the slideshow
tools. After Pillow PNGs exist, request Daytona screenshots of the HTML.
""".strip()

VIDEO_PROMPT = """
You are the Okupy video agent. Use Google Gemini Omni (Interactions API):

- generate: text_to_video
- edit: drop a source clip and restyle or rewrite it (task=edit)
- inpaint: drop a clip plus optional mask, remove/replace a region
- keyframes: interpolate between first_frame and last_frame (image_to_video)

Do not use Veo unless Omni is unavailable. Return file paths.
""".strip()


def specialist_definitions() -> dict:
    """Build Claude Agent SDK AgentDefinition map when the SDK is installed."""
    try:
        from claude_agent_sdk import AgentDefinition
    except ImportError:
        return {
            "slideshow": {"description": "TikTok slideshow specialist", "prompt": SLIDESHOW_PROMPT},
            "video": {"description": "Gemini Omni generate/edit/inpaint/keyframes specialist", "prompt": VIDEO_PROMPT},
        }

    return {
        "slideshow": AgentDefinition(
            description="Generates TikTok slideshows (9:16 carousels) and Daytona screenshots for a tutorial.",
            prompt=SLIDESHOW_PROMPT,
            tools=["mcp__okupy__generate_slideshow", "mcp__okupy__capture_screenshots"],
            model="inherit",
        ),
        "video": AgentDefinition(
            description="Generates and edits AI videos with Google Gemini Omni, including inpaint and keyframes.",
            prompt=VIDEO_PROMPT,
            tools=["mcp__okupy__generate_omni_video", "mcp__okupy__run_omni_video"],
            model="inherit",
        ),
    }


AGENT_NAMES = ("supervisor", "slideshow", "video")
