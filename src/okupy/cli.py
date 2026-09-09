from __future__ import annotations

import argparse
import json

from okupy.agent import BuilderEventAgent
from okupy.config import EXA_SEARCH_URL, get_settings
from okupy.integrations.exa import ExaSearch
from okupy.memory import BuilderMemory
from okupy.models import DiscoveryRequest


def main() -> None:
    parser = argparse.ArgumentParser(description="Find builder events with food, people, and credits.")
    parser.add_argument("message", nargs="?", default="Find something worthwhile this week")
    parser.add_argument("--user-id", required=True)
    args = parser.parse_args()
    settings = get_settings()
    finder = BuilderEventAgent(
        BuilderMemory(settings.okupy_data_dir / "memory.sqlite3"),
        ExaSearch(settings.exa_api_key, EXA_SEARCH_URL),
    )
    print(json.dumps(finder.run(DiscoveryRequest(user_id=args.user_id, message=args.message)).model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    main()
