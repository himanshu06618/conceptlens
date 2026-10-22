from typing import List, Optional
import yake

from backend.compare.extractors.base import Extractor


class YakeExtractor(Extractor):
    """
    Plug-in extractor using YAKE (Yet Another Keyword Extractor).
    Extracts statistical n-gram keywords as concept candidates.
    """

    name = "yake"

    def __init__(
        self,
        language: str = "en",
        max_ngram_size: int = 3,
        top: int = 30,
        dedup_lim: float = 0.9,
        dedup_func: str = "seqm",
        windows_size: int = 1
    ):
        self.language = language
        self.max_ngram_size = max_ngram_size
        self.top = top
        self.dedup_lim = dedup_lim
        self.kw_extractor = yake.KeywordExtractor(
            lan=language,
            n=max_ngram_size,
            dedupLim=dedup_lim,
            dedupFunc=dedup_func,
            windowsSize=windows_size,
            top=top
        )

    def extract(self, text: str) -> List[str]:
        if not text or not text.strip():
            return []

        # YAKE returns list of (keyword, score) ordered by score ASC (lower score = higher relevance)
        keywords = self.kw_extractor.extract_keywords(text)
        extracted = []
        for kw, _score in keywords:
            cleaned = kw.strip()
            if cleaned and cleaned not in extracted:
                extracted.append(cleaned)
        return extracted
