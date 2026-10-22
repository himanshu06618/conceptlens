"""
backend/tests/test_definitions_extraction_and_rag.py
Tests verifying exact definition extraction, cue detection, alias capture,
and Ask-your-notes answers with source sentence evidence.
"""

import pytest
from backend.services.extraction_v2 import extract_definition_metadata
from backend.services.definitions_lookup import (
    parse_definition_question,
    lookup_stored_definitions,
    format_natural_definition_answer,
    answer_definition_question_if_matched
)
from backend.database import (
    init_db,
    get_connection,
    get_concepts_by_document
)

SAMPLE_NOTES = (
    "Entropy is defined as a measure of disorder.\n"
    "A qubit is also known as a quantum bit.\n"
    "A shift in wavelength toward the red end is called redshift.\n"
)

def test_pattern_and_heuristic_extraction():
    """Verify regex and heuristic definition extraction for required cue phrases."""
    # 1. Entropy
    meta_entropy = extract_definition_metadata("Entropy", SAMPLE_NOTES)
    assert meta_entropy["definition"] is not None
    assert "measure of disorder" in meta_entropy["definition"].lower()
    assert meta_entropy["definition_cue"] == "defined_as"
    assert "Entropy is defined as a measure of disorder" in meta_entropy["source_sentence"]

    # 2. Qubit / Quantum Bit
    meta_qubit = extract_definition_metadata("qubit", SAMPLE_NOTES)
    assert meta_qubit["definition_cue"] in ("known_as", "other") or "quantum bit" in meta_qubit.get("aliases", [])
    assert "qubit is also known as a quantum bit" in meta_qubit["source_sentence"].lower()

    # 3. Redshift (Reverse pattern "X is called Y")
    meta_redshift = extract_definition_metadata("redshift", SAMPLE_NOTES)
    assert meta_redshift["definition"] is not None
    assert "shift in wavelength toward the red end" in meta_redshift["definition"].lower()
    assert meta_redshift["definition_cue"] == "called"
    assert "called redshift" in meta_redshift["source_sentence"].lower()

def test_parse_definition_questions():
    """Verify various question styles are accurately parsed to target terms."""
    # Standard styles: "what is X"
    term, q_type, cue = parse_definition_question("what is entropy?")
    assert term == "entropy"
    assert q_type == "definition_query"

    # "define X"
    term, q_type, cue = parse_definition_question("define qubit")
    assert term == "qubit"
    assert q_type == "definition_query"

    # "meaning of X"
    term, q_type, cue = parse_definition_question("meaning of redshift")
    assert term == "redshift"
    assert q_type == "definition_query"

    # "what do you mean by X"
    term, q_type, cue = parse_definition_question("what do you mean by entropy")
    assert term == "entropy"
    assert q_type == "definition_query"

    # Hindi / Hinglish query: "X kya hota hai"
    term, q_type, cue = parse_definition_question("entropy kya hota hai")
    assert term == "entropy"
    assert q_type == "definition_query"

    # Reverse lookup: "what is called Y"
    term, q_type, cue = parse_definition_question("what is called quantum bit")
    assert term == "quantum bit"
    assert q_type == "reverse_lookup"
    assert cue == "called"

    # Reverse lookup: "which term means Y"
    term, q_type, cue = parse_definition_question("which term means a measure of disorder")
    assert term in ("a measure of disorder", "measure of disorder")
    assert q_type == "reverse_lookup"
    assert cue == "means"

def test_ask_your_notes_with_stored_definitions():
    """Verify lookup_stored_definitions finds terms and generates natural answers with evidence."""
    stored_concepts = [
        {
            "id": 1,
            "document_id": "doc_123",
            "name": "Entropy",
            "definition": "a measure of disorder",
            "definition_cue": "defined_as",
            "aliases": [],
            "source_sentence": "Entropy is defined as a measure of disorder.",
            "source_page": 1,
            "filename": "Physics Notes.pdf"
        },
        {
            "id": 2,
            "document_id": "doc_123",
            "name": "Qubit",
            "definition": "a quantum bit",
            "definition_cue": "known_as",
            "aliases": ["quantum bit"],
            "source_sentence": "A qubit is also known as a quantum bit.",
            "source_page": 2,
            "filename": "Quantum Notes.pdf"
        },
        {
            "id": 3,
            "document_id": "doc_123",
            "name": "Redshift",
            "definition": "A shift in wavelength toward the red end",
            "definition_cue": "called",
            "aliases": [],
            "source_sentence": "A shift in wavelength toward the red end is called redshift.",
            "source_page": 3,
            "filename": "Astrophysics Notes.pdf"
        }
    ]

    # Test "what is entropy"
    res_entropy = answer_definition_question_if_matched("what is entropy", stored_concepts)
    assert res_entropy is not None
    answer_text = res_entropy["answer"]
    assert "Entropy is defined as a measure of disorder" in answer_text
    assert "Entropy is defined as a measure of disorder." in res_entropy["source_sentence"]
    assert len(res_entropy["citations"]) > 0

    # Test "define qubit"
    res_qubit = answer_definition_question_if_matched("define qubit", stored_concepts)
    assert res_qubit is not None
    assert "Qubit is also known as" in res_qubit["answer"] or "quantum bit" in res_qubit["answer"]
    assert "A qubit is also known as a quantum bit." in res_qubit["source_sentence"]

    # Test reverse lookup "what is called quantum bit"
    res_rev = answer_definition_question_if_matched("what is called quantum bit", stored_concepts)
    assert res_rev is not None
    assert "Qubit" in res_rev["answer"]

def test_concept_with_no_explicit_definition():
    """Concepts with definition=None must NOT match as an explicit definition in notes."""
    stored_concepts = [
        {
            "id": 4,
            "document_id": "doc_123",
            "name": "Dark Matter",
            "definition": None,
            "definition_cue": None,
            "aliases": [],
            "source_sentence": None,
            "source_page": 5,
            "filename": "Cosmology Notes.pdf"
        }
    ]

    res = answer_definition_question_if_matched("what is dark matter", stored_concepts)
    assert res is None  # Returns None so RAG pipeline routes to general notes answer and adds label

def test_backward_compatibility_old_notes():
    """Verify old notes in database with NULL definitions load normally."""
    init_db()
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM concepts WHERE document_id = 'doc_old_test'")
            conn.execute("DELETE FROM documents WHERE id = 'doc_old_test'")
            conn.execute(
                """
                INSERT INTO documents (id, user_id, filename, file_type, status, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                """,
                ("doc_old_test", "guest", "old_lecture.pdf", "pdf", "completed")
            )
            # Insert row simulating pre-definitions schema (definition_cue, aliases_json, source_sentence, location null)
            conn.execute(
                """
                INSERT INTO concepts (document_id, name, definition, importance, chapter, estimated_minutes, score, source_excerpt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                ("doc_old_test", "Classical Mechanics", None, 2, "Physics I", 10, 1.0, "Classical mechanics deals with motion.")
            )
        
        # Fetch using get_concepts_by_document
        concepts = get_concepts_by_document("doc_old_test")
        assert len(concepts) == 1
        c = concepts[0]
        assert c["name"] == "Classical Mechanics"
        assert c.get("definition") is None
        assert c.get("definition_cue") is None
        assert c.get("aliases") == []
        assert c.get("source_sentence") is None
        assert c.get("location") is None
    finally:
        with conn:
            conn.execute("DELETE FROM concepts WHERE document_id = 'doc_old_test'")
            conn.execute("DELETE FROM documents WHERE id = 'doc_old_test'")
        conn.close()
