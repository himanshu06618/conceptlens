"""
service.py - Orchestrates extraction execution for pluggable methods.
Handles reading document text, invoking the chosen extractor, formatting concepts,
and falling back to Gemini if extraction fails.
"""

import logging
import logging
import re
from pathlib import Path
from typing import Dict, Any, Optional, Union, List, Tuple

from .registry import is_available, get_extractor
from .text_reader import read_pages_from_file, clean_text_layer
from .base import clean_phrase, is_valid_phrase

logger = logging.getLogger("conceptlens.extractor.service")

SUPPORTED_LOCAL_METHODS = {"yake", "rake_textrank"}


def _format_concept_item(
    phrase: str,
    index: int,
    page: int = 1,
    source_page: Optional[int] = None,
    pages: Optional[List[int]] = None,
    topic: str = "General",
    chapter: str = "General",
    score: float = 0.5,
    importance: int = 2,
    source_sentence: Optional[str] = None,
    source_quote: str = "",
    source_excerpt: str = "",
    source_verified: bool = False
) -> Dict[str, Any]:
    """
    Converts an extracted phrase into the exact concept format used by ConceptLens.
    Never invents data: definition, aliases, cues, and relations are set to null or empty.
    Preserves genuine page numbers, excerpts, quotes, and topics.
    """
    clean_title = phrase.strip().title()
    sp = int(source_page or page)
    p_num = int(page)
    pages_list = sorted(list(set([p for p in (pages or [p_num]) if isinstance(p, int)]))) or [p_num]
    excerpt = source_excerpt or source_quote
    return {
        "id": f"c_{index + 1}",
        "name": clean_title,
        "definition": None,
        "definition_cue": None,
        "aliases": [],
        "source_sentence": source_sentence or (source_quote if source_quote else None),
        "location": str(sp),
        "topic": topic or "General",
        "chapter": chapter or "General",
        "score": float(score),
        "importance": int(importance),
        "source_excerpt": excerpt,
        "page": p_num,
        "source_page": sp,
        "pages": pages_list,
        "source_quote": source_quote,
        "source_verified": bool(source_verified),
        "relations": [],
        "related_concepts": []
    }


def run_extraction(
    file: Union[str, Path],
    method: Optional[str] = "gemini",
    pdf_password: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Executes concept extraction for the requested method.

    Behavior:
    (a) Returns None immediately when method is 'gemini' or unknown,
        so the existing Gemini flow runs completely untouched.
    (b) For other methods (yake, rake_textrank):
        - Validates library availability.
        - Reads page-by-page text from file via PyMuPDF or plain text reader.
        - Runs extractor across each page to ensure complete document coverage.
        - Generates page coverage audit records for all pages.
        - Deduplicates concepts while recording all page occurrences (`pages: [...]`).
        - Converts phrases into the standard ConceptLens concept schema.
        - Returns {'concepts': [...], 'extractor_used': method, 'page_coverage': [...], 'fallback': False}.
    (c) On any failure (missing library, scanned PDF / no text layer, empty extraction result),
        returns {'fallback': True, 'fallback_reason': '...'} so caller falls back to Gemini.
    """
    if not method:
        return None

    clean_method = method.strip().lower()

    # (a) Gemini or unknown method: return None so existing pipeline proceeds untouched
    if clean_method == "gemini" or clean_method not in SUPPORTED_LOCAL_METHODS:
        return None

    # (b) Check if requested method is installed and registered
    if not is_available(clean_method):
        logger.warning(f"Requested extractor '{clean_method}' is not available.")
        return {
            "fallback": True,
            "fallback_reason": f"Extractor '{clean_method}' is not installed or available."
        }

    # (c) Read document pages
    try:
        pages, fallback_reason = read_pages_from_file(file, pdf_password=pdf_password)
    except Exception as e:
        logger.warning(f"Error reading document for extractor '{clean_method}': {e}")
        return {
            "fallback": True,
            "fallback_reason": f"Could not read document text: {e}"
        }

    if pages is None or not pages:
        return {
            "fallback": True,
            "fallback_reason": fallback_reason or "Document contains no extractable text layer."
        }

    # (d) Instantiate extractor and run extraction
    extractor = get_extractor(clean_method)
    if not extractor:
        return {
            "fallback": True,
            "fallback_reason": f"Could not initialize extractor '{clean_method}'."
        }

    page_coverage_records: List[Dict[str, Any]] = []
    candidates_by_name: Dict[str, Dict[str, Any]] = {}

    # (e) Page-by-page extraction loop
    for page_info in pages:
        p_num = int(page_info.get("page", 1))
        p_text = str(page_info.get("text", "")).strip()
        p_title = str(page_info.get("title", "")).strip() or f"Page {p_num}"
        p_headings = page_info.get("headings", [])
        is_usable = bool(page_info.get("is_usable", True)) and len(p_text) >= 20

        if not is_usable:
            page_coverage_records.append({
                "page": p_num,
                "page_type": "non_content" if len(p_text) < 20 else "low_text",
                "status": "empty_ok",
                "concepts_count": 0,
                "extracted_terms": [],
                "char_count": len(p_text)
            })
            continue

        page_phrases: List[Tuple[str, float]] = []
        try:
            if hasattr(extractor, "extract_with_scores") and clean_method == "yake":
                # Extract top keywords on this page
                page_phrases = extractor.extract_with_scores(p_text, top=16)
            else:
                raw_phrases = extractor.extract(p_text)
                page_phrases = [(p, 0.2) for p in raw_phrases[:16]]
        except Exception as e_page:
            logger.warning(f"Error extracting page {p_num} with '{clean_method}': {e_page}")
            page_phrases = []

        # Also incorporate any valid section headings on this page
        for h in p_headings:
            clean_h = clean_phrase(h)
            if is_valid_phrase(clean_h) and 1 <= len(clean_h.split()) <= 4:
                if not any(clean_h == p[0] for p in page_phrases):
                    page_phrases.append((clean_h, 0.04))

        # Sentences on this page for source_quote matching
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", p_text) if s.strip()]

        terms_on_page: List[str] = []
        for phrase, score in page_phrases:
            cleaned = clean_phrase(phrase)
            if not is_valid_phrase(cleaned):
                continue

            norm_key = cleaned.lower()
            terms_on_page.append(cleaned.title())

            # Find matching sentence for quote
            quote = ""
            for sent in sentences:
                if re.search(r"\b" + re.escape(cleaned) + r"\b", sent, re.IGNORECASE):
                    quote = sent
                    break
            if not quote and cleaned.lower() in p_text.lower():
                idx = p_text.lower().find(cleaned.lower())
                start = max(0, idx - 40)
                end = min(len(p_text), idx + len(cleaned) + 80)
                quote = p_text[start:end].strip()

            # Importance: 1 to 3
            if score < 0.05 or any(cleaned.lower() in str(h).lower() for h in p_headings):
                importance = 3
            elif score < 0.20:
                importance = 2
            else:
                importance = 1

            if norm_key not in candidates_by_name:
                candidates_by_name[norm_key] = {
                    "phrase": cleaned,
                    "pages": {p_num},
                    "first_page": p_num,
                    "source_page": p_num,
                    "quote": quote,
                    "topic": p_title,
                    "chapter": p_title,
                    "importance": importance,
                    "score": round(max(0.1, min(0.99, 1.0 - score)), 3)
                }
            else:
                cand = candidates_by_name[norm_key]
                cand["pages"].add(p_num)
                if importance > cand["importance"]:
                    cand["importance"] = importance
                if quote and (not cand.get("quote") or len(quote) > len(cand["quote"])):
                    cand["quote"] = quote
                    cand["source_page"] = p_num

        page_coverage_records.append({
            "page": p_num,
            "page_type": "content",
            "status": "done" if terms_on_page else "empty_ok",
            "concepts_count": len(terms_on_page),
            "extracted_terms": terms_on_page,
            "char_count": len(p_text)
        })

    # (f) Document-wide extraction pass to capture overarching multi-page concepts
    usable_pages = [p for p in pages if p.get("is_usable")]
    if usable_pages:
        full_text = "\n\n".join(p["text"] for p in usable_pages)
        doc_top = max(30, min(80, len(pages) * 2))
        try:
            global_phrases = extractor.extract(full_text, top=doc_top) if hasattr(extractor, "extract") else []
            for phrase in global_phrases:
                cleaned = clean_phrase(phrase)
                if not is_valid_phrase(cleaned):
                    continue
                norm_key = cleaned.lower()
                if norm_key not in candidates_by_name:
                    found_page = 1
                    found_quote = ""
                    for p in usable_pages:
                        if cleaned.lower() in p["text"].lower():
                            found_page = p["page"]
                            for sent in re.split(r"(?<=[.!?])\s+", p["text"]):
                                if re.search(r"\b" + re.escape(cleaned) + r"\b", sent, re.IGNORECASE):
                                    found_quote = sent.strip()
                                    break
                            break
                    candidates_by_name[norm_key] = {
                        "phrase": cleaned,
                        "pages": {found_page},
                        "first_page": found_page,
                        "source_page": found_page,
                        "quote": found_quote,
                        "topic": "General",
                        "chapter": "General",
                        "importance": 2,
                        "score": 0.5
                    }
        except Exception as e_glob:
            logger.warning(f"Global extraction error in '{clean_method}': {e_glob}")

    if not candidates_by_name:
        logger.warning(f"Extractor '{clean_method}' returned 0 concept phrases.")
        return {
            "fallback": True,
            "fallback_reason": f"Extractor '{clean_method}' returned no concepts from the document."
        }

    # (g) Sort concepts by quality/relevance, cap candidate count, and order by document flow.
    # Prioritizes multi-page concepts and higher importance, capping to prevent downstream processing stalls
    all_cands = list(candidates_by_name.values())
    max_concepts = max(35, min(250, len(pages) * 5))
    if len(all_cands) > max_concepts:
        all_cands.sort(key=lambda x: (-len(x["pages"]), -x["importance"], x["first_page"], x["phrase"]))
        all_cands = all_cands[:max_concepts]

    sorted_candidates = sorted(
        all_cands,
        key=lambda x: (x["first_page"], -x["importance"], x["phrase"])
    )

    concepts = [
        _format_concept_item(
            phrase=cand["phrase"],
            index=idx,
            page=cand["first_page"],
            source_page=cand["source_page"],
            pages=sorted(list(cand["pages"])),
            topic=cand["topic"],
            chapter=cand["chapter"],
            score=cand["score"],
            importance=cand["importance"],
            source_sentence=cand["quote"] or None,
            source_quote=cand["quote"] or "",
            source_excerpt=cand["quote"][:120] if cand["quote"] else "",
            source_verified=bool(cand["quote"])
        )
        for idx, cand in enumerate(sorted_candidates)
    ]

    logger.info(
        f"Extraction with '{clean_method}' succeeded: {len(concepts)} concepts extracted across {len(pages)} pages."
    )

    return {
        "concepts": concepts,
        "extractor_used": clean_method,
        "fallback": False,
        "page_coverage": page_coverage_records,
        "total_pages": len(pages)
    }

