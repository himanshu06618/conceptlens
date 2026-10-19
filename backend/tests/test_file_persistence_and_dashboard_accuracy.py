import os
import io
import uuid
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app, UPLOAD_DIR
from backend.database import (
    get_connection,
    init_db,
    save_concepts_and_relations,
    get_concepts_by_document,
    get_document_file_blob,
    ensure_document_file_on_disk,
    create_document
)
from backend.auth import get_current_user, get_current_user_or_guest
from backend.services.planner_db import init_planner_db, link_document_to_curriculum


def create_user(user_id: str, username: str):
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO users (id, username, display_name, role, email, created_at, last_login_at)
            VALUES (?, ?, ?, 'student', ?, '2026-10-10T00:00:00', '2026-10-10T00:00:00')
            """,
            (user_id, username, f"User {username}", f"{username}@test.com")
        )
        conn.commit()
    finally:
        conn.close()
    return {
        "id": user_id,
        "username": username,
        "display_name": f"User {username}",
        "role": "student",
        "email": f"{username}@test.com",
        "is_authenticated": True
    }


def set_auth(user):
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_current_user_or_guest] = lambda: {**user, "is_authenticated": True}


@pytest.fixture(autouse=True)
def setup_test_db():
    init_db()
    init_planner_db()
    yield
    app.dependency_overrides.clear()


def test_file_blob_persistence_and_disk_reconstitution():
    """
    Verifies that uploaded file content is stored directly into the database BLOB,
    and if erased from disk (simulating a Render container restart),
    it is automatically restored from the database on demand.
    """
    client = TestClient(app)
    user_id = str(uuid.uuid4())
    user = create_user(user_id, "student_persistence")
    set_auth(user)

    sample_pdf_bytes = b"%PDF-1.4 sample pdf content for persistence verification"
    filename = "Biology_Cell_Structure.pdf"

    # 1. Upload file
    upload_res = client.post(
        "/api/documents",
        files={"file": (filename, io.BytesIO(sample_pdf_bytes), "application/pdf")}
    )
    assert upload_res.status_code == 200, upload_res.text
    doc_id = upload_res.json()["id"]

    # 2. Verify file content exists in database BLOB
    blob = get_document_file_blob(doc_id)
    assert blob is not None
    assert blob == sample_pdf_bytes

    # 3. Simulate Render ephemeral disk wipe: delete local file from UPLOAD_DIR
    user_file_path = UPLOAD_DIR / user_id / f"{doc_id}_{filename}"
    fallback_file_path = UPLOAD_DIR / f"{doc_id}_{filename}"

    if user_file_path.exists():
        user_file_path.unlink()
    if fallback_file_path.exists():
        fallback_file_path.unlink()

    assert not user_file_path.exists()
    assert not fallback_file_path.exists()

    # 4. GET /api/documents/{doc_id}/file-url should return provider='server' with valid URL
    url_res = client.get(f"/api/documents/{doc_id}/file-url")
    assert url_res.status_code == 200
    url_data = url_res.json()
    assert url_data["provider"] == "server"
    assert url_data["url"] == f"/api/documents/{doc_id}/file"

    # 5. GET /api/documents/{doc_id}/file should reconstitute file and return 200 inline
    file_res = client.get(f"/api/documents/{doc_id}/file")
    assert file_res.status_code == 200
    assert file_res.content == sample_pdf_bytes
    assert user_file_path.exists(), "File should be restored on disk in user upload dir"


def test_concepts_count_consistency_normalized():
    """
    Verifies that when a document's concepts are saved with 16 candidates
    (including 1 invalid non-concept/boilerplate item),
    it is normalized down to 15 concepts, and all endpoints
    (GET /api/documents, GET /api/documents/{doc_id}/concepts, planner overview)
    consistently report 15 concepts without any 16 vs 15 mismatch.
    """
    client = TestClient(app)
    user_id = str(uuid.uuid4())
    user = create_user(user_id, "student_consistency")
    set_auth(user)

    doc_id = str(uuid.uuid4())
    filename = "Sample_15_Concepts.pdf"

    # Create document
    create_document(
        user_id=user_id,
        doc_id=doc_id,
        filename=filename,
        file_type="pdf",
        status="completed",
        stage="completed"
    )

    # 16 concept candidates: 15 valid + 1 invalid sentence-like non-concept
    raw_16_concepts = [
        {"name": f"Concept {i}", "definition": f"Definition of concept {i}", "importance": 2, "topic": "Module 1"}
        for i in range(1, 16)
    ]
    # 16th item is an invalid sentence/non-concept
    raw_16_concepts.append({
        "name": "This is a long sentence describing the entire section and does not represent a discrete concept.",
        "definition": "Long description.",
        "importance": 1,
        "topic": "Module 1"
    })

    assert len(raw_16_concepts) == 16

    # Save to database
    save_concepts_and_relations(doc_id, raw_16_concepts)
    link_document_to_curriculum(doc_id, user_id)

    # 1. Stored concepts in DB should be 15
    stored = get_concepts_by_document(doc_id)
    assert len(stored) == 15

    # 2. GET /api/documents/{doc_id}/concepts should return total_concepts = 15
    concepts_res = client.get(f"/api/documents/{doc_id}/concepts")
    assert concepts_res.status_code == 200
    concepts_data = concepts_res.json()
    assert concepts_data["total_concepts"] == 15
    assert len(concepts_data["concepts"]) == 15

    # 3. GET /api/documents should return concept_count = 15
    docs_res = client.get("/api/documents")
    assert docs_res.status_code == 200
    doc_list = docs_res.json()
    matched_doc = next((d for d in doc_list if d["id"] == doc_id), None)
    assert matched_doc is not None
    assert matched_doc["concept_count"] == 15

    # 4. Planner overview stats total_concepts should be 15
    plan_res = client.get("/api/planner/overview")
    assert plan_res.status_code == 200
    plan_data = plan_res.json()
    assert plan_data["stats"]["total_concepts"] == 15


def test_reanalyze_restores_file_from_db_blob(monkeypatch):
    """
    Verifies that calling POST /api/documents/{doc_id}/reanalyze when the file has been wiped
    from ephemeral disk will seamlessly restore the file from database BLOB and succeed.
    """
    client = TestClient(app)
    user_id = str(uuid.uuid4())
    user = create_user(user_id, "student_reanalyze")
    set_auth(user)

    filename = "Sample_Notes.txt"
    sample_text = (
        "Operating Systems. A process is a program in execution. "
        "A thread is a lightweight unit of CPU utilization. "
        "Virtual memory provides an illusion of a large address space."
    ).encode("utf-8")

    # 1. Upload text document
    upload_res = client.post(
        "/api/documents",
        files={"file": (filename, io.BytesIO(sample_text), "text/plain")}
    )
    assert upload_res.status_code == 200
    doc_id = upload_res.json()["id"]

    # 2. Delete file from local disk to simulate container restart
    user_file_path = UPLOAD_DIR / user_id / f"{doc_id}_{filename}"
    fallback_file_path = UPLOAD_DIR / f"{doc_id}_{filename}"
    if user_file_path.exists():
        user_file_path.unlink()
    if fallback_file_path.exists():
        fallback_file_path.unlink()

    assert not user_file_path.exists()

    # 3. Call re-analyze endpoint
    reanalyze_res = client.post(f"/api/documents/{doc_id}/reanalyze")
    # Should NOT be 404 (file missing)
    assert reanalyze_res.status_code == 200, f"Expected 200 but got {reanalyze_res.status_code}: {reanalyze_res.text}"
    re_data = reanalyze_res.json()
    assert re_data["success"] is True
    assert re_data["concept_count"] > 0
    assert user_file_path.exists(), "File should be restored on disk during re-analysis"

