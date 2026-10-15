"""
backend/services/source_locator.py
Lightweight code-based locator using PyMuPDF (fitz) to map concepts to exact physical PDF pages.
Processes PDFs page-by-page to keep peak memory minimal (<512 MB constraint).
Never invents pages: if no text layer exists (scanned notes) or no match is found, leaves source_page empty.
"""

import io
import re
import logging
from typing import Dict, List, Any, Optional, Union
from pathlib import Path
import pymupdf as fitz

logger = logging.getLogger("conceptlens.locator")

STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at",
    "by", "for", "with", "about", "against", "between", "into", "through",
    "during", "before", "after", "above", "below", "to", "from", "up", "down",
    "in", "out", "on", "off", "over", "under", "again", "further", "once",
    "here", "there", "all", "any", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so",
    "than", "too", "very", "s", "t", "can", "will", "just", "don", "should",
    "now", "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "having", "do", "does", "did", "doing", "would", "could", "this",
    "that", "these", "those", "it", "its", "which", "what", "whose", "whom"
}

def normalize_text_for_matching(text: str) -> str:
    """Normalizes whitespace and removes punctuation for robust text matching."""
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def extract_definition_keywords(definition: str) -> List[str]:
    """Extracts distinctive educational keywords from a definition string."""
    if not definition:
        return []
    words = re.findall(r"\b[A-Za-z0-9_-]{4,}\b", definition.lower())
    return [w for w in words if w not in STOP_WORDS]

def find_evidence_snippet(raw_page_text: str, match_term: str, max_chars: int = 240) -> str:
    """Finds a neat sentence or excerpt containing the match term on the raw page."""
    if not raw_page_text or not match_term:
        return ""
    
    # Try finding sentence containing match term
    pattern = re.compile(rf"([^.\n]*?{re.escape(match_term)}[^.\n]*\.?)", re.IGNORECASE)
    m = pattern.search(raw_page_text)
    if m:
        snippet = re.sub(r"\s+", " ", m.group(1)).strip()
        if len(snippet) <= max_chars:
            return snippet
        # If too long, center around match
        start = max(0, m.start() - 40)
        end = min(len(raw_page_text), m.end() + 100)
        trimmed = raw_page_text[start:end].strip()
        return "…" + re.sub(r"\s+", " ", trimmed) + "…"

    # Fallback: substring around match
    idx = raw_page_text.lower().find(match_term.lower())
    if idx != -1:
        start = max(0, idx - 40)
        end = min(len(raw_page_text), idx + len(match_term) + 120)
        snippet = raw_page_text[start:end].strip()
        return re.sub(r"\s+", " ", snippet)
    
    return ""

def locate_concepts_in_pdf(
    pdf_source: Union[bytes, str, Path],
    concepts: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Locates concepts in a PDF document page-by-page.
    Updates concepts in-place with:
      - source_page (1-based int or None)
      - source_quote (str)
      - source_verified (bool)
    """
    if not concepts:
        return concepts

    doc = None
    try:
        if isinstance(pdf_source, bytes):
            doc = fitz.open(stream=pdf_source, filetype="pdf")
        else:
            doc = fitz.open(str(pdf_source))

        page_count = len(doc)
        if page_count == 0:
            return concepts

        # Check if the PDF has a usable digital text layer
        # Process page by page to conserve RAM
        page_texts: List[str] = []
        page_norm_texts: List[str] = []
        total_usable_chars = 0

        for p_idx in range(page_count):
            page = doc[p_idx]
            raw_text = page.get_text("text") or ""
            page_texts.append(raw_text)
            norm_text = normalize_text_for_matching(raw_text)
            page_norm_texts.append(norm_text)
            total_usable_chars += len(norm_text)
            page = None  # Release page memory immediately

        # If entire document has almost no extractable text, it is scanned / handwritten
        if total_usable_chars < 50:
            logger.info("PDF has no usable text layer (scanned or image-only). Source links left empty.")
            for c in concepts:
                if not c.get("source_verified"):
                    c["source_page"] = None
                    c["source_quote"] = ""
                    c["source_verified"] = False
            return concepts

        # Match concepts against pages
        for c in concepts:
            name = c.get("name", "").strip()
            norm_name = normalize_text_for_matching(name)
            def_text = c.get("definition", "").strip()
            keywords = extract_definition_keywords(def_text)

            model_page = c.get("source_page") or c.get("page")
            model_quote = (c.get("source_quote") or c.get("source_excerpt") or "").strip()

            verified = False
            matched_page = None
            evidence_quote = ""

            # 1. First verify model-provided page & quote if present
            if model_page and isinstance(model_page, int) and 1 <= model_page <= page_count:
                target_p_idx = model_page - 1
                p_norm = page_norm_texts[target_p_idx]
                p_raw = page_texts[target_p_idx]

                # Check if model quote or concept name matches on this page
                if model_quote and len(model_quote) >= 15:
                    norm_quote = normalize_text_for_matching(model_quote)
                    # Substring or 60% words match on specified page
                    if norm_quote in p_norm or (len(norm_quote) > 30 and norm_quote[:30] in p_norm):
                        verified = True
                        matched_page = model_page
                        evidence_quote = model_quote
                
                if not verified and norm_name and norm_name in p_norm:
                    verified = True
                    matched_page = model_page
                    evidence_quote = find_evidence_snippet(p_raw, name) or model_quote

            # 2. If not verified, search across all pages page-by-page
            if not verified and norm_name:
                best_score = 0
                best_page_idx = -1
                best_snippet = ""

                for p_idx in range(page_count):
                    p_norm = page_norm_texts[p_idx]
                    p_raw = page_texts[p_idx]
                    if not p_norm:
                        continue

                    score = 0
                    # Exact concept name matching with word boundaries
                    name_pattern = rf"\b{re.escape(norm_name)}\b"
                    name_matches = len(re.findall(name_pattern, p_norm))
                    if name_matches > 0:
                        score += 25 + min(15, name_matches * 5)

                    # Definition keyword overlap
                    kw_matches = sum(1 for kw in keywords if re.search(rf"\b{re.escape(kw)}\b", p_norm))
                    score += kw_matches * 3

                    # Check model quote presence
                    if model_quote and len(model_quote) >= 15:
                        norm_quote = normalize_text_for_matching(model_quote)
                        if norm_quote[:25] in p_norm:
                            score += 40

                    if score > best_score:
                        best_score = score
                        best_page_idx = p_idx
                        snippet = find_evidence_snippet(p_raw, name)
                        best_snippet = snippet

                # Score threshold for confidence
                if best_score >= 20 and best_page_idx >= 0:
                    matched_page = best_page_idx + 1
                    evidence_quote = best_snippet or model_quote
                    verified = True

            if verified and matched_page:
                c["source_page"] = matched_page
                c["source_quote"] = evidence_quote[:300].strip()
                c["source_verified"] = True
            else:
                # Never invent a page: leave empty
                c["source_page"] = None
                c["source_quote"] = ""
                c["source_verified"] = False

        return concepts

    except Exception as e:
        logger.warning(f"Error locating concepts in PDF: {e}")
        return concepts
    finally:
        if doc:
            try:
                doc.close()
            except Exception:
                pass


def locate_concepts_in_text(
    text_content: str,
    concepts: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Locates concepts in plain text or Markdown notes (page 1 by definition)."""
    norm_full = normalize_text_for_matching(text_content)
    for c in concepts:
        name = c.get("name", "").strip()
        norm_name = normalize_text_for_matching(name)
        if norm_name and norm_name in norm_full:
            c["source_page"] = 1
            snippet = find_evidence_snippet(text_content, name)
            c["source_quote"] = (snippet or c.get("definition", ""))[:300]
            c["source_verified"] = True
        else:
            c["source_page"] = 1
            c["source_quote"] = (c.get("definition") or "")[:200]
            c["source_verified"] = False
    return concepts


def locate_concepts_in_document(
    file_bytes_or_path: Union[bytes, str, Path],
    filename: str,
    concepts: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Dispatches to PDF or text locator based on filename extension."""
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return locate_concepts_in_pdf(file_bytes_or_path, concepts)
    elif ext in {".txt", ".md"}:
        if isinstance(file_bytes_or_path, bytes):
            text = file_bytes_or_path.decode("utf-8", errors="replace")
        else:
            text = Path(file_bytes_or_path).read_text(encoding="utf-8", errors="replace")
        return locate_concepts_in_text(text, concepts)
    else:
        # Images or unsupported formats
        for c in concepts:
            c["source_page"] = 1
            c["source_quote"] = c.get("source_excerpt", "")[:200]
            c["source_verified"] = False
        return concepts
