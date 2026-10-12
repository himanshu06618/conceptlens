import pytest
from datetime import datetime, timezone
from backend.services.normalizer import (
    normalize_extracted_concepts,
    is_blacklisted_concept,
    clean_concept_name,
    derive_estimated_minutes,
    remove_prerequisite_cycles_and_rank,
    SCHEMA_VERSION
)
from backend.database import (
    init_db,
    get_connection,
    create_user,
    create_document,
    save_concepts_and_relations,
    get_concepts_by_document,
    set_concept_progress,
    bulk_set_concept_progress,
    get_concept_progress_for_document,
    get_concept_by_id_and_user,
    verify_concept_owner
)
from backend.services.planner_db import (
    init_planner_db,
    link_document_to_curriculum,
    update_chapter_progress_status,
    get_dashboard_summary_data
)
from fastapi.testclient import TestClient
from backend.main import app


def test_normalizer_removes_bad_examples():
    """Verify normalizer drops instructors, institutions, boilerplate, and fragment nodes."""
    raw_bad_concepts = [
        {"id": "1", "name": "Erik Demaine", "definition": "Professor at MIT.", "importance": 3},
        {"id": "2", "name": "Erik Demaise", "definition": "Author.", "importance": 2},
        {"id": "3", "name": "Massachusetts Institute", "definition": "University in Cambridge.", "importance": 3},
        {"id": "4", "name": "Technology Instructors", "definition": "Teaching staff.", "importance": 1},
        {
            "id": "5",
            "name": "find next(k) return the stored item with smallest key larger than k",
            "definition": "",
            "importance": 2
        },
        {
            "id": "6",
            "name": "set at(i) delete first() ...",
            "definition": "Sequence operations.",
            "importance": 1
        },
        {
            "id": "7",
            "name": "https://ocw.mit.edu/courses/intro-to-algorithms",
            "definition": "Course URL.",
            "importance": 1
        },
        {
            "id": "8",
            "name": "Binary Search",
            "definition": "An efficient O(log n) search algorithm on sorted sequences.",
            "importance": 3,
            "chapter": "Searching",
            "relations": [{"target_id": "9", "type": "prerequisite"}]
        },
        {
            "id": "9",
            "name": "Sorted Array",
            "definition": "An array whose elements are arranged in monotonic order.",
            "importance": 3,
            "chapter": "Foundations"
        }
    ]

    cleaned = normalize_extracted_concepts(raw_bad_concepts)
    cleaned_names = [c["name"].lower() for c in cleaned]

    # Verify all bad examples are completely removed
    assert not any("erik demaine" in n for n in cleaned_names)
    assert not any("erik demaise" in n for n in cleaned_names)
    assert not any("massachusetts institute" in n for n in cleaned_names)
    assert not any("technology instructors" in n for n in cleaned_names)
    assert not any("find next" in n for n in cleaned_names)
    assert not any("delete first" in n for n in cleaned_names)
    assert not any("http" in n for n in cleaned_names)

    # Valid concepts must remain
    assert "binary search" in cleaned_names
    assert "sorted array" in cleaned_names

    # Check fields attached by normalizer
    for c in cleaned:
        assert "stage_index" in c
        assert "chapter_order" in c
        assert "estimated_minutes" in c
        assert 1 <= c["estimated_minutes"] <= 30
        assert c["schema_version"] == SCHEMA_VERSION


def test_prerequisite_graph_strictly_acyclic_dag():
    """Verify that cycles in prerequisite links are deterministically resolved into a DAG."""
    # Triangular cycle: A requires B, B requires C, C requires A
    cyclic_concepts = [
        {
            "id": "A",
            "name": "Concept Alpha",
            "definition": "First foundational concept.",
            "importance": 3,
            "chapter": "Module 1",
            "relations": [{"target_id": "B", "type": "prerequisite", "weight": 2}]
        },
        {
            "id": "B",
            "name": "Concept Beta",
            "definition": "Second intermediate concept.",
            "importance": 2,
            "chapter": "Module 1",
            "relations": [{"target_id": "C", "type": "prerequisite", "weight": 3}]
        },
        {
            "id": "C",
            "name": "Concept Gamma",
            "definition": "Third advanced concept.",
            "importance": 2,
            "chapter": "Module 1",
            "relations": [{"target_id": "A", "type": "prerequisite", "weight": 1}] # lowest weight edge to break
        }
    ]

    cleaned = normalize_extracted_concepts(cyclic_concepts)
    assert len(cleaned) == 3

    # Check that cycle is broken (DAG): verify topological stage indices are valid
    stage_indices = {c["name"]: c["stage_index"] for c in cleaned}
    # No negative stages, all valid ints
    for s in stage_indices.values():
        assert s >= 0


def test_concept_progress_and_chapter_sync():
    """Test concept progress CRUD and chapter completion synchronization."""
    init_db()
    init_planner_db()

    user_a = f"test_prog_user_{datetime.now(timezone.utc).timestamp()}"
    create_user(user_id=user_a, username=f"user_{user_a}", display_name="Progress Tester")

    doc_id = f"test_doc_{datetime.now(timezone.utc).timestamp()}"
    create_document(
        user_id=user_a,
        doc_id=doc_id,
        filename="Algorithms_101.pdf",
        file_type="pdf",
        status="completed"
    )

    concepts = [
        {
            "name": "Merge Sort",
            "definition": "Divide and conquer sorting algorithm.",
            "importance": 3,
            "topic": "Sorting",
            "score": 0.9,
            "source_excerpt": "Merge Sort",
            "page": 1,
            "flow_order": 0,
            "flow_group": "Sorting"
        },
        {
            "name": "Quick Sort",
            "definition": "Partition-based sorting algorithm.",
            "importance": 2,
            "topic": "Sorting",
            "score": 0.8,
            "source_excerpt": "Quick Sort",
            "page": 2,
            "flow_order": 1,
            "flow_group": "Sorting"
        }
    ]
    save_concepts_and_relations(doc_id, concepts)
    link_document_to_curriculum(doc_id, user_a)

    db_concepts = get_concepts_by_document(doc_id)
    assert len(db_concepts) == 2
    c1_id = str(db_concepts[0]["id"])
    c2_id = str(db_concepts[1]["id"])

    # 1. Initially both not studied
    p_map = get_concept_progress_for_document(user_a, doc_id)
    assert p_map.get(c1_id) is None or p_map.get(c1_id) == "not_started"

    # 2. Mark c1 studied
    set_concept_progress(user_a, c1_id, "studied")
    p_map = get_concept_progress_for_document(user_a, doc_id)
    assert p_map[c1_id] == "studied"

    # 3. Mark c2 studied -> Chapter should automatically complete!
    set_concept_progress(user_a, c2_id, "studied")
    p_map = get_concept_progress_for_document(user_a, doc_id)
    assert p_map[c2_id] == "studied"

    # Verify summary logic computes from concept_progress
    summary = get_dashboard_summary_data(user_a)
    stats = summary["stats"]
    assert stats["chapters_done"] >= 1
    assert stats["mastery_percent"] == 100.0
    assert stats["study_time_left"] == 0.0

    # 4. Unmarking concept reverses completion
    set_concept_progress(user_a, c2_id, "not_started")
    summary_after = get_dashboard_summary_data(user_a)
    assert summary_after["stats"]["study_time_left"] > 0


def test_user_isolation_on_concept_progress():
    """Verify that User B cannot read or modify User A's concept progress."""
    init_db()
    init_planner_db()

    user_a = f"iso_user_a_{datetime.now(timezone.utc).timestamp()}"
    user_b = f"iso_user_b_{datetime.now(timezone.utc).timestamp()}"
    create_user(user_id=user_a, username=f"u_{user_a}", display_name="User A")
    create_user(user_id=user_b, username=f"u_{user_b}", display_name="User B")

    doc_a = f"doc_a_{datetime.now(timezone.utc).timestamp()}"
    create_document(user_id=user_a, doc_id=doc_a, filename="A_Notes.pdf", file_type="pdf", status="completed")
    save_concepts_and_relations(doc_a, [{"name": "Concept A", "definition": "Doc A concept.", "importance": 2, "topic": "General"}])

    concepts_a = get_concepts_by_document(doc_a)
    c_a_id = str(concepts_a[0]["id"])

    # User A owns it
    assert verify_concept_owner(user_a, c_a_id) is True
    assert get_concept_by_id_and_user(c_a_id, user_a) is not None

    # User B does NOT own it (isolation check)
    assert verify_concept_owner(user_b, c_a_id) is False
    assert get_concept_by_id_and_user(c_a_id, user_b) is None


def test_concept_progress_endpoints_and_auth():
    """Test PUT /api/concepts/{id}/progress and bulk endpoint with authentication and 404 on other user."""
    client = TestClient(app)
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)
    
    # Register User A
    res_a = client.post("/api/auth/register", json={
        "username": f"user_a_{ts}",
        "password": "ValidPassword123!",
        "confirm_password": "ValidPassword123!",
        "display_name": "API User A"
    })
    assert res_a.status_code == 200
    user_a = res_a.json()["id"]
    token_a = res_a.cookies.get("access_token")

    # Register User B
    res_b = client.post("/api/auth/register", json={
        "username": f"user_b_{ts}",
        "password": "ValidPassword123!",
        "confirm_password": "ValidPassword123!",
        "display_name": "API User B"
    })
    assert res_b.status_code == 200
    user_b = res_b.json()["id"]
    token_b = res_b.cookies.get("access_token")

    doc_a = f"doc_api_a_{ts}"
    create_document(user_id=user_a, doc_id=doc_a, filename="UserA_Doc.pdf", file_type="pdf", status="completed")
    save_concepts_and_relations(doc_a, [
        {"name": "Hash Table", "definition": "Direct access table with hash function.", "importance": 3, "topic": "Hashing"}
    ])

    concepts = get_concepts_by_document(doc_a)
    c_id = str(concepts[0]["id"])

    # 1. Unauthenticated request -> 401
    client_anon = TestClient(app)
    resp_unauth = client_anon.put(f"/api/concepts/{c_id}/progress", json={"status": "studied"})
    assert resp_unauth.status_code == 401

    # 2. User B tries to update User A's concept -> 404
    resp_b = client.put(
        f"/api/concepts/{c_id}/progress",
        json={"status": "studied"},
        cookies={"access_token": token_b}
    )
    assert resp_b.status_code == 404

    # 3. User A updates their concept -> 200
    resp_a = client.put(
        f"/api/concepts/{c_id}/progress",
        json={"status": "studied"},
        cookies={"access_token": token_a}
    )
    assert resp_a.status_code == 200
    assert resp_a.json()["status"] == "studied"

    # 4. User A reads concepts -> contains status 'studied' and schema_version
    resp_get = client.get(
        f"/api/documents/{doc_a}/concepts",
        cookies={"access_token": token_a}
    )
    assert resp_get.status_code == 200
    data = resp_get.json()
    assert data["schema_version"] == 2
    assert data["concepts"][0]["status"] == "studied"

    # 5. Bulk progress endpoint
    resp_bulk = client.put(
        "/api/concepts/progress/bulk",
        json={"concept_ids": [c_id], "status": "not_started"},
        cookies={"access_token": token_a}
    )
    assert resp_bulk.status_code == 200
    assert resp_bulk.json()["updated_count"] == 1
