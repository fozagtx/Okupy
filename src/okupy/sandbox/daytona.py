from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class CaptureResult:
    screenshots: list[Path] = field(default_factory=list)
    note: str = ""


class DaytonaSandbox:
    """Capture finished slideshow HTML inside a Daytona desktop sandbox."""

    def __init__(self, api_key: str = "", api_url: str = "") -> None:
        self.api_key = api_key
        self.api_url = api_url

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def capture_html(self, html_paths: list[Path], output_dir: Path) -> CaptureResult:
        if not html_paths:
            return CaptureResult(note="No HTML slides to capture.")
        if not self.enabled:
            return CaptureResult(
                note="DAYTONA_API_KEY is not set. Pillow PNGs are the canonical slides; sandbox capture skipped."
            )
        try:
            from daytona import Daytona
        except ImportError:
            return CaptureResult(note="daytona SDK is not installed.")

        output_dir.mkdir(parents=True, exist_ok=True)
        kwargs = {}
        if self.api_url:
            kwargs["api_url"] = self.api_url
        daytona = Daytona(api_key=self.api_key, **kwargs) if self.api_key else Daytona()
        sandbox = daytona.create()
        shots: list[Path] = []
        try:
            sandbox.computer_use.start()
            remote_dir = "/tmp/okupy-slides"
            sandbox.process.exec(f"mkdir -p {remote_dir}")
            for html in html_paths:
                remote = f"{remote_dir}/{html.name}"
                sandbox.fs.upload_file(str(html), remote)
                sandbox.process.exec(f"xdg-open {remote} >/dev/null 2>&1 || true")
                screenshot = sandbox.computer_use.screenshot.take_full_screen()
                dest = output_dir / f"daytona-{html.stem}.png"
                _write_screenshot(screenshot, dest)
                shots.append(dest)
        finally:
            try:
                sandbox.computer_use.stop()
            except Exception:
                pass
            sandbox.delete()
        return CaptureResult(screenshots=shots, note=f"Captured {len(shots)} Daytona screenshot(s).")


def _write_screenshot(screenshot: object, dest: Path) -> None:
    import base64

    raw = getattr(screenshot, "screenshot", None) or getattr(screenshot, "data", None) or ""
    dest.write_bytes(base64.b64decode(raw) if isinstance(raw, str) else bytes(raw or b""))
