import logging
import re
import string
from typing import List

from summa import keywords

from backend.compare.extractors.base import Extractor

logger = logging.getLogger("conceptlens.compare.textrank")

# ==========================================
# Configurable Settings (Top of File)
# ==========================================
LANGUAGE = "english"
TOP_K = 30
SCORES = False


def clean_phrase(phrase: str) -> str:
    """
    Clean concept string:
    - Lowercase
    - Strip punctuation
    - Collapse whitespace
    """
    if not phrase:
        return ""
    phrase = phrase.lower().strip()
    for ch in string.punctuation:
        phrase = phrase.replace(ch, " ")
    return " ".join(phrase.split())


class TextRankExtractor(Extractor):
    """
    Plug-in extractor using TextRank (via the lightweight summa library).
    Graph-based keyword and adjacent-token phrase extraction.
    No model downloads or heavyweight NLP dependencies.
    """

    name = "textrank"

    def __init__(
        self,
        language: str = LANGUAGE,
        top_k: int = TOP_K,
        scores: bool = SCORES,
    ):
        self.language = language
        self.top_k = top_k
        self.scores = scores

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        try:
            # summa's keywords() merges adjacent tokens that appear next to each other
            # in the text into n-gram phrases automatically.
            try:
                raw_keywords = keywords.keywords(
                    text,
                    words=self.top_k,
                    language=self.language,
                    scores=self.scores,
                    split=True,
                )
            except IndexError:
                # If text has fewer unique tokens than self.top_k, fallback to ratio=1.0
                raw_keywords = keywords.keywords(
                    text,
                    ratio=1.0,
                    language=self.language,
                    scores=self.scores,
                    split=True,
                )
        except Exception as e:
            # If text is too short or graph is empty, return empty list gracefully
            logger.debug(f"TextRank returned nothing or encountered error on text: {e}")
            return []

        if not raw_keywords:
            return []

        cleaned_concepts: List[str] = []
        for raw_item in raw_keywords:
            cleaned = clean_phrase(raw_item)

            # Drop empty or single-character items
            if len(cleaned) <= 1:
                continue

            # Drop pure numbers
            if cleaned.isdigit() or re.fullmatch(r"[\d\s.,\-]+", cleaned):
                continue

            # Deduplicate while preserving score order
            if cleaned not in cleaned_concepts:
                cleaned_concepts.append(cleaned)

            if len(cleaned_concepts) >= self.top_k:
                break

        return cleaned_concepts
