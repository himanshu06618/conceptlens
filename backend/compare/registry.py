import logging
from typing import Dict, Type, List
from backend.compare.extractors.base import Extractor

logger = logging.getLogger("conceptlens.compare.registry")

AVAILABLE_EXTRACTORS: Dict[str, Type[Extractor]] = {}

# 1. Register Gemini reference extractor (always available if credentials present)
try:
    from backend.compare.extractors.gemini_ex import GeminiExtractor
    AVAILABLE_EXTRACTORS["gemini"] = GeminiExtractor
except Exception as e:
    logger.warning(f"Could not register 'gemini' extractor: {e}")

# 2. Register RAKE extractor (plug-in file; deleting rake_ex.py leaves other extractors working)
try:
    from backend.compare.extractors.rake_ex import RakeExtractor
    AVAILABLE_EXTRACTORS["rake"] = RakeExtractor
except Exception as e:
    logger.warning(f"Could not register 'rake' extractor: {e}")

# 3. Register TextRank extractor (plug-in file; deleting textrank_ex.py leaves other extractors working)
try:
    from backend.compare.extractors.textrank_ex import TextRankExtractor
    AVAILABLE_EXTRACTORS["textrank"] = TextRankExtractor
except Exception as e:
    logger.warning(f"Could not register 'textrank' extractor: {e}")


def get_extractor(name: str, **kwargs) -> Extractor:
    """Instantiate a registered extractor by name."""
    norm_name = name.lower().strip()
    if norm_name not in AVAILABLE_EXTRACTORS:
        available = list(AVAILABLE_EXTRACTORS.keys())
        raise KeyError(
            f"Extractor '{name}' is not registered or its dependencies failed to load. "
            f"Available extractors: {available}"
        )
    return AVAILABLE_EXTRACTORS[norm_name](**kwargs)


def list_extractors() -> Dict[str, Type[Extractor]]:
    """Return dictionary of currently available extractor classes."""
    return dict(AVAILABLE_EXTRACTORS)


def list_available_extractors() -> List[str]:
    """Return list of names of currently available extractors."""
    return list(AVAILABLE_EXTRACTORS.keys())
