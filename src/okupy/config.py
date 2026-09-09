from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# URLs are deployment configuration, not secrets. Keep them here rather than
# inventing environment variables for them.
EXA_SEARCH_URL = "https://api.exa.ai/search"
PHOTON_SIDECAR_URL = "http://127.0.0.1:8789"
PHOTON_AGENT_URL = "http://okupy-api:10000"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    exa_api_key: str = ""

    composio_api_key: str = ""
    composio_user_id: str = "okupy-owner"

    photon_project_id: str = ""
    photon_project_secret: str = ""
    photon_sidecar_token: str = ""
    photon_home_channel: str = ""

    okupy_data_dir: Path = Path("./jobs")
    port: int = 8000

    @property
    def package_dir(self) -> Path:
        return Path(__file__).parent


def get_settings() -> Settings:
    return Settings()
