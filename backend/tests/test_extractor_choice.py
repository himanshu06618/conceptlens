"""
test_extractor_choice.py - Tests for the pluggable Extractor Choice module.
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.extractor_choice.registry import available, is_available, get_extractor
from backend.extractor_choice.service import run_extraction
from backend.extractor_choice.base import clean_phrases

SAMPLE_COURSE_NOTE = """
Quantum Mechanics Study Notes
Chapter 1: Foundational Principles

1. Wave-Particle Duality
Wave-particle duality is the fundamental postulate that all physical matter and energy exhibits properties of both waves and classical particles. Light displays wave interference patterns in the double-slit experiment, yet transfers momentum as discrete photons.

2. The Wave Function
The wave function is a complex-valued probability amplitude describing the quantum state of an isolated physical system. The square of its absolute magnitude yields the spatial probability density for discovering a particle.

3. The Schrödinger Equation
The Schrödinger equation is the core partial differential equation that governs the continuous deterministic time evolution of a quantum mechanical wave function.

4. Heisenberg Uncertainty Principle
The uncertainty principle is the mathematical constraint stating that canonical conjugate variables, such as momentum and spatial position, cannot be simultaneously determined with arbitrary precision.
"""


@pytest.fixture
def sample_note_file():
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write(SAMPLE_COURSE_NOTE)
        f_path = Path(f.name)
    yield f_path
    if f_path.exists():
        f_path.unlink()


@pytest.fixture
def sample_image_file():
    with tempfile.NamedTemporaryFile("wb", suffix=".png", delete=False) as f:
        f.write(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4")
        f_path = Path(f.name)
    yield f_path
    if f_path.exists():
        f_path.unlink()


def test_registry_availability():
    avail = available()
    assert isinstance(avail, dict)
    assert avail.get("gemini") is True
    assert "yake" in avail
    assert "rake_textrank" in avail


def test_clean_phrases():
    raw = ["   Quantum Mechanics!  ", "QUANTUM MECHANICS", "12345", "a", "The Schrödinger Equation.", "wave-particle duality"]
    cleaned = clean_phrases(raw)
    assert "quantum mechanics" in cleaned
    assert len([p for p in cleaned if p == "quantum mechanics"]) == 1  # deduped
    assert "12345" not in cleaned  # drop pure numbers
    assert "a" not in cleaned  # drop single-character
    assert "the schrödinger equation" in cleaned


def test_gemini_returns_none(sample_note_file):
    # Gemini method returns None so existing flow runs untouched
    res = run_extraction(sample_note_file, "gemini")
    assert res is None


def test_yake_extraction(sample_note_file):
    res = run_extraction(sample_note_file, "yake")
    assert res is not None
    assert res.get("fallback") is False
    assert res.get("extractor_used") == "yake"
    concepts = res.get("concepts", [])
    assert len(concepts) > 0
    # Field verification: never invent data
    for c in concepts:
        assert c["name"]
        assert c["definition"] is None
        assert c["definition_cue"] is None
        assert c["aliases"] == []
        assert c["relations"] == []


def test_rake_textrank_extraction(sample_note_file):
    res = run_extraction(sample_note_file, "rake_textrank")
    assert res is not None
    assert res.get("fallback") is False
    assert res.get("extractor_used") == "rake_textrank"
    concepts = res.get("concepts", [])
    assert len(concepts) > 0
    for c in concepts:
        assert c["name"]
        assert c["definition"] is None
        assert c["relations"] == []


def test_image_fallback_to_gemini(sample_image_file):
    res = run_extraction(sample_image_file, "yake")
    assert res is not None
    assert res.get("fallback") is True
    assert "Image files have no text layer" in res.get("fallback_reason", "")


def test_unknown_extractor_fallback(sample_note_file):
    res = run_extraction(sample_note_file, "non_existent_extractor")
    assert res is None  # Unknown methods return None to proceed with Gemini


def test_simulated_missing_library_fallback(sample_note_file):
    with patch("backend.extractor_choice.service.is_available", return_value=False):
        res = run_extraction(sample_note_file, "yake")
        assert res is not None
        assert res.get("fallback") is True
        assert "not installed or available" in res.get("fallback_reason", "")


def test_api_extractors_endpoint():
    client = TestClient(app)

    # 1. Flag OFF -> returns 404
    with patch.dict(os.environ, {"ENABLE_EXTRACTOR_CHOICE": "false"}):
        resp = client.get("/api/extractors")
        assert resp.status_code == 404

    # 2. Flag ON -> returns 200 with dictionary
    with patch.dict(os.environ, {"ENABLE_EXTRACTOR_CHOICE": "true"}):
        resp = client.get("/api/extractors")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("gemini") is True
        assert "yake" in data


def test_yake_multi_page_pdf_extraction():
    """
    Verifies that YAKE extracts concepts across all pages of a multi-page PDF,
    yielding > 30 concepts, proper page attribution, and complete page coverage.
    """
    pdf_path = Path("samples/sample_text_50p.pdf")
    if not pdf_path.exists():
        pytest.skip("sample_text_50p.pdf not found")

    res = run_extraction(pdf_path, "yake")
    assert res is not None
    assert res.get("fallback") is False
    assert res.get("extractor_used") == "yake"

    concepts = res.get("concepts", [])
    # 1. Must extract substantially more than the old hardcoded 30 concepts
    assert len(concepts) > 30, f"Expected > 30 concepts, got {len(concepts)}"

    # 2. Must span multiple distinct pages (not just Page 1)
    distinct_pages = {c.get("page") for c in concepts}
    assert len(distinct_pages) > 1, f"Expected multiple pages, got {distinct_pages}"

    # 3. Must generate page coverage audit records for all pages
    coverage = res.get("page_coverage", [])
    assert len(coverage) >= 50, f"Expected coverage for >= 50 pages, got {len(coverage)}"

    # 4. Each concept must have valid pages list and quotes
    for c in concepts[:20]:
        assert c["name"]
        assert isinstance(c.get("pages"), list) and len(c["pages"]) > 0
        assert c.get("source_page") is not None
        assert c["definition"] is None
        assert c["aliases"] == []


def test_yake_single_page_coverage(sample_note_file):
    """Verifies that single-page text files produce valid page coverage."""
    res = run_extraction(sample_note_file, "yake")
    assert res is not None
    assert res.get("fallback") is False
    assert "page_coverage" in res
    coverage = res["page_coverage"]
    assert len(coverage) == 1
    assert coverage[0]["page"] == 1
    assert coverage[0]["status"] == "done"

