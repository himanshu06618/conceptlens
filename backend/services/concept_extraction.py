"""
backend/services/concept_extraction.py
Primary concept extraction using Google Gemini API with lightweight on-device fallback.

Pipeline:
1. Primary: Google Gemini API (gemini-3.7-flash / gemini-3.5-flash via google-genai SDK).
   Direct multimodal PDF & image understanding. Extract ALL concepts without cap.
2. Lightweight Fallback: PyMuPDF text + YAKE keyword extraction + regex definition heuristics.
   Zero heavy models (no spaCy, no RapidOCR, no OpenCV, no torch). Peak memory stays under 80 MB.
"""

import os
import re
import math
from collections import Counter, defaultdict
from typing import List, Dict, Any, Set, Tuple, Optional
from pathlib import Path
import logging

import yake
from dotenv import load_dotenv

try:
    from backend.services.cloud_extraction import (
        extract_document_with_gemini,
        extract_with_gemini,
        GeminiQuotaError
    )
except ImportError:
    from services.cloud_extraction import (
        extract_document_with_gemini,
        extract_with_gemini,
        GeminiQuotaError
    )

load_dotenv()

logger = logging.getLogger("conceptlens.nlp")

TOP_CONCEPTS_LIMIT_DEFAULT = 0

# Generic non-concept stopwords
GENERIC_STOPWORDS = {
    "thing", "things", "example", "examples", "figure", "figures", "table", "tables",
    "section", "sections", "page", "pages", "chapter", "chapters", "result", "results",
    "system", "systems", "case", "cases", "point", "points", "way", "ways", "method", "methods",
    "problem", "problems", "fact", "facts", "study", "studies", "part", "parts", "number", "numbers",
    "type", "types", "order", "orders", "value", "values", "level", "levels", "form", "forms",
    "time", "times", "year", "years", "data", "information", "course", "courses", "note", "notes",
    "class", "classes", "question", "questions", "answer", "answers", "step", "steps",
    "use", "uses", "end", "ends", "item", "items", "process", "processes", "detail", "details",
    "kind", "kinds", "sort", "sorts", "area", "areas", "group", "groups", "set", "sets",
    "line", "lines", "idea", "ideas", "view", "views", "topic", "topics", "lecture", "lectures",
    "professor", "student", "students", "text", "texts", "book", "books", "handout", "handouts",
    "diagram", "diagrams", "equation", "equations", "formula", "formulas", "work", "works",
    "concept", "concepts", "definition", "definitions", "summary", "summaries", "introduction"
}

# Regex definition indicators
DEFINITION_PATTERNS = [
    re.compile(r"\b(?:is|are)\s+defined\s+as\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\bcan\s+be\s+defined\s+as\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\brefers\s+to\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\b(?:is|are)\s+described\s+as\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\b(?:means|denotes|represents)\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\b(?:is|are)\s+known\s+as\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\b(?:is|are)\s+called\s+([^.!?;\n]+)", re.IGNORECASE),
    re.compile(r"\b(?:is|are)\s+(?:a|an)\s+([^.!?;\n]+)", re.IGNORECASE),
]


def get_spacy_nlp():
    """No-op stub replacing heavy spaCy model to maintain backward compatibility."""
    return None


def strip_leader_dots(text: str) -> str:
    """Strips repeated table-of-contents dots, dashes, underscores, and trailing page numbers."""
    if not text:
        return ""
    text = re.sub(r"(?:\.\s*){2,}", " ", text)
    text = re.sub(r"(?:_\s*){2,}", " ", text)
    text = re.sub(r"(?:-\s*){3,}", " ", text)
    text = re.sub(r"\s+\d+$", "", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_phrase(phrase: str) -> str:
    """Normalizes candidate strings for deduplication."""
    if not phrase:
        return ""
    cleaned = strip_leader_dots(phrase).lower()
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", "", cleaned)
    return " ".join(cleaned.split())


def detect_definition_sentence(concept_name: str, text: Any) -> Tuple[Optional[str], Optional[str]]:
    """Fast regex search for definition sentences without heavy NLP models."""
    if not concept_name or not text:
        return None, None
    escaped_name = re.escape(concept_name.strip())
    if isinstance(text, (list, tuple)):
        sentences = [str(s) for s in text]
    else:
        sentences = re.split(r"(?<=[.!?])\s+", str(text))

    for sent in sentences:
        if len(sent) < 15 or len(sent) > 300:
            continue
        if re.search(r"\b" + escaped_name + r"\b", sent, re.IGNORECASE):
            for pat in DEFINITION_PATTERNS:
                if pat.search(sent):
                    return sent.strip(), sent.strip()

    # Fallback to first descriptive sentence mentioning concept as excerpt
    for sent in sentences:
        if len(sent) >= 20 and re.search(r"\b" + escaped_name + r"\b", sent, re.IGNORECASE):
            return None, sent.strip()

    return None, None


def deduplicate_concepts(concepts: List[Dict[str, Any]], nlp: Any = None) -> List[Dict[str, Any]]:
    """Deduplicates concepts by normalized name, keeping highest score and merging info."""
    seen: Dict[str, Dict[str, Any]] = {}
    for c in concepts:
        norm = normalize_phrase(c.get("name", ""))
        words = norm.split()
        stem_words = [w[:-1] if (len(w) > 3 and w.endswith("s") and not w.endswith("ss") and not w.endswith("us")) else w for w in words]
        norm_stem = " ".join(stem_words)

        if norm_stem not in seen:
            seen[norm_stem] = dict(c)
        else:
            existing = seen[norm_stem]
            total_freq = existing.get("frequency", 1) + c.get("frequency", 1)
            c_freq = c.get("frequency", 1)
            e_freq = existing.get("frequency", 1)
            if c_freq > e_freq or (c_freq == e_freq and c.get("score", 0) > existing.get("score", 0)):
                best_name = c.get("name")
                best_score = c.get("score", existing.get("score", 0))
                best_def = c.get("definition") or existing.get("definition")
                best_excerpt = c.get("source_excerpt") or existing.get("source_excerpt")
            else:
                best_name = existing.get("name")
                best_score = max(existing.get("score", 0), c.get("score", 0))
                best_def = existing.get("definition") or c.get("definition")
                best_excerpt = existing.get("source_excerpt") or c.get("source_excerpt")

            existing["name"] = best_name
            existing["frequency"] = total_freq
            existing["score"] = best_score
            existing["definition"] = best_def
            existing["source_excerpt"] = best_excerpt

    return list(seen.values())


def extract_fallback_concepts(
    full_text: str,
    chunks: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Lightweight fallback concept extractor using YAKE + regex definitions.
    Consumes < 10 MB RAM and executes in under 0.5s.
    """
    if not full_text.strip():
        return []

    # 1. YAKE keyword extraction
    try:
        kw_extractor = yake.KeywordExtractor(
            lan="en",
            n=3,
            dedupLim=0.85,
            top=60,
            features=None
        )
        extracted_kw = kw_extractor.extract_keywords(full_text[:40000])
    except Exception as e:
        logger.warning(f"YAKE extraction error: {e}")
        extracted_kw = []

    if not extracted_kw:
        # Fallback to capitalized word runs
        caps = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b", full_text)
        counts = Counter(caps).most_common(30)
        extracted_kw = [(w, 1.0 / (c + 1)) for w, c in counts]

    # Map chunks to topics if available
    topic_by_chunk: Dict[int, str] = {}
    if chunks:
        for ch in chunks:
            topic_by_chunk[ch.get("id", 0)] = ch.get("heading", "General")

    concepts: List[Dict[str, Any]] = []
    seen_names: Set[str] = set()

    for idx, (kw_name, kw_score) in enumerate(extracted_kw):
        norm = normalize_phrase(kw_name)
        if not norm or norm in GENERIC_STOPWORDS or norm in seen_names or len(norm) < 3:
            continue
        seen_names.add(norm)

        clean_name = strip_leader_dots(kw_name).title()
        def_sent, excerpt = detect_definition_sentence(clean_name, full_text[:40000])

        # Importance: 1 to 3
        # In YAKE, lower score means more significant keyphrase
        if kw_score < 0.05 or idx < 5:
            importance = 3
        elif kw_score < 0.20 or idx < 15:
            importance = 2
        else:
            importance = 1

        topic = "General"
        if chunks:
            # Find first chunk mentioning this concept
            for ch in chunks:
                if clean_name.lower() in ch.get("text", "").lower():
                    topic = ch.get("heading", "General")
                    break

        concepts.append({
            "id": f"c_{len(concepts) + 1}",
            "name": clean_name,
            "importance": importance,
            "topic": topic if topic and topic != "General" else "Key Concepts",
            "definition": def_sent or f"Educational concept relating to {clean_name.lower()}.",
            "source_excerpt": excerpt or (def_sent[:60] if def_sent else clean_name),
            "score": round(1.0 / (1.0 + kw_score), 3),
            "page": 1,
            "flow_order": idx,
            "flow_group": topic if topic and topic != "General" else "Key Concepts",
            "parent_name": None,
            "related_concepts": []
        })

    # Linear relationship extraction: link concepts that co-occur in the same paragraph
    paras = full_text[:40000].split("\n\n")
    co_occurrences: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for p in paras:
        p_lower = p.lower()
        active_in_p = [c["name"] for c in concepts if c["name"].lower() in p_lower]
        for c1 in active_in_p:
            for c2 in active_in_p:
                if c1 != c2:
                    co_occurrences[c1][c2] += 1

    for c in concepts:
        partners = sorted(co_occurrences[c["name"]].items(), key=lambda kv: kv[1], reverse=True)[:4]
        c["related_concepts"] = [
            {
                "name": p_name,
                "weight": 2 if p_weight > 2 else 1,
                "type": "prerequisite" if p_weight > 3 else "related",
                "label": "prerequisite" if p_weight > 3 else "related"
            }
            for p_name, p_weight in partners
        ]

    return concepts


def extract_concepts_pipeline(
    chunks: Optional[List[Dict[str, Any]]],
    full_text: str,
    file_path: Optional[Path] = None,
    top_limit: int = TOP_CONCEPTS_LIMIT_DEFAULT,
    prefer_cloud: bool = True,
    gemini_api_key: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Main extraction pipeline entry point:
    1. Primary: Google Gemini API (via google-genai)
    2. Fallback: Lightweight YAKE + regex extraction
    """
    key = gemini_api_key or os.getenv("GEMINI_API_KEY", "").strip()

    # 1. Primary: Gemini Cloud Extraction
    if prefer_cloud and key:
        try:
            if file_path and file_path.exists():
                logger.info(f"Extracting concepts via Gemini API from file: {file_path.name}...")
                results = extract_document_with_gemini(file_path=file_path, api_key=key)
                if results and len(results) >= 2:
                    logger.info(f"Gemini successfully extracted {len(results)} concepts.")
                    return results, "gemini-3.7-flash"
            elif full_text.strip():
                logger.info("Extracting concepts via Gemini API from text...")
                results = extract_with_gemini(text=full_text, api_key=key)
                if results and len(results) >= 2:
                    return results, "gemini-3.7-flash"
        except GeminiQuotaError:
            logger.warning("Gemini quota exhausted. Attempting lightweight fallback if text is available.")
        except Exception as e:
            logger.warning(f"Gemini extraction failed: {e}. Attempting lightweight fallback.")

    # 2. Fallback: Lightweight on-device pipeline
    if full_text.strip():
        logger.info("Using lightweight on-device fallback (YAKE + regex)...")
        fallback_results = extract_fallback_concepts(full_text=full_text, chunks=chunks)
        if fallback_results:
            return fallback_results, "lightweight-fallback"

    return [], "failed"
