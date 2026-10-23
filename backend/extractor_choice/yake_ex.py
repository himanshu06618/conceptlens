"""
yake_ex.py - YAKE (Yet Another Keyword Extractor) implementation.
Configurable parameters at the top of the file.
"""

import logging
from typing import List
import yake

from .base import Extractor, clean_phrases

logger = logging.getLogger("conceptlens.extractor.yake")

# --- Configuration Constants ---
LANGUAGE: str = "en"
MAX_NGRAM_SIZE: int = 3
DEDUPLICATION_THRESHOLD: float = 0.9
NUM_KEYWORDS: int = 30
WINDOWS_SIZE: int = 1


class YakeExtractor(Extractor):
    """
    Unsupervised statistical keyword extractor using YAKE.
    Scores text using statistical features (casing, word frequency, context).
    Lower scores indicate more salient keywords.
    """

    def __init__(
        self,
        lan: str = LANGUAGE,
        n: int = MAX_NGRAM_SIZE,
        dedup_lim: float = DEDUPLICATION_THRESHOLD,
        top: int = NUM_KEYWORDS,
        windows_size: int = WINDOWS_SIZE
    ):
        self.lan = lan
        self.n = n
        self.dedup_lim = dedup_lim
        self.top = top
        self.windows_size = windows_size

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        try:
            kw_extractor = yake.KeywordExtractor(
                lan=self.lan,
                n=self.n,
                dedupLim=self.dedup_lim,
                top=self.top,
                windowsSize=self.windows_size,
                features=None
            )
            raw_results = kw_extractor.extract_keywords(text)
            # raw_results is a list of (keyword, score)
            phrases = [kw[0] for kw in raw_results]
            return clean_phrases(phrases)
        except Exception as e:
            logger.error(f"YAKE extraction error: {e}", exc_info=True)
            return []
