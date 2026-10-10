#!/usr/bin/env python3
"""
scripts/diagnose_pdf.py
ConceptLens PDF Diagnostics Tool
Analyzes PDF structure, text layer quality, font encodings, image coverage, and encryption.
"""

import sys
import os
import re
from pathlib import Path
from typing import Dict, Any, List, Tuple
import pymupdf as fitz


def analyze_text_garbage(text: str) -> Tuple[float, int, int, List[str]]:
    """
    Computes printable letter share vs garbage/symbols.
    Returns: (letter_share, total_chars, garbage_chars, issues_list)
    """
    if not text:
        return 0.0, 0, 0, ["empty_text"]

    total = len(text)
    letters = sum(1 for c in text if c.isalpha())
    letter_share = letters / max(1, total)

    issues = []
    # Check for (cid:xx) markers
    cid_count = len(re.findall(r"\(cid:\d+\)", text))
    if cid_count > 0:
        issues.append(f"{cid_count} (cid:) codes")

    # Check for unicode replacement chars (\ufffd)
    replacement_count = text.count("\ufffd")
    if replacement_count > 0:
        issues.append(f"{replacement_count} replacement chars")

    # Check for long runs of non-alphanumeric symbols
    symbol_runs = len(re.findall(r"[^\w\s]{4,}", text))
    if symbol_runs > 0:
        issues.append(f"{symbol_runs} symbol runs")

    # High non-ascii garbage
    garbage_count = sum(1 for c in text if not (c.isprintable() or c in "\n\r\t"))
    if garbage_count > 0:
        issues.append(f"{garbage_count} unprintable chars")

    return letter_share, total, garbage_count + cid_count * 5 + replacement_count, issues


def diagnose_pdf(pdf_path: str) -> Dict[str, Any]:
    path = Path(pdf_path)
    if not path.is_file():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    print("=" * 75)
    print(f"DIAGNOSING PDF: {path.name} ({path.stat().st_size:,} bytes)")
    print(f"Path: {path.resolve()}")
    print("=" * 75)

    is_encrypted = False
    needs_pass = False

    try:
        doc = fitz.open(str(path))
    except Exception as e:
        print(f"\n[FATAL] Failed to open PDF: {e}")
        return {
            "verdict": "corrupted",
            "reason": str(e),
            "pages": 0
        }

    if doc.is_encrypted:
        is_encrypted = True
        # Try empty password
        auth_success = doc.authenticate("")
        if not auth_success and doc.needs_pass:
            needs_pass = True
            doc.close()
            print("\n[VERDICT]: encrypted")
            print("Reason: Document is password protected and requires a valid password.")
            return {
                "verdict": "encrypted",
                "reason": "Password required to decrypt document",
                "is_encrypted": True,
                "needs_pass": True
            }

    total_pages = len(doc)
    print(f"Total Pages: {total_pages}")
    print(f"Encrypted: {is_encrypted} (Needs password: {needs_pass})")
    print("-" * 75)
    print(f"{'Page':<5} | {'Chars':<7} | {'Letters %':<10} | {'Images':<7} | {'Big Image?':<11} | {'Fonts/Issues'}")
    print("-" * 75)

    page_diagnostics = []

    text_pages_count = 0
    scanned_pages_count = 0
    slides_pages_count = 0
    broken_font_pages_count = 0

    for idx in range(total_pages):
        page = doc[idx]
        p_num = idx + 1
        page_rect = page.rect
        page_area = max(1.0, page_rect.width * page_rect.height)

        # 1. Text extraction
        text = page.get_text("text").strip()
        char_count = len(text)

        # 2. Garbage & printable letter ratio
        letter_share, total_chars, _, issues = analyze_text_garbage(text)

        # 3. Images & coverage
        images = page.get_images(full=True)
        img_count = len(images)

        # Calculate bounding box area of images
        total_img_area = 0.0
        for img in images:
            xref = img[0]
            try:
                rects = page.get_image_rects(xref)
                for r in rects:
                    total_img_area += r.width * r.height
            except Exception:
                pass

        img_coverage = total_img_area / page_area if total_img_area > 0 else (0.9 if img_count >= 1 and char_count < 30 else 0.0)
        is_mostly_big_image = img_count > 0 and (img_coverage > 0.55 or (char_count < 30 and img_count >= 1))

        # 4. Font encodings
        fonts = page.get_fonts()
        font_warnings = []
        for f in fonts:
            # f format: (xref, ext, type, basefont, name, encoding)
            basefont = f[3] if len(f) > 3 else "Unknown"
            encoding = f[5] if len(f) > 5 else "Standard"
            if "Type3" in f[2]:
                font_warnings.append(f"Type3 font ({basefont})")
            if not encoding or encoding in ("None", "Identity-H") and "(cid:" in text:
                font_warnings.append(f"Unmapped encoding ({basefont})")

        all_notes = issues + font_warnings
        notes_str = ", ".join(all_notes) if all_notes else "OK"

        # Classification per page
        page_type = "unknown"
        if char_count >= 30 and letter_share >= 0.45 and not ("(cid:" in text or "\ufffd" in text):
            page_type = "text"
            text_pages_count += 1
        elif char_count >= 30 and (letter_share < 0.35 or "(cid:" in text or "\ufffd" in text):
            page_type = "broken_font"
            broken_font_pages_count += 1
        elif is_mostly_big_image and char_count < 30:
            # Check aspect ratio for slides (e.g. 16:9 or 4:3 landscape)
            aspect = page_rect.width / max(1.0, page_rect.height)
            if aspect > 1.2:
                page_type = "slides"
                slides_pages_count += 1
            else:
                page_type = "scanned"
                scanned_pages_count += 1
        else:
            if img_count > 0:
                page_type = "scanned"
                scanned_pages_count += 1
            else:
                page_type = "empty"

        page_diag = {
            "page": p_num,
            "chars": char_count,
            "letter_share": letter_share,
            "images": img_count,
            "is_mostly_big_image": is_mostly_big_image,
            "img_coverage": round(img_coverage, 2),
            "fonts_count": len(fonts),
            "page_type": page_type,
            "notes": all_notes
        }
        page_diagnostics.append(page_diag)

        letter_share_pct = f"{letter_share * 100:.1f}%" if char_count > 0 else "0.0%"
        big_img_str = f"YES ({img_coverage:.0%})" if is_mostly_big_image else "NO"
        print(f"{p_num:<5} | {char_count:<7} | {letter_share_pct:<10} | {img_count:<7} | {big_img_str:<11} | {notes_str}")

    doc.close()
    print("-" * 75)

    # Compute final verdict
    verdict = "unknown"
    reason = ""

    if broken_font_pages_count > 0 and broken_font_pages_count >= total_pages * 0.4:
        verdict = "broken font encoding"
        reason = f"{broken_font_pages_count}/{total_pages} pages contain corrupted/unmapped font glyphs or (cid:xx) codes."
    elif text_pages_count == total_pages:
        verdict = "text PDF"
        reason = "All pages contain a clean, extractable text layer with normal character distributions."
    elif scanned_pages_count == total_pages:
        verdict = "scanned/image PDF"
        reason = f"All {total_pages} pages are scanned image bitmaps with 0 text layer characters."
    elif slides_pages_count == total_pages or (slides_pages_count > 0 and (slides_pages_count + scanned_pages_count) == total_pages):
        verdict = "slides with image text"
        reason = f"Document contains landscape slide images where slide text is burned into images with no text layer."
    elif text_pages_count > 0 and (scanned_pages_count > 0 or slides_pages_count > 0 or broken_font_pages_count > 0):
        verdict = "mixed"
        reason = f"Document contains a mix of text pages ({text_pages_count}) and image/scanned pages ({scanned_pages_count + slides_pages_count})."
    elif scanned_pages_count > 0:
        verdict = "scanned/image PDF"
        reason = f"{scanned_pages_count}/{total_pages} pages lack readable text and contain image bitmaps."
    else:
        verdict = "scanned/image PDF"
        reason = "No usable text layer found across document pages."

    print(f"\nFINAL VERDICT: {verdict}")
    print(f"REASON: {reason}\n")
    print("=" * 75)

    return {
        "verdict": verdict,
        "reason": reason,
        "total_pages": total_pages,
        "text_pages": text_pages_count,
        "scanned_pages": scanned_pages_count,
        "slides_pages": slides_pages_count,
        "broken_font_pages": broken_font_pages_count,
        "page_diagnostics": page_diagnostics
    }


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "samples/failing.pdf"
    diagnose_pdf(target)
