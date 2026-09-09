"""Custom model builder: switch Anthropic keys and model ids without hardcoding Opus."""

from __future__ import annotations

from dataclasses import dataclass

from okupy.config import Settings
from okupy.models import ModelProfile


@dataclass(frozen=True)
class ResolvedModel:
    profile: ModelProfile

    def agent_env(self) -> dict[str, str]:
        env: dict[str, str] = {"ANTHROPIC_MODEL": self.profile.model_id}
        if self.profile.api_key:
            env["ANTHROPIC_API_KEY"] = self.profile.api_key
        if self.profile.base_url:
            env["ANTHROPIC_BASE_URL"] = self.profile.base_url
        if self.profile.fallback_model:
            env["ANTHROPIC_SMALL_FAST_MODEL"] = self.profile.fallback_model
        return env


class ModelBuilder:
    """Named Anthropic profiles. Request `model` picks a profile or a raw model id."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._profiles: dict[str, ModelProfile] = {}
        self._seed_defaults()

    def _seed_defaults(self) -> None:
        key = self._settings.anthropic_api_key or None
        base = self._settings.anthropic_base_url or None
        fallback = self._settings.okupy_fallback_model or None
        self.register(
            ModelProfile(
                name="default",
                model_id=self._settings.okupy_model,
                api_key=key,
                base_url=base,
                fallback_model=fallback,
            )
        )
        self.register(
            ModelProfile(
                name="sonnet",
                model_id="claude-sonnet-4-5",
                api_key=key,
                base_url=base,
                fallback_model=fallback,
            )
        )
        self.register(
            ModelProfile(
                name="haiku",
                model_id="claude-haiku-4-5",
                api_key=key,
                base_url=base,
            )
        )
        self.register(
            ModelProfile(
                name="opus",
                model_id="claude-opus-4-6",
                api_key=key,
                base_url=base,
                fallback_model=fallback,
            )
        )

    def register(self, profile: ModelProfile) -> ModelProfile:
        self._profiles[profile.name] = profile
        return profile

    def list_profiles(self) -> list[ModelProfile]:
        return list(self._profiles.values())

    def resolve(self, name_or_id: str | None = None) -> ResolvedModel:
        if not name_or_id:
            return ResolvedModel(self._profiles["default"])
        if name_or_id in self._profiles:
            return ResolvedModel(self._profiles[name_or_id])
        default = self._profiles["default"]
        return ResolvedModel(
            ModelProfile(
                name=name_or_id,
                model_id=name_or_id,
                api_key=default.api_key,
                base_url=default.base_url,
                fallback_model=default.fallback_model,
            )
        )
