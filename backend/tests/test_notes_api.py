import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import init_db, get_connection
from backend.auth import get_current_user, create_access_token
from backend.services.notes_db import init_notes_db


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    init_notes_db()


def create_mock_user(user_id: str, username: str, email: str, role: str = "student"):
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, username, display_name, role, email, created_at, last_login_at)
            VALUES (?, ?, ?, ?, ?, '2026-10-10T00:00:00', '2026-10-10T00:00:00')
            """,
            (user_id, username, f"Test {username}", role, email)
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "id": user_id,
        "username": username,
        "display_name": f"Test {username}",
        "role": role,
        "email": email
    }


def test_unauthenticated_requests_return_401():
    client = TestClient(app)
    # Remove any override if present
    app.dependency_overrides.pop(get_current_user, None)

    # 1. GET /api/notes
    r1 = client.get("/api/notes")
    assert r1.status_code == 401

    # 2. POST /api/notes
    r2 = client.post("/api/notes", json={"title": "Unauthorized"})
    assert r2.status_code == 401

    # 3. GET /api/notes/{id}
    r3 = client.get("/api/notes/nonexistent-id")
    assert r3.status_code == 401

    # 4. PATCH /api/notes/{id}
    r4 = client.patch("/api/notes/nonexistent-id", json={"title": "Hacked"})
    assert r4.status_code == 401

    # 5. DELETE /api/notes/{id}
    r5 = client.delete("/api/notes/nonexistent-id")
    assert r5.status_code == 401


def test_notes_crud_lifecycle():
    user = create_mock_user("student-crud-1", "student_crud_1", "crud1@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    try:
        # 1. Create a note
        create_payload = {
            "title": "Quantum Physics Intro",
            "content": "Superposition principles and Schrodinger equation derivation.",
            "tags": ["physics", "quantum", "exam-prep"],
            "color": "mint",
            "pinned": True
        }
        res = client.post("/api/notes", json=create_payload)
        assert res.status_code == 201
        note_data = res.json()
        note_id = note_data["id"]
        assert note_data["title"] == "Quantum Physics Intro"
        assert note_data["content"] == create_payload["content"]
        assert "quantum" in note_data["tags"]
        assert note_data["pinned"] is True
        assert note_data["user_id"] == user["id"]

        # 2. Read single note
        get_res = client.get(f"/api/notes/{note_id}")
        assert get_res.status_code == 200
        assert get_res.json()["id"] == note_id

        # 3. Partial update note (autosave-friendly)
        patch_res = client.patch(
            f"/api/notes/{note_id}",
            json={"content": "Updated content with wave function collapse."}
        )
        assert patch_res.status_code == 200
        updated = patch_res.json()
        assert updated["content"] == "Updated content with wave function collapse."
        assert updated["title"] == "Quantum Physics Intro"  # Unchanged
        assert updated["pinned"] is True

        # 4. Delete note
        del_res = client.delete(f"/api/notes/{note_id}")
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True

        # 5. Verify 404 after deletion
        get_after_del = client.get(f"/api/notes/{note_id}")
        assert get_after_del.status_code == 404

    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_notes_pinned_first_and_newest_ordering():
    user = create_mock_user("student-order-1", "student_order_1", "order1@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    try:
        # Create unpinned note 1
        r1 = client.post("/api/notes", json={"title": "Note 1 (Regular)", "pinned": False})
        # Create pinned note 2
        r2 = client.post("/api/notes", json={"title": "Note 2 (Pinned)", "pinned": True})
        # Create unpinned note 3
        r3 = client.post("/api/notes", json={"title": "Note 3 (Newer Regular)", "pinned": False})

        list_res = client.get("/api/notes")
        assert list_res.status_code == 200
        items = list_res.json()["items"]
        assert len(items) >= 3

        # First item must be the pinned note
        assert items[0]["id"] == r2.json()["id"]
        assert items[0]["pinned"] is True

        # Next item should be Note 3 (newer than Note 1)
        assert items[1]["id"] == r3.json()["id"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_notes_search_and_tag_filter():
    user = create_mock_user("student-search-1", "student_search_1", "search1@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    try:
        client.post("/api/notes", json={
            "title": "Machine Learning Algorithms",
            "content": "Gradient descent optimization and loss functions.",
            "tags": ["AI", "Algorithms"]
        })
        client.post("/api/notes", json={
            "title": "Cell Biology",
            "content": "Mitochondria is the powerhouse of the cell.",
            "tags": ["Bio"]
        })

        # 1. Search in title
        s_title = client.get("/api/notes?search=machine")
        assert s_title.status_code == 200
        assert s_title.json()["total"] == 1
        assert "Machine Learning" in s_title.json()["items"][0]["title"]

        # 2. Search in content (case-insensitive)
        s_content = client.get("/api/notes?search=MITOCHONDRIA")
        assert s_content.status_code == 200
        assert s_content.json()["total"] == 1
        assert s_content.json()["items"][0]["title"] == "Cell Biology"

        # 3. Search in tags
        s_tag = client.get("/api/notes?search=algorithms")
        assert s_tag.status_code == 200
        assert s_tag.json()["total"] == 1

        # 4. Filter by specific tag
        tag_res = client.get("/api/notes?tag=Bio")
        assert tag_res.status_code == 200
        assert tag_res.json()["total"] == 1
        assert tag_res.json()["items"][0]["title"] == "Cell Biology"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_cross_user_isolation_strictly_enforced():
    user_a = create_mock_user("user-alice-1", "alice", "alice@example.com")
    user_b = create_mock_user("user-bob-1", "bob", "bob@example.com")

    # 1. User Alice creates a private note
    app.dependency_overrides[get_current_user] = lambda: user_a
    client = TestClient(app)
    res_a = client.post("/api/notes", json={
        "title": "Alice's Secret Study Notes",
        "content": "Private research data not for Bob."
    })
    assert res_a.status_code == 201
    alice_note_id = res_a.json()["id"]

    # 2. Switch to User Bob
    app.dependency_overrides[get_current_user] = lambda: user_b

    # Bob lists notes -> Alice's note must NOT be returned
    bob_list = client.get("/api/notes")
    assert bob_list.status_code == 200
    bob_note_ids = [n["id"] for n in bob_list.json()["items"]]
    assert alice_note_id not in bob_note_ids

    # Bob attempts to GET Alice's note -> 404
    bob_get = client.get(f"/api/notes/{alice_note_id}")
    assert bob_get.status_code == 404

    # Bob attempts to PATCH Alice's note -> 404
    bob_patch = client.patch(f"/api/notes/{alice_note_id}", json={"title": "Hacked by Bob"})
    assert bob_patch.status_code == 404

    # Bob attempts to DELETE Alice's note -> 404
    bob_delete = client.delete(f"/api/notes/{alice_note_id}")
    assert bob_delete.status_code == 404

    # 3. Switch back to Alice -> note is intact
    app.dependency_overrides[get_current_user] = lambda: user_a
    alice_check = client.get(f"/api/notes/{alice_note_id}")
    assert alice_check.status_code == 200
    assert alice_check.json()["title"] == "Alice's Secret Study Notes"

    app.dependency_overrides.pop(get_current_user, None)


def test_notes_validation_constraints():
    user = create_mock_user("student-val-1", "student_val_1", "val1@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    try:
        # 1. Title too long (> 150 chars)
        res_title = client.post("/api/notes", json={"title": "A" * 151})
        assert res_title.status_code in (400, 422)

        # 2. Content too long (> 20,000 chars)
        res_content = client.post("/api/notes", json={"title": "Valid", "content": "B" * 20001})
        assert res_content.status_code in (400, 422)

        # 3. Too many tags (> 10 tags)
        res_tags_count = client.post("/api/notes", json={
            "title": "Valid",
            "tags": [f"tag{i}" for i in range(11)]
        })
        assert res_tags_count.status_code in (400, 422)

        # 4. Tag too long (> 30 chars)
        res_tag_len = client.post("/api/notes", json={
            "title": "Valid",
            "tags": ["T" * 31]
        })
        assert res_tag_len.status_code in (400, 422)

    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_max_notes_per_user_limit(monkeypatch):
    user = create_mock_user("student-cap-1", "student_cap_1", "cap1@example.com")
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)

    try:
        from backend.routers import notes as notes_router_module
        monkeypatch.setattr(notes_router_module, "count_user_notes", lambda uid: 500)
        res = client.post("/api/notes", json={"title": "Exceeding note"})
        assert res.status_code == 400
        assert "500 notes" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)

