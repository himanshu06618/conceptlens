"""
base.py - Abstract base class and common cleaning utilities for concept extractors.
"""

from abc import ABC, abstractmethod
import re
import string
from typing import List, Set


PREFIX_STRIP_PAT = re.compile(
    r"^(?:slide|page|ch(?:apter)?|sec(?:tion)?|fig(?:ure)?|unit|part|module)\s*\d+[\s\:\.\-\–\—]*",
    re.IGNORECASE
)


def clean_phrase(phrase: str) -> str:
    """
    Cleans an individual extracted phrase:
    - Lowercase
    - Strip slide/chapter/figure labels (e.g. 'Slide 2: Polarization' -> 'polarization')
    - Strip surrounding punctuation, quotes, symbols
    - Collapse extra whitespace
    """
    if not phrase:
        return ""
    # Lowercase
    cleaned = phrase.strip().lower()
    # Strip leading slide/chapter/figure markers
    cleaned = PREFIX_STRIP_PAT.sub("", cleaned).strip()
    # Strip non-ascii replacement characters \ufffd or corrupted bullets
    cleaned = re.sub(r"[\ufffd\u2022\u2023\u25e6\u2043\u2219]+", " ", cleaned)
    # Strip leading/trailing punctuation and quotation marks
    cleaned = cleaned.strip(string.punctuation + "“”‘’`'\"•-—–…")
    # Collapse multiple whitespaces
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def is_valid_phrase(phrase: str) -> bool:
    """
    Validates phrase:
    - Must have at least 2 characters
    - Must not be pure numbers (e.g. '123', '3.14')
    - Must contain at least one alphanumeric character
    """
    if not phrase or len(phrase) < 2:
        return False
    # Drop pure numbers or floats
    if re.match(r"^\d+(\.\d+)?$", phrase):
        return False
    # Must contain letters
    if not any(c.isalpha() for c in phrase):
        return False
    return True


def clean_phrases(phrases: List[str]) -> List[str]:
    """
    Common cleaning for all extractors:
    - Lowercase
    - Strip punctuation
    - Drop pure numbers and invalid phrases
    - Deduplicate while preserving first-seen order
    """
    seen: Set[str] = set()
    result: List[str] = []

    for raw in phrases:
        cleaned = clean_phrase(raw)
        if is_valid_phrase(cleaned) and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)

    return result


class Extractor(ABC):
    """
    Abstract Extractor interface.
    Each extractor subclass must implement `extract(text: str) -> list[str]`.
    """

    @abstractmethod
    def extract(self, text: str) -> List[str]:
        """
        Extract key concept phrases from text.

        Args:
            text: Raw input text from the uploaded document.

        Returns:
            List of cleaned, deduplicated concept phrases (strings).
        """
        pass
