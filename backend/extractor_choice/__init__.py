"""
ConceptLens Extractor Choice Module
Provides pluggable, flag-gated extraction methods (Gemini, YAKE).
This module is isolated and self-contained.
"""

from .registry import available, get_extractor
from .service import run_extraction

__all__ = ["available", "get_extractor", "run_extraction"]
