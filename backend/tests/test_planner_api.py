import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import init_db
from backend.auth import get_current_user
from backend.services.planner_db import (
    init_planner_db,
    ensure_default_subject_and_chapters_for_user,
    get_user_subjects,
    get_connection,
)


@pytest.fixture
def client_with_user():
    init_db()
    init_planner_db()
    user = {
        "id": "test-student-123",
        "username": "student1",
        "display_name": "Test Student",
        "role": "student",
        "email": "student@example.com"
    }
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, username, display_name, role, email, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, '2026-10-10T00:00:00', '2026-10-10T00:00:00')
            """,
            (user["id"], user["username"], user["display_name"], user["role"], user["email"])
        )
        conn.commit()
    finally:
        conn.close()

    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    # Ensure default subject exists
    ensure_default_subject_and_chapters_for_user(user["id"])
    yield client, user
    app.dependency_overrides.pop(get_current_user, None)


def test_planner_overview_endpoint(client_with_user):
    client, user = client_with_user
    resp = client.get("/api/planner/overview")
    assert resp.status_code == 200
    data = resp.json()
    assert "subject" in data
    assert "subjects" in data
    assert "stats" in data
    assert "books" in data
    assert data["stats"]["total_chapters"] >= 0


def test_chapter_progress_and_meta_update(client_with_user):
    client, user = client_with_user
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO documents (id, user_id, filename, file_type, status, created_at)
            VALUES ('doc-1', ?, 'test.pdf', 'pdf', 'completed', '2026-10-10T00:00:00')
            """,
            (user["id"],)
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO chapters (id, book_id, name, order_index, concept_count, difficulty, est_hours, created_at)
            VALUES ('test-ch-1', 'doc-1', 'Test Chapter 1', 1, 5, 1, 3.0, '2026-10-10T00:00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()

    # 1. Update progress
    p_resp = client.patch("/api/chapters/test-ch-1/progress", json={"status": 1})
    assert p_resp.status_code == 200
    assert p_resp.json()["success"] is True

    # 2. Update metadata
    m_resp = client.patch("/api/chapters/test-ch-1", json={"difficulty": 2, "est_hours": 4.5})
    assert m_resp.status_code == 200
    assert m_resp.json()["chapter"]["difficulty"] == 2
    assert m_resp.json()["chapter"]["est_hours"] == 4.5


def test_plan_preview_and_creation_lifecycle(client_with_user):
    client, user = client_with_user
    subjects = get_user_subjects(user["id"])
    assert len(subjects) > 0
    sub_id = subjects[0]["id"]

    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO documents (id, user_id, subject_id, filename, file_type, status, created_at)
            VALUES ('doc-plan-1', ?, ?, 'math.pdf', 'pdf', 'completed', '2026-10-10T00:00:00')
            """,
            (user["id"], sub_id)
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO chapters (id, book_id, name, order_index, concept_count, difficulty, est_hours, created_at)
            VALUES ('ch-plan-1', 'doc-plan-1', 'Calculus', 1, 10, 1, 7.0, '2026-10-10T00:00:00')
            """
        )
        conn.commit()
    finally:
        conn.close()

    # 1. Preview
    prev_resp = client.post("/api/plans/preview", json={
        "subject_id": sub_id,
        "days": 7,
        "order_mode": "syllabus"
    })
    assert prev_resp.status_code == 200
    prev_data = prev_resp.json()
    assert prev_data["days"] == 7
    assert len(prev_data["route"]) == 7

    # 2. Create Plan
    create_resp = client.post("/api/plans", json={
        "subject_id": sub_id,
        "days": 7,
        "order_mode": "syllabus"
    })
    assert create_resp.status_code == 200
    plan_data = create_resp.json()["plan"]
    plan_id = plan_data["id"]
    assert plan_data["days"] == 7

    # 3. Active Plan endpoint
    act_resp = client.get(f"/api/plans/active?subject_id={sub_id}")
    assert act_resp.status_code == 200
    assert act_resp.json()["plan"]["id"] == plan_id

    # 4. Toggle day done
    toggle_resp = client.patch(f"/api/plans/{plan_id}/days/1")
    assert toggle_resp.status_code == 200
    assert 1 in toggle_resp.json()["plan"]["done_days"]

    # 5. Reset plan
    del_resp = client.delete(f"/api/plans/{plan_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True


def test_reminders_crud(client_with_user):
    client, user = client_with_user

    # 1. Add reminder
    add_resp = client.post("/api/reminders", json={
        "time": "18:30",
        "weekdays": [1, 2, 3, 4, 5],
        "label": "Evening Study",
        "enabled": True
    })
    assert add_resp.status_code == 200
    rem = add_resp.json()["reminder"]
    rem_id = rem["id"]
    assert rem["time"] == "18:30"
    assert rem["label"] == "Evening Study"

    # 2. List reminders
    list_resp = client.get("/api/reminders")
    assert list_resp.status_code == 200
    rem_ids = [r["id"] for r in list_resp.json()["reminders"]]
    assert rem_id in rem_ids

    # 3. Edit reminder
    edit_resp = client.patch(f"/api/reminders/{rem_id}", json={
        "enabled": False,
        "label": "Updated Study"
    })
    assert edit_resp.status_code == 200
    assert edit_resp.json()["reminder"]["enabled"] is False

    # 4. Delete reminder
    del_resp = client.delete(f"/api/reminders/{rem_id}")
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True
