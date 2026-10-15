import io
import os
import hashlib
from datetime import datetime, timezone
import pytest
import pymupdf as fitz
from fastapi.testclient import TestClient

from backend.main import app
from backend.database import (
    init_db,
    create_user,
    create_document,
    save_concepts_and_relations,
    get_concepts_by_document
)
from backend.services.source_locator import (
    locate_concepts_in_document,
    locate_concepts_in_pdf,
    locate_concepts_in_text
)
from backend.services.file_storage import (
    is_s3_configured,
    generate_presigned_download_url,
    save_document_file_record,
    get_document_file_record,
    get_user_storage_usage,
    delete_document_file
)


def test_locate_concepts_in_pdf():
    """Verify PyMuPDF locator identifies exact page numbers and evidence quotes."""
    # Create a 3-page synthetic PDF in memory
    doc = fitz.open()
    
    # Page 1: Introduction
    p1 = doc.new_page()
    p1.insert_text((50, 50), "Introduction to Data Structures and Algorithms.\nWe will cover asymptotic notation and foundations.")

    # Page 2: Binary Search Trees
    p2 = doc.new_page()
    p2.insert_text((50, 50), "Chapter 2: Binary Search Trees.\nA binary search tree is a rooted node-based binary tree data structure where each node has at most two children.")

    # Page 3: Red-Black Trees
    p3 = doc.new_page()
    p3.insert_text((50, 50), "Chapter 3: Self Balancing Trees.\nA Red-Black Tree is a self-balancing binary search tree where each node stores an extra bit representing color.")

    pdf_bytes = doc.tobytes()
    doc.close()

    concepts = [
        {
            "id": "c1",
            "name": "Binary Search Tree",
            "definition": "A rooted node-based binary tree data structure.",
            "importance": 3,
            "chapter": "Trees"
        },
        {
            "id": "c2",
            "name": "Red-Black Tree",
            "definition": "A self-balancing binary search tree with color bits.",
            "importance": 3,
            "chapter": "Trees"
        },
        {
            "id": "c3",
            "name": "Quantum Computing",
            "definition": "Computation using quantum mechanical phenomena.",
            "importance": 1,
            "chapter": "Physics"
        }
    ]

    located = locate_concepts_in_pdf(pdf_bytes, concepts)

    # c1 is on page 2 (1-based)
    c1 = next(c for c in located if c["id"] == "c1")
    assert c1["source_page"] == 2
    assert c1["source_verified"] is True
    assert "binary search tree" in c1["source_quote"].lower()

    # c2 is on page 3 (1-based)
    c2 = next(c for c in located if c["id"] == "c2")
    assert c2["source_page"] == 3
    assert c2["source_verified"] is True
    assert "red-black tree" in c2["source_quote"].lower()

    # c3 is not present in document: never invent page!
    c3 = next(c for c in located if c["id"] == "c3")
    assert c3["source_page"] is None
    assert c3["source_verified"] is False


def test_locate_concepts_in_text():
    """Verify text locator marks page 1 and quotes snippet."""
    text = "Recursion is a method of solving problems where the solution depends on solutions to smaller instances."
    concepts = [
        {"id": "c1", "name": "Recursion", "definition": "Function that calls itself."}
    ]
    located = locate_concepts_in_text(text, concepts)
    assert located[0]["source_page"] == 1
    assert located[0]["source_verified"] is True
    assert "recursion" in located[0]["source_quote"].lower()


def test_s3_presigned_url_generation():
    """Verify AWS SigV4 presigned download URL generation without boto3."""
    old_env = {k: os.environ.get(k) for k in ("S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "STORAGE_PROVIDER")}
    try:
        os.environ["S3_BUCKET"] = "test-bucket"
        os.environ["S3_ACCESS_KEY_ID"] = "TESTKEY123"
        os.environ["S3_SECRET_ACCESS_KEY"] = "TESTSECRET456"
        os.environ["S3_REGION"] = "us-east-1"
        os.environ["STORAGE_PROVIDER"] = "s3"

        url = generate_presigned_download_url("documents/user1/doc1/notes.pdf", expires_in=300)
        assert "X-Amz-Algorithm=AWS4-HMAC-SHA256" in url
        assert "X-Amz-Credential=" in url
        assert "X-Amz-Signature=" in url
        assert "documents/user1/doc1/notes.pdf" in url
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_document_files_db_operations():
    """Test document_files table CRUD operations."""
    init_db()
    from backend.database import get_connection
    conn = get_connection()
    try:
        user_id = f"test_storage_user_{datetime.now(timezone.utc).timestamp()}"
        doc_id = f"test_storage_doc_{datetime.now(timezone.utc).timestamp()}"

        create_user(user_id=user_id, username=f"u_{user_id}", display_name="Storage User")
        create_document(user_id=user_id, doc_id=doc_id, filename="Test.pdf", file_type="pdf", status="completed")

        # Initially 0 usage
        usage = get_user_storage_usage(conn, user_id)
        assert usage == 0

        # Save record
        save_document_file_record(
            conn,
            document_id=doc_id,
            user_id=user_id,
            provider="s3",
            storage_key=f"documents/{user_id}/{doc_id}/Test.pdf",
            size=500000,
            mime="application/pdf",
            sha256="fakehash123"
        )

        record = get_document_file_record(conn, doc_id)
        assert record is not None
        assert record["size"] == 500000
        assert record["provider"] == "s3"

        usage_after = get_user_storage_usage(conn, user_id)
        assert usage_after == 500000

        # Delete record
        delete_document_file(conn, doc_id)
        assert get_document_file_record(conn, doc_id) is None
        assert get_user_storage_usage(conn, user_id) == 0
    finally:
        conn.close()


def test_file_url_and_reattach_api():
    """Test GET /api/documents/{id}/file-url and POST /api/documents/{id}/file."""
    client = TestClient(app)
    ts = int(datetime.now(timezone.utc).timestamp() * 1000)

    # Register user
    res = client.post("/api/auth/register", json={
        "username": f"user_fu_{ts}",
        "password": "ValidPassword123!",
        "confirm_password": "ValidPassword123!",
        "display_name": "File URL User"
    })
    assert res.status_code == 200
    user_id = res.json()["id"]
    token = res.cookies.get("access_token")

    # Create synthetic PDF and compute hash
    doc = fitz.open()
    p = doc.new_page()
    p.insert_text((50, 50), "Dijkstra's Algorithm finds shortest paths from a single source vertex.")
    pdf_bytes = doc.tobytes()
    doc.close()
    file_sha = hashlib.sha256(pdf_bytes).hexdigest()

    doc_id = f"doc_fu_{ts}"
    create_document(
        user_id=user_id,
        doc_id=doc_id,
        filename="ShortestPath.pdf",
        file_type="pdf",
        status="completed",
        file_hash=file_sha
    )
    save_concepts_and_relations(doc_id, [
        {"name": "Dijkstra's Algorithm", "definition": "Shortest path algorithm.", "importance": 3, "topic": "Graphs"}
    ])

    # 1. GET /api/documents/{doc_id}/file-url without server/S3 file -> provider='browser'
    res_url = client.get(f"/api/documents/{doc_id}/file-url", cookies={"access_token": token})
    assert res_url.status_code == 200
    data_url = res_url.json()
    assert data_url["provider"] in ("browser", "server")
    assert data_url["document_id"] == doc_id

    # 2. POST /api/documents/{doc_id}/file with wrong hash -> 400
    res_bad_upload = client.post(
        f"/api/documents/{doc_id}/file",
        files={"file": ("Wrong.pdf", b"Completely different content", "application/pdf")},
        cookies={"access_token": token}
    )
    assert res_bad_upload.status_code == 400

    # 3. POST /api/documents/{doc_id}/file with matching hash -> 200 & backfills concept source page!
    res_good_upload = client.post(
        f"/api/documents/{doc_id}/file",
        files={"file": ("ShortestPath.pdf", pdf_bytes, "application/pdf")},
        cookies={"access_token": token}
    )
    assert res_good_upload.status_code == 200
    assert res_good_upload.json()["status"] == "ok"
    assert res_good_upload.json()["concepts_verified"] == 1

    # Verify updated concepts in DB
    updated_concepts = get_concepts_by_document(doc_id)
    assert len(updated_concepts) == 1
    assert updated_concepts[0]["source_page"] == 1
    assert updated_concepts[0]["source_verified"] is True or updated_concepts[0]["source_verified"] == 1
    assert "dijkstra" in updated_concepts[0]["source_quote"].lower()
