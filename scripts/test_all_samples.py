"""
scripts/test_all_samples.py
Runs end-to-end verification across every sample PDF type:
1. Normal text PDF
2. Scanned / image PDF
3. Slides-style PDF
4. Broken font encoding PDF
5. Encrypted PDF without password (must raise password required error)
6. Encrypted PDF with password (must succeed)
7. Mixed PDF
8. Failing PDF
"""

import sys
import os
from pathlib import Path

# Ensure UTF-8 stdout encoding on Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

root_dir = Path(__file__).resolve().parent.parent
backend_dir = root_dir / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.services.file_reader import (
    read_document_file,
    EncryptedPdfError,
    ScannedNoOcrError,
    EmptyFileError,
    CorruptedPdfError
)
from backend.services.chunking import create_chunks_from_pages
from backend.services.concept_extraction import extract_concepts_pipeline, get_spacy_nlp

samples_dir = root_dir / "samples"

def test_file(filename: str, password: str = None, expect_error: type = None):
    p = samples_dir / filename
    print(f"\n--- Testing: {filename} (password={password}) ---")
    if not p.exists():
        print(f"Skipping {filename}: file not found")
        return False

    try:
        page_count, pages, full_text, skipped = read_document_file(
            p,
            pdf_password=password,
            prefer_cloud=False
        )
        if expect_error:
            print(f"[FAIL] Expected {expect_error.__name__}, but succeeded with {len(full_text)} chars")
            return False

        print(f"[OK] Read {page_count} pages, {len(pages)} usable, {len(full_text)} chars, {len(skipped)} skipped")
        
        # Extract concepts
        nlp = get_spacy_nlp()
        chunks = create_chunks_from_pages(pages, nlp)
        concepts, prov = extract_concepts_pipeline(chunks, full_text, prefer_cloud=False)
        print(f"[OK] Extracted {len(concepts)} concepts (Provider: {prov})")
        return True

    except Exception as e:
        if expect_error and isinstance(e, expect_error):
            print(f"[OK] Correctly raised expected error: {type(e).__name__} ({e})")
            return True
        elif expect_error:
            print(f"[FAIL] Raised unexpected exception: {type(e).__name__} ({e}), expected {expect_error.__name__}")
            return False
        else:
            print(f"[FAIL] Unexpected error: {type(e).__name__} ({e})")
            return False


def main():
    print("=" * 70)
    print("VERIFYING ALL SAMPLE PDF TYPES")
    print("=" * 70)

    results = {}
    
    # 1. Normal text PDF
    results["sample_text.pdf"] = test_file("sample_text.pdf")

    # 2. Scanned PDF (12 pages)
    results["sample_scanned.pdf"] = test_file("sample_scanned.pdf")

    # 3. Slides PDF
    results["sample_slides.pdf"] = test_file("sample_slides.pdf")

    # 4. Broken font PDF
    results["sample_broken_font.pdf"] = test_file("sample_broken_font.pdf")

    # 5. Encrypted PDF without password (must fail with EncryptedPdfError)
    results["sample_encrypted.pdf (no pwd)"] = test_file("sample_encrypted.pdf", password=None, expect_error=EncryptedPdfError)

    # 6. Encrypted PDF with password (must succeed)
    results["sample_encrypted.pdf (with pwd)"] = test_file("sample_encrypted.pdf", password="secret123")

    # 7. Mixed PDF
    results["sample_mixed.pdf"] = test_file("sample_mixed.pdf")

    # 8. Failing PDF
    if (samples_dir / "failing.pdf").exists():
        results["failing.pdf"] = test_file("failing.pdf")

    print("\n" + "=" * 70)
    print("SAMPLE VERIFICATION SUMMARY:")
    print("=" * 70)
    all_passed = True
    for test_name, passed in results.items():
        status = "PASSED" if passed else "FAILED"
        print(f"  {test_name:<35} : {status}")
        if not passed:
            all_passed = False

    print("=" * 70)
    print(f"Overall Result: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
