"""
text_reader.py - Reads uploaded files into plain text for local extractors.
Uses PyMuPDF (fitz) for PDFs. If PyMuPDF is missing, a PDF has no text layer (scanned),
or the file is an image, returns None with a clear reason so the caller falls back to Gemini.
Plain text files (.txt, .md) are read directly.
"""

import logging
import re
from pathlib import Path
from typing import Optional, Tuple, Union

logger = logging.getLogger("conceptlens.extractor.text_reader")

TEXT_EXTENSIONS = {".txt", ".md"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
PDF_EXTENSIONS = {".pdf"}


def is_text_usable(text: str) -> bool:
    """
    Checks if extracted page text is meaningful and not pure garbage / scanned noise.
    """
    if not text or len(text.strip()) < 20:
        return False

    cleaned = text.strip()
    total_len = len(cleaned)
    letters = sum(1 for c in cleaned if c.isalpha())
    letter_share = letters / max(1, total_len)

    if letter_share < 0.25:
        return False

    # Check for excessive unprintable / CID markers
    cid_count = len(re.findall(r"\(cid:\d+\)", cleaned))
    if cid_count > 5 or (cid_count * 5 / total_len) > 0.15:
        return False

    if cleaned.count("\ufffd") > 6:
        return False

    return True


def clean_text_layer(text: str) -> str:
    """Cleans up raw extracted text from PDFs or text files."""
    if not text:
        return ""
    # Strip TOC leader dots
    text = re.sub(r"(?:\.\s*){3,}", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def read_text_from_file(file_path: Union[str, Path], pdf_password: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Reads plain text from an uploaded file for lightweight keyword extraction.

    Returns:
        (text, fallback_reason)
        If text is readable: (extracted_text, None)
        If text cannot be extracted: (None, fallback_reason_string)
    """
    path = Path(file_path)
    if not path.exists():
        return None, f"File not found: {path.name}"

    if path.stat().st_size == 0:
        return None, "The uploaded file is empty (0 bytes)."

    ext = path.suffix.lower()

    # 1. Plain Text / Markdown
    if ext in TEXT_EXTENSIONS:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            cleaned = clean_text_layer(raw)
            if not cleaned or len(cleaned.strip()) < 10:
                return None, "Text file contains insufficient content for concept extraction."
            return cleaned, None
        except Exception as e:
            return None, f"Could not read text file: {e}"

    # 2. Images (PNG, JPG, WEBP) -> no text layer, requires Gemini
    if ext in IMAGE_EXTENSIONS:
        return None, "Image files have no text layer and require Gemini multimodal extraction."

    # 3. PDF Files
    if ext in PDF_EXTENSIONS:
        # Check if PyMuPDF (fitz) is available
        try:
            import pymupdf as fitz
        except ImportError:
            try:
                import fitz
            except ImportError:
                return None, "PyMuPDF is not installed to read PDF text."

        try:
            doc = fitz.open(str(path))
        except Exception as e:
            return None, f"Could not open PDF file: {e}"

        try:
            if doc.is_encrypted:
                if not pdf_password or not doc.authenticate(pdf_password):
                    return None, "This PDF is password-protected and could not be decrypted."

            if len(doc) == 0:
                return None, "The PDF contains 0 pages."

            full_text_parts = []
            usable_pages_count = 0

            for p_idx in range(len(doc)):
                page = doc[p_idx]
                raw_page_text = page.get_text("text", sort=True)
                cleaned_page = clean_text_layer(raw_page_text)
                if is_text_usable(cleaned_page):
                    usable_pages_count += 1
                    full_text_parts.append(cleaned_page)

            full_text = "\n\n".join(full_text_parts).strip()

            if usable_pages_count == 0 or len(full_text) < 40:
                return None, "PDF has no selectable text layer (scanned or image-only document)."

            return full_text, None
        finally:
            doc.close()

    return None, f"Unsupported file type '{ext}' for local extraction."
