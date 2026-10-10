import re
import uuid
import shutil
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import APIRouter, Request, Response, HTTPException, Depends
from slowapi import Limiter
from slowapi.util import get_remote_address

try:
    from backend.auth import (
        hash_password,
        verify_password,
        dummy_verify,
        validate_username,
        validate_password_strength,
        create_access_token,
        set_auth_cookie,
        clear_auth_cookie,
        verify_google_id_token,
        verify_csrf,
        get_current_user,
        claim_guest_documents,
        require_role,
        GOOGLE_CLIENT_ID
    )
    from backend.database import (
        create_user,
        get_user_by_id,
        get_user_by_username,
        get_user_by_email,
        get_user_by_google_sub,
        update_user_last_login,
        update_user_display_name,
        update_user_password,
        update_user_role,
        link_google_account,
        delete_user_and_all_data
    )
    from backend.models import (
        UserRegisterRequest,
        UserLoginRequest,
        GoogleAuthRequest,
        UserResponse,
        SetRoleRequest,
        AuthResponse,
        UpdateUserRequest,
        ChangePasswordRequest,
        DeleteAccountRequest
    )
except ImportError:
    from auth import (
        hash_password,
        verify_password,
        dummy_verify,
        validate_username,
        validate_password_strength,
        create_access_token,
        set_auth_cookie,
        clear_auth_cookie,
        verify_google_id_token,
        verify_csrf,
        get_current_user,
        claim_guest_documents,
        require_role,
        GOOGLE_CLIENT_ID
    )
    from database import (
        create_user,
        get_user_by_id,
        get_user_by_username,
        get_user_by_email,
        get_user_by_google_sub,
        update_user_last_login,
        update_user_display_name,
        update_user_password,
        update_user_role,
        link_google_account,
        delete_user_and_all_data
    )
    from models import (
        UserRegisterRequest,
        UserLoginRequest,
        GoogleAuthRequest,
        UserResponse,
        SetRoleRequest,
        AuthResponse,
        UpdateUserRequest,
        ChangePasswordRequest,
        DeleteAccountRequest
    )

import os

router = APIRouter()
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() not in ("false", "0", "no")
limiter = Limiter(key_func=get_remote_address, enabled=RATE_LIMIT_ENABLED)

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

def format_user_response(user: Dict[str, Any]) -> UserResponse:
    name_val = user.get("name") or user.get("display_name") or user.get("username") or ""
    avatar_val = user.get("avatar") or user.get("avatar_url")
    return UserResponse(
        id=user["id"],
        username=user.get("username", ""),
        name=name_val,
        display_name=name_val,
        email=user.get("email"),
        avatar=avatar_val,
        avatar_url=avatar_val,
        role=user.get("role"),
        has_password=bool(user.get("password_hash")),
        created_at=user["created_at"]
    )

def create_auth_response(user: Dict[str, Any], token: str, is_new: bool = False) -> Dict[str, Any]:
    formatted = format_user_response(user)
    has_role = user.get("role") is not None and str(user.get("role")).strip() != ""
    return {
        "user": formatted.model_dump(),
        "token": token,
        "access_token": token,
        "token_type": "bearer",
        "requires_role": not has_role,
        "is_new": is_new,
        "id": formatted.id,
        "username": formatted.username,
        "name": formatted.name,
        "display_name": formatted.display_name,
        "email": formatted.email,
        "avatar": formatted.avatar,
        "avatar_url": formatted.avatar_url,
        "role": formatted.role,
        "has_password": formatted.has_password,
        "created_at": formatted.created_at
    }

@router.get("/check-username")
@limiter.limit("30/minute")
async def check_username(request: Request, username: str):
    clean = (username or "").strip().lower()
    if not clean:
        return {"available": False, "valid": False, "message": "Username cannot be empty."}
    err = validate_username(clean)
    if err:
        return {"available": False, "valid": False, "message": err}
    existing = get_user_by_username(clean)
    if existing:
        return {"available": False, "valid": True, "message": "Username is already taken."}
    return {"available": True, "valid": True, "message": "Username is available."}

@router.post("/register")
@limiter.limit("5/minute")
async def register_user(
    request: Request,
    response: Response,
    payload: UserRegisterRequest
):
    verify_csrf(request)

    # 1. Email validation if provided
    clean_email = (payload.email or "").strip().lower()
    if clean_email:
        if not EMAIL_REGEX.match(clean_email):
            raise HTTPException(status_code=400, detail="Invalid email format.")
        existing_email = get_user_by_email(clean_email)
        if existing_email:
            raise HTTPException(status_code=400, detail="An account with this email already exists.")

    # 2. Username resolution and validation
    raw_username = (payload.username or "").strip().lower()
    if not raw_username and clean_email:
        raw_username = clean_email.split("@")[0]
        raw_username = re.sub(r"[^a-zA-Z0-9_.]", "", raw_username)
        if len(raw_username) < 3:
            raw_username = f"user_{raw_username}"
        counter = 1
        base_u = raw_username
        while get_user_by_username(raw_username):
            raw_username = f"{base_u}{counter}"
            counter += 1

    u_err = validate_username(raw_username)
    if u_err:
        raise HTTPException(status_code=400, detail=u_err)

    # 3. Check for existing username
    existing_user = get_user_by_username(raw_username)
    if existing_user:
        raise HTTPException(status_code=400, detail="Username is already taken.")

    # 4. Password validation
    if payload.confirm_password and payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    p_err = validate_password_strength(payload.password)
    if p_err:
        raise HTTPException(status_code=400, detail=p_err)

    # 5. Role validation ('student' or 'teacher')
    clean_role = (payload.role or "student").strip().lower()
    if clean_role not in ("student", "teacher"):
        clean_role = "student"

    # 6. Create user
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(payload.password)
    name = (payload.name or payload.display_name or "").strip() or raw_username

    user = create_user(
        user_id=user_id,
        username=raw_username,
        display_name=name,
        name=name,
        email=clean_email or None,
        password_hash=pw_hash,
        role=clean_role
    )

    # 7. Create JWT token
    token = create_access_token(user_id=user_id, username=raw_username)
    set_auth_cookie(response, token)

    # 8. Transfer guest uploads
    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user_id)
        response.delete_cookie("guest_session_id", path="/")

    return create_auth_response(user, token, is_new=True)

@router.post("/login")
@limiter.limit("10/minute")
async def login_user(
    request: Request,
    response: Response,
    payload: UserLoginRequest
):
    verify_csrf(request)

    identifier = (payload.email or payload.username or "").strip().lower()
    if not identifier:
        raise HTTPException(status_code=400, detail="Email or username is required.")

    # Find by email first, fallback to username
    user = get_user_by_email(identifier)
    if not user:
        user = get_user_by_username(identifier)

    if not user or not user.get("password_hash"):
        dummy_verify(payload.password)
        raise HTTPException(status_code=400, detail="Invalid email or password.")

    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid email or password.")

    update_user_last_login(user["id"])
    token = create_access_token(user_id=user["id"], username=user["username"])
    set_auth_cookie(response, token)

    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user["id"])
        response.delete_cookie("guest_session_id", path="/")

    return create_auth_response(user, token, is_new=False)

@router.post("/google")
@limiter.limit("10/minute")
async def google_auth(
    request: Request,
    response: Response,
    payload: GoogleAuthRequest
):
    verify_csrf(request)

    id_info = verify_google_id_token(payload.credential)
    sub = id_info["sub"]
    email = id_info.get("email", "").lower().strip()
    name = id_info.get("name", "").strip()
    picture = id_info.get("picture", "")

    # Check if user already exists with this google_sub
    user = get_user_by_google_sub(sub)
    if user:
        update_user_last_login(user["id"])
        token = create_access_token(user_id=user["id"], username=user["username"])
        set_auth_cookie(response, token)
        guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
        if guest_id:
            claim_guest_documents(guest_id, user["id"])
            response.delete_cookie("guest_session_id", path="/")
        return create_auth_response(user, token, is_new=False)

    # Check if existing user by email -> link accounts
    if email:
        existing = get_user_by_email(email)
        if existing:
            link_google_account(existing["id"], sub, picture)
            update_user_last_login(existing["id"])
            token = create_access_token(user_id=existing["id"], username=existing["username"])
            set_auth_cookie(response, token)
            guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
            if guest_id:
                claim_guest_documents(guest_id, existing["id"])
                response.delete_cookie("guest_session_id", path="/")
            updated = get_user_by_id(existing["id"])
            return create_auth_response(updated, token, is_new=False)

    # New Google user: generate username from email
    base_username = re.sub(r"[^a-zA-Z0-9_.]", "", email.split("@")[0].lower()) if email else "user"
    if len(base_username) < 3:
        base_username = f"user_{base_username}"
    if len(base_username) > 20:
        base_username = base_username[:20]

    candidate = base_username
    counter = 1
    while get_user_by_username(candidate):
        candidate = f"{base_username}{counter}"
        counter += 1

    user_id = str(uuid.uuid4())
    display_name = name or candidate

    # Role is null for new Google users until chosen
    new_user = create_user(
        user_id=user_id,
        username=candidate,
        display_name=display_name,
        name=display_name,
        email=email or None,
        password_hash=None,
        google_sub=sub,
        avatar_url=picture or None,
        avatar=picture or None,
        role=None
    )

    token = create_access_token(user_id=user_id, username=candidate)
    set_auth_cookie(response, token)

    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user_id)
        response.delete_cookie("guest_session_id", path="/")

    return create_auth_response(new_user, token, is_new=True)

@router.post("/logout")
async def logout_user(request: Request, response: Response):
    verify_csrf(request)
    clear_auth_cookie(response)
    return {"success": True, "message": "Signed out successfully."}

@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(current_user: Dict[str, Any] = Depends(get_current_user)):
    return format_user_response(current_user)

@router.patch("/me", response_model=UserResponse)
async def update_profile(
    request: Request,
    payload: UpdateUserRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    verify_csrf(request)

    cleaned_name = payload.display_name.strip()
    if not cleaned_name:
        raise HTTPException(status_code=400, detail="Display name cannot be empty.")
    if len(cleaned_name) > 50:
        raise HTTPException(status_code=400, detail="Display name cannot exceed 50 characters.")

    update_user_display_name(current_user["id"], cleaned_name)
    updated = get_user_by_id(current_user["id"])
    return format_user_response(updated)

@router.post("/change-password")
async def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    verify_csrf(request)

    if not current_user.get("password_hash"):
        raise HTTPException(
            status_code=400,
            detail="Google accounts do not have a password. Sign in using Google instead."
        )

    if not verify_password(payload.current_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    if payload.confirm_password and payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="New passwords do not match.")

    p_err = validate_password_strength(payload.new_password)
    if p_err:
        raise HTTPException(status_code=400, detail=p_err)

    new_hash = hash_password(payload.new_password)
    update_user_password(current_user["id"], new_hash)

    return {"success": True, "message": "Password changed successfully."}

@router.delete("/me")
async def delete_account(
    request: Request,
    response: Response,
    payload: Optional[DeleteAccountRequest] = None,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    verify_csrf(request)

    user_id = current_user["id"]

    # Delete database records (documents, concepts, relations, user)
    delete_user_and_all_data(user_id)

    # Delete uploaded files for this user
    from backend.main import UPLOAD_DIR
    user_upload_dir = Path(UPLOAD_DIR) / user_id
    if user_upload_dir.exists() and user_upload_dir.is_dir():
        try:
            shutil.rmtree(user_upload_dir, ignore_errors=True)
        except Exception:
            pass

    clear_auth_cookie(response)
    return {"success": True, "message": "Account and all associated workspace data have been permanently deleted."}

@router.get("/config")
def get_auth_config():
    """Returns public client configuration including Google Client ID for OAuth login."""
    return {
        "google_client_id": GOOGLE_CLIENT_ID or ""
    }

@router.patch("/role", response_model=UserResponse)
async def set_user_role(
    request: Request,
    payload: SetRoleRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Sets the user's role (allowed only when current role is null or not set)."""
    verify_csrf(request)

    current_role = current_user.get("role")
    if current_role and str(current_role).strip():
        raise HTTPException(
            status_code=400,
            detail="Role has already been set and cannot be changed."
        )

    clean_role = (payload.role or "").strip().lower()
    if clean_role not in ("student", "teacher"):
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be 'student' or 'teacher'."
        )

    update_user_role(current_user["id"], clean_role)
    updated = get_user_by_id(current_user["id"])
    return format_user_response(updated)

@router.get("/teacher-only")
async def teacher_only_endpoint(current_user: Dict[str, Any] = Depends(require_role("teacher"))):
    """Protected endpoint for teachers only. Returns 403 to students, 401 to unauthenticated users."""
    return {
        "success": True,
        "message": "Welcome Teacher.",
        "user_id": current_user["id"],
        "role": current_user.get("role")
    }

