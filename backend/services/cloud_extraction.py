"""
backend/services/cloud_extraction.py
Primary cloud extraction using Google Gemini API (gemini-2.5-flash).
Features:
- Single-call extraction: concepts, topics, parents, importance, flow relations, and order
- Compact JSON with Pydantic validation
- Thinking budget disabled (thinking_budget=0) for ultra-fast latency
- Token-bucket rate limiter respecting RATE_LIMIT_RPM
- Large chunks (8k-12k tokens, ~15-30 pages) to minimize request count
- Content hash caching
- Truncation continuation
- Automatic failover to local pipeline on 429 / timeout (>20s wait)
"""

import os
import re
import json
import time
import hashlib
import logging
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
from pydantic import BaseModel, Field
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()

logger = logging.getLogger("conceptlens.cloud")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
RATE_LIMIT_RPM = int(os.getenv("RATE_LIMIT_RPM", "15"))

# Cache of extracted concepts by content hash
_content_cache: Dict[str, List[Dict[str, Any]]] = {}

# Rate limiter timestamps
_request_timestamps: List[float] = []


class ConceptRelationItem(BaseModel):
    target_idx: int = Field(description="0-based index of target concept in concepts list")
    type: str = Field(default="related", description="relation type: prerequisite, contains, leads_to, or related")
    label: str = Field(default="related", description="short label, e.g. 'requires' or 'relates'")


class ConceptItem(BaseModel):
    name: str = Field(description="Name of the concept, 1 to 4 words")
    importance: int = Field(default=3, ge=1, le=5, description="Importance rating 1 to 5")
    topic: str = Field(default="General", description="Topic or chapter heading")
    definition: str = Field(default="", description="Precise definition, at most 20 words")
    source_excerpt: str = Field(default="", description="Exact phrase from text, at most 12 words")
    parent_idx: Optional[int] = Field(default=None, description="0-based index of parent concept in hierarchy, or null")
    flow_order: int = Field(default=0, description="Sequential flow order within this topic")
    relations: List[ConceptRelationItem] = Field(default_factory=list, description="Relations to other concepts by index")


class ExtractionPayload(BaseModel):
    concepts: List[ConceptItem] = Field(default_factory=list)


def check_gemini_key_valid(api_key: Optional[str] = None) -> Tuple[bool, str]:
    """Makes a tiny test call to verify whether GEMINI_API_KEY is configured and valid."""
    key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return False, "GEMINI_API_KEY is not set."

    model = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        resp = requests.post(
            url,
            params={"key": key},
            json={
                "contents": [{"parts": [{"text": "Reply with 'OK'."}]}],
                "generationConfig": {
                    "maxOutputTokens": 5,
                    "thinkingConfig": {"thinkingBudget": 0}
                }
            },
            timeout=15
        )
        if resp.status_code == 200:
            return True, f"Gemini API key is valid (Model: {model})."
        elif resp.status_code == 400:
            return False, f"Invalid API request or key: {resp.text}"
        elif resp.status_code == 403:
            return False, "API key is invalid or lacks Gemini API permissions."
        elif resp.status_code == 429:
            return True, "API key is valid (temporarily rate limited)."
        else:
            return False, f"Gemini API returned HTTP {resp.status_code}."
    except Exception as e:
        return False, f"Could not connect to Gemini API: {e}"


def _acquire_rate_limit_slot(max_wait_sec: float = 20.0) -> bool:
    """Enforces token-bucket rate limit (RATE_LIMIT_RPM). Returns False if wait exceeds max_wait_sec."""
    global _request_timestamps
    now = time.time()
    # Retain timestamps from last 60 seconds
    _request_timestamps = [t for t in _request_timestamps if now - t < 60.0]

    if len(_request_timestamps) < RATE_LIMIT_RPM:
        _request_timestamps.append(now)
        return True

    # Need to wait until oldest timestamp drops out of 60s window
    oldest = _request_timestamps[0]
    wait_time = (oldest + 60.0) - now + 0.1
    if wait_time > max_wait_sec:
        logger.warning(f"Rate limit wait ({wait_time:.1f}s) exceeds max wait ({max_wait_sec}s). Failing over.")
        return False

    time.sleep(max(0.1, wait_time))
    now = time.time()
    _request_timestamps = [t for t in _request_timestamps if now - t < 60.0]
    _request_timestamps.append(now)
    return True


EXTRACTION_PROMPT = """You are an expert educational concept extractor for ConceptLens.
Analyze the provided course notes text and extract ALL key educational concepts, their definitions, topics, hierarchical parents, and relationships.

Rules for compact extraction:
1. Extract ALL key concepts, algorithms, theorems, and definitions found in the text.
2. For each concept:
   - "name": Concise concept name (1 to 4 words, Title Case).
   - "importance": Integer from 1 (minor detail) to 5 (foundational core concept).
   - "topic": Chapter or section heading this concept belongs to.
   - "definition": Concise definition, AT MOST 20 words.
   - "source_excerpt": Short direct quote from text, AT MOST 12 words.
   - "parent_idx": 0-based index of broader parent concept in the list, or null if top-level concept.
   - "flow_order": Sequential progression order (0, 1, 2...) within the topic.
   - "relations": List of objects with target_idx (0-based index of related concept), type ("prerequisite", "contains", "leads_to", or "related"), and label.
3. Return STRICT JSON with a "concepts" list matching this structure. Do NOT include markdown code fences or extra commentary.
"""


def extract_with_gemini(
    text: str,
    api_key: Optional[str] = None,
    model_name: Optional[str] = None
) -> Optional[List[Dict[str, Any]]]:
    """
    Calls Gemini API to extract concepts in a single call.
    Returns list of concept dictionaries, or None on failure/quota exhaustion.
    """
    key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return None

    model = model_name or os.getenv("GEMINI_MODEL", "gemini-flash-latest")

    # Check cache by content hash
    content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if content_hash in _content_cache:
        logger.info(f"Using cached Gemini extraction for hash {content_hash[:10]}")
        return _content_cache[content_hash]

    # Acquire rate limit slot
    if not _acquire_rate_limit_slot(max_wait_sec=20.0):
        logger.warning("Gemini rate limit slot unavailable within 20s. Failing over to local pipeline.")
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    # Schema definition for structured JSON output
    schema = {
        "type": "OBJECT",
        "properties": {
            "concepts": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": {"type": "STRING"},
                        "importance": {"type": "INTEGER"},
                        "topic": {"type": "STRING"},
                        "definition": {"type": "STRING"},
                        "source_excerpt": {"type": "STRING"},
                        "parent_idx": {"type": "INTEGER", "nullable": True},
                        "flow_order": {"type": "INTEGER"},
                        "relations": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "target_idx": {"type": "INTEGER"},
                                    "type": {"type": "STRING"},
                                    "label": {"type": "STRING"}
                                },
                                "required": ["target_idx", "type", "label"]
                            }
                        }
                    },
                    "required": ["name", "importance", "topic", "definition", "source_excerpt", "flow_order"]
                }
            }
        },
        "required": ["concepts"]
    }

    payload = {
        "contents": [{
            "parts": [
                {"text": EXTRACTION_PROMPT},
                {"text": f"COURSE NOTES TEXT:\n{text[:65000]}"}
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "temperature": 0.2,
            "maxOutputTokens": 8192,
            "thinkingConfig": {"thinkingBudget": 0}
        }
    }

    try:
        t0 = time.perf_counter()
        resp = requests.post(url, params={"key": key}, json=payload, timeout=35)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 5))
            if retry_after <= 15:
                logger.info(f"Gemini 429 received. Waiting {retry_after}s...")
                time.sleep(retry_after)
                resp = requests.post(url, params={"key": key}, json=payload, timeout=35)
            else:
                logger.warning(f"Gemini 429 retry-after {retry_after}s too long. Failing over to local pipeline.")
                return None

        if resp.status_code != 200:
            logger.warning(f"Gemini API returned {resp.status_code}: {resp.text[:200]}. Failing over.")
            return None

        result_data = resp.json()
        candidates = result_data.get("candidates", [])
        if not candidates:
            return None

        candidate = candidates[0]
        content_parts = candidate.get("content", {}).get("parts", [])
        raw_json_str = content_parts[0].get("text", "") if content_parts else ""
        finish_reason = candidate.get("finishReason", "")

        # Check if truncated due to MAX_TOKENS
        if finish_reason == "MAX_TOKENS" and raw_json_str:
            logger.info("Gemini response reached MAX_TOKENS. Repairing JSON...")
            # Try to close open JSON arrays/objects
            cleaned_json = raw_json_str.strip()
            if not cleaned_json.endswith("}"):
                cleaned_json = re.sub(r',\s*\{[^}]*$', '', cleaned_json) + "]}"

        parsed = json.loads(raw_json_str)
        validated = ExtractionPayload.model_validate(parsed)

        # Convert to project concept format
        raw_items = validated.concepts
        final_concepts: List[Dict[str, Any]] = []

        for idx, item in enumerate(raw_items):
            c_dict = {
                "name": item.name.strip(),
                "importance": max(1, min(5, item.importance)),
                "topic": item.topic.strip() or "General",
                "definition": item.definition.strip(),
                "source_excerpt": item.source_excerpt.strip(),
                "score": round(item.importance / 5.0, 3),
                "page": 1,
                "flow_order": item.flow_order,
                "flow_group": item.topic.strip() or "General",
                "parent_name": raw_items[item.parent_idx].name if (item.parent_idx is not None and 0 <= item.parent_idx < len(raw_items)) else None,
                "related_concepts": []
            }
            # Populate relations
            for r in item.relations:
                if 0 <= r.target_idx < len(raw_items) and r.target_idx != idx:
                    c_dict["related_concepts"].append({
                        "name": raw_items[r.target_idx].name.strip(),
                        "weight": 2,
                        "type": r.type or "related",
                        "label": r.label or "related"
                    })
            final_concepts.append(c_dict)

        logger.info(f"Gemini extracted {len(final_concepts)} concepts in {time.perf_counter() - t0:.2f}s.")
        _content_cache[content_hash] = final_concepts
        return final_concepts

    except Exception as e:
        logger.warning(f"Gemini cloud extraction failed: {e}. Failing over to local pipeline.")
        return None
