"""
backend/services/definitions_lookup.py
Specialized definition lookup and natural answer generator for ConceptLens.

Features:
- Identifies definition query patterns ("what is X", "define X", "meaning of X", "what do you mean by X", "X kya hota hai", etc.)
- Identifies reverse lookup patterns ("what is called Y", "which term means Y", etc.)
- Fuzzy term & alias matching (similarity threshold >= 0.85 using difflib)
- Natural phrasing using stored cues ("defined_as", "known_as", "called", "refers_to", "termed", "means")
- Formats source sentence evidence with document filename and page
- Grouping across multiple notes
"""

import re
import json
import logging
from typing import List, Dict, Any, Optional, Tuple
from difflib import SequenceMatcher

logger = logging.getLogger("conceptlens.definitions")

SIMILARITY_THRESHOLD = 0.85

def clean_term_string(term: str) -> str:
    """Cleans a query term by removing question marks, extra spaces, and common leading particles."""
    if not term:
        return ""
    t = term.strip().rstrip("?.!,:;")
    t = re.sub(r"^(?:a|an|the)\s+", "", t, flags=re.IGNORECASE).strip()
    return re.sub(r"\s+", " ", t)

def parse_definition_question(question: str) -> Tuple[Optional[str], str, Optional[str]]:
    """
    Parses a user question to detect definition queries or reverse lookups.
    Returns:
        (extracted_term_or_phrase, query_type, cue_hint)
        where query_type is 'definition_query', 'reverse_lookup', or 'generic'
    """
    if not question:
        return None, "generic", None

    q = question.strip()
    q_lower = q.lower().rstrip("?.!,;").strip()

    # 1. Reverse Lookups: "what is called Y", "which term means Y", "what is termed Y"
    m_rev_called = re.search(r"^(?:what|which|who)\s+(?:is|are)\s+called\s+(.+)$", q_lower)
    if m_rev_called:
        return clean_term_string(m_rev_called.group(1)), "reverse_lookup", "called"

    m_rev_means = re.search(r"^(?:which|what)\s+(?:term|concept|word)?\s*means\s+(.+)$", q_lower)
    if m_rev_means:
        return clean_term_string(m_rev_means.group(1)), "reverse_lookup", "means"

    m_rev_termed = re.search(r"^(?:what|which)\s+(?:is|are)\s+termed\s+(.+)$", q_lower)
    if m_rev_termed:
        return clean_term_string(m_rev_termed.group(1)), "reverse_lookup", "termed"

    m_rev_known = re.search(r"^(?:what|which)\s+(?:is|are)\s+(?:also\s+)?known\s+as\s+(.+)$", q_lower)
    if m_rev_known:
        return clean_term_string(m_rev_known.group(1)), "reverse_lookup", "known_as"

    # 2. Hindi / Hinglish styles: "X kya hota hai", "X kya hai", "X ka matlab kya hai"
    m_hi_hota = re.search(r"^(.+?)\s+(?:kya\s+hota\s+hai|kya\s+hai|kya\s+hoti\s+hai|ka\s+matlab\s+kya\s+hai)$", q_lower)
    if m_hi_hota:
        return clean_term_string(m_hi_hota.group(1)), "definition_query", None

    # 3. "what do you mean by X" / "what is meant by X"
    m_meant = re.search(r"^what\s+(?:do\s+you\s+mean\s+by|is\s+meant\s+by)\s+(.+)$", q_lower)
    if m_meant:
        return clean_term_string(m_meant.group(1)), "definition_query", None

    # 4. "what does X mean"
    m_does_mean = re.search(r"^what\s+does\s+(.+?)\s+mean$", q_lower)
    if m_does_mean:
        return clean_term_string(m_does_mean.group(1)), "definition_query", None

    # 5. "meaning of X" / "definition of X"
    m_meaning = re.search(r"^(?:meaning|definition)\s+of\s+(.+)$", q_lower)
    if m_meaning:
        return clean_term_string(m_meaning.group(1)), "definition_query", None

    # 6. "define X"
    m_define = re.search(r"^define\s+(.+)$", q_lower)
    if m_define:
        return clean_term_string(m_define.group(1)), "definition_query", None

    # 7. "what is X", "what are X", "what is a X", "what is an X"
    m_what_is = re.search(r"^what\s+(?:is|are)(?:\s+(?:a|an|the))?\s+(.+)$", q_lower)
    if m_what_is:
        return clean_term_string(m_what_is.group(1)), "definition_query", None

    # 8. "tell me about X", "explain X"
    m_explain = re.search(r"^(?:tell\s+me\s+about|explain)\s+(.+)$", q_lower)
    if m_explain:
        return clean_term_string(m_explain.group(1)), "definition_query", None

    # 9. If short query (1-4 words), treat as definition query for that term
    words = q_lower.split()
    if 1 <= len(words) <= 4 and not any(w in words for w in ("how", "why", "when", "where", "who", "which", "compare", "steps")):
        return clean_term_string(q_lower), "definition_query", None

    return None, "generic", None

def fuzzy_match_ratio(str1: str, str2: str) -> float:
    """Computes similarity ratio between two strings using difflib."""
    if not str1 or not str2:
        return 0.0
    s1 = clean_term_string(str1).lower()
    s2 = clean_term_string(str2).lower()
    if s1 == s2:
        return 1.0
    # Substring check with word boundary-like matching
    if s1 in s2 or s2 in s1:
        # Give high score if one is a clean substring of the other
        len_ratio = min(len(s1), len(s2)) / max(len(s1), len(s2))
        if len_ratio >= 0.7:
            return max(0.90, len_ratio)
    return SequenceMatcher(None, s1, s2).ratio()

def lookup_stored_definitions(
    question: str,
    user_id: Any,
    document_id: Optional[str] = None,
    conn = None
) -> Tuple[List[Dict[str, Any]], bool, Optional[str]]:
    """
    Looks up concepts and aliases matching the user's question.
    Accepts either:
      - user_id (str) and queries the database via conn or get_connection()
      - user_id (list of concept dicts) for in-memory direct matching
    Returns:
        (matched_definitions_list, is_definition_question_bool, matched_term_str)
    """
    target, q_type, cue_hint = parse_definition_question(question)
    if not target or q_type == "generic":
        return [], False, None

    should_close = False
    rows = []

    if isinstance(user_id, list):
        # In-memory concept objects passed directly
        rows = user_id
    else:
        if conn is None:
            from backend.database import get_connection
            conn = get_connection()
            should_close = True

        try:
            sql = """
                SELECT c.id, c.name, c.definition, c.definition_cue, c.aliases_json,
                       c.source_sentence, c.source_page, c.page, c.location, c.document_id,
                       d.filename
                FROM concepts c
                JOIN documents d ON c.document_id = d.id
                WHERE d.user_id = ?
            """
            params = [user_id]
            if document_id:
                sql += " AND c.document_id = ?"
                params.append(document_id)

            rows = conn.execute(sql, params).fetchall()
        finally:
            if should_close and conn is not None:
                conn.close()

    if not rows:
        return [], True, target

    matches = []
    target_clean = clean_term_string(target)

    for r in rows:
        name = (r.get("name") if isinstance(r, dict) else r["name"]) or ""
        
        # Handle aliases from dict or JSON string
        if isinstance(r, dict) and "aliases" in r and isinstance(r["aliases"], list):
            aliases = r["aliases"]
        else:
            raw_aliases = (r.get("aliases_json") if isinstance(r, dict) else r["aliases_json"]) or "[]"
            try:
                aliases = json.loads(raw_aliases) if isinstance(raw_aliases, str) else (raw_aliases or [])
            except Exception:
                aliases = []
        if not isinstance(aliases, list):
            aliases = []

        defn = r.get("definition") if isinstance(r, dict) else r["definition"]
        cue = r.get("definition_cue") if isinstance(r, dict) else r["definition_cue"]
        src_sentence = r.get("source_sentence") if isinstance(r, dict) else r["source_sentence"]
        src_page = (r.get("source_page") or r.get("page")) if isinstance(r, dict) else (r["source_page"] or r["page"] or 1)
        doc_filename = (r.get("filename") or r.get("document_title") or "Course Notes") if isinstance(r, dict) else (r["filename"] or "Course Notes")
        c_id = r.get("id") if isinstance(r, dict) else r["id"]
        doc_id = r.get("document_id") if isinstance(r, dict) else r["document_id"]
        loc = r.get("location") if isinstance(r, dict) else r["location"]

        matched = False
        matched_as_alias = None
        match_score = 0.0

        if q_type == "reverse_lookup":
            # In reverse lookup ("what is called Y", "which term means Y"):
            # match target against aliases, definition, or source_sentence
            for a in aliases:
                ratio = fuzzy_match_ratio(target_clean, str(a))
                if ratio >= SIMILARITY_THRESHOLD:
                    matched = True
                    matched_as_alias = str(a)
                    match_score = max(match_score, ratio)
                    break

            if not matched and defn:
                ratio = fuzzy_match_ratio(target_clean, defn)
                if ratio >= SIMILARITY_THRESHOLD or target_clean.lower() in defn.lower():
                    matched = True
                    match_score = max(match_score, ratio if ratio >= SIMILARITY_THRESHOLD else 0.88)

            if not matched and src_sentence:
                if target_clean.lower() in src_sentence.lower():
                    matched = True
                    match_score = max(match_score, 0.86)

        else:
            # Direct definition query ("what is X", "define X", etc.):
            # match target against concept name
            name_ratio = fuzzy_match_ratio(target_clean, name)
            if name_ratio >= SIMILARITY_THRESHOLD:
                matched = True
                match_score = name_ratio
            else:
                # check aliases
                for a in aliases:
                    alias_ratio = fuzzy_match_ratio(target_clean, str(a))
                    if alias_ratio >= SIMILARITY_THRESHOLD:
                        matched = True
                        matched_as_alias = str(a)
                        match_score = alias_ratio
                        break

        if matched:
            matches.append({
                "concept_id": c_id,
                "name": name,
                "definition": defn,
                "definition_cue": cue or cue_hint or "defined_as",
                "aliases": aliases,
                "matched_alias": matched_as_alias,
                "source_sentence": src_sentence,
                "page": src_page or 1,
                "location": loc,
                "document_id": doc_id,
                "filename": doc_filename,
                "score": match_score
            })

    # Sort matches by match score descending
    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches, True, target


def answer_definition_question_if_matched(
    question: str,
    user_id_or_concepts: Any,
    document_id: Optional[str] = None,
    conn = None
) -> Optional[Dict[str, Any]]:
    """Convenience helper returning formatted answer dictionary or None."""
    matches, is_def_q, target = lookup_stored_definitions(
        question=question,
        user_id=user_id_or_concepts,
        document_id=document_id,
        conn=conn
    )
    valid_matches = [m for m in matches if m.get("definition")]
    if not valid_matches:
        return None

    ans_text = format_natural_definition_answer(valid_matches)
    return {
        "answer": ans_text,
        "matches": valid_matches,
        "source_sentence": valid_matches[0].get("source_sentence"),
        "citations": [
            {
                "type": "chunk",
                "document_id": m.get("document_id"),
                "filename": m.get("filename"),
                "page": m.get("page", 1),
                "quote": m.get("source_sentence") or m.get("definition"),
                "origin": "notes"
            }
            for m in valid_matches
        ]
    }

def format_natural_definition_answer(matches: List[Dict[str, Any]]) -> str:
    """
    Formats matched concept definitions into natural phrasing with stored cue
    and source sentence evidence.
    """
    if not matches:
        return ""

    # Group matches by note / filename to handle multi-note cases cleanly
    grouped_by_doc: Dict[str, List[Dict[str, Any]]] = {}
    for m in matches:
        doc_key = m["filename"]
        grouped_by_doc.setdefault(doc_key, []).append(m)

    sections = []
    is_multi_note = len(grouped_by_doc) > 1

    for filename, doc_matches in grouped_by_doc.items():
        doc_lines = []
        if is_multi_note:
            doc_lines.append(f"### In {filename}:")

        for item in doc_matches:
            name = item["name"]
            defn = item["definition"]
            cue = item.get("definition_cue") or "defined_as"
            matched_alias = item.get("matched_alias")
            aliases = item.get("aliases") or []
            src_sentence = item.get("source_sentence")
            page = item.get("page", 1)

            # Clean definition string
            clean_def = defn.strip() if defn else ""
            if clean_def.endswith("."):
                clean_def = clean_def[:-1].strip()

            # Format natural phrasing based on stored cue
            statement = ""
            if cue == "defined_as":
                # Ensure lowercase start if not proper noun
                first_word = clean_def.split()[0] if clean_def else ""
                formatted_def = clean_def
                if first_word.islower() or first_word.lower() in ("a", "an", "the", "measure", "process", "phenomenon", "state"):
                    formatted_def = clean_def[0].lower() + clean_def[1:]
                statement = f"{name} is defined as {formatted_def}."

            elif cue == "known_as":
                alias_to_use = matched_alias or (aliases[0] if aliases else clean_def)
                if alias_to_use:
                    statement = f"{name} is also known as {alias_to_use}."
                else:
                    statement = f"{name} is known as {clean_def}."

            elif cue == "called":
                # If definition starts lowercase, capitalize first letter of sentence
                cap_def = clean_def[0].upper() + clean_def[1:] if clean_def else clean_def
                statement = f"{cap_def} is called {name}."

            elif cue == "termed":
                cap_def = clean_def[0].upper() + clean_def[1:] if clean_def else clean_def
                statement = f"{cap_def} is termed {name}."

            elif cue == "refers_to":
                formatted_def = clean_def[0].lower() + clean_def[1:] if clean_def else clean_def
                statement = f"{name} refers to {formatted_def}."

            elif cue == "means":
                formatted_def = clean_def[0].lower() + clean_def[1:] if clean_def else clean_def
                statement = f"{name} means {formatted_def}."

            else:
                # Fallback
                statement = f"{name} is defined as {clean_def}."

            doc_lines.append(statement)

            # Add source sentence evidence
            evidence_sentence = src_sentence or f"{name} appears on page {page}."
            evidence_block = (
                f"\n**Evidence from your notes:**\n"
                f"> \"{evidence_sentence.strip()}\"\n"
                f"*(from {filename}, page {page})*"
            )
            doc_lines.append(evidence_block)

        sections.append("\n".join(doc_lines))

    return "\n\n---\n\n".join(sections)
