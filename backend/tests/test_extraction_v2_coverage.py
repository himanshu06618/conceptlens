import pytest
from pathlib import Path
from backend.services.layout_extractor import LayoutExtractor, BOILERPLATE_PATTERNS, compute_text_hash
from backend.services.extraction_v2 import ExtractionV2Pipeline
from backend.database import (
    init_db,
    save_document_page_coverage,
    get_document_page_coverage,
    get_document_coverage_summary,
    get_connection
)

def test_layout_extractor_boilerplate_patterns():
    # Test boilerplate patterns matching
    page_match = any(p.match("Page 4 of 60") for p in BOILERPLATE_PATTERNS)
    copyright_match = any(p.match("Copyright © 2026 University") for p in BOILERPLATE_PATTERNS)
    standalone_number = any(p.match("42") for p in BOILERPLATE_PATTERNS)
    content_match = any(p.match("Supervised learning uses labeled training datasets.") for p in BOILERPLATE_PATTERNS)

    assert page_match is True
    assert copyright_match is True
    assert standalone_number is True
    assert content_match is False

def test_compute_text_hash():
    h1 = compute_text_hash("Hello World")
    h2 = compute_text_hash("  Hello World  \n")
    h3 = compute_text_hash("Different Content")
    assert h1 == h2
    assert h1 != h3

def test_page_coverage_db_roundtrip():
    init_db()
    conn = get_connection()
    doc_id = "test-doc-cov-roundtrip"
    user_id = "test-user-cov-1"

    # Insert parent document to satisfy foreign key
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO documents (id, user_id, filename, file_type, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, user_id, "test.pdf", "pdf", "completed", "2026-10-17")
        )

    # Save coverage records
    records = [
        {
            "document_id": doc_id,
            "user_id": user_id,
            "page": 1,
            "page_type": "title",
            "text_chars": 80,
            "status": "empty_ok",
            "concepts_count": 0,
            "error": "title slide"
        },
        {
            "document_id": doc_id,
            "user_id": user_id,
            "page": 2,
            "page_type": "content",
            "text_chars": 450,
            "status": "done",
            "concepts_count": 4,
            "error": None
        },
        {
            "document_id": doc_id,
            "user_id": user_id,
            "page": 3,
            "page_type": "low_text",
            "text_chars": 15,
            "status": "low_text",
            "concepts_count": 0,
            "error": "scanned or low text page"
        }
    ]

    save_document_page_coverage(doc_id, records)

    # Fetch coverage records
    fetched = get_document_page_coverage(doc_id)
    assert len(fetched) == 3
    assert fetched[0]["page"] == 1
    assert fetched[0]["status"] == "empty_ok"
    assert fetched[1]["concepts_count"] == 4

    # Fetch summary
    summary = get_document_coverage_summary(doc_id)
    assert summary["total_pages"] == 3
    assert summary["processed_pages"] == 3
    assert summary["pages_with_concepts"] == 1
    assert summary["pages_skipped"] == 1
    assert summary["pages_needing_attention"] == 1

def test_extraction_v2_code_fallback():
    from backend.services.layout_extractor import LayoutAwarePage
    pipeline = ExtractionV2Pipeline(api_key=None)

    page = LayoutAwarePage(
        page_num=1,
        raw_text="Gradient Descent is an optimization algorithm that minimizes the loss function. Learning Rate controls step size.",
        cleaned_text="Gradient Descent is an optimization algorithm that minimizes the loss function. Learning Rate controls step size.",
        title="Optimization Basics",
        page_type="content",
        headings=["Gradient Descent", "Learning Rate"],
        text_hash="abc12345",
        char_count=114
    )

    res = pipeline._extract_page_code_only(page)
    assert res["page"] == 1
    assert res["page_type"] == "content"
    concepts = res["concepts"]
    assert len(concepts) > 0
    # Every concept must have valid definition and quote
    for c in concepts:
        assert "educational concept relating to" not in c["definition_from_text"].lower()
        assert c["quote"] != ""
