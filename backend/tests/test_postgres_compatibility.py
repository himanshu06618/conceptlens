import os
import json
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import (
    get_database_url,
    RowAdapter,
    DBConnectionAdapter,
    engine,
)
from scripts.export_data import export_data


def test_database_url_normalization(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pass@ep-cool-pooler.neon.tech/neondb")
    norm_url = get_database_url()
    assert norm_url.startswith("postgresql://")
    assert "sslmode=require" in norm_url

    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@ep-cool-pooler.neon.tech/neondb?sslmode=require")
    norm_url2 = get_database_url()
    assert norm_url2 == "postgresql://user:pass@ep-cool-pooler.neon.tech/neondb?sslmode=require"

    monkeypatch.setenv("DATABASE_URL", "")
    sqlite_url = get_database_url()
    assert sqlite_url.startswith("sqlite:///")


def test_row_adapter():
    data = {"id": "doc_123", "name": "Algorithms", "score": 0.95}
    values = ("doc_123", "Algorithms", 0.95)
    row = RowAdapter(data, values)

    # Dictionary key access
    assert row["id"] == "doc_123"
    assert row["name"] == "Algorithms"
    assert row.get("score") == 0.95
    assert row.get("nonexistent", "default") == "default"

    # Numeric index access
    assert row[0] == "doc_123"
    assert row[1] == "Algorithms"
    assert row[2] == 0.95
    assert row.get(0) == "doc_123"
    assert row.get(99, "none") == "none"

    # Dict conversion
    as_dict = dict(row)
    assert as_dict == data


def test_sql_translation_adapter():
    # 1. Parameter translation: ? -> %s
    sql = "SELECT id, name FROM concepts WHERE document_id = ? AND importance >= ?"
    translated = DBConnectionAdapter._translate_sql(sql)
    assert translated == "SELECT id, name FROM concepts WHERE document_id = %s AND importance >= %s"

    # 2. String literal preservation
    sql_with_literal = "SELECT * FROM notes WHERE title LIKE '%what?' AND status = ?"
    trans_lit = DBConnectionAdapter._translate_sql(sql_with_literal)
    assert trans_lit == "SELECT * FROM notes WHERE title LIKE '%what?' AND status = %s"

    # 3. INSERT OR REPLACE translation to ON CONFLICT DO UPDATE
    sql_replace = "INSERT OR REPLACE INTO users (id, username, email) VALUES (?, ?, ?)"
    trans_replace = DBConnectionAdapter._translate_sql(sql_replace)
    assert "INSERT INTO users (id, username, email)" in trans_replace
    assert "ON CONFLICT (id) DO UPDATE SET" in trans_replace
    assert "username = EXCLUDED.username" in trans_replace
    assert "email = EXCLUDED.email" in trans_replace
    assert "id = EXCLUDED.id" not in trans_replace


def test_health_db_endpoint():
    client = TestClient(app)
    res_root = client.get("/health/db")
    assert res_root.status_code == 200
    assert res_root.json() == {"status": "ok"}

    res_api = client.get("/api/health/db")
    assert res_api.status_code == 200
    assert res_api.json() == {"status": "ok"}


def test_export_data_script(tmp_path):
    out_file = tmp_path / "test_backup.json"
    export_data(out_file)

    assert out_file.exists()
    with open(out_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert "metadata" in data
    assert data["metadata"]["app"] == "ConceptLens"
    assert "users" in data
    assert "notes" in data
    assert "documents" in data

    # Verify security: no password_hash ever exported
    for u in data["users"]:
        assert "password_hash" not in u
