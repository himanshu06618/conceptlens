from abc import ABC, abstractmethod
from typing import List


class Extractor(ABC):
    """
    Abstract base class for benchmark concept extractors.
    Each extractor implementation must take input text and return a list of concept names.
    """

    name: str

    @abstractmethod
    def extract(self, text: str) -> List[str]:
        """
        Extract concept names from plain-text notes.

        Args:
            text: Raw input text from course notes.

        Returns:
            List of extracted concept names as strings.
        """
        pass
