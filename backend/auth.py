import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
from pathlib import Path

from fastapi import Request, Response, HTTPException, Depends
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
import jwt
from dotenv import load_dotenv

load_dotenv()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()
JWT_SECRET = os.getenv("JWT_SECRET", "conceptlens_dev_secret_key_8f3c7b2a9e1d4f6c0b5e8a7d3c2b1a0e_change_in_production")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in ("true", "1", "yes")
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "none" if COOKIE_SECURE else "lax").lower()

# Validate secret in production
if ENVIRONMENT == "production":
    if not JWT_SECRET or len(JWT_SECRET) < 32 or "dev_secret" in JWT_SECRET or JWT_SECRET == "change_in_production":
        # Fallback to an auto-generated cryptographically secure random secret so the server boots reliably
        JWT_SECRET = secrets.token_hex(32)
        print("[AUTH NOTICE] Production JWT_SECRET was not provided or was too short. Auto-generated secure temporary key for this session. Add JWT_SECRET to your environment variables to persist logins across restarts.")

# Allowed origins for CORS and CSRF verification
ALLOWED_ORIGINS_RAW = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:8000,http://127.0.0.1:8000"
)
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in ALLOWED_ORIGINS_RAW.split(",") if o.strip()]
FRONTEND_URL = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
if FRONTEND_URL and FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

# Initialize Argon2id password hasher
ph = PasswordHasher(
    time_cost=2,
    memory_cost=65536,
    parallelism=1,
    hash_len=32,
    type=Type.ID
)

# Dummy hash for constant-time comparison when a username does not exist
DUMMY_HASH = ph.hash("conceptlens_dummy_salt_timing_protection_secret")

# Top common passwords to reject
COMMON_PASSWORDS = {
    "password", "password123", "12345678", "123456789", "1234567890",
    "qwerty123", "admin123", "welcome123", "letmein123", "iloveyou",
    "abc12345", "monkey123", "dragon123", "master123", "football123",
    "trustno1", "sunshine1", "princess1", "passw0rd", "pass1234",
    "changeme", "qwertyuiop", "11111111", "00000000", "secret123"
}

USERNAME_REGEX = re.compile(r"^[a-zA-Z0-9_.]+$")

def hash_password(password: str) -> str:
    """Hashes a password using Argon2id."""
    return ph.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a password against an Argon2id hash."""
    try:
        return ph.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False

def dummy_verify(plain_password: str) -> None:
    """Performs a dummy verification to mitigate timing attacks on nonexistent users."""
    try:
        ph.verify(DUMMY_HASH, plain_password)
    except Exception:
        pass

def validate_username(username: str) -> Optional[str]:
    """Validates username format. Returns error message if invalid, None if valid."""
    cleaned = username.strip()
    if len(cleaned) < 3 or len(cleaned) > 24:
        return "Username must be between 3 and 24 characters."
    if not USERNAME_REGEX.match(cleaned):
        return "Username can only contain letters, numbers, underscores, and dots."
    return None

def validate_password_strength(password: str) -> Optional[str]:
    """Validates password strength and common dictionary checks."""
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    if password.lower() in COMMON_PASSWORDS:
        return "This password is too common and easily guessed. Please choose a stronger password."
    return None

def create_access_token(user_id: str, username: str, expires_delta: Optional[timedelta] = None) -> str:
    """Generates a signed JWT access token valid for 7 days."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=7)
    
    payload = {
        "sub": user_id,
        "username": username,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp())
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def decode_access_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a JWT access token."""
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])

def set_auth_cookie(response: Response, token: str) -> None:
    """Sets the httpOnly access_token cookie."""
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=7 * 24 * 3600,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path="/"
    )

def clear_auth_cookie(response: Response) -> None:
    """Clears the access_token cookie."""
    response.delete_cookie(
        key="access_token",
        path="/",
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE
    )

def verify_google_id_token(credential: str) -> Dict[str, Any]:
    """Verifies a Google OAuth ID token using google.oauth2.id_token."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID).strip()
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Google sign-in is not configured on this server."
        )
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        req = google_requests.Request()
        id_info = id_token.verify_oauth2_token(credential, req, client_id)

        if id_info.get("aud") != client_id:
            raise HTTPException(status_code=401, detail="Google token audience mismatch.")

        if not id_info.get("email_verified", False):
            raise HTTPException(status_code=400, detail="Google account email is not verified.")

        return id_info
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Google authentication failed: {str(e)}"
        )

def verify_csrf(request: Request) -> None:
    """CSRF protection: For mutating requests, check that Origin matches ALLOWED_ORIGINS."""
    if request.method in ("POST", "PATCH", "DELETE", "PUT"):
        origin = request.headers.get("origin")
        if origin:
            # Normalize origin
            norm_origin = origin.rstrip("/")
            norm_allowed = [o.rstrip("/") for o in ALLOWED_ORIGINS]
            # Match explicit origins or any *.vercel.app deployment
            is_vercel = bool(re.match(r"^https:\/\/[\w\-]+(\.[\w\-]+)*\.vercel\.app$", norm_origin))
            if norm_origin not in norm_allowed and not is_vercel:
                raise HTTPException(
                    status_code=403,
                    detail="Cross-site request forgery protection: Origin not allowed."
                )

def get_current_user(request: Request) -> Dict[str, Any]:
    """
    FastAPI dependency to authenticate requests.
    Checks Authorization Bearer header first, then falls back to httpOnly cookie.
    """
    try:
        from backend.database import get_user_by_id
    except ImportError:
        from database import get_user_by_id

    token = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()

    if not token:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    try:
        payload = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session token.")
    except Exception:
        raise HTTPException(status_code=401, detail="Could not validate credentials.")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session payload.")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User account no longer exists.")

    return user

def require_role(required_role: str):
    """Dependency that verifies the authenticated user has the specified role."""
    def role_dependency(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        user_role = (current_user.get("role") or "").strip().lower()
        if user_role != required_role.lower():
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: {required_role.capitalize()} role required."
            )
        return current_user
    return role_dependency

def get_current_user_or_guest(request: Request, response: Response) -> Dict[str, Any]:
    """
    FastAPI dependency:
    Returns the authenticated user dict if signed in,
    or a guest session dict if unauthenticated.
    """
    token = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()

    if not token:
        token = request.cookies.get("access_token")

    if token:
        try:
            payload = decode_access_token(token)
            user_id = payload.get("sub")
            if user_id:
                try:
                    from backend.database import get_user_by_id
                except ImportError:
                    from database import get_user_by_id
                user = get_user_by_id(user_id)
                if user:
                    return {
                        "is_authenticated": True,
                        "id": user["id"],
                        "username": user["username"],
                        "name": user.get("name") or user.get("display_name"),
                        "display_name": user["display_name"],
                        "email": user.get("email"),
                        "avatar": user.get("avatar") or user.get("avatar_url"),
                        "avatar_url": user.get("avatar_url"),
                        "role": user.get("role"),
                        "has_password": bool(user.get("password_hash")),
                        "created_at": user["created_at"]
                    }
        except Exception:
            pass

    # Unauthenticated -> persistent guest session
    guest_id = request.cookies.get("guest_session_id") or request.cookies.get("guest_id")
    if not guest_id:
        guest_id = request.headers.get("x-guest-session")
    if not guest_id or not re.match(r"^guest_[a-zA-Z0-9_-]{10,64}$", guest_id):
        guest_id = f"guest_{secrets.token_hex(16)}"

    response.set_cookie(
        key="guest_session_id",
        value=guest_id,
        max_age=30 * 24 * 3600,
        httponly=False,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/"
    )

    return {
        "is_authenticated": False,
        "id": guest_id,
        "username": "guest",
        "display_name": "Guest Scholar",
        "email": None,
        "avatar_url": None,
        "has_password": False,
        "created_at": ""
    }

def claim_guest_documents(guest_session_id: Optional[str], user_id: str) -> int:
    """Transfers documents and files from a guest session into a registered user workspace."""
    if not guest_session_id or not guest_session_id.startswith("guest_"):
        return 0
    try:
        try:
            from backend.database import transfer_documents_user
        except ImportError:
            from database import transfer_documents_user
        count = transfer_documents_user(guest_session_id, user_id)

        import shutil
        from backend.main import UPLOAD_DIR
        guest_dir = Path(UPLOAD_DIR) / guest_session_id
        user_dir = Path(UPLOAD_DIR) / user_id
        if guest_dir.exists() and guest_dir.is_dir():
            user_dir.mkdir(parents=True, exist_ok=True)
            for item in guest_dir.iterdir():
                if item.is_file():
                    dest = user_dir / item.name
                    try:
                        shutil.move(str(item), str(dest))
                    except Exception:
                        pass
            try:
                shutil.rmtree(guest_dir, ignore_errors=True)
            except Exception:
                pass
        return count
    except Exception:
        return 0
