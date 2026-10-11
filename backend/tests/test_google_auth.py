import os
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "test_google_auth.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test_secret_for_google_auth_testing_32bytes_min"
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["GOOGLE_CLIENT_ID"] = "test-google-client-id-12345.apps.googleusercontent.com"

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

def test_google_auth_unverified_email_rejected(client):
    """Rejects if email_verified is False."""
    fake_id_info = {
        "sub": "google-sub-unverified",
        "email": "unverified@example.com",
        "email_verified": False,
        "name": "Unverified User",
        "aud": "test-google-client-id-12345.apps.googleusercontent.com"
    }

    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=fake_id_info):
        res = client.post("/auth/google", json={"credential": "fake_credential_token"})
        assert res.status_code == 400
        assert "not verified" in res.json()["detail"].lower()

def test_google_auth_invalid_token_rejected(client):
    """Rejects if token verification throws an error."""
    with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("Token expired")):
        res = client.post("/auth/google", json={"credential": "expired_token"})
        assert res.status_code == 401
        assert "failed" in res.json()["detail"].lower()

def test_new_google_user_requires_role_and_sets_role(client):
    """Brand new Google user has role=None, needs_role=True, then sets role via PATCH /auth/role."""
    fake_id_info = {
        "sub": "google-sub-newbie-101",
        "email": "newbie@example.com",
        "email_verified": True,
        "name": "Newbie Student",
        "picture": "https://lh3.googleusercontent.com/avatar_newbie",
        "aud": "test-google-client-id-12345.apps.googleusercontent.com"
    }

    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=fake_id_info):
        res = client.post("/auth/google", json={"credential": "valid_token_new"})
        assert res.status_code == 200
        data = res.json()
        assert data["needs_role"] is True
        assert data["requires_role"] is True
        assert data["user"]["role"] is None
        assert data["user"]["email"] == "newbie@example.com"
        assert data["token"]
        token = data["token"]

        # Call PATCH /auth/role to choose "student"
        res_role = client.patch(
            "/auth/role",
            json={"role": "student"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res_role.status_code == 200
        role_data = res_role.json()
        assert role_data["role"] == "student"

        # Calling PATCH /auth/role a second time is rejected (role already set)
        res_role_again = client.patch(
            "/auth/role",
            json={"role": "teacher"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert res_role_again.status_code == 400
        assert "already been set" in res_role_again.json()["detail"].lower()

def test_returning_google_user_signs_in_directly(client):
    """Returning Google user who already has a role gets needs_role=False."""
    fake_id_info = {
        "sub": "google-sub-returning-202",
        "email": "returning@example.com",
        "email_verified": True,
        "name": "Returning Professor",
        "picture": "https://lh3.googleusercontent.com/avatar_prof",
        "aud": "test-google-client-id-12345.apps.googleusercontent.com"
    }

    # First sign in
    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=fake_id_info):
        res1 = client.post("/auth/google", json={"credential": "token_prof"})
        token1 = res1.json()["token"]

        # Choose teacher role
        client.patch(
            "/auth/role",
            json={"role": "teacher"},
            headers={"Authorization": f"Bearer {token1}"}
        )

        # Second sign in (returning user)
        res2 = client.post("/auth/google", json={"credential": "token_prof"})
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["needs_role"] is False
        assert data2["user"]["role"] == "teacher"

def test_existing_email_password_user_account_linking(client):
    """If user already registered with email/password, signing in with Google links google_sub."""
    # Register with email & password
    res_reg = client.post("/auth/register", json={
        "username": "charlie_test",
        "email": "charlie@example.com",
        "password": "Password123!",
        "role": "student",
        "display_name": "Charlie Chaplin"
    })
    assert res_reg.status_code == 200

    # Now sign in via Google with same email
    fake_id_info = {
        "sub": "google-sub-charlie-999",
        "email": "charlie@example.com",
        "email_verified": True,
        "name": "Charlie Google",
        "picture": "https://lh3.googleusercontent.com/avatar_charlie",
        "aud": "test-google-client-id-12345.apps.googleusercontent.com"
    }

    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=fake_id_info):
        res_google = client.post("/auth/google", json={"credential": "charlie_google_token"})
        assert res_google.status_code == 200
        data = res_google.json()
        assert data["user"]["email"] == "charlie@example.com"
        assert data["user"]["role"] == "student"
        assert data["needs_role"] is False
