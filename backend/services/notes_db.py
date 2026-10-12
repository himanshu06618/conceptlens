import os
import json
import uuid
import math
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pathlib import Path

from sqlalchemy import create_engine, select, func, event, text
from sqlalchemy.orm import sessionmaker, Session

try:
    from backend.planner_models import Note
    from backend.database import engine, SessionLocal, is_postgres
except ImportError:
    from planner_models import Note
    from database import engine, SessionLocal, is_postgres


def init_notes_db() -> None:
    """Safely creates the notes table and indexes if they do not already exist."""
    Note.__table__.create(engine, checkfirst=True)

def format_note(note: Note) -> Dict[str, Any]:
    """Formats a Note ORM instance into a clean JSON-serializable dictionary."""
    tags = []
    if note.tags:
        try:
            tags = json.loads(note.tags) if isinstance(note.tags, str) else list(note.tags)
            if not isinstance(tags, list):
                tags = []
        except Exception:
            tags = [t.strip() for t in str(note.tags).split(",") if t.strip()]

    return {
        "id": note.id,
        "user_id": note.user_id,
        "title": note.title or "",
        "content": note.content or "",
        "tags": tags,
        "color": note.color or "",
        "pinned": bool(note.pinned),
        "document_id": note.document_id,
        "chapter": note.chapter or "",
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }

def count_user_notes(user_id: str) -> int:
    """Returns the total number of notes owned by this user."""
    with SessionLocal() as session:
        stmt = select(func.count(Note.id)).where(Note.user_id == user_id)
        return session.scalar(stmt) or 0

def create_note(
    user_id: str,
    title: str = "",
    content: str = "",
    tags: Optional[List[str]] = None,
    color: Optional[str] = "",
    pinned: bool = False,
    document_id: Optional[str] = None,
    chapter: Optional[str] = ""
) -> Dict[str, Any]:
    """Creates a new personal note for the user."""
    cleaned_tags = []
    if tags:
        for t in tags[:10]:
            cleaned_tag = str(t).strip()[:30]
            if cleaned_tag and cleaned_tag not in cleaned_tags:
                cleaned_tags.append(cleaned_tag)

    now = datetime.now(timezone.utc).isoformat()
    note_id = str(uuid.uuid4())

    note = Note(
        id=note_id,
        user_id=user_id,
        title=(title or "").strip()[:150],
        content=(content or "")[:20000],
        tags=json.dumps(cleaned_tags),
        color=(color or "").strip()[:32],
        pinned=bool(pinned),
        document_id=document_id or None,
        chapter=(chapter or "").strip()[:255],
        created_at=now,
        updated_at=now,
    )

    with SessionLocal() as session:
        session.add(note)
        session.commit()
        session.refresh(note)
        return format_note(note)

def get_note_by_id(user_id: str, note_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a note by id, strictly verifying that it belongs to the given user."""
    with SessionLocal() as session:
        stmt = select(Note).where(Note.id == note_id, Note.user_id == user_id)
        note = session.scalar(stmt)
        if not note:
            return None
        return format_note(note)

def list_notes(
    user_id: str,
    search: Optional[str] = None,
    tag: Optional[str] = None,
    pinned: Optional[bool] = None,
    document_id: Optional[str] = None,
    page: int = 1,
    limit: int = 20
) -> Dict[str, Any]:
    """
    Lists notes for the user with optional search, tag, pinned, and document filters.
    Results are returned newest-updated first, with pinned notes first.
    """
    page = max(1, page)
    limit = min(max(1, limit), 100)
    offset = (page - 1) * limit

    with SessionLocal() as session:
        conditions = [Note.user_id == user_id]

        if search and search.strip():
            s = f"%{search.strip()}%"
            conditions.append(
                Note.title.ilike(s) | Note.content.ilike(s) | Note.tags.ilike(s)
            )

        if tag and tag.strip():
            t = f"%{tag.strip()}%"
            conditions.append(Note.tags.ilike(t))

        if pinned is not None:
            conditions.append(Note.pinned == bool(pinned))

        if document_id and document_id.strip():
            conditions.append(Note.document_id == document_id.strip())

        # Count total matches
        count_stmt = select(func.count(Note.id)).where(*conditions)
        total_count = session.scalar(count_stmt) or 0

        # Query items with pinned first, newest updated first
        query_stmt = (
            select(Note)
            .where(*conditions)
            .order_by(Note.pinned.desc(), Note.updated_at.desc())
            .offset(offset)
            .limit(limit)
        )
        notes = session.scalars(query_stmt).all()
        items = [format_note(n) for n in notes]

        total_pages = max(1, math.ceil(total_count / limit)) if total_count > 0 else 1

        return {
            "items": items,
            "total": total_count,
            "page": page,
            "limit": limit,
            "pages": total_pages,
        }

def update_note(
    user_id: str,
    note_id: str,
    updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Partially updates a note for autosave, validating ownership and refreshing updated_at.
    Returns None if the note does not exist or belongs to another user.
    """
    with SessionLocal() as session:
        stmt = select(Note).where(Note.id == note_id, Note.user_id == user_id)
        note = session.scalar(stmt)
        if not note:
            return None

        if "title" in updates and updates["title"] is not None:
            note.title = str(updates["title"]).strip()[:150]

        if "content" in updates and updates["content"] is not None:
            note.content = str(updates["content"])[:20000]

        if "tags" in updates and updates["tags"] is not None:
            cleaned_tags = []
            for t in updates["tags"][:10]:
                cleaned = str(t).strip()[:30]
                if cleaned and cleaned not in cleaned_tags:
                    cleaned_tags.append(cleaned)
            note.tags = json.dumps(cleaned_tags)

        if "color" in updates:
            note.color = str(updates["color"] or "").strip()[:32]

        if "pinned" in updates and updates["pinned"] is not None:
            note.pinned = bool(updates["pinned"])

        if "document_id" in updates:
            note.document_id = updates["document_id"] or None

        if "chapter" in updates:
            note.chapter = str(updates["chapter"] or "").strip()[:255]

        note.updated_at = datetime.now(timezone.utc).isoformat()

        session.commit()
        session.refresh(note)
        return format_note(note)

def delete_note(user_id: str, note_id: str) -> bool:
    """Deletes a note, strictly verifying ownership. Returns True if deleted, False otherwise."""
    with SessionLocal() as session:
        stmt = select(Note).where(Note.id == note_id, Note.user_id == user_id)
        note = session.scalar(stmt)
        if not note:
            return False

        session.delete(note)
        session.commit()
        return True
