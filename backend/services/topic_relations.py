import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from collections import defaultdict, deque

import requests

logger = logging.getLogger("conceptlens.planner.relations")

TOPIC_RELATIONS_PROMPT = """You are an expert curriculum designer analyzing a chapter's topics to structure a study plan.
Analyze the following list of topics for this chapter in reading order.
Group them into sequential clusters and determine their learning relations (prerequisites and related topics).

STRICT RULES:
1. ONLY two relation types are allowed: "prerequisite" and "related".
   - "prerequisite": The learner cannot properly understand `to` without first mastering `from`. Must ALWAYS point from an earlier topic to a later topic in reading order.
   - "related": The two topics are connected concepts and best studied close together. Order does not matter.
2. Give ONLY DIRECT prerequisites (no transitive jumps; if A -> B and B -> C, do NOT link A -> C).
3. At most 3 prerequisites and at most 3 related links per topic so it stays clean and readable.
4. "clusters": Groups of closely connected topics that follow each other in reading order (typically 3 to 8 topics per cluster). Every topic must belong to a cluster.
5. Return ONLY a valid JSON object matching this schema:
{
  "clusters": [
    {"name": "Descriptive Cluster Name", "topic_ids": [id1, id2, ...]}
  ],
  "edges": [
    {"from": from_topic_id, "to": to_topic_id, "type": "prerequisite" | "related"}
  ]
}
"""


def generate_fallback_relations(topics: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Fallback: Chunks of 4 consecutive topics with no edges if AI call fails or is unavailable.
    """
    if not topics:
        return {"clusters": [], "edges": []}

    sorted_topics = sorted(topics, key=lambda t: t.get("order_index", 0))
    clusters = []
    chunk_size = 4

    for i in range(0, len(sorted_topics), chunk_size):
        chunk = sorted_topics[i : i + chunk_size]
        first_name = chunk[0].get("name", "Topic")
        cluster_idx = (i // chunk_size) + 1
        clusters.append({
            "name": f"Part {cluster_idx}: {first_name}",
            "topic_ids": [t["id"] for t in chunk]
        })

    return {
        "clusters": clusters,
        "edges": []
    }


def validate_and_sanitize_relations(
    topics: List[Dict[str, Any]],
    raw_data: Any
) -> Dict[str, Any]:
    """
    Validates and sanitizes raw clusters and edges:
    - Topic IDs must exist in the chapter's topics.
    - Relation types must strictly be 'prerequisite' or 'related'.
    - Prerequisite edges must strictly point from earlier topic to later topic (order_index(from) < order_index(to)).
    - Prerequisite edges must form a DAG (no cycles).
    - Drops transitive shortcut edges (direct prerequisites only).
    - Enforces <= 3 prerequisites and <= 3 related edges per topic.
    - Symmetrically stores related edges once with from_id < to_id.
    - Ensures all topics are covered in clusters.
    """
    if not topics:
        return {"clusters": [], "edges": []}

    sorted_topics = sorted(topics, key=lambda t: t.get("order_index", 0))
    topic_ids = {t["id"] for t in sorted_topics}
    topic_order = {t["id"]: t.get("order_index", idx) for idx, t in enumerate(sorted_topics)}

    if not isinstance(raw_data, dict):
        return generate_fallback_relations(sorted_topics)

    # 1. Validate clusters
    raw_clusters = raw_data.get("clusters")
    clusters_clean: List[Dict[str, Any]] = []
    assigned_topic_ids: Set[Any] = set()

    if isinstance(raw_clusters, list):
        for idx, cl in enumerate(raw_clusters):
            if not isinstance(cl, dict):
                continue
            name = str(cl.get("name") or f"Cluster {idx + 1}").strip()
            raw_tids = cl.get("topic_ids", [])
            valid_tids = [tid for tid in raw_tids if tid in topic_ids and tid not in assigned_topic_ids]
            if valid_tids:
                assigned_topic_ids.update(valid_tids)
                clusters_clean.append({
                    "name": name,
                    "topic_ids": valid_tids
                })

    # Unassigned topics fallback
    unassigned = [t["id"] for t in sorted_topics if t["id"] not in assigned_topic_ids]
    if unassigned:
        if not clusters_clean:
            return generate_fallback_relations(sorted_topics)
        # Append unassigned to the last cluster or create chunks of 4
        chunk_size = 4
        for i in range(0, len(unassigned), chunk_size):
            chunk = unassigned[i : i + chunk_size]
            c_idx = len(clusters_clean) + 1
            sample_t = next(t for t in sorted_topics if t["id"] == chunk[0])
            clusters_clean.append({
                "name": f"Part {c_idx}: {sample_t.get('name', 'Topics')}",
                "topic_ids": chunk
            })

    # 2. Validate edges
    raw_edges = raw_data.get("edges", [])
    if not isinstance(raw_edges, list):
        raw_edges = []

    prereq_candidates: List[Tuple[Any, Any]] = []
    related_candidates: Set[Tuple[Any, Any]] = set()

    for edge in raw_edges:
        if not isinstance(edge, dict):
            continue
        u = edge.get("from")
        v = edge.get("to")
        edge_type = str(edge.get("type") or "").strip().lower()

        if u not in topic_ids or v not in topic_ids or u == v:
            continue

        if edge_type == "prerequisite":
            # Must point from earlier to later in reading order
            if topic_order[u] < topic_order[v]:
                prereq_candidates.append((u, v))
        elif edge_type == "related":
            # Store once with smaller id first
            first, second = (u, v) if u < v else (v, u)
            related_candidates.add((first, second))

    # 3. DAG check & Transitive Reduction for prerequisites
    # Since topic_order[u] < topic_order[v], cycles are mathematically impossible if order is strictly increasing.
    # But let's verify DAG and perform transitive reduction:
    adj: Dict[Any, Set[Any]] = defaultdict(set)
    in_degree: Dict[Any, int] = defaultdict(int)
    for u, v in prereq_candidates:
        adj[u].add(v)

    # Transitive reduction: if u -> v and there is a path from u to v of length >= 2, drop u -> v
    def has_alternate_path(start: Any, target: Any) -> bool:
        visited = set()
        queue = deque([start])
        while queue:
            curr = queue.popleft()
            for neighbor in adj[curr]:
                if curr == start and neighbor == target:
                    continue
                if neighbor == target:
                    return True
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        return False

    final_prereqs: List[Tuple[Any, Any]] = []
    # Limit to at most 3 prerequisites per target topic (keeping latest/closest predecessors)
    by_target: Dict[Any, List[Any]] = defaultdict(list)
    for u, v in prereq_candidates:
        if not has_alternate_path(u, v):
            by_target[v].append(u)

    for v, u_list in by_target.items():
        # Sort by proximity in reading order (closest predecessor first)
        u_sorted = sorted(u_list, key=lambda u: topic_order[u], reverse=True)[:3]
        for u in u_sorted:
            final_prereqs.append((u, v))

    # 4. Limit related edges: at most 3 per topic
    final_related: List[Tuple[Any, Any]] = []
    related_degree: Dict[Any, int] = defaultdict(int)
    for u, v in sorted(related_candidates):
        if related_degree[u] < 3 and related_degree[v] < 3:
            final_related.append((u, v))
            related_degree[u] += 1
            related_degree[v] += 1

    # Format edges
    edges_clean = []
    for u, v in final_prereqs:
        edges_clean.append({"from": u, "to": v, "type": "prerequisite"})
    for u, v in final_related:
        edges_clean.append({"from": u, "to": v, "type": "related"})

    return {
        "clusters": clusters_clean,
        "edges": edges_clean
    }


def extract_topic_relations(
    topics: List[Dict[str, Any]],
    chapter_title: str = "",
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Extracts clusters and topic relations (prerequisites and related) using Gemini API,
    with robust validation and a guaranteed deterministic fallback to chunks of 4 topics with no edges.
    """
    if not topics:
        return {"clusters": [], "edges": []}

    key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
    if not key or len(topics) < 2:
        return generate_fallback_relations(topics)

    model = model_name or os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    # Prepare topic payload for the model
    topics_summary = [
        {"id": t["id"], "order_index": t.get("order_index", idx + 1), "name": t["name"]}
        for idx, t in enumerate(topics)
    ]

    prompt_content = f"{TOPIC_RELATIONS_PROMPT}\n\nCHAPTER TITLE: {chapter_title or 'General Chapter'}\nTOPICS:\n{json.dumps(topics_summary, indent=2)}"

    payload = {
        "contents": [{
            "parts": [{"text": prompt_content}]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 4096
        }
    }

    try:
        t0 = time.perf_counter()
        resp = requests.post(url, params={"key": key}, json=payload, timeout=20)
        if resp.status_code == 200:
            result_data = resp.json()
            candidates = result_data.get("candidates", [])
            if candidates:
                text_content = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                parsed = json.loads(text_content)
                sanitized = validate_and_sanitize_relations(topics, parsed)
                logger.info(f"Successfully extracted {len(sanitized.get('clusters', []))} clusters and {len(sanitized.get('edges', []))} edges in {time.perf_counter() - t0:.2f}s.")
                return sanitized

        logger.warning(f"Topic relations AI call returned status {resp.status_code}. Using fallback.")
    except Exception as exc:
        logger.warning(f"Topic relations extraction failed: {exc}. Using fallback.")

    return generate_fallback_relations(topics)


def apply_topic_relations_to_db(chapter_id: str, relations_data: Dict[str, Any]) -> None:
    """
    Saves the extracted clusters and relations into the database for this chapter.
    """
    try:
        from backend.services.planner_db import save_topic_relations
    except ImportError:
        from services.planner_db import save_topic_relations
    save_topic_relations(
        chapter_id=chapter_id,
        clusters_data=relations_data.get("clusters", []),
        edges_data=relations_data.get("edges", [])
    )


def process_document_chapters_and_relations(doc_id: str) -> None:
    """
    Called after concepts are extracted for a document:
    Ensures chapters and topics exist, then extracts clusters & topic relations for each chapter.
    """
    try:
        try:
            from backend.services.planner_db import (
                get_connection,
                save_topic_relations,
                link_document_to_curriculum,
                ensure_default_subject_and_chapters_for_user
            )
        except ImportError:
            from services.planner_db import (
                get_connection,
                save_topic_relations,
                link_document_to_curriculum,
                ensure_default_subject_and_chapters_for_user
            )
        conn = get_connection()
        try:
            doc_row = conn.execute("SELECT id, user_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc_row:
                return
            user_id = doc_row["user_id"]
            if user_id:
                link_document_to_curriculum(doc_id, user_id)

            ch_rows = conn.execute("SELECT id, name FROM chapters WHERE book_id = ?", (doc_id,)).fetchall()
            for ch in ch_rows:
                ch_id = ch["id"]
                topic_rows = conn.execute(
                    "SELECT * FROM topics WHERE chapter_id = ? ORDER BY order_index ASC",
                    (ch_id,)
                ).fetchall()
                topics = [dict(t) for t in topic_rows]
                if topics:
                    extracted = extract_topic_relations(topics, chapter_title=ch["name"])
                    save_topic_relations(ch_id, extracted.get("clusters", []), extracted.get("edges", []))
        finally:
            conn.close()
    except Exception as exc:
        logger.warning(f"Error processing chapters and relations for document {doc_id}: {exc}")

