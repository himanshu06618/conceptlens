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
        claim_guest_documents
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
        link_google_account,
        delete_user_and_all_data
    )
    from backend.models import (
        UserRegisterRequest,
        UserLoginRequest,
        GoogleAuthRequest,
        UserResponse,
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
        claim_guest_documents
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
        link_google_account,
        delete_user_and_all_data
    )
    from models import (
        UserRegisterRequest,
        UserLoginRequest,
        GoogleAuthRequest,
        UserResponse,
        UpdateUserRequest,
        ChangePasswordRequest,
        DeleteAccountRequest
    )

import os

router = APIRouter()
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() not in ("false", "0", "no")
limiter = Limiter(key_func=get_remote_address, enabled=RATE_LIMIT_ENABLED)

def format_user_response(user: Dict[str, Any]) -> UserResponse:
    return UserResponse(
        id=user["id"],
        username=user["username"],
        display_name=user["display_name"],
        email=user.get("email"),
        avatar_url=user.get("avatar_url"),
        role=user.get("role") or "student",
        has_password=bool(user.get("password_hash")),
        created_at=user["created_at"]
    )

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

@router.post("/register", response_model=UserResponse)
@limiter.limit("5/minute")
async def register_user(
    request: Request,
    response: Response,
    payload: UserRegisterRequest
):
    verify_csrf(request)

    # 1. Validate username
    u_err = validate_username(payload.username)
    if u_err:
        raise HTTPException(status_code=400, detail=u_err)

    clean_username = payload.username.strip().lower()

    # 2. Validate passwords
    if payload.confirm_password and payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    p_err = validate_password_strength(payload.password)
    if p_err:
        raise HTTPException(status_code=400, detail=p_err)

    # 3. Check for existing username
    existing = get_user_by_username(clean_username)
    if existing:
        raise HTTPException(status_code=400, detail="Username is already taken.")

    # 4. Hash password and create user
    user_id = str(uuid.uuid4())
    pw_hash = hash_password(payload.password)
    display_name = (payload.display_name or "").strip() or payload.username.strip()
    user_role = (payload.role or "student").strip().lower()
    if user_role not in ("student", "teacher"):
        user_role = "student"

    user = create_user(
        user_id=user_id,
        username=clean_username,
        display_name=display_name,
        password_hash=pw_hash,
        role=user_role
    )

    # 5. Issue JWT and set httpOnly cookie
    token = create_access_token(user_id=user_id, username=clean_username)
    set_auth_cookie(response, token)

    # 6. Transfer any guest session uploads to this new account
    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user_id)
        response.delete_cookie("guest_session_id", path="/")

    return format_user_response(user)

@router.post("/login", response_model=UserResponse)
@limiter.limit("5/minute")
async def login_user(
    request: Request,
    response: Response,
    payload: UserLoginRequest
):
    verify_csrf(request)

    clean_username = payload.username.strip().lower()
    user = get_user_by_username(clean_username)

    if not user or not user.get("password_hash"):
        # Run dummy Argon2id hash to mitigate timing side-channels
        dummy_verify(payload.password)
        raise HTTPException(status_code=400, detail="Incorrect username or password.")

    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="Incorrect username or password.")

    update_user_last_login(user["id"])
    token = create_access_token(user_id=user["id"], username=user["username"])
    set_auth_cookie(response, token)

    # Transfer any guest session uploads to logged-in user
    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user["id"])
        response.delete_cookie("guest_session_id", path="/")

    return format_user_response(user)

@router.post("/google", response_model=UserResponse)
@limiter.limit("5/minute")
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
        return format_user_response(user)

    # Check if an existing password account matches this email -> link them
    if email:
        existing_email_user = get_user_by_email(email)
        if existing_email_user:
            link_google_account(existing_email_user["id"], sub, picture)
            update_user_last_login(existing_email_user["id"])
            token = create_access_token(user_id=existing_email_user["id"], username=existing_email_user["username"])
            set_auth_cookie(response, token)
            guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
            if guest_id:
                claim_guest_documents(guest_id, existing_email_user["id"])
                response.delete_cookie("guest_session_id", path="/")
            updated_user = get_user_by_id(existing_email_user["id"])
            return format_user_response(updated_user)

    # New Google user: generate unique username from email prefix
    base_username = re.sub(r"[^a-zA-Z0-9_.]", "", email.split("@")[0].lower())
    if len(base_username) < 3:
        base_username = f"user_{base_username}"
    if len(base_username) > 20:
        base_username = base_username[:20]

    candidate_username = base_username
    counter = 1
    while get_user_by_username(candidate_username):
        candidate_username = f"{base_username}{counter}"
        counter += 1

    user_id = str(uuid.uuid4())
    display_name = name or candidate_username

    new_user = create_user(
        user_id=user_id,
        username=candidate_username,
        display_name=display_name,
        email=email,
        password_hash=None,
        google_sub=sub,
        avatar_url=picture
    )

    token = create_access_token(user_id=user_id, username=candidate_username)
    set_auth_cookie(response, token)

    guest_id = request.cookies.get("guest_session_id") or request.headers.get("x-guest-session")
    if guest_id:
        claim_guest_documents(guest_id, user_id)
        response.delete_cookie("guest_session_id", path="/")

    return format_user_response(new_user)

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
