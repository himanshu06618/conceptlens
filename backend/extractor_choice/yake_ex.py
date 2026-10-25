"""
yake_ex.py - YAKE (Yet Another Keyword Extractor) implementation.
Configurable parameters at the top of the file.
"""

import logging
from typing import List, Optional, Tuple
import yake

from .base import Extractor, clean_phrases, clean_phrase, is_valid_phrase

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

    def _determine_effective_top(self, text: str, requested_top: Optional[int] = None) -> int:
        if requested_top is not None and requested_top > 0:
            return requested_top
        # Scale dynamically for longer texts instead of arbitrarily capping at 30
        word_count = len(text.split())
        if word_count > 600:
            return max(self.top, min(350, word_count // 25))
        return self.top

    def extract(self, text: str, top: Optional[int] = None) -> List[str]:
        if not text or not text.strip():
            return []

        effective_top = self._determine_effective_top(text, requested_top=top)

        try:
            kw_extractor = yake.KeywordExtractor(
                lan=self.lan,
                n=self.n,
                dedupLim=self.dedup_lim,
                top=effective_top,
                windowsSize=self.windows_size,
                features=None
            )
            raw_results = kw_extractor.extract_keywords(text)
            # raw_results is a list of (keyword, score)
            phrases = [kw[0] for kw in raw_results]

            # PRECISION-FILTER-START
            try:
                import os
                if os.getenv("YAKE_PRECISION", "on").lower() not in ("off", "0", "false"):
                    try:
                        from precision_filter.filter import filter_phrases
                    except ImportError:
                        from backend.precision_filter.filter import filter_phrases
                    filtered = filter_phrases(raw_results, text)
                    if filtered is not None:
                        return filtered
            except Exception as e:
                logger.warning(f"Precision filter error in extract, falling back to raw YAKE: {e}")
            # PRECISION-FILTER-END

            return clean_phrases(phrases)
        except Exception as e:
            logger.error(f"YAKE extraction error: {e}", exc_info=True)
            return []

    def extract_with_scores(self, text: str, top: Optional[int] = None) -> List[Tuple[str, float]]:
        """
        Extracts keywords along with their YAKE scores (lower score = higher significance).
        Returns deduplicated (clean_phrase, score) tuples.
        """
        if not text or not text.strip():
            return []

        effective_top = self._determine_effective_top(text, requested_top=top)

        try:
            kw_extractor = yake.KeywordExtractor(
                lan=self.lan,
                n=self.n,
                dedupLim=self.dedup_lim,
                top=effective_top,
                windowsSize=self.windows_size,
                features=None
            )
            raw_results = kw_extractor.extract_keywords(text)
            results: List[Tuple[str, float]] = []
            seen = set()
            for kw, score in raw_results:
                cleaned = clean_phrase(kw)
                if is_valid_phrase(cleaned) and cleaned not in seen:
                    seen.add(cleaned)
                    results.append((cleaned, float(score)))

            # PRECISION-FILTER-START
            try:
                import os
                if os.getenv("YAKE_PRECISION", "on").lower() not in ("off", "0", "false"):
                    try:
                        from precision_filter.filter import filter_phrases
                    except ImportError:
                        from backend.precision_filter.filter import filter_phrases
                    filtered = filter_phrases(raw_results, text)
                    if filtered is not None:
                        keep_set = {f.lower().strip() for f in filtered}
                        return [(kw, score) for kw, score in results if kw.lower().strip() in keep_set]
            except Exception as e:
                logger.warning(f"Precision filter error in extract_with_scores, falling back to raw YAKE: {e}")
            # PRECISION-FILTER-END

            return results
        except Exception as e:
            logger.error(f"YAKE extraction error: {e}", exc_info=True)
            return []

