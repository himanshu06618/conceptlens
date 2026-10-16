"""
scripts/eval_extraction.py
Automated Quality Evaluation for ConceptLens Extraction Pipeline (v1 vs v2).

Computes:
1. Per-page concept counts and coverage %
2. Position distribution: Beginning (first 33%), Middle (34%), End (last 33%) to detect middle-pages drop-off
3. Placeholder definition rate ('Educational concept relating to...')
4. Duplicate rate & junk rate
5. Exports CSV report for human gold-standard annotation to tests/extraction_gold/
"""

import os
import sys
import csv
import json
from pathlib import Path
from collections import Counter, defaultdict
import pymupdf as fitz
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path("backend/.env"))
load_dotenv()

from backend.services.concept_extraction import extract_fallback_concepts
from backend.services.file_reader import read_document_file
from backend.services.layout_extractor import LayoutExtractor
from backend.services.extraction_v2 import (
    ExtractionV2Pipeline,
    is_junk_concept,
    normalize_concept_name
)

GOLD_DIR = Path("tests/extraction_gold")
GOLD_DIR.mkdir(parents=True, exist_ok=True)


def evaluate_pdf(pdf_path: Path):
    print("=" * 75)
    print(f"EVALUATING EXTRACTION QUALITY ON: {pdf_path.name}")
    print("=" * 75)

    doc = fitz.open(str(pdf_path))
    total_pages = len(doc)
    page_chars = {}
    for p_no in range(total_pages):
        page_chars[p_no + 1] = len(doc[p_no].get_text().strip())
    doc.close()

    content_pages = [p for p, ch in page_chars.items() if ch > 80]
    total_content_pages = len(content_pages) or 1

    # --- 1. RUN OLD PIPELINE (Fallback on quota/limits) ---
    _, _, full_text, _ = read_document_file(pdf_path)
    old_concepts = extract_fallback_concepts(full_text=full_text)

    old_page_counts = Counter()
    old_placeholders = 0
    old_junk = 0
    old_seen = set()
    old_dupes = 0

    for c in old_concepts:
        p = c.get("page", 1)
        old_page_counts[p] += 1
        defn = c.get("definition", "")
        if "Educational concept relating to" in defn:
            old_placeholders += 1
        name = c.get("name", "")
        if is_junk_concept(name):
            old_junk += 1
        norm = normalize_concept_name(name)
        if norm in old_seen:
            old_dupes += 1
        else:
            old_seen.add(norm)

    # Position split for old pipeline
    b_end = max(1, total_pages // 3)
    m_end = max(b_end + 1, (2 * total_pages) // 3)
    
    old_beg = sum(old_page_counts[p] for p in range(1, b_end + 1))
    old_mid = sum(old_page_counts[p] for p in range(b_end + 1, m_end + 1))
    old_end = sum(old_page_counts[p] for p in range(m_end + 1, total_pages + 1))

    old_covered_pages = len([p for p in content_pages if old_page_counts[p] > 0])
    old_coverage_pct = round((old_covered_pages / total_content_pages) * 100, 1)

    # --- 2. RUN PIPELINE V2 ---
    v2_pipeline = ExtractionV2Pipeline()
    v2_result = v2_pipeline.extract_document(pdf_path, doc_id="eval_" + pdf_path.stem)
    v2_concepts = v2_result.get("concepts", [])

    v2_page_counts = Counter()
    v2_placeholders = 0
    v2_junk = 0
    v2_seen = set()
    v2_dupes = 0
    v2_verified_count = 0

    for c in v2_concepts:
        for p in c.get("pages", [c.get("page", 1)]):
            v2_page_counts[p] += 1
        defn = c.get("definition", "")
        if "Educational concept relating to" in defn:
            v2_placeholders += 1
        name = c.get("name", "")
        if is_junk_concept(name):
            v2_junk += 1
        norm = normalize_concept_name(name)
        if norm in v2_seen:
            v2_dupes += 1
        else:
            v2_seen.add(norm)
        if c.get("source_verified"):
            v2_verified_count += 1

    v2_beg = sum(v2_page_counts[p] for p in range(1, b_end + 1))
    v2_mid = sum(v2_page_counts[p] for p in range(b_end + 1, m_end + 1))
    v2_end = sum(v2_page_counts[p] for p in range(m_end + 1, total_pages + 1))

    v2_covered_pages = len([p for p in content_pages if v2_page_counts[p] > 0])
    v2_coverage_pct = round((v2_covered_pages / total_content_pages) * 100, 1)

    # --- 3. EXPORT CSV FOR GOLD ANNOTATION ---
    csv_file = GOLD_DIR / f"{pdf_path.stem}_eval.csv"
    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "page", "name", "definition", "source_quote", "source_verified",
            "is_correct (1/0)", "is_junk (1/0)", "is_duplicate (1/0)", "missing_concepts_for_page", "notes"
        ])
        for c in v2_concepts:
            writer.writerow([
                c.get("page", 1),
                c.get("name", ""),
                c.get("definition", ""),
                c.get("source_quote", ""),
                "YES" if c.get("source_verified") else "NO",
                "", "", "", "", ""
            ])

    # --- 4. PRINT REPORT ---
    print(f"\nDOCUMENT: {pdf_path.name} ({total_pages} total pages, {total_content_pages} content pages)")
    print("-" * 75)
    print(f"{'Metric':<35} | {'Old Pipeline':<16} | {'Pipeline v2':<16}")
    print("-" * 75)
    print(f"{'Total Concepts':<35} | {len(old_concepts):<16} | {len(v2_concepts):<16}")
    print(f"{'Content Pages Covered':<35} | {f'{old_covered_pages}/{total_content_pages} ({old_coverage_pct}%)':<16} | {f'{v2_covered_pages}/{total_content_pages} ({v2_coverage_pct}%)':<16}")
    print(f"{'Beginning Pages Concepts (p 1-{b_end})':<35} | {old_beg:<16} | {v2_beg:<16}")
    print(f"{'Middle Pages Concepts (p {b_end+1}-{m_end})':<35} | {old_mid:<16} | {v2_mid:<16}")
    print(f"{'End Pages Concepts (p {m_end+1}-{total_pages})':<35} | {old_end:<16} | {v2_end:<16}")
    print(f"{'Placeholder Definitions':<35} | {f'{old_placeholders} ({round(old_placeholders/max(1,len(old_concepts))*100,1)}%)':<16} | {f'{v2_placeholders} ({round(v2_placeholders/max(1,len(v2_concepts))*100,1)}%)':<16}")
    print(f"{'Junk Concepts Detected':<35} | {f'{old_junk} ({round(old_junk/max(1,len(old_concepts))*100,1)}%)':<16} | {f'{v2_junk} ({round(v2_junk/max(1,len(v2_concepts))*100,1)}%)':<16}")
    print(f"{'Duplicates Detected':<35} | {f'{old_dupes} ({round(old_dupes/max(1,len(old_concepts))*100,1)}%)':<16} | {f'{v2_dupes} ({round(v2_dupes/max(1,len(v2_concepts))*100,1)}%)':<16}")
    print(f"{'Verified Source Quotes':<35} | {'0 (Unverified)':<16} | {f'{v2_verified_count}/{len(v2_concepts)}':<16}")
    print(f"{'Gold CSV Exported':<35} | {'-':<16} | {csv_file.name:<16}")
    print("-" * 75)

    return {
        "file": pdf_path.name,
        "old": {
            "total": len(old_concepts),
            "coverage_pct": old_coverage_pct,
            "placeholders": old_placeholders,
            "distribution": [old_beg, old_mid, old_end]
        },
        "v2": {
            "total": len(v2_concepts),
            "coverage_pct": v2_coverage_pct,
            "placeholders": v2_placeholders,
            "distribution": [v2_beg, v2_mid, v2_end],
            "verified": v2_verified_count
        }
    }


if __name__ == "__main__":
    p1 = Path("samples/biology_cell_structure.pdf")
    p2 = Path("samples/sample_text.pdf")
    evaluate_pdf(p1)
    print("\n")
    evaluate_pdf(p2)
