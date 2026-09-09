from __future__ import annotations

from datetime import date, timedelta

import httpx

from okupy.models import BuilderProfile, Event


class ExaSearch:
    def __init__(self, api_key: str, endpoint: str = "https://api.exa.ai/search") -> None:
        self.api_key = api_key
        self.endpoint = endpoint

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def discover(self, profile: BuilderProfile, request: str = "", limit: int = 8) -> list[Event]:
        if not self.api_key:
            return []
        today = date.today()
        query = (
            f'Upcoming free in-person founder, startup, developer, demo day, hackathon or community events near '
            f'"{profile.location}" between {today.isoformat()} and {(today + timedelta(days=45)).isoformat()}. '
            f'Must mention free food, pizza, lunch, dinner, refreshments, networking, founder credits, cloud credits, '
            f'or startup perks. Relevant to: {profile.project}; {", ".join(profile.interests)}. {request}'
        )
        response = httpx.post(
            self.endpoint,
            headers={"x-api-key": self.api_key, "Content-Type": "application/json"},
            json={
                "query": query,
                "type": "auto",
                "numResults": limit,
                "startPublishedDate": f"{today.isoformat()}T00:00:00.000Z",
                "contents": {"text": {"maxCharacters": 1800}, "highlights": {"numSentences": 4}},
            },
            timeout=30,
        )
        response.raise_for_status()
        return [self._event(item, profile) for item in response.json().get("results", [])]

    @staticmethod
    def _event(item: dict, profile: BuilderProfile) -> Event:
        text = " ".join([item.get("title", ""), item.get("text", ""), " ".join(item.get("highlights", []))])
        lower = text.lower()
        food = any(word in lower for word in ("free food", "pizza", "lunch", "dinner", "refreshments", "catering"))
        credits = any(word in lower for word in ("credits", "startup perk", "grant", "compute"))
        network = any(word in lower for word in ("network", "founder", "demo day", "meetup", "pitch"))
        signals = [label for yes, label in ((food, "free food"), (network, "people to meet"), (credits, "builder credits")) if yes]
        return Event(
            title=item.get("title") or "Untitled event",
            url=item.get("url"),
            summary=(item.get("text") or "")[:420],
            date=item.get("publishedDate"),
            location=profile.location,
            free_food=food,
            networking=network,
            builder_credits=credits,
            why=f"Matches {profile.project}: " + (", ".join(signals) if signals else "potential local builder event"),
        )
