from __future__ import annotations

from okupy.integrations.exa import ExaSearch
from okupy.memory import BuilderMemory
from okupy.models import AgentReply, DiscoveryRequest


class EveFoodFinderAgent:
    """Eve-compatible agent boundary used by HTTP and Photon channels."""

    def __init__(self, memory: BuilderMemory, search: ExaSearch) -> None:
        self.memory = memory
        self.search = search

    def run(self, request: DiscoveryRequest) -> AgentReply:
        profile = self.memory.get(request.user_id)
        if profile is None:
            return AgentReply(
                user_id=request.user_id,
                needs_onboarding=True,
                reply="First, tell me what you're building, your city, your stage, and who you want to meet.",
            )
        if not self.search.configured:
            return AgentReply(
                user_id=request.user_id,
                reply="I remember what you're building. Add EXA_API_KEY so I can search live events for you.",
            )
        events = self.search.discover(profile, request.message)
        if not events:
            return AgentReply(user_id=request.user_id, reply="I couldn't verify a strong nearby match yet. Try widening your radius.")
        top = events[:5]
        lines = [f"I found {len(top)} promising reasons to leave the build cave:"]
        for event in top:
            badges = [label for yes, label in ((event.free_food, "food"), (event.networking, "networking"), (event.builder_credits, "credits")) if yes]
            lines.append(f"• {event.title} ({', '.join(badges) or 'possible fit'}) — {event.url}")
        lines.append("Verify the event details and RSVP page before heading out—event perks can change.")
        return AgentReply(user_id=request.user_id, reply="\n".join(lines), events=top)
