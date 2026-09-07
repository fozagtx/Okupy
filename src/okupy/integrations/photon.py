from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass
class PhotonSendResult:
    ok: bool
    note: str


class PhotonClient:
    """Talk to the Node spectrum-ts sidecar so Python can DM via iMessage."""

    def __init__(self, sidecar_url: str, token: str = "") -> None:
        self.sidecar_url = sidecar_url.rstrip("/")
        self.token = token

    def configured(self) -> bool:
        return bool(self.sidecar_url)

    def send(self, to: str, text: str) -> PhotonSendResult:
        if not to or not text:
            return PhotonSendResult(ok=False, note="Missing iMessage recipient or body.")
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-Okupy-Sidecar-Token"] = self.token
        try:
            response = httpx.post(
                f"{self.sidecar_url}/send",
                json={"to": to, "text": text},
                headers=headers,
                timeout=20.0,
            )
            response.raise_for_status()
        except Exception as exc:
            return PhotonSendResult(ok=False, note=f"Photon sidecar send failed: {exc}")
        return PhotonSendResult(ok=True, note="Queued on Photon Spectrum.")
