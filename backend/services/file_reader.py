"""
backend/services/file_reader.py
Bulletproof document text acquisition with multi-library fallback ladder:
PyMuPDF (sort=True & blocks) -> pdfplumber -> pypdf -> pdfminer.six -> RapidOCR / Gemini Vision / Tesseract.
Handles encrypted PDFs, slides, diagrams, partial success, and actionable errors.
"""

import os
import io
import re
import logging
from typing import Dict, List, Any, Tuple, Optional
from pathlib import Path

import numpy as np
from PIL import Image
import pymupdf as fitz
from dotenv import load_dotenv

load_dotenv()

try:
    from backend.services.ocr import (
        run_ocr_on_image,
        check_rapidocr_available,
        is_tesseract_available
    )
    from backend.services.text_cleaning import clean_text, remove_repeated_headers_footers
except ImportError:
    from services.ocr import (
        run_ocr_on_image,
        check_rapidocr_available,
        is_tesseract_available
    )
    from services.text_cleaning import clean_text, remove_repeated_headers_footers

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
    Rejects text that is too short (<30 chars), mostly non-letters,
    contains many (cid:xx) markers, replacement chars, or random symbol runs.
    """
    if not text or len(text.strip()) < 30:
        return False

    cleaned = text.strip()
    total_len = len(cleaned)
    letters = sum(1 for c in cleaned if c.isalpha())
    letter_share = letters / max(1, total_len)

    # If less than 35% letters, it's mostly gibberish / symbols
    if letter_share < 0.35:
        return False

    # Check for (cid:xx) markers
    cid_count = len(re.findall(r"\(cid:\d+\)", cleaned))
    if cid_count > 3 or (cid_count * 5 / total_len) > 0.08:
        return False

    # Check for unicode replacement chars (\ufffd)
    if cleaned.count("\ufffd") > 4:
        return False

    # Check for excessive unprintable characters
    unprintable = sum(1 for c in cleaned if not (c.isprintable() or c in "\n\r\t"))
    if unprintable > 8 or (unprintable / total_len) > 0.10:
        return False

    return True


def try_extract_page_text_pymupdf(page: fitz.Page) -> str:
    """Tries extraction with PyMuPDF sort=True, falling back to blocks mode."""
    try:
        text = page.get_text("text", sort=True).strip()
        if is_text_usable(text):
            return text
    except Exception:
        pass

    try:
        blocks = page.get_text("blocks")
        if blocks:
            # Sort blocks vertically then horizontally
            blocks = sorted(blocks, key=lambda b: (b[1], b[0]))
            block_texts = [b[4].strip() for b in blocks if len(b) > 4 and b[4].strip()]
            text = "\n\n".join(block_texts).strip()
            if is_text_usable(text):
                return text
    except Exception:
        pass

    return ""


def try_extract_page_text_pdfplumber(file_path: Path, page_idx: int) -> str:
    """Tries extraction with pdfplumber."""
    try:
        import pdfplumber
        with pdfplumber.open(str(file_path)) as pdf:
            if page_idx < len(pdf.pages):
                text = pdf.pages[page_idx].extract_text()
                if text and is_text_usable(text):
                    return text.strip()
    except Exception as e:
        logger.debug(f"pdfplumber fallback page {page_idx} failed: {e}")
    return ""


def try_extract_page_text_pypdf(file_path: Path, page_idx: int) -> str:
    """Tries extraction with pypdf."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(file_path))
        if page_idx < len(reader.pages):
            text = reader.pages[page_idx].extract_text()
            if text and is_text_usable(text):
                return text.strip()
    except Exception as e:
        logger.debug(f"pypdf fallback page {page_idx} failed: {e}")
    return ""


def try_extract_page_text_pdfminer(file_path: Path, page_idx: int) -> str:
    """Tries extraction with pdfminer.six."""
    try:
        from pdfminer.high_level import extract_text
        text = extract_text(str(file_path), page_numbers=[page_idx])
        if text and is_text_usable(text):
            return text.strip()
    except Exception as e:
        logger.debug(f"pdfminer fallback page {page_idx} failed: {e}")
    return ""


def extract_page_text_ladder(doc: fitz.Document, file_path: Path, page_idx: int) -> str:
    """
    Executes the text-layer fallback ladder for a specific page:
    PyMuPDF (sort/blocks) -> pdfplumber -> pypdf -> pdfminer.six
    """
    page = doc[page_idx]

    # 1. PyMuPDF
    text = try_extract_page_text_pymupdf(page)
    if text:
        return text

    # 2. pdfplumber
    text = try_extract_page_text_pdfplumber(file_path, page_idx)
    if text:
        return text

    # 3. pypdf
    text = try_extract_page_text_pypdf(file_path, page_idx)
    if text:
        return text

    # 4. pdfminer.six
    text = try_extract_page_text_pdfminer(file_path, page_idx)
    if text:
        return text

    return ""


def render_page_to_numpy(page: fitz.Page, dpi: int = 150) -> np.ndarray:
    """
    Renders a PDF page to a NumPy BGR image at 150 DPI,
    downscaled so that the long edge is at most 2000px.
    """
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csGRAY)
    # Convert grayscale pixmap samples to BGR numpy array
    img_gray = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w)
    import cv2
    img_bgr = cv2.cvtColor(img_gray, cv2.COLOR_GRAY2BGR)

    h, w = img_bgr.shape[:2]
    long_edge = max(h, w)
    if long_edge > 2000:
        scale = 2000.0 / long_edge
        img_bgr = cv2.resize(img_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    return img_bgr


def read_text_file(file_path: Path) -> Tuple[int, List[Dict[str, Any]], str, List[int]]:
    """Reads TXT or MD file with UTF-8 encoding, falling back to latin-1."""
    content = ""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        try:
            with open(file_path, "r", encoding="latin-1") as f:
                content = f.read()
        except Exception as e:
            raise CorruptedPdfError(f"Failed to decode text file: {e}")

    cleaned = clean_text(content)
    if not cleaned.strip():
        raise EmptyFileError("The uploaded text file is empty or contains no readable characters.")

    pages = [{"page": 1, "text": cleaned}]
    return 1, pages, cleaned, []


def read_image_file(
    file_path: Path,
    prefer_cloud: bool = False,
    gemini_api_key: Optional[str] = None,
    gemini_model: str = "gemini-flash-latest"
) -> Tuple[int, List[Dict[str, Any]], str, List[int]]:
    """Processes an image file using RapidOCR / Gemini Vision."""
    try:
        with Image.open(file_path) as img:
            img.verify()
    except Exception as e:
        raise CorruptedPdfError(f"Invalid or corrupted image file: {e}")

    logger.info(f"Running OCR on image file: {file_path.name}")
    ocr_result = run_ocr_on_image(
        file_path,
        prefer_cloud=prefer_cloud,
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model
    )
    cleaned = clean_text(ocr_result)

    if not cleaned.strip():
        raise EmptyFileError(
            "OCR could not detect any readable text in this image. "
            "Please ensure the image contains clear, legible notes."
        )

    pages = [{"page": 1, "text": cleaned}]
    return 1, pages, cleaned, []


def read_pdf_file(
    file_path: Path,
    on_ocr_page=None,
    on_page_progress=None,
    pdf_password: Optional[str] = None,
    prefer_cloud: bool = False,
    gemini_api_key: Optional[str] = None,
    gemini_model: str = "gemini-flash-latest"
) -> Tuple[int, List[Dict[str, Any]], str, List[int]]:
    """
    Bulletproof PDF text acquisition pipeline:
    1. Checks encryption and password (tries empty password if not supplied).
    2. Per page: runs fallback ladder (PyMuPDF -> pdfplumber -> pypdf -> pdfminer).
    3. Runs quality check; if text is rejected or image-heavy (slides/diagrams), triggers OCR.
    4. Extracts text from embedded images on mixed diagram pages.
    5. Partial success: keeps readable pages, records skipped pages.
    6. Only raises error if NO page produced usable text.
    """
    try:
        doc = fitz.open(str(file_path))
    except Exception as e:
        raise CorruptedPdfError(f"Failed to open PDF document: {e}")

    # Handle encryption
    if doc.is_encrypted:
        pw_to_try = pdf_password or ""
        auth_success = doc.authenticate(pw_to_try)
        if not auth_success and doc.needs_pass:
            doc.close()
            raise EncryptedPdfError(
                "This PDF is password protected. Please provide the document password to decrypt it."
            )

    total_pages = len(doc)
    if total_pages == 0:
        doc.close()
        raise EmptyFileError("The uploaded PDF has no pages (0 pages).")

    raw_page_texts: List[str] = []
    skipped_pages: List[int] = []

    for page_idx in range(total_pages):
        page_num = page_idx + 1
        page = doc[page_idx]
        page_rect = page.rect
        page_area = max(1.0, page_rect.width * page_rect.height)

        if on_page_progress:
            try:
                on_page_progress(page_num, total_pages, False)
            except Exception:
                pass

        # 1. Text-layer ladder
        page_text = extract_page_text_ladder(doc, file_path, page_idx)

        # Check if page has images and calculate image coverage
        images = page.get_images(full=True)
        img_count = len(images)
        total_img_area = 0.0
        for img in images:
            try:
                rects = page.get_image_rects(img[0])
                for r in rects:
                    total_img_area += r.width * r.height
            except Exception:
                pass
        img_coverage = total_img_area / page_area if total_img_area > 0 else (0.9 if img_count >= 1 and len(page_text) < 30 else 0.0)

        # 2. Quality check: does this page need OCR?
        needs_ocr = False
        if not is_text_usable(page_text):
            needs_ocr = True
        elif img_count > 0 and img_coverage > 0.55 and len(page_text) < 150:
            # Slides or diagrams where text is embedded in images
            needs_ocr = True

        if needs_ocr:
            logger.info(f"Page {page_num}/{total_pages} requires OCR (coverage: {img_coverage:.0%}, chars: {len(page_text)}).")
            if on_ocr_page:
                try:
                    on_ocr_page(page_num, total_pages)
                except Exception:
                    pass

            # Render page at 150 DPI grayscale and OCR
            try:
                img_bgr = render_page_to_numpy(page, dpi=150)
                ocr_text = run_ocr_on_image(
                    img_bgr,
                    prefer_cloud=prefer_cloud,
                    gemini_api_key=gemini_api_key,
                    gemini_model=gemini_model
                )
                if ocr_text and is_text_usable(ocr_text):
                    page_text = ocr_text
                elif ocr_text and len(ocr_text.strip()) > 10:
                    page_text = ocr_text
            except Exception as e:
                logger.warning(f"OCR failed on page {page_num}: {e}")

        # 3. Check for embedded images on pages that have text but also diagrams (coverage > 25%)
        elif img_count > 0 and 0.25 <= img_coverage <= 0.85:
            try:
                # OCR embedded diagram images and append
                for img in images[:2]:  # Check up to 2 major embedded images
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    if base_image and "image" in base_image:
                        img_bytes = base_image["image"]
                        import cv2
                        arr = np.frombuffer(img_bytes, dtype=np.uint8)
                        img_mat = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                        if img_mat is not None and max(img_mat.shape[:2]) >= 200:
                            diag_text = run_ocr_on_image(
                                img_mat,
                                prefer_cloud=prefer_cloud,
                                gemini_api_key=gemini_api_key,
                                gemini_model=gemini_model
                            )
                            if diag_text and len(diag_text.strip()) >= 15:
                                page_text += f"\n\n[Diagram / Image Note]:\n{diag_text.strip()}"
            except Exception as e:
                logger.debug(f"Embedded diagram OCR note skipped on page {page_num}: {e}")

        # Check if page ultimately produced usable text
        if not page_text or len(page_text.strip()) < 10:
            skipped_pages.append(page_num)
            raw_page_texts.append("")
        else:
            raw_page_texts.append(page_text.strip())

    doc.close()

    # Filter out repeated headers and footers across pages
    cleaned_page_texts = remove_repeated_headers_footers(raw_page_texts)

    pages: List[Dict[str, Any]] = []
    full_text_pieces: List[str] = []

    for idx, pt in enumerate(cleaned_page_texts):
        cleaned = clean_text(pt)
        if cleaned.strip():
            pages.append({"page": idx + 1, "text": cleaned})
            full_text_pieces.append(cleaned)

    full_text = "\n\n".join(full_text_pieces)

    # 4. Partial success check: Only fail when NO page produced usable text
    if not full_text.strip() or len(pages) == 0:
        # Check if RapidOCR is available to provide a helpful actionable message
        rapid_ok, rapid_msg = check_rapidocr_available()
        if not rapid_ok and not is_tesseract_available():
            raise ScannedNoOcrError(
                "This appears to be a scanned document, but no local OCR engine is ready on the server. "
                f"Error: {rapid_msg}"
            )
        raise EmptyFileError(
            "No readable text could be extracted from this PDF. "
            "All pages were either blank or illegible to both text extraction and OCR."
        )

    return total_pages, pages, full_text, skipped_pages


def read_document_file(
    file_path: Path,
    on_ocr_page=None,
    on_page_progress=None,
    pdf_password: Optional[str] = None,
    prefer_cloud: bool = False,
    gemini_api_key: Optional[str] = None,
    gemini_model: str = "gemini-flash-latest"
) -> Tuple[int, List[Dict[str, Any]], str, List[int]]:
    """
    Entry point for reading any document. Validates extension, parses content,
    and returns (total_pages, pages_list, full_cleaned_text, skipped_pages).
    """
    ext = file_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFileTypeError(
            f"Unsupported file format '{ext}'. Supported formats: PDF, PNG, JPG, JPEG, WEBP, TXT, MD."
        )

    if ext in TEXT_EXTENSIONS:
        return read_text_file(file_path)
    elif ext in IMAGE_EXTENSIONS:
        return read_image_file(
            file_path,
            prefer_cloud=prefer_cloud,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model
        )
    elif ext in PDF_EXTENSIONS:
        return read_pdf_file(
            file_path,
            on_ocr_page=on_ocr_page,
            on_page_progress=on_page_progress,
            pdf_password=pdf_password,
            prefer_cloud=prefer_cloud,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model
        )
    else:
        raise UnsupportedFileTypeError(f"Unsupported format '{ext}'.")
