import os

from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "test_conceptlens.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test_secret_for_pytest_long_enough_random_key_1234567890"

from backend.auth import get_current_user_or_guest
from backend.database import create_document, get_connection, init_db, save_concepts_and_relations
from backend.main import app


def test_flowchart_route_returns_topic_data_and_checks_owner():
    init_db()
    conn = get_connection()
    with conn:
        conn.execute("DELETE FROM relations")
        conn.execute("DELETE FROM concepts")
        conn.execute("DELETE FROM documents")
    conn.close()
    create_document("owner-one", "flow-route", "notes.txt", "txt", status="completed", stage="completed")
    save_concepts_and_relations("flow-route", [
        {"name": "Input", "topic": "Process", "flow_order": 1, "importance": 3, "score": 0.8},
        {"name": "Output", "topic": "Process", "flow_order": 2, "importance": 3, "score": 0.7},
    ])
    app.dependency_overrides[get_current_user_or_guest] = lambda: {"id": "owner-one"}
    try:
        client = TestClient(app)
        overview = client.get("/api/documents/flow-route/flowchart")
        assert overview.status_code == 200
        assert overview.json()["overview"] is True
        detail = client.get("/api/documents/flow-route/flowchart?topic=Process")
        assert detail.status_code == 200
        assert {node["label"] for node in detail.json()["nodes"] if node.get("node_type") == "concept"} == {"Input", "Output"}
        app.dependency_overrides[get_current_user_or_guest] = lambda: {"id": "owner-two"}
        assert client.get("/api/documents/flow-route/flowchart").status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user_or_guest, None)
