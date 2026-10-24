"""
text_reader.py - Reads uploaded files into plain text for local extractors.
Uses PyMuPDF (fitz) for PDFs. If PyMuPDF is missing, a PDF has no text layer (scanned),
or the file is an image, returns None with a clear reason so the caller falls back to Gemini.
Plain text files (.txt, .md) are read directly.
"""

import logging
import re
from pathlib import Path
from typing import Optional, Tuple, Union, List, Dict, Any

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


def extract_headings_from_text(text: str) -> List[str]:
    """Extracts likely section headings from page text."""
    headings: List[str] = []
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for line in lines[:6]:
        # Chapter / Section indicators
        if re.match(r"^(?:chapter|section|module|unit|part)\s+\d+[:\.\-]?\s*(.*)$", line, re.IGNORECASE):
            headings.append(line)
        elif re.match(r"^(?:\d+\.){1,3}\s+(.+)$", line):
            headings.append(line)
        elif 3 <= len(line.split()) <= 7 and not line.endswith((".", ";", "?", "!")) and (line.istitle() or line.isupper()):
            headings.append(line)
    return headings


def read_pages_from_file(
    file_path: Union[str, Path],
    pdf_password: Optional[str] = None
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """
    Reads structured page-by-page text from an uploaded document.
    Preserves page numbers (1-indexed), headings, and usable text flags.

    Returns:
        (pages, fallback_reason)
        If readable: (List of page dicts, None)
        If unreadable: (None, fallback_reason_string)
    """
    path = Path(file_path)
    if not path.exists():
        return None, f"File not found: {path.name}"

    if path.stat().st_size == 0:
        return None, "The uploaded file is empty (0 bytes)."

    ext = path.suffix.lower()

    # 1. Images (PNG, JPG, WEBP) -> no text layer, requires Gemini
    if ext in IMAGE_EXTENSIONS:
        return None, "Image files have no text layer and require Gemini multimodal extraction."

    # 2. Plain Text / Markdown
    if ext in TEXT_EXTENSIONS:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            cleaned = clean_text_layer(raw)
            if not cleaned or len(cleaned.strip()) < 10:
                return None, "Text file contains insufficient content for concept extraction."

            # If markdown has headings (# Chapter 1, ## Topic) or multiple sections, split into pages
            sections = [s for s in re.split(r"\n(?=#{1,3}\s+|Chapter\s+\d+[:\.\-]?\s*)", cleaned) if s.strip()]
            if len(sections) > 1 and len(sections[0].split()) < 50:
                sections[1] = sections[0].strip() + "\n\n" + sections[1].strip()
                sections = sections[1:]

            if len(sections) > 1:
                pages = []
                for p_idx, sec in enumerate(sections):
                    sec_clean = clean_text_layer(sec)
                    if not sec_clean:
                        continue
                    first_line = sec_clean.split("\n")[0].strip("# -:.")
                    headings = extract_headings_from_text(sec_clean)
                    pages.append({
                        "page": p_idx + 1,
                        "text": sec_clean,
                        "title": first_line or f"Section {p_idx + 1}",
                        "headings": headings,
                        "is_usable": is_text_usable(sec_clean),
                        "char_count": len(sec_clean)
                    })
                if pages:
                    return pages, None

            # Fallback to single page for short text
            headings = extract_headings_from_text(cleaned)
            title = headings[0] if headings else path.stem.replace("_", " ").title()
            return [{
                "page": 1,
                "text": cleaned,
                "title": title,
                "headings": headings,
                "is_usable": True,
                "char_count": len(cleaned)
            }], None
        except Exception as e:
            return None, f"Could not read text file: {e}"

    # 3. PDF Files
    if ext in PDF_EXTENSIONS:
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

            total_doc_pages = len(doc)
            if total_doc_pages == 0:
                return None, "The PDF contains 0 pages."

            # Read TOC / bookmarks map: page_num (1-indexed) -> title
            toc_map: Dict[int, str] = {}
            try:
                toc = doc.get_toc()
                for item in toc:
                    if len(item) >= 3 and item[2] > 0:
                        p_num = int(item[2])
                        title_str = str(item[1]).strip()
                        if p_num not in toc_map and title_str:
                            toc_map[p_num] = title_str
            except Exception:
                pass

            pages_list: List[Dict[str, Any]] = []
            usable_pages_count = 0

            for p_idx in range(total_doc_pages):
                page_num = p_idx + 1
                page = doc[p_idx]
                raw_page_text = page.get_text("text", sort=True)
                cleaned_page = clean_text_layer(raw_page_text)
                is_usable = is_text_usable(cleaned_page)

                headings = extract_headings_from_text(cleaned_page)
                if page_num in toc_map:
                    headings.insert(0, toc_map[page_num])

                page_title = toc_map.get(page_num) or (headings[0] if headings else f"Page {page_num}")

                if is_usable:
                    usable_pages_count += 1

                pages_list.append({
                    "page": page_num,
                    "text": cleaned_page,
                    "title": page_title,
                    "headings": headings,
                    "is_usable": is_usable,
                    "char_count": len(cleaned_page)
                })

            total_chars = sum(p["char_count"] for p in pages_list)
            if usable_pages_count == 0 or total_chars < 40:
                return None, "PDF has no selectable text layer (scanned or image-only document)."

            return pages_list, None
        finally:
            doc.close()

    return None, f"Unsupported file type '{ext}' for local extraction."


def read_text_from_file(file_path: Union[str, Path], pdf_password: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """
    Reads plain text from an uploaded file for lightweight keyword extraction.
    Backwards compatible with callers expecting a single text string.

    Returns:
        (text, fallback_reason)
    """
    pages, fallback_reason = read_pages_from_file(file_path, pdf_password=pdf_password)
    if pages is None:
        return None, fallback_reason

    usable_texts = [p["text"] for p in pages if p.get("is_usable")]
    if not usable_texts:
        return None, "Document contains no extractable text layer."

    full_text = "\n\n".join(usable_texts).strip()
    if len(full_text) < 40:
        return None, "Document contains insufficient text for concept extraction."

    return full_text, None

