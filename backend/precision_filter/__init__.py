"""
backend/precision_filter - Post-filter module for YAKE extraction output.
Removes junk phrases and enforces generic linguistic and structural rules.
"""

from .filter import filter_phrases

__all__ = ["filter_phrases"]
