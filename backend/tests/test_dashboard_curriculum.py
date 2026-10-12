import io
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import init_db, get_connection
from backend.auth import get_current_user, get_current_user_or_guest
from backend.services.planner_db import (
    init_planner_db,
    link_document_to_curriculum,
    backfill_unlinked_documents,
    get_user_subjects,
    get_connection as get_planner_conn,
)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    init_planner_db()


def create_user(user_id: str, username: str):
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, username, display_name, role, email, created_at, last_login_at)
            VALUES (?, ?, ?, 'student', ?, '2026-10-10T00:00:00', '2026-10-10T00:00:00')
            """,
            (user_id, username, f"User {username}", f"{username}@test.com")
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "id": user_id,
        "username": username,
        "display_name": f"User {username}",
        "role": "student",
        "email": f"{username}@test.com",
        "is_authenticated": True
    }


def set_auth(user):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_or_guest] = lambda: {**user, "is_authenticated": True}


def clear_auth():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_or_guest, None)


def test_dashboard_summary_empty_state():
    user = create_user("user-empty-1", "empty_user")
    set_auth(user)
    client = TestClient(app)
    try:
        resp = client.get("/api/dashboard/summary")
        assert resp.status_code == 200
        data = resp.json()

        assert "stats" in data
        assert data["stats"]["total_concepts"] == 0
        assert data["stats"]["completed_chapters"] == 0
        assert data["stats"]["total_chapters"] == 0
        assert data["stats"]["study_time_left"] == 0.0
        assert data["stats"]["mastery_percentage"] == 0.0

        assert "0h left" in data["status_line"]
        assert len(data["books"]) == 0
        assert len(data["course_status"]["chapters"]) == 0
    finally:
        clear_auth()


def test_upload_linking_and_summary_refresh():
    user = create_user("user-upload-1", "uploader_user")
    set_auth(user)
    client = TestClient(app)
    try:
        # Upload a document in offline extraction mode
        content = (
            "Sorting Algorithms: QuickSort is a divide-and-conquer algorithm. "
            "MergeSort is another divide-and-conquer algorithm with guaranteed O(n log n) runtime. "
            "HeapSort uses a binary heap data structure."
        ).encode("utf-8")
        upload_resp = client.post(
            "/api/documents",
            data={"extraction_mode": "offline"},
            files={"file": ("Lecture_3_Sorting.txt", io.BytesIO(content), "text/plain")}
        )
        assert upload_resp.status_code == 200
        doc_data = upload_resp.json()
        doc_id = doc_data["id"]

        # Call GET /api/dashboard/summary
        summary_resp = client.get("/api/dashboard/summary")
        assert summary_resp.status_code == 200
        summary = summary_resp.json()

        stats = summary["stats"]
        assert stats["total_concepts"] > 0
        assert stats["total_chapters"] >= 1
        assert stats["completed_chapters"] == 0
        assert stats["study_time_left"] > 0.0  # Shows study time even before deadline
        assert stats["mastery_percentage"] == 0.0

        # Check status line before plan start
        assert "Choose a deadline" in summary["status_line"]
        assert f"{stats['study_time_left']}h of study material in Core Curriculum" in summary["status_line"]

        # Notes Analysis & Chapters check
        assert len(summary["books"]) >= 1
        book = summary["books"][0]
        assert book["id"] == doc_id
        assert len(book["chapters"]) >= 1
        ch = book["chapters"][0]
        assert ch["difficulty"] in [0, 1, 2]
        assert ch["difficulty_label"] in ["Easy", "Medium", "Hard"]
        assert ch["est_hours"] > 0
        assert ch["completed"] is False

        # Course Status & Route Planner check
        assert len(summary["course_status"]["chapters"]) >= 1
        assert len(summary["preview_route"]["route"]) >= 1

        # Related Topics & Clusters check
        assert "clusters" in summary["relations"]
    finally:
        clear_auth()


def test_reupload_same_file_idempotency():
    user = create_user("user-idem-1", "idem_user")
    set_auth(user)
    client = TestClient(app)
    try:
        content = (
            "Idempotency Test Content: Hashing ensures that duplicate file uploads "
            "are recognized immediately by their SHA256 checksum without double extraction."
        ).encode("utf-8")
        # First upload
        up1 = client.post(
            "/api/documents",
            data={"extraction_mode": "offline"},
            files={"file": ("Notes_Idem.txt", io.BytesIO(content), "text/plain")}
        )
        assert up1.status_code == 200
        doc_id_1 = up1.json()["id"]

        sum1 = client.get("/api/dashboard/summary").json()
        concepts_1 = sum1["stats"]["total_concepts"]
        chapters_1 = sum1["stats"]["total_chapters"]
        assert concepts_1 > 0
        assert chapters_1 >= 1

        # Second upload of the EXACT same content
        up2 = client.post(
            "/api/documents",
            data={"extraction_mode": "offline"},
            files={"file": ("Notes_Idem.txt", io.BytesIO(content), "text/plain")}
        )
        assert up2.status_code == 200
        doc_id_2 = up2.json()["id"]

        # Cache hit returns same document
        assert doc_id_2 == doc_id_1

        # Summary check: MUST NOT double count concepts or chapters
        sum2 = client.get("/api/dashboard/summary").json()
        assert sum2["stats"]["total_concepts"] == concepts_1
        assert sum2["stats"]["total_chapters"] == chapters_1
        assert len(sum2["books"]) == 1
    finally:
        clear_auth()


def test_mark_chapter_complete_and_plan_daily_pace():
    user = create_user("user-ch-progress-1", "progress_user")
    set_auth(user)
    client = TestClient(app)
    try:
        content = (
            "Binary Search is an efficient searching algorithm with logarithmic time complexity. "
            "Linear Search scans all elements sequentially with linear time complexity."
        ).encode("utf-8")
        up = client.post(
            "/api/documents",
            data={"extraction_mode": "offline"},
            files={"file": ("BinarySearch.txt", io.BytesIO(content), "text/plain")}
        )
        assert up.status_code == 200
        doc_id = up.json()["id"]

        sum_before = client.get("/api/dashboard/summary").json()
        assert len(sum_before["books"]) >= 1
        ch = sum_before["books"][0]["chapters"][0]
        ch_id = ch["id"]
        assert sum_before["stats"]["completed_chapters"] == 0
        assert sum_before["stats"]["mastery_percentage"] == 0.0

        # Mark chapter complete (status = 2)
        patch_res = client.patch(f"/api/chapters/{ch_id}/progress", json={"status": 2})
        assert patch_res.status_code == 200

        # Verify summary updates immediately
        sum_after = client.get("/api/dashboard/summary").json()
        assert sum_after["stats"]["completed_chapters"] == 1
        assert sum_after["stats"]["study_time_left"] == 0.0
        assert sum_after["stats"]["mastery_percentage"] == 100.0

        # Re-set status to in_progress (status = 1) and create a 7-day plan
        client.patch(f"/api/chapters/{ch_id}/progress", json={"status": 1})
        sub_id = sum_after["subject"]["id"]
        plan_res = client.post("/api/plans", json={"subject_id": sub_id, "days": 7, "order_mode": "easy"})
        assert plan_res.status_code == 200

        sum_plan = client.get("/api/dashboard/summary").json()
        assert sum_plan["active_plan"] is not None
        assert "h/day needed" in sum_plan["status_line"]
    finally:
        clear_auth()


def test_rename_and_delete_document():
    user = create_user("user-crud-1", "crud_user")
    set_auth(user)
    client = TestClient(app)
    try:
        content = (
            "Graph Theory: Dijkstra algorithm finds the shortest path between nodes. "
            "Bellman-Ford algorithm handles graphs with negative edge weights."
        ).encode("utf-8")
        up = client.post(
            "/api/documents",
            data={"extraction_mode": "offline"},
            files={"file": ("Graph_Theory.txt", io.BytesIO(content), "text/plain")}
        )
        assert up.status_code == 200
        doc_id = up.json()["id"]

        # Rename document
        rename_res = client.patch(f"/api/documents/{doc_id}", json={"filename": "Advanced_Graph_Theory.txt"})
        assert rename_res.status_code == 200
        assert rename_res.json()["filename"] == "Advanced_Graph_Theory.txt"

        sum_renamed = client.get("/api/dashboard/summary").json()
        assert sum_renamed["books"][0]["name"] == "Advanced_Graph_Theory.txt"

        # Delete document
        del_res = client.delete(f"/api/documents/{doc_id}")
        assert del_res.status_code == 200

        # Summary should have 0 concepts and 0 chapters
        sum_deleted = client.get("/api/dashboard/summary").json()
        assert sum_deleted["stats"]["total_concepts"] == 0
        assert sum_deleted["stats"]["total_chapters"] == 0
        assert len(sum_deleted["books"]) == 0
    finally:
        clear_auth()


def test_user_data_isolation():
    user_a = create_user("user-iso-a", "user_a")
    user_b = create_user("user-iso-b", "user_b")

    client = TestClient(app)

    # User A uploads document
    set_auth(user_a)
    content = (
        "Machine Learning: Linear regression models continuous values. "
        "Logistic regression models discrete probabilities."
    ).encode("utf-8")
    up_a = client.post(
        "/api/documents",
        data={"extraction_mode": "offline"},
        files={"file": ("ML_Notes.txt", io.BytesIO(content), "text/plain")}
    )
    assert up_a.status_code == 200

    sum_a = client.get("/api/dashboard/summary").json()
    assert sum_a["stats"]["total_concepts"] > 0
    assert sum_a["stats"]["total_chapters"] >= 1

    # User B checks summary: must be 0
    set_auth(user_b)
    sum_b = client.get("/api/dashboard/summary").json()
    assert sum_b["stats"]["total_concepts"] == 0
    assert sum_b["stats"]["total_chapters"] == 0
    assert len(sum_b["books"]) == 0
    clear_auth()


def test_backfill_unlinked_documents_routine():
    user = create_user("user-backfill-1", "backfill_user")
    # Directly insert an unlinked completed document with concepts
    conn = get_connection()
    doc_id = "doc-unlinked-test-1"
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO documents (id, user_id, filename, file_type, status, created_at)
            VALUES (?, ?, 'PreExisting_Lecture.pdf', 'pdf', 'completed', '2026-10-10T00:00:00')
            """,
            (doc_id, user["id"])
        )
        conn.execute(
            """
            INSERT INTO concepts (document_id, name, definition, topic, score, importance, source_excerpt)
            VALUES (?, 'Backfill Concept 1', 'Definition 1', 'General', 0.9, 1, 'Excerpt 1')
            """,
            (doc_id,)
        )
        conn.execute(
            """
            INSERT INTO concepts (document_id, name, definition, topic, score, importance, source_excerpt)
            VALUES (?, 'Backfill Concept 2', 'Definition 2', 'General', 0.8, 1, 'Excerpt 2')
            """,
            (doc_id,)
        )
        conn.commit()
    finally:
        conn.close()

    # Run backfill routine
    linked_count = backfill_unlinked_documents()
    assert linked_count >= 1

    # Run backfill routine AGAIN (idempotency test)
    linked_second = backfill_unlinked_documents()
    assert linked_second == 0  # No new documents needed backfilling

    # Check that user's summary now has this document
    set_auth(user)
    client = TestClient(app)
    try:
        sum_data = client.get("/api/dashboard/summary").json()
        assert sum_data["stats"]["total_concepts"] >= 2
        assert sum_data["stats"]["total_chapters"] >= 1
        assert any(b["id"] == doc_id for b in sum_data["books"])
    finally:
        clear_auth()
