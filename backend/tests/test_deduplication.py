import pytest
import spacy
from backend.services.concept_extraction import deduplicate_concepts, normalize_phrase

@pytest.fixture(scope="module")
def nlp():
    return spacy.load("en_core_web_sm")

def test_deduplicate_singular_and_plural(nlp):
    candidates = [
        {
            "name": "wave functions",
            "score": 0.82,
            "frequency": 3,
            "definition": "Wave functions describe quantum states.",
            "source_excerpt": "Wave functions describe quantum states.",
            "chunk_ids": [1, 2],
            "topic": "Quantum",
            "page": 1
        },
        {
            "name": "wave function",
            "score": 0.88,
            "frequency": 6,
            "definition": "The wave function is a mathematical description.",
            "source_excerpt": "The wave function is a mathematical description.",
            "chunk_ids": [1],
            "topic": "Quantum",
            "page": 1
        }
    ]

    deduped = deduplicate_concepts(candidates, nlp)
    assert len(deduped) == 1
    # Most frequent surface form should be "wave function" (frequency 6 vs 3)
    assert deduped[0]["name"] == "wave function"
    assert deduped[0]["frequency"] == 9
    assert deduped[0]["score"] == 0.88

def test_normalize_phrase():
    assert normalize_phrase("   Entropy!  ") == "entropy"
    assert normalize_phrase("“Kinetic Energy”") == "kinetic energy"
