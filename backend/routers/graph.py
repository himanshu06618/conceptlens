"""
backend/routers/graph.py
FastAPI router for Graph RAG, Knowledge Graph visualisations, Flow, Mastery Map, and Ask.
Strictly scoped to the verified user.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, Response, HTTPException, Depends, Query, Path
from pydantic import BaseModel, Field

try:
    from backend.auth import get_current_user, get_current_user_or_guest
    from backend.routers.auth import limiter
    from backend.services.graph_service import (
        GRAPH_RAG_ENABLED,
        get_graph_data,
        get_entity_detail,
        get_flow_data,
        get_mastery_map_data,
        list_merge_suggestions,
        accept_merge_suggestion,
        reject_merge_suggestion,
        unmerge_entity
    )
    from backend.services.rag_service import (
        answer_user_question,
        get_user_qa_history
    )
except ImportError:
    from auth import get_current_user, get_current_user_or_guest
    from routers.auth import limiter
    from services.graph_service import (
        GRAPH_RAG_ENABLED,
        get_graph_data,
        get_entity_detail,
        get_flow_data,
        get_mastery_map_data,
        list_merge_suggestions,
        accept_merge_suggestion,
        reject_merge_suggestion,
        unmerge_entity
    )
    from services.rag_service import (
        answer_user_question,
        get_user_qa_history
    )

router = APIRouter()

# ---------------------------------------------------------------------------
# Request Models
# ---------------------------------------------------------------------------

class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=1000, description="Question about course notes or concept relationships")
    document_id: Optional[str] = Field(None, description="Optional document ID for single-document scope")
    scope: Optional[str] = Field("document", description="Query scope: 'document' or 'all'")

# ---------------------------------------------------------------------------
# 1. Knowledge Graph Visualization Endpoint
# ---------------------------------------------------------------------------

@router.get("/graph", tags=["graph"])
@limiter.limit("60/minute")
async def get_knowledge_graph_endpoint(
    request: Request,
    response: Response,
    scope: str = Query("all", description="'document' or 'all'"),
    document_id: Optional[str] = Query(None, description="Optional document ID filter"),
    origin: str = Query("all", description="'notes', 'suggested', or 'all'"),
    include_related: bool = Query(True, description="Include related non-prerequisite edges"),
    search: Optional[str] = Query("", description="Search term for concept names"),
    focus: Optional[str] = Query(None, description="Entity ID to focus on with hops"),
    hops: int = Query(2, ge=1, le=3, description="Number of hops in focus mode"),
    limit: int = Query(80, ge=1, le=500, description="Max nodes to return"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns verified per-student knowledge graph nodes & edges.
    Default limit is 80 nodes with a `truncated` flag and focus mode support.
    """
    if not GRAPH_RAG_ENABLED:
        return {
            "nodes": [],
            "edges": [],
            "total_nodes": 0,
            "total_edges": 0,
            "truncated": False,
            "merge_suggestions_count": 0,
            "message": "Graph RAG is currently disabled via feature flag."
        }

    user_id = current_user["id"]
    data = get_graph_data(
        user_id=user_id,
        scope=scope,
        document_id=document_id,
        origin=origin,
        include_related=include_related,
        search=search or "",
        focus=focus,
        hops=hops,
        limit=limit
    )

    # Cache response header per user
    response.headers["Cache-Control"] = "private, no-cache, must-revalidate"
    return data

# ---------------------------------------------------------------------------
# 2. Entity Details Endpoint
# ---------------------------------------------------------------------------

@router.get("/graph/entities/{entity_id}", tags=["graph"])
@limiter.limit("60/minute")
async def get_entity_detail_endpoint(
    request: Request,
    entity_id: str = Path(..., description="Concept entity ID"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Retrieves full detail, lecture/page mentions, depends_on, needed_for, and merge suggestions."""
    user_id = current_user["id"]
    detail = get_entity_detail(entity_id=entity_id, user_id=user_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Concept entity not found.")
    return detail

# ---------------------------------------------------------------------------
# 3. Prerequisite Flowchart Endpoint
# ---------------------------------------------------------------------------

@router.get("/flow", tags=["graph"])
@limiter.limit("60/minute")
async def get_flow_chart_endpoint(
    request: Request,
    response: Response,
    target: Optional[str] = Query(None, description="Target entity ID or name to trace path for"),
    scope: str = Query("all", description="'document' or 'all'"),
    document_id: Optional[str] = Query(None, description="Document ID"),
    chapter: Optional[str] = Query(None, description="Optional chapter filter"),
    user_or_guest: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """
    Returns layered flowchart data:
    Columns by stage_index ('STEP n'), states ('studied', 'next_up', 'locked'),
    estimated minutes, and the directed path to the target.
    Guests see flow without progress states and with 'Sign in to track progress'.
    """
    is_guest = not user_or_guest.get("id") or user_or_guest.get("role") == "guest"
    user_id = None if is_guest else user_or_guest["id"]

    data = get_flow_data(
        user_id=user_id,
        target_id=target,
        scope=scope,
        document_id=document_id,
        chapter=chapter
    )
    response.headers["Cache-Control"] = "private, no-cache, must-revalidate"
    return data

# ---------------------------------------------------------------------------
# 4. Mastery Map Endpoint
# ---------------------------------------------------------------------------

@router.get("/mastery-map", tags=["graph"])
@limiter.limit("60/minute")
async def get_mastery_map_endpoint(
    request: Request,
    response: Response,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Returns chapter tiles grouped under lectures with studied counts,
    progress percentages, next-up concept, weakest area marker, and ready-to-learn recommendations.
    """
    user_id = current_user["id"]
    data = get_mastery_map_data(user_id=user_id)
    response.headers["Cache-Control"] = "private, no-cache, must-revalidate"
    return data

# ---------------------------------------------------------------------------
# 5. Merge Suggestions Endpoints
# ---------------------------------------------------------------------------

@router.get("/graph/merge-suggestions", tags=["graph"])
async def list_merge_suggestions_endpoint(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Lists all pending merge suggestions for the authenticated user."""
    return list_merge_suggestions(user_id=current_user["id"])

@router.post("/graph/merge-suggestions/{suggestion_id}/accept", tags=["graph"])
async def accept_merge_suggestion_endpoint(
    suggestion_id: str = Path(..., description="Merge suggestion ID"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Accepts a merge suggestion, consolidating entity_b into entity_a."""
    success = accept_merge_suggestion(suggestion_id=suggestion_id, user_id=current_user["id"])
    if not success:
        raise HTTPException(status_code=400, detail="Could not accept merge suggestion. It may have expired or already been processed.")
    return {"status": "accepted", "suggestion_id": suggestion_id}

@router.post("/graph/merge-suggestions/{suggestion_id}/reject", tags=["graph"])
async def reject_merge_suggestion_endpoint(
    suggestion_id: str = Path(..., description="Merge suggestion ID"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Rejects a merge suggestion and remembers the rejection."""
    success = reject_merge_suggestion(suggestion_id=suggestion_id, user_id=current_user["id"])
    if not success:
        raise HTTPException(status_code=400, detail="Could not reject merge suggestion.")
    return {"status": "rejected", "suggestion_id": suggestion_id}

@router.post("/graph/entities/{entity_id}/unmerge", tags=["graph"])
async def unmerge_entity_endpoint(
    entity_id: str = Path(..., description="Entity ID to split back into separate concepts"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Splits an entity that has mentions from multiple concepts or documents back into distinct entities."""
    success = unmerge_entity(entity_id=entity_id, user_id=current_user["id"])
    if not success:
        raise HTTPException(status_code=400, detail="Entity has 1 or fewer mentions and cannot be unmerged.")
    return {"status": "unmerged", "entity_id": entity_id}

# ---------------------------------------------------------------------------
# 6. Ask Question Endpoint (Grounded with Server-Verified Citations)
# ---------------------------------------------------------------------------

@router.post("/ask", tags=["ask"])
@limiter.limit("30/minute")
async def ask_question_endpoint(
    request: Request,
    payload: AskRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Answers dependency, relationship, and factual questions from the student's concept graph & chunks.
    Verifies every citation on the server; drops unsupported claims; returns document, page, and quote.
    """
    user_id = current_user["id"]
    try:
        result = answer_user_question(
            question=payload.question,
            user_id=user_id,
            document_id=payload.document_id,
            scope=payload.scope or "document"
        )
        return result
    except Exception as e:
        logger.exception(f"Ask endpoint error for user {user_id}: {e}")
        # Fallback to safe message if unhandled error
        return {
            "answer": "An error occurred while answering your question. Please try again.",
            "citations": [],
            "concepts_used": [],
            "dependency_path": [],
            "not_found": False,
            "route": "error_fallback",
            "timing_ms": 0.0
        }

@router.get("/ask/history", tags=["ask"])
async def get_ask_history_endpoint(
    limit: int = Query(20, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Returns the user's recent Ask Q&A history."""
    return get_user_qa_history(user_id=current_user["id"], limit=limit)
