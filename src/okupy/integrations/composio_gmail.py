from __future__ import annotations

import importlib.util
from dataclasses import dataclass


@dataclass
class GmailAuth:
    redirect_url: str
    user_id: str
    note: str
    status: str = "pending"


class ComposioGmail:
    def __init__(self, api_key: str = "", user_id: str = "okupy-owner") -> None:
        self.api_key = api_key
        self.user_id = user_id

    def start_gmail_auth(self, user_id: str | None = None, callback_url: str | None = None) -> GmailAuth:
        uid = user_id or self.user_id
        if not self.api_key:
            return GmailAuth(
                redirect_url="",
                user_id=uid,
                note="COMPOSIO_API_KEY is not set. Add it to connect Gmail.",
                status="not_configured",
            )
        if importlib.util.find_spec("composio") is None:
            return GmailAuth(redirect_url="", user_id=uid, note="composio SDK is not installed.", status="unavailable")

        from composio import Composio

        composio = Composio(api_key=self.api_key)
        session = composio.create(user_id=uid)
        kwargs = {}
        if callback_url:
            kwargs["callback_url"] = callback_url
        request = session.authorize("gmail", **kwargs)
        return GmailAuth(
            redirect_url=getattr(request, "redirect_url", "") or getattr(request, "redirectUrl", ""),
            user_id=uid,
            note="Open the Connect Link to authenticate Gmail.",
        )
