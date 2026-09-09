"""Photon iMessage worker: start the spectrum-ts sidecar and forward DMs to the API."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

from okupy.config import PHOTON_AGENT_URL, get_settings

SIDECAR_DIR = Path(__file__).parent / "photon_sidecar"


def main() -> int:
    settings = get_settings()
    if not settings.photon_project_id or not settings.photon_project_secret:
        print("PHOTON_PROJECT_ID and PHOTON_PROJECT_SECRET are required for the iMessage worker.", file=sys.stderr)
        return 1

    env = os.environ.copy()
    env["PHOTON_PROJECT_ID"] = settings.photon_project_id
    env["PHOTON_PROJECT_SECRET"] = settings.photon_project_secret
    env["PHOTON_SIDECAR_TOKEN"] = settings.photon_sidecar_token

    proc = subprocess.Popen(
        ["node", "index.mjs", "--agent-url", PHOTON_AGENT_URL, "--port", "8789"],
        cwd=SIDECAR_DIR,
        env=env,
    )

    def _stop(_signum=None, _frame=None) -> None:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    api = PHOTON_AGENT_URL.rstrip("/")
    while True:
        if proc.poll() is not None:
            print("Photon sidecar exited.", file=sys.stderr)
            return proc.returncode or 1
        try:
            httpx.get(f"{api}/health", timeout=5.0)
        except Exception:
            pass
        time.sleep(15)


if __name__ == "__main__":
    raise SystemExit(main())
