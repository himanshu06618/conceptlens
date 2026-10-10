"""
backend/services/concept_extraction.py
High-performance concept extraction pipeline:
1. Fast mode: Google Gemini API (gemini-2.5-flash) with structured JSON
2. Local fallback: PyMuPDF + RapidOCR + YAKE + spaCy patterns (optimized with nlp.pipe and inverted sentence index)
3. Linear deduplication and relationship mapping (O(n))
"""

import os
import re
import math
import unicodedata
from collections import Counter, defaultdict
from typing import List, Dict, Any, Set, Tuple, Optional
import logging

import spacy
from spacy.tokens import Doc
import yake
from dotenv import load_dotenv

load_dotenv()

try:
    from backend.services.cloud_extraction import extract_with_gemini
except ImportError:
    from services.cloud_extraction import extract_with_gemini

logger = logging.getLogger("conceptlens.nlp")

# Global NLP singleton
_nlp = None

TOP_CONCEPTS_LIMIT_DEFAULT = 0
USE_KEYBERT_ENV = os.getenv("USE_KEYBERT", "false").lower() in ("true", "1", "yes")

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

# Definition indicator patterns
DEFINITION_VERBS = [
    r"\bis defined as\b",
    r"\bcan be defined as\b",
    r"\brefers to\b",
    r"\bcan be described as\b",
    r"\bis described as\b",
    r"\bmeans\b",
    r"\brepresents\b",
    r"\bdenotes\b",
    r"\bstands for\b",
    r"\bconstitutes\b",
    r"\bis known as\b",
    r"\bare known as\b",
    r"\bis called\b",
    r"\bare called\b"
]


def get_spacy_nlp():
    """Lazily loads and returns the spaCy model singleton with NER disabled for maximum speed."""
    global _nlp
    if _nlp is None:
        try:
            logger.info("Loading spaCy model en_core_web_sm (disable ner for speed)...")
            _nlp = spacy.load("en_core_web_sm", disable=["ner"])
        except Exception as e:
            logger.error(f"Error loading spaCy model: {e}")
            raise RuntimeError(
                "spaCy model 'en_core_web_sm' is not available. "
                "Please run: python -m spacy download en_core_web_sm"
            ) from e
    return _nlp


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
    """Lowercases, normalizes unicode, and removes surrounding punctuation."""
    phrase = strip_leader_dots(phrase)
    norm = unicodedata.normalize("NFKD", phrase)
    norm = "".join(c for c in norm if not unicodedata.combining(c))
    norm = re.sub(r"^[^\w]+|[^\w]+$", "", norm)
    return norm.strip().lower()


def is_valid_candidate(phrase: str) -> bool:
    """Validates that candidate phrase is meaningful and not generic."""
    cleaned = normalize_phrase(phrase)
    if not cleaned or len(cleaned) < 2:
        return False
    if cleaned in GENERIC_STOPWORDS:
        return False
    if cleaned.isnumeric():
        return False

    tokens = cleaned.split()
    if len(tokens) > 4:
        return False
    if all(tok in GENERIC_STOPWORDS for tok in tokens):
        return False
    if not any(len(tok) >= 2 and tok.isalpha() for tok in tokens):
        return False

    return True


def extract_candidates_from_spacy(doc: Doc) -> List[Dict[str, Any]]:
    """Extracts noun chunks from a spaCy Doc."""
    candidates = []

    for chunk in doc.noun_chunks:
        start = chunk.start
        while start < chunk.end and doc[start].pos_ in ("DET", "PRON"):
            start += 1

        span = doc[start:chunk.end]
        text = span.text.strip()
        tokens = [t for t in span]

        if 1 <= len(tokens) <= 4:
            has_noun = any(t.pos_ in ("NOUN", "PROPN") for t in tokens)
            if has_noun and is_valid_candidate(text):
                candidates.append({
                    "text": text,
                    "lemma": span.lemma_.strip().lower(),
                    "type": "noun_chunk",
                    "span": span
                })

    return candidates


def extract_yake_keyphrases(text: str, top_n: int = 40) -> Dict[str, float]:
    """Runs YAKE keyphrase extraction and returns a dict mapping normalized kw to inverted score."""
    if not text.strip():
        return {}

    try:
        kw_extractor = yake.KeywordExtractor(
            lan="en",
            n=3,
            dedupLim=0.85,
            top=min(top_n, 50),
            features=None
        )
        keywords = kw_extractor.extract_keywords(text)

        scores = {}
        for kw, score in keywords:
            norm_kw = normalize_phrase(kw)
            if is_valid_candidate(norm_kw):
                inverted = 1.0 / (1.0 + float(score))
                scores[norm_kw] = max(scores.get(norm_kw, 0.0), inverted)
        return scores
    except Exception as e:
        logger.warning(f"YAKE extraction error: {e}")
        return {}


def build_sentence_inverted_index(sentences: List[str]) -> Tuple[List[str], Dict[str, List[int]]]:
    """
    Builds an inverted word index over sentences for O(1) definition detection lookups.
    Returns (cleaned_sentences, token_to_sentence_indices).
    """
    cleaned_sentences = [s.strip() for s in sentences if s.strip()]
    token_index = defaultdict(list)

    for idx, sent in enumerate(cleaned_sentences):
        tokens = set(re.findall(r"\b[a-zA-Z]{2,}\b", sent.lower()))
        for tok in tokens:
            token_index[tok].append(idx)

    return cleaned_sentences, token_index


def detect_definition_fast(
    concept_name: str,
    sentences: List[str],
    token_index: Dict[str, List[int]]
) -> Tuple[Optional[str], Optional[str]]:
    """
    Fast definition detection using the pre-computed token inverted index.
    Only checks candidate sentences that actually contain concept tokens.
    """
    escaped_name = re.escape(concept_name)
    name_tokens = re.findall(r"\b[a-zA-Z]{2,}\b", concept_name.lower())
    if not name_tokens:
        return None, ""

    # Intersect or union sentence candidate indices
    candidate_indices = token_index.get(name_tokens[0], [])
    for tok in name_tokens[1:]:
        matching = token_index.get(tok, [])
        if matching:
            candidate_indices = [idx for idx in candidate_indices if idx in set(matching)]

    # If too few matches, try first token alone capped at 10
    if not candidate_indices:
        candidate_indices = token_index.get(name_tokens[0], [])[:8]
    else:
        candidate_indices = candidate_indices[:15]

    first_mention_sentence = None
    best_def = None
    best_def_score = 0.0

    explicit_verb_pattern = re.compile(
        rf"\b{escaped_name}\b.*?(?:" + "|".join(DEFINITION_VERBS) + rf")\b",
        re.IGNORECASE
    )
    is_pattern = re.compile(
        rf"^\s*(?:the\s+|a\s+|an\s+)?\b{escaped_name}\b\s+(?:is|are)\s+(?:a|an|the|one of|defined|characterized|used to|represented)\b",
        re.IGNORECASE
    )

    for s_idx in candidate_indices:
        s_clean = sentences[s_idx]
        s_lower = s_clean.lower()

        if concept_name.lower() in s_lower or all(tok in s_lower for tok in name_tokens):
            if first_mention_sentence is None:
                first_mention_sentence = s_clean

            words = s_clean.split()
            if len(words) < 6 or len(words) > 65:
                continue

            score = 0.0
            if explicit_verb_pattern.search(s_clean):
                score = 3.0
            elif is_pattern.search(s_clean):
                score = 2.5
            elif re.search(rf"\b{escaped_name}\b\s+(?:is|are)\b", s_clean, re.IGNORECASE):
                score = 1.5

            if score > best_def_score:
                best_def_score = score
                best_def = s_clean

    return (best_def if best_def_score >= 1.5 else None), (first_mention_sentence or "")


def detect_definition_sentence(
    concept_name: str,
    sentences: List[str]
) -> Tuple[Optional[str], Optional[str]]:
    """Backward-compatible wrapper for definition detection."""
    cleaned_sents, token_idx = build_sentence_inverted_index(sentences)
    return detect_definition_fast(concept_name, cleaned_sents, token_idx)


def deduplicate_concepts(
    raw_concepts: List[Dict[str, Any]],
    nlp_model=None
) -> List[Dict[str, Any]]:
    """Backward-compatible wrapper for linear-time concept deduplication."""
    if nlp_model is None:
        nlp_model = get_spacy_nlp()
    return deduplicate_concepts_linear(raw_concepts, nlp_model)


def deduplicate_concepts_linear(
    raw_concepts: List[Dict[str, Any]],
    nlp_model
) -> List[Dict[str, Any]]:
    """
    Linear-time O(n) deduplication of concepts using normalized keys and batch lemmatization.
    """
    if not raw_concepts:
        return []

    # 1. Group by normalized string directly
    norm_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in raw_concepts:
        norm = normalize_phrase(c["name"])
        if norm:
            norm_groups[norm].append(c)

    # 2. Batch lemmatize unique keys using nlp.pipe
    unique_norms = list(norm_groups.keys())
    docs = list(nlp_model.pipe(unique_norms, batch_size=128))
    norm_to_lemma = {
        norm: " ".join(t.lemma_ for t in doc).strip() or norm
        for norm, doc in zip(unique_norms, docs)
    }

    # 3. Group by canonical lemma key
    lemma_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for norm, items in norm_groups.items():
        lemma_key = norm_to_lemma.get(norm, norm)
        lemma_groups[lemma_key].extend(items)

    merged: List[Dict[str, Any]] = []

    for lemma_key, items in lemma_groups.items():
        surface_counts: Counter = Counter()
        for it in items:
            surface_counts[it["name"]] += it.get("frequency", 1)
        best_name = surface_counts.most_common(1)[0][0]

        total_frequency = sum(it.get("frequency", 1) for it in items)
        max_score = max(it.get("score", 0.0) for it in items)

        best_def = next((it["definition"] for it in items if it.get("definition")), "")
        best_excerpt = next((it["source_excerpt"] for it in items if it.get("source_excerpt")), "")

        all_chunks = set()
        for it in items:
            all_chunks.update(it.get("chunk_ids", []))

        best_topic = items[0].get("topic", "General")
        best_page = min(it.get("page", 1) for it in items)

        merged.append({
            "name": best_name,
            "lemma_key": lemma_key,
            "frequency": total_frequency,
            "score": max_score,
            "definition": best_def,
            "source_excerpt": best_excerpt,
            "chunk_ids": list(all_chunks),
            "topic": best_topic,
            "page": best_page
        })

    return merged


def assign_importance_ratings(concepts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Assigns importance ratings 1 to 5 based on score quantiles."""
    if not concepts:
        return concepts

    sorted_concepts = sorted(concepts, key=lambda c: c["score"], reverse=True)
    n = len(sorted_concepts)

    if n <= 5:
        for idx, c in enumerate(sorted_concepts):
            c["importance"] = max(1, 5 - idx)
        return sorted_concepts

    for idx, c in enumerate(sorted_concepts):
        percentile = idx / n
        if percentile < 0.20:
            c["importance"] = 5
        elif percentile < 0.40:
            c["importance"] = 4
        elif percentile < 0.60:
            c["importance"] = 3
        elif percentile < 0.80:
            c["importance"] = 2
        else:
            c["importance"] = 1

    return sorted_concepts


def compute_related_concepts_linear(
    concepts: List[Dict[str, Any]],
    chunk_map: Dict[int, Set[str]]
) -> None:
    """Computes co-occurrence of concepts within chunks with capped candidates."""
    co_occurrences: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for chunk_id, concept_names in chunk_map.items():
        # Cap names list to top 25 to guarantee linear performance
        names_list = list(concept_names)[:25]
        for i in range(len(names_list)):
            for j in range(i + 1, len(names_list)):
                c1, c2 = names_list[i], names_list[j]
                co_occurrences[c1][c2] += 1
                co_occurrences[c2][c1] += 1

    for c in concepts:
        name = c["name"]
        partners = co_occurrences.get(name, {})
        sorted_partners = sorted(partners.items(), key=lambda kv: kv[1], reverse=True)[:5]
        c["related_concepts"] = [
            {"name": p_name, "weight": p_weight, "type": "related", "label": "related"}
            for p_name, p_weight in sorted_partners
        ]


def extract_concepts_pipeline(
    chunks: List[Dict[str, Any]],
    full_text: str,
    top_limit: int = TOP_CONCEPTS_LIMIT_DEFAULT,
    use_keybert: bool = False,
    prefer_cloud: bool = True,
    gemini_api_key: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], str]:
    """
    Main concept extraction pipeline.
    Returns: (concepts_list, provider_name: 'cloud' | 'on-device')
    """
    if not full_text.strip() or not chunks:
        return [], "on-device"

    # 1. Primary: Cloud Extraction (if enabled and key present)
    if prefer_cloud:
        cloud_results = extract_with_gemini(full_text, api_key=gemini_api_key)
        if cloud_results and len(cloud_results) >= 5:
            logger.info(f"Successfully extracted {len(cloud_results)} concepts via Gemini Flash cloud.")
            return cloud_results, "cloud"

    # 2. Local Fallback Pipeline (Fast, offline)
    logger.info("Executing optimized local concept extraction pipeline...")
    nlp = get_spacy_nlp()

    # Pre-index sentences for O(1) definition detection
    all_sentences_flat: List[str] = []
    for ch in chunks:
        all_sentences_flat.extend(ch.get("sentences", []))
    cleaned_sentences, sentence_index = build_sentence_inverted_index(all_sentences_flat)

    # YAKE scores on full document
    doc_yake_scores = extract_yake_keyphrases(full_text[:35000], top_n=50)

    # Batch process chunk texts with nlp.pipe
    chunk_texts = [ch["text"] for ch in chunks]
    chunk_docs = list(nlp.pipe(chunk_texts, batch_size=32))

    candidate_occurrences: Dict[str, Dict[str, Any]] = {}
    chunk_concepts_map: Dict[int, Set[str]] = defaultdict(set)

    for ch, doc in zip(chunks, chunk_docs):
        ch_id = ch["id"]
        ch_heading = ch.get("heading", "General")
        ch_page = ch.get("page", 1)

        spacy_candidates = extract_candidates_from_spacy(doc)

        for cand in spacy_candidates:
            raw_name = strip_leader_dots(cand["text"])
            norm = normalize_phrase(raw_name)
            if not norm or not is_valid_candidate(norm):
                continue

            chunk_concepts_map[ch_id].add(raw_name)

            if norm not in candidate_occurrences:
                candidate_occurrences[norm] = {
                    "name": raw_name,
                    "frequency": 0,
                    "chunk_ids": set(),
                    "headings": [],
                    "page": ch_page,
                    "yake_score": doc_yake_scores.get(norm, 0.0)
                }

            candidate_occurrences[norm]["frequency"] += 1
            candidate_occurrences[norm]["chunk_ids"].add(ch_id)
            if ch_heading and ch_heading != "General":
                candidate_occurrences[norm]["headings"].append(ch_heading)

    if not candidate_occurrences:
        return [], "on-device"

    # Compute scores and detect definitions with token index
    candidates_list: List[Dict[str, Any]] = []
    max_freq = max((c["frequency"] for c in candidate_occurrences.values()), default=1)

    for norm_key, info in candidate_occurrences.items():
        name = strip_leader_dots(info["name"])
        freq = info["frequency"]
        yake_s = info["yake_score"]

        definition_sent, excerpt_sent = detect_definition_fast(
            name, cleaned_sentences, sentence_index
        )

        topic = "General"
        if info["headings"]:
            topic = Counter(info["headings"]).most_common(1)[0][0]
        elif info["chunk_ids"]:
            first_chunk_id = min(info["chunk_ids"])
            topic = chunks[first_chunk_id].get("heading", "General")

        freq_normalized = min(1.0, freq / max(1.0, math.sqrt(max_freq * 3)))
        heading_bonus = 0.15 if info["headings"] else 0.0
        def_bonus = 0.25 if definition_sent else 0.0

        base_score = (0.35 * yake_s) + (0.25 * freq_normalized) + heading_bonus + def_bonus
        score = min(1.0, max(0.05, round(base_score, 4)))

        clean_def = strip_leader_dots(definition_sent or "")
        clean_excerpt = strip_leader_dots(excerpt_sent or clean_def)

        candidates_list.append({
            "name": name,
            "frequency": freq,
            "score": score,
            "definition": clean_def,
            "source_excerpt": clean_excerpt,
            "topic": topic,
            "page": info["page"],
            "chunk_ids": list(info["chunk_ids"])
        })

    # Linear-time deduplication
    deduped = deduplicate_concepts_linear(candidates_list, nlp)
    deduped.sort(key=lambda x: x["score"], reverse=True)

    # Assign importance ratings
    top_concepts = assign_importance_ratings(deduped)

    # Compute relations with linear mapping
    final_names = {c["name"] for c in top_concepts}
    filtered_chunk_map: Dict[int, Set[str]] = defaultdict(set)
    for ch_id, names in chunk_concepts_map.items():
        for n in names:
            if n in final_names:
                filtered_chunk_map[ch_id].add(n)

    compute_related_concepts_linear(top_concepts, filtered_chunk_map)

    topic_orders: Dict[str, int] = defaultdict(int)
    for concept in sorted(top_concepts, key=lambda item: (int(item.get("page", 1)), item["name"].casefold())):
        topic = concept.get("topic") or "General"
        concept["flow_order"] = topic_orders[topic]
        concept["flow_group"] = topic
        topic_orders[topic] += 1

    return top_concepts, "on-device"
