import math
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Request, HTTPException, Depends, Query, Path
from pydantic import BaseModel, Field, field_validator

try:
    from backend.auth import get_current_user
    from backend.routers.auth import limiter
    from backend.services.notes_db import (
        create_note,
        get_note_by_id,
        list_notes,
        update_note,
        delete_note,
        count_user_notes
    )
except ImportError:
    from auth import get_current_user
    from routers.auth import limiter
    from services.notes_db import (
        create_note,
        get_note_by_id,
        list_notes,
        update_note,
        delete_note,
        count_user_notes
    )

router = APIRouter()

MAX_USER_NOTES = 500

class NoteCreateRequest(BaseModel):
    title: Optional[str] = Field(default="", description="Note title up to 150 characters")
    content: Optional[str] = Field(default="", description="Note content up to 20,000 characters")
    tags: Optional[List[str]] = Field(default_factory=list, description="List of up to 10 tags")
    color: Optional[str] = Field(default="", description="Optional color label")
    pinned: Optional[bool] = Field(default=False, description="Pin note to top")
    document_id: Optional[str] = Field(default=None, description="Optional linked document ID")
    chapter: Optional[str] = Field(default="", description="Optional linked chapter title")

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if v and len(v) > 150:
            raise ValueError("Title cannot exceed 150 characters.")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if v and len(v) > 20000:
            raise ValueError("Note content cannot exceed 20,000 characters.")
        return v

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v is None:
            return []
        if len(v) > 10:
            raise ValueError("A note can have at most 10 tags.")
        cleaned = []
        for tag in v:
            t = str(tag).strip()
            if len(t) > 30:
                raise ValueError(f"Tag '{t}' exceeds maximum length of 30 characters.")
            if t and t not in cleaned:
                cleaned.append(t)
        return cleaned

class NoteUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, description="Note title up to 150 characters")
    content: Optional[str] = Field(default=None, description="Note content up to 20,000 characters")
    tags: Optional[List[str]] = Field(default=None, description="List of up to 10 tags")
    color: Optional[str] = Field(default=None, description="Optional color label")
    pinned: Optional[bool] = Field(default=None, description="Pin note to top")
    document_id: Optional[str] = Field(default=None, description="Optional linked document ID")
    chapter: Optional[str] = Field(default=None, description="Optional linked chapter title")

    @field_validator("title")
    @classmethod
    def validate_title(cls, v):
        if v is not None and len(v) > 150:
            raise ValueError("Title cannot exceed 150 characters.")
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if v is not None and len(v) > 20000:
            raise ValueError("Note content cannot exceed 20,000 characters.")
        return v

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v):
        if v is None:
            return None
        if len(v) > 10:
            raise ValueError("A note can have at most 10 tags.")
        cleaned = []
        for tag in v:
            t = str(tag).strip()
            if len(t) > 30:
                raise ValueError(f"Tag '{t}' exceeds maximum length of 30 characters.")
            if t and t not in cleaned:
                cleaned.append(t)
        return cleaned


@router.get("", summary="List notes for the authenticated user")
async def get_notes_list(
    request: Request,
    search: Optional[str] = Query(None, description="Case-insensitive search across title, content, and tags"),
    tag: Optional[str] = Query(None, description="Filter by specific tag"),
    pinned: Optional[bool] = Query(None, description="Filter by pinned status"),
    document_id: Optional[str] = Query(None, description="Filter by associated document ID"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns personal notes for the logged-in user.
    Results are ordered newest-updated first, with pinned notes first.
    Strictly scoped to the authenticated user's ID.
    """
    user_id = current_user["id"]
    return list_notes(
        user_id=user_id,
        search=search,
        tag=tag,
        pinned=pinned,
        document_id=document_id,
        page=page,
        limit=limit
    )


@router.post("", status_code=201, summary="Create a new personal note")
@limiter.limit("60/minute")
async def create_user_note(
    request: Request,
    body: NoteCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Creates a new note for the authenticated user.
    Enforces a maximum of 500 notes per user account.
    Rate-limited per user.
    """
    user_id = current_user["id"]

    current_count = count_user_notes(user_id)
    if current_count >= MAX_USER_NOTES:
        raise HTTPException(
            status_code=400,
            detail=f"You have reached the maximum limit of {MAX_USER_NOTES} notes. Please delete older notes to create new ones."
        )

    note = create_note(
        user_id=user_id,
        title=body.title or "",
        content=body.content or "",
        tags=body.tags or [],
        color=body.color or "",
        pinned=bool(body.pinned),
        document_id=body.document_id,
        chapter=body.chapter or ""
    )
    return note


@router.get("/{note_id}", summary="Get a note by ID")
async def get_single_note(
    request: Request,
    note_id: str = Path(..., description="ID of the note"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Retrieves a single note.
    Returns 404 if the note does not exist or belongs to another user.
    """
    user_id = current_user["id"]
    note = get_note_by_id(user_id=user_id, note_id=note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


@router.patch("/{note_id}", summary="Partially update a note (autosave friendly)")
@limiter.limit("120/minute")
async def patch_user_note(
    request: Request,
    note_id: str = Path(..., description="ID of the note"),
    body: NoteUpdateRequest = ...,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Partially updates an existing note.
    Updates `updated_at` to the current timestamp.
    Returns 404 if the note belongs to another user or does not exist.
    """
    user_id = current_user["id"]

    updates = body.model_dump(exclude_unset=True)
    updated_note = update_note(user_id=user_id, note_id=note_id, updates=updates)
    if not updated_note:
        raise HTTPException(status_code=404, detail="Note not found.")
    return updated_note


@router.delete("/{note_id}", summary="Delete a note")
@limiter.limit("60/minute")
async def delete_user_note(
    request: Request,
    note_id: str = Path(..., description="ID of the note"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Deletes a personal note.
    Returns 404 if the note belongs to another user or does not exist.
    """
    user_id = current_user["id"]
    deleted = delete_note(user_id=user_id, note_id=note_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"success": True, "message": "Note deleted successfully."}
