"""
service.py - Orchestrates extraction execution for pluggable methods.
Handles reading document text, invoking the chosen extractor, formatting concepts,
and falling back to Gemini if extraction fails.
"""

import logging
from pathlib import Path
from typing import Dict, Any, Optional, Union

from .registry import is_available, get_extractor
from .text_reader import read_text_from_file

logger = logging.getLogger("conceptlens.extractor.service")

SUPPORTED_LOCAL_METHODS = {"yake", "rake_textrank"}


def _format_concept_item(phrase: str, index: int) -> Dict[str, Any]:
    """
    Converts an extracted phrase into the exact concept format used by ConceptLens.
    Never invents data: definition, aliases, cues, and relations are set to null or empty.
    """
    clean_title = phrase.strip().title()
    return {
        "id": f"c_{index + 1}",
        "name": clean_title,
        "definition": None,
        "definition_cue": None,
        "aliases": [],
        "source_sentence": None,
        "location": None,
        "topic": "General",
        "chapter": "General",
        "score": 0.5,
        "importance": 2,
        "source_excerpt": "",
        "page": 1,
        "source_page": 1,
        "source_quote": "",
        "source_verified": False,
        "relations": [],
        "related_concepts": []
    }


def run_extraction(
    file: Union[str, Path],
    method: Optional[str] = "gemini",
    pdf_password: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Executes concept extraction for the requested method.

    Behavior:
    (a) Returns None immediately when method is 'gemini' or unknown,
        so the existing Gemini flow runs completely untouched.
    (b) For other methods (yake, rake_textrank, spacy):
        - Validates library availability.
        - Reads text from file via PyMuPDF or plain text reader.
        - Runs extractor.
        - Converts phrases into the standard ConceptLens concept object schema.
        - Returns {'concepts': [...], 'extractor_used': method, 'fallback': False}.
    (c) On any failure (missing library, scanned PDF / no text layer, empty extraction result),
        returns {'fallback': True, 'fallback_reason': '...'} so caller falls back to Gemini.
    """
    if not method:
        return None

    clean_method = method.strip().lower()

    # (a) Gemini or unknown method: return None so existing pipeline proceeds untouched
    if clean_method == "gemini" or clean_method not in SUPPORTED_LOCAL_METHODS:
        return None

    # (b) Check if requested method is installed and registered
    if not is_available(clean_method):
        logger.warning(f"Requested extractor '{clean_method}' is not available.")
        return {
            "fallback": True,
            "fallback_reason": f"Extractor '{clean_method}' is not installed or available."
        }

    # (c) Read document text
    try:
        text, fallback_reason = read_text_from_file(file, pdf_password=pdf_password)
    except Exception as e:
        logger.warning(f"Error reading document for extractor '{clean_method}': {e}")
        return {
            "fallback": True,
            "fallback_reason": f"Could not read document text: {e}"
        }

    if text is None:
        return {
            "fallback": True,
            "fallback_reason": fallback_reason or "Document contains no extractable text layer."
        }

    # (d) Instantiate extractor and run extraction
    extractor = get_extractor(clean_method)
    if not extractor:
        return {
            "fallback": True,
            "fallback_reason": f"Could not initialize extractor '{clean_method}'."
        }

    try:
        phrases = extractor.extract(text)
    except Exception as e:
        logger.exception(f"Extractor '{clean_method}' failed during extraction: {e}")
        return {
            "fallback": True,
            "fallback_reason": f"Extractor '{clean_method}' failed with error: {str(e)}"
        }

    if not phrases:
        logger.warning(f"Extractor '{clean_method}' returned 0 concept phrases.")
        return {
            "fallback": True,
            "fallback_reason": f"Extractor '{clean_method}' returned no concepts from the document."
        }

    # (e) Convert phrases into standard concept dictionary objects
    concepts = [_format_concept_item(phrase, idx) for idx, phrase in enumerate(phrases)]

    logger.info(
        f"Extraction with '{clean_method}' succeeded: {len(concepts)} concepts extracted."
    )

    return {
        "concepts": concepts,
        "extractor_used": clean_method,
        "fallback": False
    }
