"""
Diagnostic script for ITEM 5.A:
Audits old extraction pipeline on two existing PDFs:
1. samples/biology_cell_structure.pdf
2. samples/sample_text.pdf (or samples/sample_slides.pdf)
Reports per-page concept distribution and pinpoints root causes.
"""
import os
import sys
from pathlib import Path
from collections import Counter
import pymupdf as fitz
from dotenv import load_dotenv

sys.path.insert(0, str(Path("d:/ConceptFinder").resolve()))
load_dotenv(Path("backend/.env"))
load_dotenv()

from backend.services.concept_extraction import extract_fallback_concepts
from backend.services.file_reader import read_document_file

def audit_document(pdf_path: Path):
    print("=" * 70)
    print(f"AUDITING: {pdf_path.name}")
    print("=" * 70)
    
    doc = fitz.open(str(pdf_path))
    total_pages = len(doc)
    
    page_chars = {}
    for p_no in range(total_pages):
        page_text = doc[p_no].get_text()
        page_chars[p_no + 1] = len(page_text.strip())
    doc.close()
    
    page_count, pages_list, full_text, has_usable_text = read_document_file(pdf_path)
    chunks = pages_list
    
    print(f"Total Pages in PDF: {total_pages}")
    print(f"Total Characters Extracted: {len(full_text)}")
    print(f"Text Chunks Created: {len(chunks)}")
    
    # Run the fallback concept extractor (which is what runs when Gemini hits limits/429/quota)
    concepts = extract_fallback_concepts(full_text=full_text, chunks=chunks)
    print(f"\nConcepts Extracted by Old Fallback: {len(concepts)}")
    
    page_counts = Counter()
    unassigned = 0
    fake_defs = 0
    
    for c in concepts:
        p = c.get("page")
        if p is not None and p > 0:
            page_counts[p] += 1
        else:
            unassigned += 1
            
        defn = c.get("definition", "")
        if "Educational concept relating to" in defn:
            fake_defs += 1
            
    print("\nPER-PAGE CONCEPT DISTRIBUTION (Old Pipeline):")
    empty_content_pages = []
    for p in range(1, total_pages + 1):
        cnt = page_counts.get(p, 0)
        ch_count = page_chars.get(p, 0)
        if cnt == 0 and ch_count > 100:
            status = "EMPTY (MISSED CONTENT!)"
            empty_content_pages.append(p)
        elif cnt > 0:
            status = f"OK ({cnt} concepts)"
        else:
            status = "Low text / blank"
        print(f"  Page {p:2d}: {cnt:2d} concepts ({ch_count:5d} chars) -> {status}")
        
    print(f"\nConcepts with placeholder definition ('Educational concept relating to...'): {fake_defs}/{len(concepts)}")
    print(f"Empty content pages: {len(empty_content_pages)} / {total_pages} pages")
    
    # Sample concepts
    print("\nSample Extracted Concepts (first 5):")
    for c in concepts[:5]:
        print(f"  - [{c.get('name')}] (Page {c.get('page')}): {c.get('definition')}")
        
    return {
        "file": pdf_path.name,
        "total_pages": total_pages,
        "total_concepts": len(concepts),
        "empty_content_pages": empty_content_pages,
        "fake_definitions_count": fake_defs,
        "page_counts": dict(page_counts)
    }

if __name__ == "__main__":
    p1 = Path("samples/biology_cell_structure.pdf")
    p2 = Path("samples/sample_text.pdf")
    if not p2.exists():
        p2 = Path("samples/sample_slides.pdf")
        
    r1 = audit_document(p1)
    print("\n")
    r2 = audit_document(p2)
    
    print("\n" + "=" * 70)
    print("FINAL SUMMARY REPORT FOR ITEM 5.A:")
    print(f"File 1: {r1['file']} ({r1['total_pages']} pages) -> {r1['total_concepts']} concepts. Page distribution: {r1['page_counts']}. Empty pages: {r1['empty_content_pages']}")
    print(f"File 2: {r2['file']} ({r2['total_pages']} pages) -> {r2['total_concepts']} concepts. Page distribution: {r2['page_counts']}. Empty pages: {r2['empty_content_pages']}")
    print("=" * 70)
