"""
backend/services/layout_extractor.py
Layout-aware document parser using PyMuPDF (pymupdf).

Key Responsibilities:
1. One-page-at-a-time memory efficient processing (< 50MB peak RAM).
2. Per-page text block extraction with font size, boldness, and bounding coordinates.
3. Heading & slide title detection (largest/bold text near top, PDF bookmarks/TOC).
4. Boilerplate / header / footer / page number removal.
5. Code block & table preservation as formatted text blocks.
6. Reading order preservation.
7. Page classification:
   - 'content': standard educational content
   - 'title': document or course title slide / cover
   - 'agenda': table of contents, outline, agenda, syllabus
   - 'exercise': problem set, quiz, homework, practice exercises
   - 'references': bibliography, readings, citations
   - 'blank': < 20 chars
   - 'low_text': < 80 chars, scanned or diagram-heavy
8. Page image extraction for vision-based extraction on low_text / scanned pages.
"""

import os
import re
import hashlib
import logging
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import pymupdf as fitz

logger = logging.getLogger("conceptlens.layout_extractor")

def clean_page_text(text: str) -> str:
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

# Regex patterns for headers, footers, boilerplate, and course logistics
BOILERPLATE_PATTERNS = [
    re.compile(r"^(?:page\s+)?\d+(?:\s*(?:of|\/)\s*\d+)?$", re.IGNORECASE),
    re.compile(r"^\d+\s*$", re.IGNORECASE),
    re.compile(r"^copyright\s*(?:©|\(c\)).*$", re.IGNORECASE),
    re.compile(r"^all\s+rights\s+reserved.*$", re.IGNORECASE),
    re.compile(r"^(?:spring|fall|summer|winter)\s+20\d\d.*$", re.IGNORECASE),
    re.compile(r"^(?:lecture|session|class)\s+\d+.*$", re.IGNORECASE),
    re.compile(r"^(?:mit|harvard|stanford|cmu|uc\s+berkeley|oxford|cambridge).*$", re.IGNORECASE),
    re.compile(r"^\s*https?:\/\/\S+\s*$", re.IGNORECASE),
]

AGENDA_KEYWORDS = {
    "agenda", "outline", "table of contents", "today's topics",
    "topics covered", "overview of lecture", "roadmap", "schedule"
}

EXERCISE_KEYWORDS = {
    "problem set", "homework", "quiz", "exercise", "practice problem",
    "assignment", "solution to problem", "exam review", "hands-on lab"
}

REFERENCE_KEYWORDS = {
    "references", "bibliography", "further reading", "sources",
    "works cited", "suggested reading", "acknowledgements", "credits",
    "appendix", "index", "glossary", "citations", "readings", "acknowledgments",
    "citations and references", "source materials"
}

CLOSING_KEYWORDS = {
    "thank you", "thanks", "questions?", "questions", "any questions", "q&a", "q & a",
    "the end", "conclusion", "conclusions", "author biography", "about the author",
    "published by", "table of figures", "list of tables", "disclaimer",
    "legal notice", "terms of use", "contact us", "contact info", "wrap up", "wrap-up"
}


def compute_text_hash(text: str) -> str:
    """Computes SHA256 hex digest of stripped text for caching and idempotency."""
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()[:16]


class LayoutAwarePage:
    def __init__(
        self,
        page_num: int,
        raw_text: str,
        cleaned_text: str,
        title: Optional[str],
        page_type: str,
        headings: List[str],
        text_hash: str,
        char_count: int,
        is_scanned_or_low_text: bool = False,
        blocks: Optional[List[Dict[str, Any]]] = None
    ):
        self.page_num = page_num
        self.raw_text = raw_text
        self.cleaned_text = cleaned_text
        self.title = title
        self.page_type = page_type
        self.headings = headings
        self.text_hash = text_hash
        self.char_count = char_count
        self.is_scanned_or_low_text = is_scanned_or_low_text
        self.blocks = blocks or []

    def is_content_eligible(self) -> bool:
        """Determines if a page is eligible for educational concept extraction."""
        return self.page_type not in ("title", "agenda", "exercise", "references", "blank", "low_text")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "page": self.page_num,
            "title": self.title,
            "page_type": self.page_type,
            "headings": self.headings,
            "text": self.cleaned_text,
            "char_count": self.char_count,
            "text_hash": self.text_hash,
            "is_scanned_or_low_text": self.is_scanned_or_low_text
        }


class LayoutExtractor:
    """
    Processes a PDF document one page at a time to protect memory.
    """

    def __init__(self, file_path: Path):
        self.file_path = file_path
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")

    def extract_document_pages(self) -> Tuple[List[LayoutAwarePage], Dict[int, str]]:
        """
        Extracts all pages from the document with layout awareness and classification.
        Returns:
            pages: List of LayoutAwarePage objects
            toc_map: Map of page_num -> TOC/Bookmark heading
        """
        ext = self.file_path.suffix.lower()
        if ext in ('.png', '.jpg', '.jpeg', '.webp'):
            return self._extract_image_file()

        doc = fitz.open(str(self.file_path))
        total_pages = len(doc)
        
        # 1. Extract TOC / bookmarks if present
        toc_map: Dict[int, str] = {}
        try:
            toc = doc.get_toc() # [[lvl, title, page, ...], ...]
            for item in toc:
                if len(item) >= 3 and item[2] > 0:
                    p = item[2]
                    title = item[1].strip()
                    if p not in toc_map:
                        toc_map[p] = title
        except Exception:
            pass

        # 2. First pass: detect repeating header and footer lines across pages
        # (Lines appearing in > 40% of pages in the top or bottom 10% vertical slice)
        top_lines: List[str] = []
        bottom_lines: List[str] = []
        
        sample_limit = min(total_pages, 30)
        for p_idx in range(sample_limit):
            page = doc[p_idx]
            rect = page.rect
            blocks = page.get_text("blocks")
            for b in blocks:
                if len(b) >= 5 and isinstance(b[4], str):
                    text = b[4].strip()
                    if not text:
                        continue
                    y0, y1 = b[1], b[3]
                    if y0 < rect.height * 0.12:
                        top_lines.append(text.lower())
                    elif y1 > rect.height * 0.88:
                        bottom_lines.append(text.lower())

        repeated_headers = {
            t for t, count in Counter(top_lines).items()
            if count >= max(3, int(sample_limit * 0.35))
        }
        repeated_footers = {
            t for t, count in Counter(bottom_lines).items()
            if count >= max(3, int(sample_limit * 0.35))
        }

        # 3. Process each page one-by-one to maintain peak RAM < 50MB
        pages: List[LayoutAwarePage] = []
        current_active_heading = "General"

        for p_idx in range(total_pages):
            page = doc[p_idx]
            page_num = p_idx + 1
            page_rect = page.rect
            
            # Extract detailed text blocks with font information
            text_page = page.get_text("dict")
            raw_blocks = text_page.get("blocks", [])
            
            extracted_blocks: List[Dict[str, Any]] = []
            page_text_lines: List[str] = []
            detected_headings: List[str] = []
            max_font_size = 0.0
            candidate_title = ""

            for b in raw_blocks:
                if b.get("type") != 0: # 0 = text, 1 = image
                    continue
                
                block_lines: List[str] = []
                block_max_font = 0.0
                block_is_bold = False
                
                for line in b.get("lines", []):
                    line_text = ""
                    for span in line.get("spans", []):
                        span_text = span.get("text", "")
                        line_text += span_text
                        sz = span.get("size", 10.0)
                        if sz > block_max_font:
                            block_max_font = sz
                        flags = span.get("flags", 0)
                        # flags & 2 (italic), flags & 16 or 20 (bold)
                        font_name = span.get("font", "").lower()
                        if (flags & 16) or (flags & 20) or "bold" in font_name or "heavy" in font_name:
                            block_is_bold = True
                            
                    clean_line = line_text.strip()
                    if clean_line:
                        block_lines.append(clean_line)

                if not block_lines:
                    continue

                full_block_text = "\n".join(block_lines)
                bbox = b.get("bbox", (0, 0, 0, 0))
                y0, y1 = bbox[1], bbox[3]

                # Check if this block is a repeating header or footer
                norm_block = full_block_text.strip().lower()
                if (y0 < page_rect.height * 0.12 and norm_block in repeated_headers) or \
                   (y1 > page_rect.height * 0.88 and norm_block in repeated_footers):
                    continue

                # Filter out single line boilerplates (page numbers, copyright)
                is_boiler = False
                for pat in BOILERPLATE_PATTERNS:
                    if pat.match(full_block_text.strip()):
                        is_boiler = True
                        break
                if is_boiler:
                    continue

                # Heading detection: large font or bold text near top of the page
                is_heading = False
                if block_max_font >= 14.0 or (block_is_bold and block_max_font >= 12.0):
                    if len(full_block_text) < 120 and not full_block_text.endswith("."):
                        is_heading = True
                        detected_headings.append(full_block_text)

                if y0 < page_rect.height * 0.35 and block_max_font > max_font_size:
                    if len(full_block_text) < 100:
                        max_font_size = block_max_font
                        candidate_title = full_block_text

                page_text_lines.append(full_block_text)
                extracted_blocks.append({
                    "text": full_block_text,
                    "font_size": block_max_font,
                    "is_bold": block_is_bold,
                    "is_heading": is_heading,
                    "bbox": bbox
                })

            raw_text = page.get_text()
            cleaned_text = "\n\n".join(page_text_lines).strip()
            char_count = len(cleaned_text)

            # If page has very little or no extracted text, run OCR
            if char_count < 40 and (len(page.get_images()) > 0 or total_pages <= 5):
                try:
                    try:
                        from backend.services.ocr import run_ocr_on_image
                    except ImportError:
                        from services.ocr import run_ocr_on_image
                    pix = page.get_pixmap(dpi=150)
                    pix_bytes = pix.tobytes("png")
                    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
                    ocr_text = run_ocr_on_image(
                        pix_bytes,
                        prefer_cloud=bool(gemini_key),
                        gemini_api_key=gemini_key,
                        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
                    )
                    if ocr_text and len(ocr_text.strip()) > char_count:
                        cleaned_text = clean_page_text(ocr_text)
                        char_count = len(cleaned_text)
                        raw_text = ocr_text
                        for ocr_l in [l.strip() for l in cleaned_text.split("\n") if l.strip()]:
                            if len(ocr_l) < 60 and not ocr_l.endswith(".") and ocr_l not in detected_headings:
                                detected_headings.append(ocr_l)
                except Exception as e_ocr:
                    logger.warning(f"Could not perform OCR on page {page_num}: {e_ocr}")

            # Determine title: Prefer TOC bookmark, then candidate title, then first heading
            final_title = None
            if page_num in toc_map:
                final_title = toc_map[page_num]
            elif candidate_title:
                final_title = candidate_title
            elif detected_headings:
                final_title = detected_headings[0]

            if final_title:
                current_active_heading = final_title

            # Page classification
            page_type = self._classify_page(
                page_num=page_num,
                total_pages=total_pages,
                char_count=char_count,
                title=final_title or "",
                text=cleaned_text,
                has_images=len(page.get_images()) > 0
            )

            is_scanned_or_low = (page_type == "low_text")

            pages.append(
                LayoutAwarePage(
                    page_num=page_num,
                    raw_text=raw_text,
                    cleaned_text=cleaned_text,
                    title=final_title,
                    page_type=page_type,
                    headings=detected_headings,
                    text_hash=compute_text_hash(cleaned_text),
                    char_count=char_count,
                    is_scanned_or_low_text=is_scanned_or_low,
                    blocks=extracted_blocks
                )
            )

        doc.close()
        return pages, toc_map

    def _extract_image_file(self) -> Tuple[List[LayoutAwarePage], Dict[int, str]]:
        """Extracts text from an image file using OCR."""
        try:
            from backend.services.ocr import run_ocr_on_image
        except ImportError:
            from services.ocr import run_ocr_on_image

        gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
        ocr_text = run_ocr_on_image(
            self.file_path,
            prefer_cloud=bool(gemini_key),
            gemini_api_key=gemini_key,
            gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
        )
        cleaned_text = clean_page_text(ocr_text) if ocr_text else ""
        lines = [line.strip() for line in cleaned_text.split("\n") if line.strip()]
        detected_headings = []
        candidate_title = lines[0] if lines else self.file_path.stem.replace("_", " ").title()
        for line in lines[:5]:
            if len(line) < 60 and not line.endswith("."):
                detected_headings.append(line)

        char_count = len(cleaned_text)
        page = LayoutAwarePage(
            page_num=1,
            raw_text=ocr_text or "",
            cleaned_text=cleaned_text,
            title=candidate_title,
            page_type="content" if char_count >= 15 else "low_text",
            headings=detected_headings,
            text_hash=compute_text_hash(cleaned_text),
            char_count=char_count,
            is_scanned_or_low_text=(char_count < 15),
            blocks=[{"text": l, "font_size": 12.0, "is_bold": False, "is_heading": False, "bbox": (0, 0, 0, 0)} for l in lines]
        )
        return [page], {1: candidate_title}

    def _classify_page(
        self,
        page_num: int,
        total_pages: int,
        char_count: int,
        title: str,
        text: str,
        has_images: bool
    ) -> str:
        """Classifies page into one of the canonical categories."""
        # 1. Scanned / image-only / diagram-heavy page (has image and little/no text)
        if total_pages > 2 and has_images and char_count < 40:
            return "low_text"

        # 2. Blank page (< 15 characters)
        if char_count < 15:
            return "blank"

        text_lower = text.lower()
        title_lower = title.lower()

        # 3. Title slide / cover (Page 1 in multi-page document with instructor or course keywords)
        if page_num == 1 and total_pages > 1:
            if any(kw in text_lower for kw in ("instructor", "professor", "university", "syllabus", "lecture 1:")) or \
               (char_count < 150 and any(kw in title_lower for kw in ("title", "overview", "course"))):
                return "title"

        # 4. Agenda / Table of contents
        if any(kw in title_lower or kw in text_lower[:250] for kw in AGENDA_KEYWORDS):
            return "agenda"

        # 5. Exercise / Homework
        if any(kw in title_lower or kw in text_lower[:250] for kw in EXERCISE_KEYWORDS):
            return "exercise"

        # 6. References / Bibliography / Appendix / Closing / Thank you / Q&A
        is_closing_phase = (page_num >= total_pages - 2) if total_pages > 2 else (page_num == total_pages and total_pages > 1)
        if any(kw in title_lower or kw in text_lower[:400] for kw in REFERENCE_KEYWORDS):
            return "references"
        if is_closing_phase and any(kw in title_lower or kw in text_lower for kw in CLOSING_KEYWORDS):
            return "references"

        # Check citation density near document end
        citation_matches = len(re.findall(r"(?:\[\d{1,3}\]|\(\d{4}\)|et al\.|doi:\s*10\.|isbn|https?:\/\/)", text_lower))
        if citation_matches >= 3 and is_closing_phase:
            return "references"

        # On the very last page of multi-page notes, check if it contains no definitions and minimal content
        if page_num == total_pages and total_pages > 1:
            if char_count < 150 and not any(kw in text_lower for kw in ("is a", "defined as", "refers to", "concept", "theory")):
                return "references"

        if char_count < 80:
            return "low_text"

        return "content"

    def get_page_image_bytes(self, page_num: int, dpi: int = 150) -> bytes:
        """
        Renders a single page as PNG bytes for multimodal vision fallback.
        Memory is released immediately.
        """
        doc = fitz.open(str(self.file_path))
        if page_num < 1 or page_num > len(doc):
            doc.close()
            raise ValueError(f"Invalid page number {page_num}")
        page = doc[page_num - 1]
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        doc.close()
        return img_bytes


from collections import Counter
