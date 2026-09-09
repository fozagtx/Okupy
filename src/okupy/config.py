from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    exa_api_key: str = ""
    exa_api_url: str = "https://api.exa.ai/search"
    eve_api_key: str = ""

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
    def package_dir(self) -> Path:
        return Path(__file__).parent


def get_settings() -> Settings:
    return Settings()
