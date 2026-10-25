"""
filter.py - Generic post-filter for YAKE extraction output.
Removes junk phrases, normalizes concepts, and enforces structural rules.
Configurable via config.json and generic_words.json.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

logger = logging.getLogger("conceptlens.precision_filter")

MODULE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = MODULE_DIR / "config.json"
GENERIC_WORDS_PATH = MODULE_DIR / "generic_words.json"

# Linguistic constants for cleaning and filtering
ARTICLES = {"a", "an", "the"}
PREPOSITIONS = {
    "in", "on", "at", "by", "for", "with", "about", "against", "between",
    "into", "through", "during", "before", "after", "above", "below", "to",
    "from", "up", "down", "of", "off", "over", "under", "per", "via"
}
AUXILIARY_VERBS = {
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "can", "could", "shall", "should", "will", "would",
    "may", "might", "must"
}
CONJUNCTIONS = {"and", "or", "but", "nor", "so", "yet"}
PRONOUNS_DETERMINERS = {
    "this", "that", "these", "those", "its", "their", "your", "our", "my",
    "his", "her", "such", "each", "every", "both", "all", "some", "any",
    "few", "many", "more", "most", "other", "another", "also", "which", "who", "whom"
}

LEADING_STRIP_WORDS = (
    ARTICLES
    | PREPOSITIONS
    | AUXILIARY_VERBS
    | CONJUNCTIONS
    | PRONOUNS_DETERMINERS
    | {"then", "here", "there", "when", "where", "why", "how", "just", "only", "very"}
)

TRAILING_STRIP_WORDS = (
    ARTICLES
    | PREPOSITIONS
    | AUXILIARY_VERBS
    | CONJUNCTIONS
    | {"etc", "ie", "eg", "as"}
)

COMMON_VERBS = {
    "shows", "show", "showing", "shown",
    "gives", "give", "giving", "given",
    "using", "used", "use",
    "based", "calls", "called",
    "making", "made", "make",
    "having", "had", "has",
    "become", "becomes", "became",
    "contains", "contained", "contain",
    "consists", "consisting", "consist",
    "includes", "included", "including", "include",
    "represents", "representing", "represent",
    "provides", "providing", "provide",
    "takes", "taking", "taken", "take",
    "finds", "finding", "found", "find"
}

SENTENCE_PIECE_MIDDLE = {"is", "are", "was", "were", "can", "will"}

STOP_WORDS = LEADING_STRIP_WORDS | TRAILING_STRIP_WORDS | COMMON_VERBS

UNICODE_DASHES = re.compile(r"[\u2010\u2012\u2013\u2014\u2015\u2212]")


def _load_config(custom_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    defaults = {
        "rule1_clean": True,
        "rule2_drop_patterns": True,
        "rule3_generic_words": True,
        "rule4_support_check": True,
        "rule5_redundancy": True,
        "rule6_size_limit": True,
        "min_count": 2,
        "max_heading_words": 10,
        "min_size_limit": 15,
        "max_size_limit": 80,
        "words_per_concept": 40
    }
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                defaults.update(loaded)
        except Exception as e:
            logger.warning(f"Could not load config.json: {e}")
    if custom_config:
        defaults.update(custom_config)
    return defaults


def _load_generic_words() -> Set[str]:
    if GENERIC_WORDS_PATH.exists():
        try:
            with open(GENERIC_WORDS_PATH, "r", encoding="utf-8") as f:
                words = json.load(f)
                return {w.strip().lower() for w in words if w.strip()}
        except Exception as e:
            logger.warning(f"Could not load generic_words.json: {e}")
    return {
        "introduction", "advantages", "advantage", "disadvantages", "disadvantage",
        "application", "applications", "formula", "formulas", "numericals", "numerical",
        "example", "examples", "figure", "fig", "working", "construction", "according",
        "thus", "therefore", "also", "called", "due", "form", "time", "input", "output"
    }


def extract_headings_from_document(document_text: str, max_words: int = 10) -> List[str]:
    """Extracts likely section and slide headings from text."""
    headings: List[str] = []
    for line in document_text.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        words = cleaned.split()
        if 1 <= len(words) <= max_words:
            # Check if line looks like a heading
            if re.match(r"^(?:chapter|section|module|unit|part)\s+\d+[:\.\-]?\s*", cleaned, re.IGNORECASE):
                headings.append(cleaned)
            elif re.match(r"^(?:\d+\.){1,3}\s+", cleaned):
                headings.append(cleaned)
            elif cleaned.isupper() or cleaned.istitle() or not cleaned.endswith((".", ";", "?", "!")):
                headings.append(cleaned)
    return headings


def format_title_casing(cleaned_words: List[str], raw_original: str = "") -> str:
    """
    Formats phrase nicely: if originally all-lowercase, formats as title case.
    If original had mixed-case or acronyms (e.g. 'Nd3+ ions', 'LED'), preserves the original word casing.
    """
    if not cleaned_words:
        return ""

    if raw_original and not raw_original.islower():
        # Map original words by lowercase form to preserve exact casing (e.g. 'Nd3+ ions', 'LED')
        orig_tokens = raw_original.split()
        mapping = {re.sub(r"^[^a-zA-Z0-9]+|[^a-zA-Z0-9+]+$", "", w).lower(): w.strip(".,;:!?'\"`()[]{}<>•*~_") for w in orig_tokens}
        formatted = []
        for w in cleaned_words:
            w_norm = re.sub(r"^[^a-zA-Z0-9]+|[^a-zA-Z0-9+]+$", "", w).lower()
            if w_norm in mapping:
                formatted.append(mapping[w_norm])
            elif (w.isupper() and len(w) >= 2) or any(c.isdigit() for c in w) or "+" in w or "-" in w:
                formatted.append(w)
            else:
                formatted.append(w.capitalize())
        return " ".join(formatted)

    formatted = []
    for w in cleaned_words:
        if (w.isupper() and len(w) >= 2) or any(c.isdigit() for c in w) or "+" in w:
            formatted.append(w)
        else:
            formatted.append(w.capitalize())
    return " ".join(formatted)


def canonical_variant_key(phrase: str) -> str:
    """
    Generates a canonical key to merge plural, hyphen, and space variants.
    """
    norm = UNICODE_DASHES.sub(" ", phrase.lower())
    norm = re.sub(r"[\s\-_]+", " ", norm).strip()
    words = norm.split()
    stemmed_words = []
    for w in words:
        if w.endswith("ies") and len(w) > 4:
            stemmed_words.append(w[:-3] + "y")
        elif w.endswith("es") and not w.endswith(("ses", "sses", "ches", "shes", "xes")) and len(w) > 4:
            stemmed_words.append(w[:-2])
        elif w.endswith("s") and not w.endswith(("ss", "us", "is")) and len(w) > 3:
            stemmed_words.append(w[:-1])
        else:
            stemmed_words.append(w)
    return " ".join(stemmed_words)


def _clean_and_strip_phrase(phrase: str) -> Optional[List[str]]:
    """
    Rule 1: Unicode dashes, collapse spaces, strip surrounding punctuation,
    and repeatedly strip leading/trailing stop words, prepositions, and auxiliaries.
    Returns cleaned list of words.
    """
    if not phrase:
        return None

    # Fix unicode dashes
    text = UNICODE_DASHES.sub(" - ", phrase)
    text = re.sub(r"\s+", " ", text).strip()
    # Strip surrounding punctuation
    text = text.strip(".,;:!?'\"`()[]{}<>•*~_-\\/")
    if not text:
        return None

    words = text.split()
    changed = True
    while changed and words:
        changed = False
        # Strip non-alphanumeric tokens at edges (e.g. standalone '-', '/', etc.)
        while words and not any(c.isalnum() for c in words[0]):
            words.pop(0)
            changed = True
        while words and not any(c.isalnum() for c in words[-1]):
            words.pop()
            changed = True
        # Strip leading punctuation attached to first word
        if words:
            cleaned_first = words[0].strip(".,;:!?'\"`()[]{}<>•*~_-\\/")
            if cleaned_first != words[0]:
                words[0] = cleaned_first
                changed = True
        # Strip trailing punctuation attached to last word
        if words:
            cleaned_last = words[-1].strip(".,;:!?'\"`()[]{}<>•*~_-\\/")
            if cleaned_last != words[-1]:
                words[-1] = cleaned_last
                changed = True
        # Strip leading stop words / prepositions / auxiliaries
        if words and words[0].lower() in LEADING_STRIP_WORDS:
            words.pop(0)
            changed = True
        # Strip trailing stop words / auxiliaries / common linking words
        if words and words[-1].lower() in TRAILING_STRIP_WORDS:
            words.pop()
            changed = True

    if not words:
        return None

    return words


def _passes_rule2_drop_patterns(phrase: str) -> bool:
    """
    Rule 2: Drop pure numbers, < 3 chars (except acronyms), stop-word-only phrases,
    phrases ending with a stop word or common verb, and sentence piece fragments.
    """
    # Check if pure numbers / symbols
    stripped_alpha = re.sub(r"[\s\.\,\-\+\/\:\(\)]+", "", phrase)
    if not any(c.isalpha() for c in stripped_alpha):
        return False

    # Check length < 3
    if len(phrase) < 3:
        if phrase.isupper() and phrase.isalpha() and len(phrase) >= 2:
            pass  # keep all-caps acronym like AI, DP, IR
        else:
            return False

    words = phrase.split()
    lower_words = [w.lower() for w in words]

    # Phrases made only of stop words
    if all(w in STOP_WORDS for w in lower_words):
        return False

    # Phrases ending with a stop word or common verb
    last_word = lower_words[-1]
    if last_word in STOP_WORDS or last_word in COMMON_VERBS:
        return False

    # Sentence piece fragments (middle words contains is, are, was, were, can, will)
    if len(lower_words) > 2:
        middle_words = set(lower_words[1:-1])
        if middle_words & SENTENCE_PIECE_MIDDLE:
            return False

    return True


def _passes_rule3_generic_words(phrase: str, generic_words: Set[str]) -> bool:
    """
    Rule 3: Drop single words in generic_words.json.
    Keep multi-word phrases that merely contain them.
    """
    words = phrase.split()
    if len(words) == 1:
        if words[0].lower() in generic_words:
            return False
    return True


def filter_phrases(
    phrases_with_scores: Union[List[Tuple[str, float]], List[str]],
    document_text: str,
    config: Optional[Dict[str, Any]] = None
) -> List[str]:
    """
    Public precision filter entrypoint.
    Applies Rules 1 through 6 to remove junk phrases and return high-precision concepts.
    GUARANTEE: Never raises an exception; falls back to the original list on any error.
    """
    if not phrases_with_scores:
        return []

    # Preserve original list of strings for safe fallback
    original_phrases: List[str] = []
    for item in phrases_with_scores:
        if isinstance(item, (tuple, list)):
            original_phrases.append(str(item[0]))
        else:
            original_phrases.append(str(item))

    try:
        cfg = _load_config(config)
        generic_words = _load_generic_words()
        doc_text = document_text or ""
        doc_lower = doc_text.lower()
        headings = extract_headings_from_document(doc_text, max_words=cfg.get("max_heading_words", 10))

        # Standardize candidates into dict list: {'phrase': ..., 'score': float, 'orig_idx': int}
        candidates: List[Dict[str, Any]] = []
        for idx, item in enumerate(phrases_with_scores):
            if isinstance(item, (tuple, list)) and len(item) >= 2:
                phrase_str = str(item[0]).strip()
                try:
                    score_val = float(item[1])
                except Exception:
                    score_val = 1.0
            else:
                phrase_str = str(item).strip()
                score_val = 1.0
            if phrase_str:
                candidates.append({
                    "raw": phrase_str,
                    "phrase": phrase_str,
                    "score": score_val,
                    "orig_idx": idx
                })

        # --- Rule 1: Clean each phrase ---
        if cfg.get("rule1_clean", True):
            cleaned_candidates = []
            for c in candidates:
                words = _clean_and_strip_phrase(c["phrase"])
                if words:
                    # Format casing
                    c["phrase"] = format_title_casing(words, raw_original=c["raw"])
                    cleaned_candidates.append(c)
            candidates = cleaned_candidates

        # --- Rule 2: Drop pattern violations ---
        if cfg.get("rule2_drop_patterns", True):
            candidates = [c for c in candidates if _passes_rule2_drop_patterns(c["phrase"])]

        # --- Rule 3: Generic words check ---
        if cfg.get("rule3_generic_words", True):
            candidates = [c for c in candidates if _passes_rule3_generic_words(c["phrase"], generic_words)]

        # --- Rule 4: Support check in document text ---
        if cfg.get("rule4_support_check", True):
            min_count = int(cfg.get("min_count", 2))
            supported_candidates = []
            for c in candidates:
                p = c["phrase"]
                # Exceptions: acronym, contains digit, or appears in heading
                is_acronym = p.isupper() and p.isalpha() and 2 <= len(p) <= 6
                has_digit = any(char.isdigit() for char in p)
                in_heading = any(p.lower() in h.lower() for h in headings)

                if is_acronym or has_digit or in_heading:
                    supported_candidates.append(c)
                    continue

                # Count occurrences in document
                pattern = r"\b" + re.escape(p.lower()) + r"\b"
                matches_count = len(re.findall(pattern, doc_lower))
                if matches_count >= min_count:
                    supported_candidates.append(c)
            candidates = supported_candidates

        # --- Rule 5: Redundancy filtering and variant merging ---
        if cfg.get("rule5_redundancy", True):
            # A. Merge plural, hyphen and space variants
            groups: Dict[str, List[Dict[str, Any]]] = {}
            for c in candidates:
                key = canonical_variant_key(c["phrase"])
                groups.setdefault(key, []).append(c)

            merged_candidates = []
            for key, group in groups.items():
                if len(group) == 1:
                    merged_candidates.append(group[0])
                else:
                    # Pick best by YAKE score (lower is better), then shortest/cleanest
                    best = min(group, key=lambda x: (x["score"], len(x["phrase"]), x["orig_idx"]))
                    merged_candidates.append(best)
            candidates = merged_candidates

            # B. Sub-phrase check: if shorter phrase is contained in longer kept phrase
            # and appears < 2 times outside it, drop the shorter one
            candidates_by_len = sorted(candidates, key=lambda x: len(x["phrase"].split()), reverse=True)
            kept_candidates: List[Dict[str, Any]] = []

            for cand in candidates_by_len:
                short_p = cand["phrase"].lower()
                should_drop = False
                for parent in kept_candidates:
                    parent_p = parent["phrase"].lower()
                    if re.search(r"\b" + re.escape(short_p) + r"\b", parent_p):
                        # short_p is inside parent_p
                        count_short = len(re.findall(r"\b" + re.escape(short_p) + r"\b", doc_lower))
                        count_parent = len(re.findall(r"\b" + re.escape(parent_p) + r"\b", doc_lower))
                        if (count_short - count_parent) < 2:
                            should_drop = True
                            break
                if not should_drop:
                    kept_candidates.append(cand)

            candidates = sorted(kept_candidates, key=lambda x: (x["score"], x["orig_idx"]))

        # --- Rule 6: Size limit based on word count ---
        if cfg.get("rule6_size_limit", True):
            words = doc_text.split()
            word_count = len(words)
            min_lim = int(cfg.get("min_size_limit", 15))
            max_lim = int(cfg.get("max_size_limit", 80))
            words_per_concept = int(cfg.get("words_per_concept", 40))

            calc_n = round(word_count / max(1, words_per_concept))
            n = max(min_lim, min(max_lim, calc_n))

            # Sort by score ascending (lowest score is best)
            candidates = sorted(candidates, key=lambda x: (x["score"], x["orig_idx"]))
            candidates = candidates[:n]

        # Deduplicate while preserving order
        seen = set()
        final_list = []
        for c in candidates:
            cleaned_title = c["phrase"].strip()
            norm = cleaned_title.lower()
            if norm not in seen:
                seen.add(norm)
                final_list.append(cleaned_title)

        return final_list

    except Exception as e:
        logger.warning(f"Precision filter error, falling back to original phrases: {e}", exc_info=True)
        return original_phrases
