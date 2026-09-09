from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    anthropic_base_url: str = ""
    okupy_model: str = "claude-sonnet-4-5"
    okupy_fallback_model: str = "claude-haiku-4-5"
    okupy_agent_mode: str = "direct"

    gemini_api_key: str = ""
    gemini_omni_model: str = "gemini-omni-1.1-flash"

    daytona_api_key: str = ""
    daytona_api_url: str = ""

    composio_api_key: str = ""
    composio_user_id: str = "okupy-owner"

    photon_project_id: str = ""
    photon_project_secret: str = ""
    photon_sidecar_url: str = "http://127.0.0.1:8789"
    photon_sidecar_token: str = ""
    photon_home_channel: str = ""

    okupy_data_dir: Path = Path("./jobs")
    okupy_public_base_url: str = "http://localhost:8000"
    okupy_api_url: str = ""
    port: int = 8000

    @property
    def agent_mode(self) -> str:
        mode = self.okupy_agent_mode.strip().lower()
        if mode not in {"direct", "agent"}:
            return "direct"
        return mode


def get_settings() -> Settings:
    return Settings()
