"""
test_precision_filter.py - Comprehensive unit tests for YAKE precision filter.
Tests all required cases:
- "the quantum tunnelling" becomes "Quantum Tunnelling"
- "Figure Shows", "According", and "Fig" are dropped
- "LED" and "Nd3+ ions" are kept
- "Principle Of Laser" is kept
- Generic rules, toggles (YAKE_PRECISION=on|off), and error safety
"""

import os
import pytest

try:
    from backend.precision_filter.filter import (
        filter_phrases,
        _clean_and_strip_phrase,
        _passes_rule2_drop_patterns,
        _passes_rule3_generic_words,
        format_title_casing
    )
    from backend.extractor_choice.yake_ex import YakeExtractor
except ImportError:
    from precision_filter.filter import (
        filter_phrases,
        _clean_and_strip_phrase,
        _passes_rule2_drop_patterns,
        _passes_rule3_generic_words,
        format_title_casing
    )
    from extractor_choice.yake_ex import YakeExtractor


DOCUMENT_TEXT = """
Introduction to Solid State Laser Technology.
Figure shows the experimental setup for stimulated emission.
According to the principle of laser, radiation is coherent.
Fig 1 shows the schematic of the resonator.
In modern physics, LED devices and Nd3+ ions are used widely.
The quantum tunnelling effect allows carrier transport through barriers.
The quantum tunnelling is a fundamental concept.
Principle of laser governs population inversion.
Light is incident on the semi-transparent mirror.
"""


def test_required_concept_transformations():
    """Verify specific test cases requested in requirements."""
    test_inputs = [
        ("the quantum tunnelling", 0.05),
        ("Figure Shows", 0.1),
        ("According", 0.12),
        ("Fig", 0.15),
        ("LED", 0.02),
        ("Nd3+ ions", 0.03),
        ("Principle Of Laser", 0.01),
        ("light is incident", 0.25)
    ]

    filtered = filter_phrases(test_inputs, DOCUMENT_TEXT)

    # 1. "the quantum tunnelling" becomes "Quantum Tunnelling"
    assert "Quantum Tunnelling" in filtered, f"Expected 'Quantum Tunnelling' in {filtered}"

    # 2. "Figure Shows", "According", and "Fig" are dropped
    assert "Figure Shows" not in filtered
    assert "According" not in filtered
    assert "Fig" not in filtered

    # 3. "LED" and "Nd3+ ions" are kept
    assert "LED" in filtered, f"Expected 'LED' in {filtered}"
    assert "Nd3+ ions" in filtered, f"Expected 'Nd3+ ions' in {filtered}"

    # 4. "Principle Of Laser" is kept
    assert "Principle Of Laser" in filtered, f"Expected 'Principle Of Laser' in {filtered}"

    # 5. Sentence fragment "light is incident" is dropped
    assert "light is incident" not in filtered


def test_rule1_cleaning_and_stripping():
    """Test leading/trailing stop words stripping, unicode dashes, and punctuation."""
    words = _clean_and_strip_phrase("— the of quantum tunnelling —")
    assert words == ["quantum", "tunnelling"]
    title = format_title_casing(words, raw_original="the quantum tunnelling")
    assert title == "Quantum Tunnelling"

    # Entirely stop words should be stripped to None
    assert _clean_and_strip_phrase("is of the in") is None


def test_rule2_drop_patterns():
    """Test dropping pure numbers, short words, ending verbs, and middle auxiliaries."""
    assert not _passes_rule2_drop_patterns("12345")
    assert not _passes_rule2_drop_patterns("2.718")
    assert not _passes_rule2_drop_patterns("no")  # < 3 chars, not acronym
    assert _passes_rule2_drop_patterns("AI")     # 2-char all-caps acronym kept
    assert _passes_rule2_drop_patterns("LED")    # 3-char all-caps acronym kept
    assert not _passes_rule2_drop_patterns("Figure Shows") # ends in common verb
    assert not _passes_rule2_drop_patterns("light is incident") # middle 'is'


def test_rule3_generic_words():
    """Test dropping single words from generic_words.json while keeping multi-word phrases."""
    generic_set = {"introduction", "advantages", "disadvantages", "according", "fig", "figure"}
    # Single word in list dropped
    assert not _passes_rule3_generic_words("According", generic_set)
    assert not _passes_rule3_generic_words("Fig", generic_set)
    assert not _passes_rule3_generic_words("Introduction", generic_set)
    # Multi-word containing generic word kept
    assert _passes_rule3_generic_words("Introduction To Algorithms", generic_set)
    assert _passes_rule3_generic_words("Advantages Of Optical Fibres", generic_set)


def test_rule5_redundancy_and_variants():
    """Test plural/hyphen variant merging and sub-phrase deduplication."""
    doc = (
        "Polarization of light. Polarization occurs in transverse waves. "
        "Linear Polarization is studied. Linear Polarization is important."
    )
    phrases = [
        ("Polarization", 0.05),
        ("Polarizations", 0.06),
        ("Linear Polarization", 0.02)
    ]
    res = filter_phrases(phrases, doc, config={"rule6_size_limit": False})
    # Should merge plural variant
    assert "Polarization" in res
    assert "Polarizations" not in res
    assert "Linear Polarization" in res


def test_never_raises_error():
    """Public function must never raise an error and return original list on issue."""
    assert filter_phrases([], "") == []
    assert filter_phrases(None, None) == []

    # Faulty inputs
    faulty = [("Test Concept", "not-a-float"), None, 123]
    out = filter_phrases(faulty, "")
    assert isinstance(out, list)


def test_yake_precision_env_switch(monkeypatch):
    """Verify YAKE_PRECISION=on|off switch behavior in YakeExtractor."""
    sample_text = (
        "According to figure shows, the quantum tunnelling and LED and Nd3+ ions "
        "illustrate the principle of laser in quantum mechanics."
    )
    extractor = YakeExtractor()

    # With YAKE_PRECISION=on (default)
    monkeypatch.setenv("YAKE_PRECISION", "on")
    res_on = extractor.extract(sample_text)
    assert "Figure Shows" not in res_on
    assert "According" not in res_on

    # With YAKE_PRECISION=off
    monkeypatch.setenv("YAKE_PRECISION", "off")
    res_off = extractor.extract(sample_text)
    assert isinstance(res_off, list)

