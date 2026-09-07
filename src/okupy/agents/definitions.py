"""Claude Agent SDK agent definitions: supervisor + two specialists."""

from __future__ import annotations

SUPERVISOR_PROMPT = """
You are the Okupy supervisor agent. You orchestrate tutorial generation.
You never generate slides or videos yourself. You delegate:

- slideshow: TikTok 9:16 carousel + Daytona screenshots
- video: Gemini Omni 9:16 clip

Use the custom model profile already selected for this session.
After specialists finish, summarize artifacts for the user. If they asked
for Gmail or iMessage delivery, say so in the final reply.
""".strip()

SLIDESHOW_PROMPT = """
You are the Okupy slideshow agent. Turn any tutorial into a TikTok
slideshow: 5-8 cards, 1080x1920, hook / steps / CTA. Call the slideshow
tools. After Pillow PNGs exist, request Daytona screenshots of the HTML.
""".strip()

VIDEO_PROMPT = """
You are the Okupy video agent. Generate a vertical 9:16 AI tutorial
video with Google Gemini Omni (Interactions API). Do not use Veo unless
Omni is unavailable. Call the video tools and return the file path.
""".strip()


def specialist_definitions() -> dict:
    """Build Claude Agent SDK AgentDefinition map when the SDK is installed."""
    try:
        from claude_agent_sdk import AgentDefinition
    except ImportError:
        return {
            "slideshow": {"description": "TikTok slideshow specialist", "prompt": SLIDESHOW_PROMPT},
            "video": {"description": "Gemini Omni video specialist", "prompt": VIDEO_PROMPT},
        }

    return {
        "slideshow": AgentDefinition(
            description="Generates TikTok slideshows (9:16 carousels) and Daytona screenshots for a tutorial.",
            prompt=SLIDESHOW_PROMPT,
            tools=["mcp__okupy__generate_slideshow", "mcp__okupy__capture_screenshots"],
            model="inherit",
        ),
        "video": AgentDefinition(
            description="Generates AI tutorial videos with Google Gemini Omni.",
            prompt=VIDEO_PROMPT,
            tools=["mcp__okupy__generate_omni_video"],
            model="inherit",
        ),
    }


AGENT_NAMES = ("supervisor", "slideshow", "video")
