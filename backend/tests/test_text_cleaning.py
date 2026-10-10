import pytest
from backend.services.text_cleaning import (
    clean_text,
    fix_hyphenated_breaks,
    remove_page_numbers,
    collapse_whitespace,
    normalize_unicode_and_quotes
)

def test_fix_hyphenated_breaks():
    raw = "The wave-\nfunction collapsed after measurement."
    fixed = fix_hyphenated_breaks(raw)
    assert "wavefunction" in fixed

    raw_crlf = "Inter-\r\nnational physics conference."
    fixed_crlf = fix_hyphenated_breaks(raw_crlf)
    assert "International" in fixed_crlf

def test_remove_page_numbers():
    text = "Introduction to Mechanics\n42\nThe motion of particles.\nPage 5 of 12\nNext line."
    cleaned = remove_page_numbers(text)
    assert "42" not in cleaned
    assert "Page 5 of 12" not in cleaned
    assert "Introduction to Mechanics" in cleaned
    assert "The motion of particles." in cleaned

def test_collapse_whitespace():
    text = "Here   are    multiple     spaces.\n\n\n\nAnd excessive empty lines."
    cleaned = collapse_whitespace(text)
    assert "multiple spaces." in cleaned
    assert "\n\n\n" not in cleaned
    assert "\n\nAnd excessive" in cleaned

def test_normalize_unicode_and_quotes():
    text = "\u201cQuantum\u201d mechanics \u2014 \u2018Schr\u00f6dinger\u2019"
    norm = normalize_unicode_and_quotes(text)
    assert '"Quantum"' in norm
    assert "'Schrödinger'" in norm or "'Schrodinger'" in norm

def test_clean_text_end_to_end():
    text = """
    Lecture 1: Quantum Foundations
    
    1
    
    In this sec-\n    tion, we discuss   the   basic pos-\ntulates.
    
    
    Page 1 of 10
    """
    cleaned = clean_text(text)
    assert "section" in cleaned
    assert "postulates" in cleaned
    assert "Page 1 of 10" not in cleaned
    assert "1" not in cleaned.split()
