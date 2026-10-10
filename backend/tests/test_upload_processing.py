import os
import io
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

os.environ["DATABASE_PATH"] = "test_upload.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test_secret_for_upload_test_1234567890"
os.environ["RATE_LIMIT_ENABLED"] = "false"

from backend.main import app, process_document_background
from backend.database import init_db, get_connection, get_document_by_id, get_concepts_by_document
from backend.routers.auth import limiter

@pytest.fixture(autouse=True)
def clean_db():
    limiter.enabled = False
    init_db()
    conn = get_connection()
    with conn:
        conn.execute("DELETE FROM relations;")
        conn.execute("DELETE FROM concepts;")
        conn.execute("DELETE FROM documents;")
        conn.execute("DELETE FROM users;")
    conn.close()
    yield

def test_document_upload_and_background_processing():
    client = TestClient(app)
    sample_text = (
        "Supervised Learning is a category of machine learning where models are trained on labeled data. "
        "A Neural Network is a computational model inspired by the biological neural networks in animal brains. "
        "Backpropagation is an algorithm used for training feedforward neural networks."
    ).encode("utf-8")

    # Upload document as guest
    res = client.post(
        "/api/documents",
        files={"file": ("ml_notes.txt", io.BytesIO(sample_text), "text/plain")}
    )
    assert res.status_code == 200
    data = res.json()
    doc_id = data["id"]
    guest_cookie = res.cookies.get("guest_id")

    # In TestClient, BackgroundTasks may run synchronously with the request context
    # Let's inspect the document state
    cookies = {"guest_id": guest_cookie} if guest_cookie else {}
    doc_res = client.get(f"/api/documents/{doc_id}", cookies=cookies)
    assert doc_res.status_code == 200
    doc_data = doc_res.json()
    
    # Verify no 'Depends' error occurred
    assert doc_data.get("error") is None or "Depends" not in str(doc_data.get("error"))
    assert doc_data["status"] == "completed"
    assert doc_data["concept_count"] > 0

    # Verify concepts endpoint works
    concepts_res = client.get(f"/api/documents/{doc_id}/concepts", cookies=cookies)
    assert concepts_res.status_code == 200
    concepts_data = concepts_res.json()
    assert concepts_data["total_concepts"] > 0
