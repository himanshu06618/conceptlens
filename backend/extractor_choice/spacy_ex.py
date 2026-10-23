"""
spacy_ex.py - spaCy noun chunks concept extractor.
Uses en_core_web_sm, lazy-loaded on first use (never at import time).
"""

import logging
from typing import List, Optional, Any

from .base import Extractor, clean_phrases

logger = logging.getLogger("conceptlens.extractor.spacy")

# --- Configuration Constants ---
MODEL_NAME: str = "en_core_web_sm"
TOP_K: int = 30
DETERMINERS = {"the", "a", "an", "this", "that", "these", "those"}
PRONOUNS = {
    "it", "they", "them", "he", "she", "him", "her", "we", "us", "you",
    "i", "me", "my", "your", "his", "their", "our", "its", "what", "which",
    "who", "whom", "whose", "this", "that", "someone", "anyone", "everyone",
    "something", "anything", "nothing", "everything"
}

_spacy_nlp: Optional[Any] = None


def get_spacy_nlp():
    """
    Lazy-loads the spaCy English model on first use.
    Never loads at module import time to protect startup memory.
    """
    global _spacy_nlp
    if _spacy_nlp is None:
        try:
            import spacy
            _spacy_nlp = spacy.load(MODEL_NAME, disable=["ner"])
        except Exception as e:
            logger.error(
                f"Failed to load spaCy model '{MODEL_NAME}'. "
                f"Ensure it is installed via: python -m spacy download {MODEL_NAME}. Error: {e}"
            )
            raise
    return _spacy_nlp


class SpacyExtractor(Extractor):
    """
    Grammar-based noun chunk extractor using spaCy.
    Extracts base noun phrases, strips determiners, filters out pronouns,
    and returns deduplicated key concepts.
    """

    def __init__(self, model_name: str = MODEL_NAME, top_k: int = TOP_K):
        self.model_name = model_name
        self.top_k = top_k

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        try:
            nlp = get_spacy_nlp()
        except Exception as e:
            logger.error(f"Cannot run spaCy extraction: {e}")
            raise

        # Process document through spaCy
        doc = nlp(text)
        raw_phrases: List[str] = []

        for chunk in doc.noun_chunks:
            # Drop if the root is a pronoun
            if chunk.root.pos_ == "PRON" or chunk.root.text.lower() in PRONOUNS:
                continue

            # Tokens in chunk
            words = [t.text for t in chunk]

            # Strip leading determiners (the, a, an, this, that, etc.)
            while words and words[0].lower() in DETERMINERS:
                words.pop(0)

            if not words:
                continue

            phrase = " ".join(words).strip()

            # Drop single-character items and pronouns
            if len(phrase) <= 1 or phrase.lower() in PRONOUNS:
                continue

            raw_phrases.append(phrase)

        cleaned = clean_phrases(raw_phrases)
        return cleaned[:self.top_k]
