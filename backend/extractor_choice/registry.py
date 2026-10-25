"""
registry.py - Defensive registry for pluggable concept extractors.
Gracefully skips extractors whose dependencies or models are missing.
"""

import logging
from typing import Dict, Type, Optional
from .base import Extractor

logger = logging.getLogger("conceptlens.extractor.registry")

AVAILABLE_EXTRACTORS: Dict[str, Type[Extractor]] = {}

# 1. YAKE Extractor
try:
    import yake  # noqa: F401
    from .yake_ex import YakeExtractor
    AVAILABLE_EXTRACTORS["yake"] = YakeExtractor
    logger.info("Registered 'yake' extractor successfully.")
except Exception as e:
    logger.warning(f"Could not register 'yake' extractor: {e}")

def available() -> Dict[str, bool]:
    """
    Returns dictionary of availability for all extraction methods.
    'gemini' is always True as the core baseline extractor.
    """
    return {
        "gemini": True,
        "yake": "yake" in AVAILABLE_EXTRACTORS
    }


def is_available(name: str) -> bool:
    """Checks whether an extraction method is available."""
    if not name:
        return False
    name_clean = name.strip().lower()
    if name_clean == "gemini":
        return True
    return name_clean in AVAILABLE_EXTRACTORS


def get_extractor(name: str) -> Optional[Extractor]:
    """
    Returns an instance of the requested extractor if available, or None.
    """
    if not name:
        return None
    name_clean = name.strip().lower()
    cls = AVAILABLE_EXTRACTORS.get(name_clean)
    if cls:
        return cls()
    return None
