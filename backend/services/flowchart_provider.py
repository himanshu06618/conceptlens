import json
import logging
import os
from typing import Any, Dict, List

import requests

logger = logging.getLogger("conceptlens.flowchart_provider")


def enrich_flowchart_with_cloud(concepts: List[Dict[str, Any]], raw_text: str) -> Dict[str, Any]:
    provider = os.getenv("FLOWCHART_PROVIDER", "offline").strip().lower()
    if provider == "offline":
        return {"provider": "offline", "relations": []}
    if provider not in {"gemini", "groq", "auto"}:
        raise ValueError(f"Unsupported FLOWCHART_PROVIDER: {provider}")
    selected = provider
    if selected == "auto":
        selected = "gemini" if os.getenv("GEMINI_API_KEY") else "groq"
    api_key = os.getenv("GEMINI_API_KEY" if selected == "gemini" else "GROQ_API_KEY")
    if not api_key:
        logger.warning("%s selected without an API key; using offline flow data.", selected)
        return {"provider": "offline", "relations": []}
    concept_names = [str(item.get("name", "")) for item in concepts]
    prompt = (
        "Return only JSON with a relations array. Each relation must contain source, target, type, and label. "
        "Use only supplied concept names and explicit relations supported by the text. "
        f"Concepts: {json.dumps(concept_names, ensure_ascii=False)}\nText:\n{raw_text}"
    )
    try:
        if selected == "gemini":
            model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                params={"key": api_key},
                json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json"}},
                timeout=45,
            )
            response.raise_for_status()
            content = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        else:
            model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "messages": [{"role": "user", "content": prompt}], "response_format": {"type": "json_object"}},
                timeout=45,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        payload = json.loads(content)
        if not isinstance(payload, dict) or not isinstance(payload.get("relations"), list):
            raise ValueError("Cloud response must be a JSON object containing a relations list.")
        allowed = {name.casefold() for name in concept_names}
        relations = [
            item for item in payload.get("relations", [])
            if isinstance(item, dict)
            and str(item.get("source", "")).casefold() in allowed
            and str(item.get("target", "")).casefold() in allowed
            and str(item.get("source", "")).casefold() != str(item.get("target", "")).casefold()
        ]
        return {"provider": selected, "relations": relations}
    except (requests.RequestException, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        logger.exception("Cloud flowchart enrichment failed; retaining offline relations: %s", exc)
        return {"provider": "offline", "relations": []}


def apply_flowchart_enrichment(concepts: List[Dict[str, Any]], enrichment: Dict[str, Any]) -> None:
    by_name = {str(item.get("name", "")).casefold(): item for item in concepts}
    for relation in enrichment.get("relations", []):
        source = by_name.get(str(relation.get("source", "")).casefold())
        if source:
            source.setdefault("related_concepts", []).append({
                "name": relation["target"],
                "weight": 2,
                "type": str(relation.get("type", "related")),
                "label": str(relation.get("label", "related")),
            })
