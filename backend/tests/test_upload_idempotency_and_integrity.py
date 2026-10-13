import io
import os
import uuid
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import init_db, get_connection, delete_document_by_id
from backend.auth import get_current_user, get_current_user_or_guest
from backend.services.planner_db import (
    init_planner_db,
    get_subject_overview_data,
    get_dashboard_summary_data,
    link_document_to_curriculum,
)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    init_planner_db()


def make_test_user(user_id: str, username: str):
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, username, display_name, role, email, created_at, last_login_at)
            VALUES (?, ?, ?, 'student', ?, '2026-10-10T00:00:00', '2026-10-10T00:00:00')
            """,
            (user_id, username, f"User {username}", f"{username}@example.com")
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "id": user_id,
        "username": username,
        "display_name": f"User {username}",
        "role": "student",
        "email": f"{username}@example.com",
        "is_authenticated": True
    }


def set_auth(user):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_or_guest] = lambda: {**user, "is_authenticated": True}


def clear_auth():
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_or_guest, None)


def test_single_upload_produces_exact_counts_and_no_doubling():
    user = make_test_user("test-user-exact-1", "exact_user_1")
    set_auth(user)
    client = TestClient(app)
    try:
        content = (
            "Machine Learning Fundamentals: Supervised Learning uses labeled datasets to train algorithms. "
            "Unsupervised Learning discovers hidden patterns without human guidance. "
            "Reinforcement Learning trains agents via rewards and penalties."
        ).encode("utf-8")

        # 1. Upload file (TestClient executes background task synchronously)
        idempotency_key = str(uuid.uuid4())
        res = client.post(
            "/api/documents",
            files={"file": ("ml_notes.txt", io.BytesIO(content), "text/plain")},
            data={"idempotency_key": idempotency_key},
            headers={"X-Idempotency-Key": idempotency_key}
        )
        assert res.status_code == 200
        doc = res.json()
        doc_id = doc["id"]

        # 2. Check document row
        conn = get_connection()
        try:
            doc_row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            assert doc_row is not None
            assert doc_row["status"] == "completed"

            # Check chapters in DB
            chapters = conn.execute("SELECT * FROM chapters WHERE book_id = ?", (doc_id,)).fetchall()
            concepts = conn.execute("SELECT * FROM concepts WHERE document_id = ?", (doc_id,)).fetchall()

            chapter_names = [c["name"].lower().strip() for c in chapters]
            assert len(chapters) == len(set(chapter_names)), "No duplicate chapter names exist"

            concept_names = [c["name"].lower().strip() for c in concepts]
            assert len(concepts) == len(set(concept_names)), "No duplicate concept names exist"

            # 3. Check dashboard summary
            summary = client.get("/api/dashboard/summary").json()
            assert summary["stats"]["total_chapters"] == len(chapters)
            assert summary["stats"]["total_concepts"] == len(concepts)

            # 4. Check book list
            books = summary["books"]
            matching_books = [b for b in books if b["id"] == doc_id]
            assert len(matching_books) == 1
            assert len(matching_books[0]["chapters"]) == len(chapters)
        finally:
            conn.close()
    finally:
        clear_auth()


def test_reupload_same_file_returns_existing_document():
    user = make_test_user("test-user-reup-1", "reup_user_1")
    set_auth(user)
    client = TestClient(app)
    try:
        content = "Binary Search operates in logarithmic O(log n) time complexity on sorted arrays.".encode("utf-8")
        
        # First upload
        res1 = client.post(
            "/api/documents",
            files={"file": ("binary_search.txt", io.BytesIO(content), "text/plain")}
        )
        assert res1.status_code == 200
        doc1 = res1.json()

        # Second upload with same content
        res2 = client.post(
            "/api/documents",
            files={"file": ("binary_search_copy.txt", io.BytesIO(content), "text/plain")}
        )
        assert res2.status_code == 200
        doc2 = res2.json()

        # Must return the identical document ID
        assert doc1["id"] == doc2["id"]

        # Database must have exactly 1 document row for this user
        conn = get_connection()
        try:
            doc_count = conn.execute("SELECT COUNT(*) FROM documents WHERE user_id = ?", (user["id"],)).fetchone()[0]
            assert doc_count == 1
        finally:
            conn.close()
    finally:
        clear_auth()


def test_multi_user_isolation_with_same_file():
    user_a = make_test_user("user-iso-a", "user_iso_a")
    user_b = make_test_user("user-iso-b", "user_iso_b")

    content = "Distributed Consensus: Paxos and Raft achieve fault tolerance in distributed state machines.".encode("utf-8")

    # User A uploads
    set_auth(user_a)
    client_a = TestClient(app)
    res_a = client_a.post("/api/documents", files={"file": ("consensus.txt", io.BytesIO(content), "text/plain")})
    assert res_a.status_code == 200
    doc_a = res_a.json()
    clear_auth()

    # User B uploads identical file
    set_auth(user_b)
    client_b = TestClient(app)
    res_b = client_b.post("/api/documents", files={"file": ("consensus.txt", io.BytesIO(content), "text/plain")})
    assert res_b.status_code == 200
    doc_b = res_b.json()
    clear_auth()

    # User A and User B documents MUST have different IDs
    assert doc_a["id"] != doc_b["id"]

    # Verify both exist in DB with their respective user_id
    conn = get_connection()
    try:
        row_a = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_a["id"],)).fetchone()
        row_b = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_b["id"],)).fetchone()
        assert row_a["user_id"] == user_a["id"]
        assert row_b["user_id"] == user_b["id"]
    finally:
        conn.close()


def test_polling_does_not_duplicate_results():
    user = make_test_user("user-poll-1", "poll_user_1")
    set_auth(user)
    client = TestClient(app)
    try:
        content = "Graph Theory: Breadth-First Search traverses level by level. Depth-First Search explores deeply.".encode("utf-8")
        res = client.post("/api/documents", files={"file": ("graphs.txt", io.BytesIO(content), "text/plain")})
        assert res.status_code == 200
        doc_id = res.json()["id"]

        # Poll status and results multiple times (e.g., 5 times)
        for _ in range(5):
            st = client.get(f"/api/documents/{doc_id}/status")
            assert st.status_code == 200
            sum_res = client.get("/api/dashboard/summary")
            assert sum_res.status_code == 200

        # Verify database did not multiply chapters or concepts
        conn = get_connection()
        try:
            chapters = conn.execute("SELECT * FROM chapters WHERE book_id = ?", (doc_id,)).fetchall()
            concepts = conn.execute("SELECT * FROM concepts WHERE document_id = ?", (doc_id,)).fetchall()

            chapter_names = [c["name"].lower().strip() for c in chapters]
            assert len(chapters) == len(set(chapter_names))

            concept_names = [c["name"].lower().strip() for c in concepts]
            assert len(concepts) == len(set(concept_names))
        finally:
            conn.close()
    finally:
        clear_auth()


def test_delete_document_cleans_all_related_rows_no_orphans():
    user = make_test_user("user-del-1", "del_user_1")
    set_auth(user)
    client = TestClient(app)
    try:
        content = "Cryptography: RSA encryption relies on the practical difficulty of factoring large integers.".encode("utf-8")
        res = client.post("/api/documents", files={"file": ("crypto.txt", io.BytesIO(content), "text/plain")})
        assert res.status_code == 200
        doc_id = res.json()["id"]

        # Delete document
        del_res = client.delete(f"/api/documents/{doc_id}")
        assert del_res.status_code == 200

        # Verify no orphan rows exist in DB
        conn = get_connection()
        try:
            assert conn.execute("SELECT COUNT(*) FROM documents WHERE id = ?", (doc_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM chapters WHERE book_id = ?", (doc_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (doc_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM relations WHERE document_id = ?", (doc_id,)).fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM topics WHERE chapter_id NOT IN (SELECT id FROM chapters)").fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM chapter_progress WHERE chapter_id NOT IN (SELECT id FROM chapters)").fetchone()[0] == 0
        finally:
            conn.close()
    finally:
        clear_auth()


def test_repeated_startup_hooks_leave_counts_unchanged():
    user = make_test_user("user-startup-1", "startup_user_1")
    set_auth(user)
    client = TestClient(app)
    try:
        content = "Compilers: Lexical analysis transforms character streams into token streams.".encode("utf-8")
        res = client.post("/api/documents", files={"file": ("compilers.txt", io.BytesIO(content), "text/plain")})
        assert res.status_code == 200
        doc_id = res.json()["id"]

        conn = get_connection()
        try:
            initial_chapters = conn.execute("SELECT COUNT(*) FROM chapters WHERE book_id = ?", (doc_id,)).fetchone()[0]
            initial_concepts = conn.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (doc_id,)).fetchone()[0]

            # Simulate backend restart by calling init_db and init_planner_db multiple times
            init_db()
            init_planner_db()
            init_db()
            init_planner_db()

            final_chapters = conn.execute("SELECT COUNT(*) FROM chapters WHERE book_id = ?", (doc_id,)).fetchone()[0]
            final_concepts = conn.execute("SELECT COUNT(*) FROM concepts WHERE document_id = ?", (doc_id,)).fetchone()[0]

            assert initial_chapters == final_chapters
            assert initial_concepts == final_concepts
        finally:
            conn.close()
    finally:
        clear_auth()
