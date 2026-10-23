import logging
import re
import string
from pathlib import Path
from typing import List, Optional

import nltk
from rake_nltk import Rake

from backend.compare.extractors.base import Extractor

logger = logging.getLogger("conceptlens.compare.rake")

# ==========================================
# Configurable Settings (Top of File)
# ==========================================
LANGUAGE = "english"
MIN_PHRASE_LENGTH = 1
MAX_PHRASE_LENGTH = 3
TOP_K = 30

NLTK_DATA_DIR = Path(__file__).resolve().parent.parent / ".nltk_data"
_nltk_initialized = False


def _ensure_nltk_data():
    """
    Ensures required NLTK data is stored ONLY inside backend/compare/.nltk_data/.
    Runs on first use, never at import time.
    Raises RuntimeError if data is missing and download fails.
    """
    global _nltk_initialized
    if _nltk_initialized:
        return

    NLTK_DATA_DIR.mkdir(parents=True, exist_ok=True)
    dir_str = str(NLTK_DATA_DIR)
    if dir_str not in nltk.data.path:
        nltk.data.path.insert(0, dir_str)

    required_packages = ["stopwords", "punkt", "punkt_tab"]
    for pkg in required_packages:
        lookup_path = f"tokenizers/{pkg}" if "punkt" in pkg else f"corpora/{pkg}"
        try:
            nltk.data.find(lookup_path)
        except (LookupError, OSError):
            try:
                nltk.download(pkg, download_dir=dir_str, quiet=True)
            except Exception as e:
                logger.warning(f"Could not download NLTK '{pkg}' to {dir_str}: {e}")

    # Verify essential resources exist
    try:
        nltk.data.find("corpora/stopwords")
    except LookupError:
        raise RuntimeError(
            f"NLTK 'stopwords' data missing in {dir_str} and automatic download failed. "
            "Skipping RAKE extractor."
        )

    _nltk_initialized = True


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


class RakeExtractor(Extractor):
    """
    Plug-in extractor using RAKE (Rapid Automatic Keyword Extraction via rake-nltk).
    Configurable min/max phrase lengths, English stopwords, and top-k ranking.
    """

    name = "rake"

    def __init__(
        self,
        language: str = LANGUAGE,
        min_length: int = MIN_PHRASE_LENGTH,
        max_length: int = MAX_PHRASE_LENGTH,
        top_k: int = TOP_K,
    ):
        self.language = language
        self.min_length = min_length
        self.max_length = max_length
        self.top_k = top_k

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        # Download / verify NLTK data on first use, never at import time
        _ensure_nltk_data()

        rake = Rake(
            language=self.language,
            min_length=self.min_length,
            max_length=self.max_length,
        )

        rake.extract_keywords_from_text(text)
        ranked_phrases = rake.get_ranked_phrases()

        cleaned_concepts: List[str] = []
        for raw_phrase in ranked_phrases:
            cleaned = clean_phrase(raw_phrase)

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
