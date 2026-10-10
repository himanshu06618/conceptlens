import os
import io
import pytest
from fastapi.testclient import TestClient

# Ensure test uses an in-memory or test SQLite database
os.environ["DATABASE_PATH"] = "test_conceptlens.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test_secret_for_pytest_long_enough_random_key_1234567890"

os.environ["RATE_LIMIT_ENABLED"] = "false"

from backend.main import app
from backend.database import init_db, get_connection
from backend.routers.auth import limiter

@pytest.fixture(autouse=True)
def clean_db():
    limiter.enabled = False
    init_db()
    conn = get_connection()
    with conn:
        conn.execute("DELETE FROM relations;")
        conn.execute("DELETE FROM concepts;")
        conn.execute("DELETE FROM documents;")
        conn.execute("DELETE FROM users;")
    conn.close()
    yield

@pytest.fixture
def client():
    return TestClient(app)

def test_register_and_login_validation(client):
    # Short username
    res = client.post("/api/auth/register", json={
        "username": "ab",
        "password": "ValidPassword123!"
    })
    assert res.status_code == 400
    assert "Username must be between 3 and 24" in res.json()["detail"]

    # Short password
    res = client.post("/api/auth/register", json={
        "username": "alice",
        "password": "123"
    })
    assert res.status_code == 400
    assert "at least 8 characters" in res.json()["detail"]

    # Common password
    res = client.post("/api/auth/register", json={
        "username": "alice",
        "password": "password123"
    })
    assert res.status_code == 400
    assert "too common" in res.json()["detail"]

    # Password mismatch
    res = client.post("/api/auth/register", json={
        "username": "alice",
        "password": "ValidPassword123!",
        "confirm_password": "DifferentPassword123!"
    })
    assert res.status_code == 400
    assert "Passwords do not match" in res.json()["detail"]

    # Valid registration
    res = client.post("/api/auth/register", json={
        "username": "Alice_99",
        "password": "ValidPassword123!",
        "confirm_password": "ValidPassword123!",
        "display_name": "Alice Wonderland"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "alice_99"  # stored lowercase
    assert data["display_name"] == "Alice Wonderland"
    assert "access_token" in res.cookies

    # Duplicate username (case-insensitive)
    res_dup = client.post("/api/auth/register", json={
        "username": "ALICE_99",
        "password": "AnotherPassword123!"
    })
    assert res_dup.status_code == 400
    assert "already taken" in res_dup.json()["detail"]

    # Failed login with generic error message
    res_fail = client.post("/api/auth/login", json={
        "username": "alice_99",
        "password": "WrongPassword999!"
    })
    assert res_fail.status_code == 400
    assert res_fail.json()["detail"] == "Incorrect username or password."

    # Nonexistent user also returns generic error message
    res_nonexistent = client.post("/api/auth/login", json={
        "username": "nonexistent_user",
        "password": "WrongPassword999!"
    })
    assert res_nonexistent.status_code == 400
    assert res_nonexistent.json()["detail"] == "Incorrect username or password."

    # Successful login
    res_success = client.post("/api/auth/login", json={
        "username": "alice_99",
        "password": "ValidPassword123!"
    })
    assert res_success.status_code == 200
    assert "access_token" in res_success.cookies

def test_user_profile_and_change_password(client):
    # Register Alice
    reg = client.post("/api/auth/register", json={
        "username": "alice",
        "password": "OldPassword123!"
    })
    assert reg.status_code == 200

    # GET /api/auth/me
    me_res = client.get("/api/auth/me")
    assert me_res.status_code == 200
    assert me_res.json()["username"] == "alice"

    # PATCH /api/auth/me
    patch_res = client.patch("/api/auth/me", json={"display_name": "Alice Updated"})
    assert patch_res.status_code == 200
    assert patch_res.json()["display_name"] == "Alice Updated"

    # Change password - wrong current password
    cp_fail = client.post("/api/auth/change-password", json={
        "current_password": "WrongPassword!",
        "new_password": "NewStrongPassword123!"
    })
    assert cp_fail.status_code == 400
    assert "Current password is incorrect" in cp_fail.json()["detail"]

    # Change password - success
    cp_ok = client.post("/api/auth/change-password", json={
        "current_password": "OldPassword123!",
        "new_password": "NewStrongPassword123!"
    })
    assert cp_ok.status_code == 200

    # Verify login with new password works
    client.post("/api/auth/logout")
    login_new = client.post("/api/auth/login", json={
        "username": "alice",
        "password": "NewStrongPassword123!"
    })
    assert login_new.status_code == 200

def test_per_user_data_isolation(client):
    # 1. Register User A
    res_a = client.post("/api/auth/register", json={
        "username": "user_a",
        "password": "PasswordUserA123!"
    })
    assert res_a.status_code == 200
    cookie_a = {"access_token": res_a.cookies["access_token"]}

    # User A uploads a document
    file_content = b"Artificial Intelligence and Machine Learning are transforming modern technology."
    upload_res = client.post(
        "/api/documents",
        files={"file": ("notes_a.txt", io.BytesIO(file_content), "text/plain")},
        cookies=cookie_a
    )
    assert upload_res.status_code == 200
    doc_id_a = upload_res.json()["id"]

    # User A lists documents: should see 1 document
    list_a = client.get("/api/documents", cookies=cookie_a)
    assert list_a.status_code == 200
    assert len(list_a.json()) == 1
    assert list_a.json()[0]["id"] == doc_id_a

    # User A views their document
    get_a = client.get(f"/api/documents/{doc_id_a}", cookies=cookie_a)
    assert get_a.status_code == 200
    assert get_a.json()["id"] == doc_id_a

    # 2. Register User B
    res_b = client.post("/api/auth/register", json={
        "username": "user_b",
        "password": "PasswordUserB123!"
    })
    assert res_b.status_code == 200
    cookie_b = {"access_token": res_b.cookies["access_token"]}

    # User B lists documents: MUST be empty
    list_b = client.get("/api/documents", cookies=cookie_b)
    assert list_b.status_code == 200
    assert len(list_b.json()) == 0

    # User B attempting to view User A's document MUST return strict 404 (never 403)
    get_b = client.get(f"/api/documents/{doc_id_a}", cookies=cookie_b)
    assert get_b.status_code == 404
    assert get_b.json()["detail"] == "Document not found."

    # User B attempting to view concepts of User A's document MUST return 404
    concepts_b = client.get(f"/api/documents/{doc_id_a}/concepts", cookies=cookie_b)
    assert concepts_b.status_code == 404
    assert concepts_b.json()["detail"] == "Document not found."

    # User B attempting to export User A's document MUST return 404
    export_b = client.get(f"/api/documents/{doc_id_a}/export?format=json", cookies=cookie_b)
    assert export_b.status_code == 404
    assert export_b.json()["detail"] == "Document not found."

    # User B attempting to delete User A's document MUST return 404
    delete_b = client.delete(f"/api/documents/{doc_id_a}", cookies=cookie_b)
    assert delete_b.status_code == 404
    assert delete_b.json()["detail"] == "Document not found."

    # User A can safely delete their own document
    delete_a = client.delete(f"/api/documents/{doc_id_a}", cookies=cookie_a)
    assert delete_a.status_code == 200

    # Now User A's list is empty
    list_a_empty = client.get("/api/documents", cookies=cookie_a)
    assert list_a_empty.status_code == 200
    assert len(list_a_empty.json()) == 0

def test_account_deletion_cleans_up(client):
    # Register user
    reg = client.post("/api/auth/register", json={
        "username": "delete_me",
        "password": "Password123!"
    })
    assert reg.status_code == 200
    cookie = {"access_token": reg.cookies["access_token"]}

    # Upload document
    file_content = b"Some private notes."
    upload_res = client.post(
        "/api/documents",
        files={"file": ("private.txt", io.BytesIO(file_content), "text/plain")},
        cookies=cookie
    )
    assert upload_res.status_code == 200

    # Delete account
    del_res = client.delete("/api/auth/me", cookies=cookie)
    assert del_res.status_code == 200
    assert "permanently deleted" in del_res.json()["message"]

    # Further calls with that cookie return 401
    me_res = client.get("/api/auth/me", cookies=cookie)
    assert me_res.status_code == 401

def test_rate_limiting_on_auth_endpoints(client):
    limiter.enabled = True
    # Send 5 attempts
    for i in range(5):
        client.post("/api/auth/login", json={
            "username": f"user_attempt_{i}",
            "password": "Password123!"
        })

    # The 6th attempt should be rate limited with 429
    res_limited = client.post("/api/auth/login", json={
        "username": "user_attempt_6",
        "password": "Password123!"
    })
    limiter.enabled = False
    assert res_limited.status_code == 429
    assert "Too many attempts" in res_limited.json()["detail"]

def test_guest_upload_limit_and_claim(client):
    """
    Verifies that:
    1. Guests can freely upload up to 5 documents.
    2. Attempting a 6th upload returns HTTP 403 Forbidden.
    3. Registering claims all previous guest documents into the user workspace.
    4. Authenticated users enjoy unlimited uploads.
    """
    # 1. Unauthenticated guest checks status
    status_res = client.get("/api/guest/status")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["is_authenticated"] is False
    assert status_data["uploads_count"] == 0
    assert status_data["upload_limit"] == 5
    assert status_data["remaining"] == 5

    guest_cookie = {}
    if status_res.cookies.get("guest_session_id"):
        guest_cookie = {"guest_session_id": status_res.cookies["guest_session_id"]}

    # 2. Upload 5 notes as guest
    doc_ids = []
    for i in range(5):
        file_content = f"Note content number {i}. Definition: term_{i} refers to concept_{i}.".encode("utf-8")
        up = client.post(
            "/api/documents",
            files={"file": (f"guest_note_{i}.txt", io.BytesIO(file_content), "text/plain")},
            cookies=guest_cookie
        )
        assert up.status_code == 200, up.text
        doc_ids.append(up.json()["id"])
        if up.cookies.get("guest_session_id"):
            guest_cookie["guest_session_id"] = up.cookies["guest_session_id"]

    # 3. Status shows 5 uploads used, 0 remaining
    status_res2 = client.get("/api/guest/status", cookies=guest_cookie)
    assert status_res2.status_code == 200
    assert status_res2.json()["uploads_count"] == 5
    assert status_res2.json()["remaining"] == 0

    # 4. Attempt 6th upload as guest -> MUST return 403
    up_6 = client.post(
        "/api/documents",
        files={"file": ("guest_note_6.txt", io.BytesIO(b"Sixth note"), "text/plain")},
        cookies=guest_cookie
    )
    assert up_6.status_code == 403
    assert "Guest upload limit reached" in up_6.json()["detail"]

    # 5. Guest registers an account
    reg_res = client.post(
        "/api/auth/register",
        json={
            "username": "converted_guest_scholar",
            "password": "PasswordGuest123!",
            "display_name": "Converted Guest"
        },
        cookies=guest_cookie
    )
    assert reg_res.status_code == 200
    user_cookie = {"access_token": reg_res.cookies["access_token"]}

    # 6. Check that all 5 previous guest documents were claimed and are present in user workspace
    user_docs = client.get("/api/documents", cookies=user_cookie)
    assert user_docs.status_code == 200
    user_doc_ids = [d["id"] for d in user_docs.json()]
    for did in doc_ids:
        assert did in user_doc_ids

    # 7. As registered user, upload is now unlimited (6th upload succeeds!)
    up_user = client.post(
        "/api/documents",
        files={"file": ("unlimited_note.txt", io.BytesIO(b"Sixth note for registered user"), "text/plain")},
        cookies=user_cookie
    )
    assert up_user.status_code == 200

