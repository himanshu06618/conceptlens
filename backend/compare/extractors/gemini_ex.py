import os
import tempfile
import logging
from pathlib import Path
from typing import List, Optional

from backend.compare.extractors.base import Extractor

logger = logging.getLogger("conceptlens.compare.gemini")


class GeminiExtractor(Extractor):
    """
    Wrapper reusing the existing ConceptLens Gemini extraction pipeline.
    Returns extracted concept names only.
    """

    name = "gemini"

    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        try:
            from backend.services.cloud_extraction import extract_document_with_gemini
        except ImportError:
            from services.cloud_extraction import extract_document_with_gemini

        # Write text to a temporary .txt file to leverage existing pipeline
        with tempfile.NamedTemporaryFile(suffix=".txt", mode="w", encoding="utf-8", delete=False) as tmp:
            tmp.write(text)
            tmp_path = Path(tmp.name)

        try:
            results = extract_document_with_gemini(
                file_path=tmp_path,
                mime_type="text/plain",
                model_name=self.model_name
            )
            concepts = []
            for item in results:
                name = item.get("name") if isinstance(item, dict) else getattr(item, "name", None)
                if name and isinstance(name, str) and name.strip():
                    cleaned = name.strip()
                    if cleaned not in concepts:
                        concepts.append(cleaned)
            return concepts
        except Exception as e:
            logger.warning(f"Gemini extractor call failed: {e}")
            raise
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
