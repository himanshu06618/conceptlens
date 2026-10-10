import re
import unicodedata
from typing import List

def normalize_unicode_and_quotes(text: str) -> str:
    """Normalizes unicode characters, smart quotes, dashes, and ligatures."""
    if not text:
        return ""
    # Standardize unicode decomposition/composition
    text = unicodedata.normalize("NFKC", text)
    
    # Replace common typographic characters with ASCII equivalents
    replacements = {
        "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
        "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"',
        "\u2014": " - ", "\u2013": " - ", "\u2015": " - ",
        "\u2026": "...",
        "\u00a0": " ", "\u200b": "", "\u200e": "", "\u200f": "",
        "\u2022": " - ", "\u25aa": " - ", "\u25cf": " - ", "\u25cb": " - "
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
        
    return text

def fix_hyphenated_breaks(text: str) -> str:
    """Rejoins words split by a hyphen at line breaks (e.g., 'wave-\\nfunction' -> 'wavefunction')."""
    if not text:
        return ""
    # Matches letters followed by hyphen, newline, optional whitespace, and continuing letters
    pattern = re.compile(r"([a-zA-Z]+)-\s*\r?\n\s*([a-zA-Z]+)")
    return pattern.sub(r"\1\2", text)

def remove_page_numbers(text: str) -> str:
    """Removes bare page numbers or patterns like 'Page 3 of 10' or '- 4 -' on isolated lines."""
    if not text:
        return ""
    # Lines with only digits, roman numerals, or 'Page X of Y' or '- X -'
    patterns = [
        r"(?im)^\s*(?:page\s+)?\d+(?:\s+(?:of|\/)\s+\d+)?\s*$",
        r"(?im)^\s*[-—]\s*\d+\s*[-—]\s*$",
        r"(?im)^\s*[ivxlcdm]+\s*$"
    ]
    cleaned = text
    for pat in patterns:
        cleaned = re.sub(pat, "", cleaned)
    return cleaned

def collapse_whitespace(text: str) -> str:
    """Collapses duplicate spaces and excessive empty lines, preserving paragraph breaks."""
    if not text:
        return ""
    # Normalize Windows line endings to \n
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Collapse multiple spaces or tabs on each line
    text = re.sub(r"[ \t]+", " ", text)
    # Strip space at line beginnings and endings
    lines = [line.strip() for line in text.split("\n")]
    text = "\n".join(lines)
    # Collapse 3 or more newlines into max 2 newlines (paragraph boundary)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

def remove_repeated_headers_footers(page_texts: List[str]) -> List[str]:
    """
    Identifies short lines that repeat across 3 or more pages at the very beginning
    or end of pages (typical running headers or footers) and removes them.
    """
    if len(page_texts) < 3:
        return page_texts

    first_lines = []
    last_lines = []
    for pt in page_texts:
        lines = [line.strip() for line in pt.split("\n") if line.strip()]
        if lines:
            if len(lines[0]) < 80:
                first_lines.append(lines[0])
            if len(lines[-1]) < 80:
                last_lines.append(lines[-1])

    def find_repeated(candidates: List[str]) -> set:
        counts = {}
        for c in candidates:
            counts[c] = counts.get(c, 0) + 1
        return {cand for cand, count in counts.items() if count >= max(2, len(page_texts) // 2)}

    repeated_headers = find_repeated(first_lines)
    repeated_footers = find_repeated(last_lines)
    to_remove = repeated_headers | repeated_footers

    if not to_remove:
        return page_texts

    cleaned_pages = []
    for pt in page_texts:
        lines = pt.split("\n")
        filtered = [l for l in lines if l.strip() not in to_remove]
        cleaned_pages.append("\n".join(filtered))

    return cleaned_pages

def remove_leader_dots(text: str) -> str:
    """Removes table-of-contents leader dots and dashes (e.g. 'Statement .................... 12')."""
    if not text:
        return ""
    text = re.sub(r"(?:\.\s*){2,}", " ", text)
    text = re.sub(r"(?:_\s*){2,}", " ", text)
    text = re.sub(r"(?:-\s*){3,}", " ", text)
    return text

def clean_text(text: str) -> str:
    """Comprehensive text cleaning pipeline for a single string."""
    if not text:
        return ""
    text = normalize_unicode_and_quotes(text)
    text = fix_hyphenated_breaks(text)
    text = remove_page_numbers(text)
    text = remove_leader_dots(text)
    text = collapse_whitespace(text)
    return text
