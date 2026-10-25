"""
rake_textrank_ex.py - Hybrid RAKE + TextRank keyword extractor.
Combines Rapid Automatic Keyword Extraction (RAKE) and graph-based TextRank.
Configurable parameters at the top of the file.
"""

import logging
from pathlib import Path
from typing import List, Optional, Tuple
import nltk
from rake_nltk import Rake
from summa import keywords as summa_keywords

from .base import Extractor, clean_phrases, clean_phrase, is_valid_phrase

logger = logging.getLogger("conceptlens.extractor.rake_textrank")

# --- Configuration Constants ---
TOP_K: int = 30
MIN_PHRASE_LENGTH: int = 1
MAX_PHRASE_LENGTH: int = 3
LANGUAGE: str = "english"

# Standard English stopwords fallback to eliminate NLTK corpus dependency and disk reads
DEFAULT_ENGLISH_STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "ain", "all", "am", "an", "and", "any", "are", "aren",
    "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "couldn", "couldn't", "d", "did", "didn", "didn't", "do", "does", "doesn", "doesn't", "doing", "don",
    "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn", "hadn't", "has", "hasn",
    "hasn't", "have", "haven", "haven't", "having", "he", "her", "here", "hers", "herself", "him", "himself",
    "his", "how", "i", "if", "in", "into", "is", "isn", "isn't", "it", "it's", "its", "itself", "just", "ll",
    "m", "ma", "me", "mightn", "mightn't", "more", "most", "mustn", "mustn't", "my", "myself", "needn",
    "needn't", "no", "nor", "not", "now", "o", "of", "off", "on", "once", "only", "or", "other", "our", "ours",
    "ourselves", "out", "over", "own", "re", "s", "same", "shan", "shan't", "she", "she's", "should",
    "should've", "shouldn", "shouldn't", "so", "some", "such", "t", "than", "that", "that'll", "the", "their",
    "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
    "under", "until", "up", "ve", "very", "was", "wasn", "wasn't", "we", "were", "weren", "weren't", "what",
    "when", "where", "which", "while", "who", "whom", "why", "will", "with", "won", "won't", "wouldn",
    "wouldn't", "y", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves"
}

# NLTK data path isolated strictly inside this folder
NLTK_DATA_DIR: Path = Path(__file__).resolve().parent / ".nltk_data"

_nltk_initialized = False


def ensure_nltk_resources() -> None:
    """
    Ensures required NLTK resources (stopwords, punkt) are available in the isolated directory.
    Checks local availability first to avoid network latency on cloud instances.
    """
    global _nltk_initialized
    if _nltk_initialized:
        return

    data_dir_str = str(NLTK_DATA_DIR)
    NLTK_DATA_DIR.mkdir(parents=True, exist_ok=True)

    if data_dir_str not in nltk.data.path:
        nltk.data.path.insert(0, data_dir_str)

    # Check local availability first before attempting download
    resource_checks = [
        ("stopwords", "corpora/stopwords"),
        ("punkt", "tokenizers/punkt"),
        ("punkt_tab", "tokenizers/punkt_tab")
    ]
    for resource, path_suffix in resource_checks:
        try:
            nltk.data.find(path_suffix)
        except (LookupError, OSError):
            try:
                nltk.download(resource, download_dir=data_dir_str, quiet=True)
            except Exception as e:
                logger.warning(f"Could not download NLTK '{resource}' to {data_dir_str}: {e}")

    _nltk_initialized = True


class RakeTextRankExtractor(Extractor):
    """
    Hybrid extractor combining RAKE (co-occurrence statistics) and TextRank (graph ranking).
    Merges both lists, handles short text gracefully, and deduplicates phrases.
    """

    def __init__(
        self,
        top_k: int = TOP_K,
        min_length: int = MIN_PHRASE_LENGTH,
        max_length: int = MAX_PHRASE_LENGTH,
        language: str = LANGUAGE
    ):
        self.top_k = top_k
        self.min_length = min_length
        self.max_length = max_length
        self.language = language
        self._rake_instance: Optional[Rake] = None
        self._cached_stopwords: Optional[List[str]] = None

    def _determine_effective_top(self, text: str, requested_top: Optional[int] = None) -> int:
        if requested_top is not None and requested_top > 0:
            return requested_top
        word_count = len(text.split())
        if word_count > 600:
            return max(self.top_k, min(350, word_count // 25))
        return self.top_k

    def _get_stopwords(self) -> List[str]:
        if self._cached_stopwords is not None:
            return self._cached_stopwords
        try:
            sw = nltk.corpus.stopwords.words(self.language)
            self._cached_stopwords = list(sw)
        except Exception:
            self._cached_stopwords = list(DEFAULT_ENGLISH_STOPWORDS)
        return self._cached_stopwords

    def _get_rake(self) -> Rake:
        if self._rake_instance is None:
            sw = self._get_stopwords()
            self._rake_instance = Rake(
                stopwords=sw,
                min_length=self.min_length,
                max_length=self.max_length
            )
        return self._rake_instance

    def _extract_rake(self, text: str, top: Optional[int] = None) -> List[str]:
        """Extract phrases using RAKE with cached instance."""
        try:
            r = self._get_rake()
            r.extract_keywords_from_text(text)
            limit = top if (top and top > 0) else self.top_k
            return r.get_ranked_phrases()[:limit]
        except Exception as e:
            logger.warning(f"RAKE extraction error: {e}")
            return []

    def _extract_textrank(self, text: str, top: Optional[int] = None) -> List[str]:
        """Extract phrases using TextRank (Summa) with short-text guard."""
        # Summa TextRank builds a graph and runs PageRank power iterations.
        # Short slide bullet points (<80 words) fail or cause IndexError.
        words = text.split()
        if len(words) < 80:
            return []
        try:
            limit = min(top if (top and top > 0) else self.top_k, 30)
            raw = summa_keywords.keywords(text, language=self.language, words=limit)
            if not raw or not raw.strip():
                return []
            return [line.strip() for line in raw.split("\n") if line.strip()]
        except Exception as e:
            logger.debug(f"TextRank extraction skipped: {e}")
            return []

    def extract(self, text: str, top: Optional[int] = None) -> List[str]:
        if not text or not text.strip():
            return []

        # Download/verify NLTK data on first extraction call
        ensure_nltk_resources()

        effective_top = self._determine_effective_top(text, requested_top=top)

        rake_phrases = self._extract_rake(text, top=effective_top)
        textrank_phrases = self._extract_textrank(text, top=effective_top)

        # If TextRank returns nothing (e.g. short text), use RAKE only
        if not textrank_phrases:
            combined = rake_phrases
        elif not rake_phrases:
            combined = textrank_phrases
        else:
            # Interleave top phrases to balance both statistical and graph methods
            combined = []
            max_len = max(len(rake_phrases), len(textrank_phrases))
            for i in range(max_len):
                if i < len(rake_phrases):
                    combined.append(rake_phrases[i])
                if i < len(textrank_phrases):
                    combined.append(textrank_phrases[i])

        # PRECISION-FILTER-START
        try:
            import os
            if os.getenv("RAKE_PRECISION", "on").lower() not in ("off", "0", "false"):
                try:
                    from precision_filter.filter import filter_phrases
                except ImportError:
                    from backend.precision_filter.filter import filter_phrases
                filtered = filter_phrases(combined, text)
                if filtered is not None:
                    return filtered[:effective_top]
        except Exception as e:
            logger.warning(f"Precision filter error in RAKE extract, falling back to raw: {e}")
        # PRECISION-FILTER-END

        cleaned = clean_phrases(combined)
        return cleaned[:effective_top]

    def extract_with_scores(self, text: str, top: Optional[int] = None) -> List[Tuple[str, float]]:
        """
        Extracts keywords along with RAKE scores.
        Returns deduplicated (clean_phrase, score) tuples.
        """
        if not text or not text.strip():
            return []

        ensure_nltk_resources()
        effective_top = self._determine_effective_top(text, requested_top=top)

        try:
            r = self._get_rake()
            r.extract_keywords_from_text(text)
            ranked = r.get_ranked_phrases_with_scores()[:effective_top * 2]
            raw_tuples = [(phrase, float(score)) for score, phrase in ranked]

            # PRECISION-FILTER-START
            try:
                import os
                if os.getenv("RAKE_PRECISION", "on").lower() not in ("off", "0", "false"):
                    try:
                        from precision_filter.filter import filter_phrases
                    except ImportError:
                        from backend.precision_filter.filter import filter_phrases
                    filtered = filter_phrases([t[0] for t in raw_tuples], text)
                    if filtered is not None:
                        keep_map = {f.lower().strip(): f for f in filtered}
                        res: List[Tuple[str, float]] = []
                        seen = set()
                        for phrase, score in raw_tuples:
                            cleaned = clean_phrase(phrase)
                            k = cleaned.lower()
                            if k in keep_map and k not in seen:
                                seen.add(k)
                                res.append((keep_map[k], score))
                                if len(res) >= effective_top:
                                    break
                        return res
            except Exception as e:
                logger.warning(f"Precision filter error in RAKE extract_with_scores: {e}")
            # PRECISION-FILTER-END

            res: List[Tuple[str, float]] = []
            seen = set()
            for phrase, score in raw_tuples:
                cleaned = clean_phrase(phrase)
                if is_valid_phrase(cleaned) and cleaned not in seen:
                    seen.add(cleaned)
                    res.append((cleaned, score))
                    if len(res) >= effective_top:
                        break
            return res
        except Exception as e:
            logger.error(f"RAKE extract_with_scores error: {e}", exc_info=True)
            return []
