from okupy.config import Settings
from okupy.model_builder import ModelBuilder
from okupy.models import ModelProfile


def test_default_is_not_opus():
    builder = ModelBuilder(Settings(okupy_model="claude-sonnet-4-5", anthropic_api_key="sk-ant-testkey"))
    resolved = builder.resolve(None)
    assert resolved.profile.name == "default"
    assert "opus" not in resolved.profile.model_id.lower()
    assert resolved.agent_env()["ANTHROPIC_API_KEY"] == "sk-ant-testkey"


def test_switch_api_key_and_model():
    builder = ModelBuilder(Settings())
    builder.register(
        ModelProfile(
            name="work",
            model_id="claude-haiku-4-5",
            api_key="sk-ant-other",
            base_url="https://api.anthropic.com",
        )
    )
    resolved = builder.resolve("work")
    env = resolved.agent_env()
    assert env["ANTHROPIC_API_KEY"] == "sk-ant-other"
    assert env["ANTHROPIC_MODEL"] == "claude-haiku-4-5"
    assert env["ANTHROPIC_BASE_URL"] == "https://api.anthropic.com"


def test_raw_model_id_uses_default_key():
    builder = ModelBuilder(Settings(anthropic_api_key="sk-ant-root"))
    resolved = builder.resolve("claude-sonnet-4-5")
    assert resolved.profile.model_id == "claude-sonnet-4-5"
    assert resolved.agent_env()["ANTHROPIC_API_KEY"] == "sk-ant-root"
