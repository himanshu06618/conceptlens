"""
api.py - FastAPI router providing the GET /extractors endpoint.
Gated by the ENABLE_EXTRACTOR_CHOICE environment variable.
"""

import os
import logging
from fastapi import APIRouter, HTTPException

from .registry import available

logger = logging.getLogger("conceptlens.extractor.api")

router = APIRouter(tags=["extractors"])


def is_extractor_choice_enabled() -> bool:
    """Checks the ENABLE_EXTRACTOR_CHOICE feature flag."""
    val = os.getenv("ENABLE_EXTRACTOR_CHOICE", "").strip().lower()
    return val in ("true", "1", "yes", "on")


@router.get("/extractors")
@router.get("/api/extractors")
def get_available_extractors():
    """
    Returns the availability status of all concept extractors.
    When ENABLE_EXTRACTOR_CHOICE is False or unset, returns 404.
    """
    if not is_extractor_choice_enabled():
        raise HTTPException(
            status_code=404,
            detail="Extractor choice feature is disabled."
        )

    return available()
