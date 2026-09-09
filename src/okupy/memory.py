from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from okupy.models import BuilderProfile


class BuilderMemory:
    """Small durable profile store; each channel uses the same stable user id."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    def get(self, user_id: str) -> BuilderProfile | None:
        with self._connect() as db:
            row = db.execute("SELECT payload FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
        return BuilderProfile.model_validate_json(row[0]) if row else None

    def save(self, profile: BuilderProfile) -> BuilderProfile:
        saved = profile.model_copy(update={"updated_at": datetime.now(UTC)})
        with self._connect() as db:
            db.execute(
                "INSERT INTO profiles(user_id, payload) VALUES (?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload",
                (saved.user_id, saved.model_dump_json()),
            )
        return saved

    def public_snapshot(self, user_id: str) -> dict:
        profile = self.get(user_id)
        return json.loads(profile.model_dump_json()) if profile else {}
