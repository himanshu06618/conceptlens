"""
FastAPI Router for ConceptLens Study Planner.
Provides:
- GET /api/planner/overview?subject_id=
- PATCH /api/chapters/{id}/progress
- PATCH /api/chapters/{id}
- POST /api/plans/preview
- POST /api/plans
- GET /api/plans/active?subject_id=
- PATCH /api/plans/{id}/days/{day_index}
- DELETE /api/plans/{id}
- GET /api/chapters/{id}/relations
- CRUD /api/reminders
"""

import json
from typing import Any, Dict, List, Optional, Tuple
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

try:
    from backend.auth import get_current_user
    from backend.models import (
        ChapterProgressUpdateRequest,
        ChapterMetaUpdateRequest,
        PlanPreviewRequest,
        PlanCreateRequest,
        ReminderCreateRequest,
        ReminderUpdateRequest,
    )
    from backend.services.planner_db import (
        ensure_default_subject_and_chapters_for_user,
        get_user_subjects,
        get_subject_books_with_chapters,
        update_chapter_progress_status,
        update_chapter_meta,
        save_study_plan_record,
        get_active_study_plan,
        toggle_plan_day_completion,
        delete_study_plan,
        get_chapter_relations_data,
        save_topic_relations,
        get_user_reminders,
        create_reminder,
        update_reminder,
        delete_reminder,
        get_connection,
    )
    from backend.services.plan_engine import (
        build_route,
        remaining_hours,
        calculate_plan_status,
    )
    from backend.services.topic_relations import (
        extract_topic_relations,
    )
except ImportError:
    from auth import get_current_user
    from models import (
        ChapterProgressUpdateRequest,
        ChapterMetaUpdateRequest,
        PlanPreviewRequest,
        PlanCreateRequest,
        ReminderCreateRequest,
        ReminderUpdateRequest,
    )
    from services.planner_db import (
        ensure_default_subject_and_chapters_for_user,
        get_user_subjects,
        get_subject_books_with_chapters,
        update_chapter_progress_status,
        update_chapter_meta,
        save_study_plan_record,
        get_active_study_plan,
        toggle_plan_day_completion,
        delete_study_plan,
        get_chapter_relations_data,
        save_topic_relations,
        get_user_reminders,
        create_reminder,
        update_reminder,
        delete_reminder,
        get_connection,
    )
    from services.plan_engine import (
        build_route,
        remaining_hours,
        calculate_plan_status,
    )
    from services.topic_relations import (
        extract_topic_relations,
    )

router = APIRouter(prefix="/api", tags=["planner"])


def _gather_chapter_topics_and_relations(chapter_ids: List[str]) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]]]:
    """Helper to fetch topic lists and relations mapping for chapters."""
    if not chapter_ids:
        return {}, {}

    conn = get_connection()
    try:
        t_rows = conn.execute(
            """
            SELECT * FROM topics
            WHERE chapter_id IN ({seq})
            ORDER BY order_index ASC
            """.format(seq=",".join("?" * len(chapter_ids))),
            chapter_ids
        ).fetchall()

        topics_map: Dict[str, List[Dict[str, Any]]] = {cid: [] for cid in chapter_ids}
        all_tids = []
        for tr in t_rows:
            d = dict(tr)
            topics_map[d["chapter_id"]].append(d)
            all_tids.append(d["id"])

        relations_map: Dict[str, Dict[str, Any]] = {cid: {"edges": []} for cid in chapter_ids}
        if all_tids:
            rel_rows = conn.execute(
                """
                SELECT tr.*, t1.chapter_id as from_chapter_id
                FROM topic_relations tr
                JOIN topics t1 ON tr.from_topic_id = t1.id
                WHERE tr.from_topic_id IN ({seq})
                """.format(seq=",".join("?" * len(all_tids))),
                all_tids
            ).fetchall()

            for rr in rel_rows:
                cid = rr["from_chapter_id"]
                if cid in relations_map:
                    relations_map[cid]["edges"].append({
                        "from": rr["from_topic_id"],
                        "to": rr["to_topic_id"],
                        "type": rr["type"]
                    })

        return topics_map, relations_map
    finally:
        conn.close()


# ==================== Planner Overview ====================

@router.get("/planner/overview")
async def get_planner_overview(
    subject_id: Optional[str] = Query(default=None),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    # Ensure user has default subject, synthesized chapters and books
    ensure_default_subject_and_chapters_for_user(user_id)

    subjects = get_user_subjects(user_id)
    if not subjects:
        return {
            "subject": None,
            "subjects": [],
            "stats": {
                "total_concepts": 0,
                "chapters_done": 0,
                "total_chapters": 0,
                "study_time_left": 0.0,
                "mastery_percent": 0.0
            },
            "books": [],
            "active_plan": None
        }

    # Pick requested or first subject
    selected_subject = None
    if subject_id:
        for s in subjects:
            if s["id"] == subject_id:
                selected_subject = s
                break
    if not selected_subject:
        selected_subject = subjects[0]

    books_data = get_subject_books_with_chapters(selected_subject["id"], user_id)

    # Flatten all chapters in this subject
    all_chapters = []
    for b in books_data:
        all_chapters.extend(b.get("chapters", []))

    total_concepts = sum(ch.get("concept_count", 0) for ch in all_chapters)
    total_chapters = len(all_chapters)
    done_chapters = sum(1 for ch in all_chapters if ch.get("status") == 2)
    study_time_left = round(sum(remaining_hours(ch) for ch in all_chapters), 1)

    mastery_percent = round((done_chapters / total_chapters * 100), 1) if total_chapters > 0 else 0.0

    # Active plan
    active_plan = get_active_study_plan(user_id, selected_subject["id"])
    plan_status_info = None
    if active_plan:
        plan_status_info = calculate_plan_status(active_plan, date.today().strftime("%Y-%m-%d"))

    return {
        "subject": selected_subject,
        "subjects": subjects,
        "stats": {
            "total_concepts": total_concepts,
            "chapters_done": done_chapters,
            "total_chapters": total_chapters,
            "study_time_left": study_time_left,
            "mastery_percent": mastery_percent
        },
        "books": books_data,
        "active_plan": active_plan,
        "plan_status": plan_status_info
    }


# ==================== Chapter Progress & Meta ====================

@router.patch("/chapters/{chapter_id}/progress")
async def update_chapter_progress(
    chapter_id: str,
    req: ChapterProgressUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        updated = update_chapter_progress_status(current_user["id"], chapter_id, req.status)
        return {"success": True, "chapter_progress": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/chapters/{chapter_id}")
async def update_chapter_metadata_endpoint(
    chapter_id: str,
    req: ChapterMetaUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        updated = update_chapter_meta(chapter_id, req.difficulty, req.est_hours)
        return {"success": True, "chapter": updated}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ==================== Chapter Relations & Clusters ====================

@router.get("/chapters/{chapter_id}/relations")
async def get_chapter_relations(
    chapter_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    data = get_chapter_relations_data(chapter_id)
    if not data or not data.get("chapter"):
        raise HTTPException(status_code=404, detail="Chapter not found.")

    # If chapter has topics but no clusters yet, generate clusters and relations
    topics = data.get("topics", [])
    clusters = data.get("clusters", [])
    if topics and not clusters:
        # Generate with AI or fallback
        ch_title = data["chapter"].get("name", "")
        extracted = extract_topic_relations(topics, chapter_title=ch_title)
        save_topic_relations(chapter_id, extracted.get("clusters", []), extracted.get("edges", []))
        data = get_chapter_relations_data(chapter_id)

    return data


# ==================== Study Plans ====================

@router.post("/plans/preview")
async def preview_study_plan(
    req: PlanPreviewRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    books = get_subject_books_with_chapters(req.subject_id, user_id)
    chapters = []
    for b in books:
        chapters.extend(b.get("chapters", []))

    ch_ids = [c["id"] for c in chapters]
    topics_map, relations_map = _gather_chapter_topics_and_relations(ch_ids)

    route = build_route(
        chapters=chapters,
        days=req.days,
        order_mode=req.order_mode,
        scope_chapter_id=req.scope_chapter_id,
        chapter_topics_map=topics_map,
        chapter_relations_map=relations_map,
        start_date=req.start_date
    )

    return {
        "days": req.days,
        "order_mode": req.order_mode,
        "scope_chapter_id": req.scope_chapter_id,
        "start_date": req.start_date or date.today().strftime("%Y-%m-%d"),
        "route": route
    }


@router.post("/plans")
async def create_study_plan(
    req: PlanCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    books = get_subject_books_with_chapters(req.subject_id, user_id)
    chapters = []
    for b in books:
        chapters.extend(b.get("chapters", []))

    ch_ids = [c["id"] for c in chapters]
    topics_map, relations_map = _gather_chapter_topics_and_relations(ch_ids)

    start_date_str = req.start_date or date.today().strftime("%Y-%m-%d")

    route = build_route(
        chapters=chapters,
        days=req.days,
        order_mode=req.order_mode,
        scope_chapter_id=req.scope_chapter_id,
        chapter_topics_map=topics_map,
        chapter_relations_map=relations_map,
        start_date=start_date_str
    )

    route_json = json.dumps(route)
    saved_plan = save_study_plan_record(
        user_id=user_id,
        subject_id=req.subject_id,
        days=req.days,
        order_mode=req.order_mode,
        start_date=start_date_str,
        route_json=route_json,
        scope_chapter_id=req.scope_chapter_id
    )

    status_info = calculate_plan_status(saved_plan, date.today().strftime("%Y-%m-%d"))

    return {
        "success": True,
        "plan": saved_plan,
        "plan_status": status_info
    }


@router.get("/plans/active")
async def get_active_plan_endpoint(
    subject_id: str = Query(...),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    active_plan = get_active_study_plan(user_id, subject_id)
    if not active_plan:
        return {"plan": None, "plan_status": None}

    status_info = calculate_plan_status(active_plan, date.today().strftime("%Y-%m-%d"))
    return {
        "plan": active_plan,
        "plan_status": status_info
    }


@router.patch("/plans/{plan_id}/days/{day_index}")
async def toggle_plan_day(
    plan_id: str,
    day_index: int,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    try:
        updated_plan = toggle_plan_day_completion(plan_id, current_user["id"], day_index)
        status_info = calculate_plan_status(updated_plan, date.today().strftime("%Y-%m-%d"))
        return {
            "success": True,
            "plan": updated_plan,
            "plan_status": status_info
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/plans/{plan_id}")
async def reset_study_plan(
    plan_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    deleted = delete_study_plan(plan_id, current_user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Plan not found.")
    return {"success": True, "deleted": True, "id": plan_id}


# ==================== Reminders CRUD ====================

@router.get("/reminders")
async def list_reminders(current_user: Dict[str, Any] = Depends(get_current_user)):
    user_id = current_user["id"]
    reminders = get_user_reminders(user_id)
    return {"reminders": reminders}


@router.post("/reminders")
async def add_reminder(
    req: ReminderCreateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    rem = create_reminder(
        user_id=user_id,
        time_str=req.time,
        weekdays=req.weekdays,
        label=req.label,
        enabled=req.enabled
    )
    return {"success": True, "reminder": rem}


@router.patch("/reminders/{reminder_id}")
async def edit_reminder(
    reminder_id: str,
    req: ReminderUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    updated = update_reminder(
        reminder_id=reminder_id,
        user_id=user_id,
        time_str=req.time,
        weekdays=req.weekdays,
        label=req.label,
        enabled=req.enabled
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"success": True, "reminder": updated}


@router.delete("/reminders/{reminder_id}")
async def remove_reminder(
    reminder_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    user_id = current_user["id"]
    deleted = delete_reminder(reminder_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Reminder not found.")
    return {"success": True, "deleted": True, "id": reminder_id}
