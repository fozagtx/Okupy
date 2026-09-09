from okupy.agents.definitions import AGENT_NAMES, specialist_definitions
from okupy.config import Settings
from okupy.models import GenerateRequest
from okupy.orchestrator import Supervisor


def test_three_agents_are_named():
    assert AGENT_NAMES == ("supervisor", "slideshow", "video")
    specs = specialist_definitions()
    assert set(specs) == {"slideshow", "video"}


def test_supervisor_plans_both_specialists(tmp_path):
    settings = Settings(okupy_data_dir=tmp_path, okupy_agent_mode="direct")
    supervisor = Supervisor(settings)
    plan = supervisor.plan(GenerateRequest(tutorial="Make iced coffee in two minutes now.", outputs=["slideshow", "video"]))
    assert plan == ["supervisor", "slideshow", "video"]


def test_direct_mode_writes_slides(tmp_path):
    settings = Settings(okupy_data_dir=tmp_path, okupy_agent_mode="direct")
    supervisor = Supervisor(settings)
    result = supervisor.run(
        GenerateRequest(
            tutorial="1. Boil water. 2. Bloom the coffee. 3. Pour slowly. 4. Drink it hot.",
            title="V60 in 60 seconds",
            outputs=["slideshow"],
        )
    )
    assert result.supervisor == "supervisor"
    assert "slideshow" in result.agents_used
    assert len(result.slides) >= 3
    assert (tmp_path / result.job_id / "slides" / "slide-00.png").exists()
    assert any("DAYTONA_API_KEY is not set" in note for note in result.notes)
