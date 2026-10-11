"""
backend/services/file_reader.py
Lightweight document reader using PyMuPDF (fitz) only.
Completely eliminates heavy OCR dependencies (RapidOCR, Tesseract, OpenCV).
Multimodal PDFs and images are sent directly to the Gemini API.
For fallback scenarios, this module provides fast, zero-dependency text extraction for digital PDFs and text files.
"""

import os
import re
import logging
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path
import pymupdf as fitz
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("conceptlens.reader")

# Supported file extensions
TEXT_EXTENSIONS = {".txt", ".md"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
PDF_EXTENSIONS = {".pdf"}
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | IMAGE_EXTENSIONS | PDF_EXTENSIONS


class UnsupportedFileTypeError(Exception):
    pass


class EmptyFileError(Exception):
    pass


class EncryptedPdfError(Exception):
    pass


class CorruptedPdfError(Exception):
    pass


class ScannedNoOcrError(Exception):
    pass


def is_text_usable(text: str) -> bool:
    """
    Quality check per page:
    Rejects text that is too short (<20 chars), mostly non-letters,
    or contains excessive unprintable / replacement markers.
    """
    if not text or len(text.strip()) < 20:
        return False

    cleaned = text.strip()
    total_len = len(cleaned)
    letters = sum(1 for c in cleaned if c.isalpha())
    letter_share = letters / max(1, total_len)

    if letter_share < 0.25:
        return False

    # Check for (cid:xx) markers
    cid_count = len(re.findall(r"\(cid:\d+\)", cleaned))
    if cid_count > 5 or (cid_count * 5 / total_len) > 0.15:
        return False

    # Check for unicode replacement chars (\ufffd)
    if cleaned.count("\ufffd") > 6:
        return False

    return True


def clean_page_text(text: str) -> str:
    """Cleans up raw extracted text by removing repeated whitespace, control chars, and TOC dots."""
    if not text:
        return ""
    # Strip TOC leader dots
    text = re.sub(r"(?:\.\s*){3,}", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse 3+ newlines to 2
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def read_document_file(
    file_path: Path,
    pdf_password: Optional[str] = None,
    on_page_progress: Optional[Any] = None
) -> Tuple[int, List[Dict[str, Any]], str, bool]:
    """
    Reads a document file using PyMuPDF (fitz) or native text reading.
    Returns:
      (page_count, pages_list, full_text, has_usable_text)
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    size = file_path.stat().st_size
    if size == 0:
        raise EmptyFileError("The uploaded file is empty (0 bytes).")

    ext = file_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(f"Unsupported file format '{ext}'.")

    # 1. Plain Text / Markdown
    if ext in TEXT_EXTENSIONS:
        text = file_path.read_text(encoding="utf-8", errors="replace")
        cleaned = clean_page_text(text)
        page_dict = {
            "page_num": 1,
            "text": cleaned,
            "has_usable_text": bool(cleaned)
        }
        return 1, [page_dict], cleaned, bool(cleaned)

    # 2. Images (PNG, JPG, WEBP)
    # Images have no local text layer; they are processed by Gemini's multimodal vision
    if ext in IMAGE_EXTENSIONS:
        page_dict = {
            "page_num": 1,
            "text": "",
            "has_usable_text": False
        }
        return 1, [page_dict], "", False

    # 3. PDF Files
    if ext in PDF_EXTENSIONS:
        try:
            doc = fitz.open(str(file_path))
        except Exception as e:
            raise CorruptedPdfError(f"Could not open PDF file: {e}") from e

        try:
            if doc.is_encrypted:
                if not pdf_password or not doc.authenticate(pdf_password):
                    doc.close()
                    raise EncryptedPdfError("This PDF is password-protected. Please provide a valid password.")

            total_pages = len(doc)
            if total_pages == 0:
                doc.close()
                raise EmptyFileError("The PDF document contains 0 pages.")

            pages: List[Dict[str, Any]] = []
            full_text_parts: List[str] = []
            usable_pages_count = 0

            for p_idx in range(total_pages):
                page = doc[p_idx]
                raw_text = page.get_text("text", sort=True)
                cleaned = clean_page_text(raw_text)
                is_usable = is_text_usable(cleaned)

                if is_usable:
                    usable_pages_count += 1
                    full_text_parts.append(cleaned)

                pages.append({
                    "page_num": p_idx + 1,
                    "text": cleaned if is_usable else "",
                    "has_usable_text": is_usable
                })

                if on_page_progress:
                    on_page_progress(p_idx + 1, total_pages)

            full_text = "\n\n".join(full_text_parts).strip()
            has_usable_text = usable_pages_count > 0 and len(full_text) > 40

            return total_pages, pages, full_text, has_usable_text
        finally:
            doc.close()

    return 1, [], "", False
