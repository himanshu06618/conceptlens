#!/usr/bin/env python3
"""
scripts/run_timing_profile.py
Measures per-stage timing for uploads:
1. Text layer extraction
2. Garbage detection / quality check
3. Page rendering (if OCR needed)
4. OCR execution (RapidOCR / local)
5. Cloud API call (if any)
6. Chunking
7. Concept extraction (spaCy / YAKE)
8. Deduplication
9. Tree building
10. Flowchart building
11. DB write / persistence
"""

import sys
import time
from pathlib import Path
from typing import Dict, Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.services.file_reader import read_document_file
from backend.services.chunking import create_chunks_from_pages
from backend.services.concept_extraction import (
    extract_concepts_pipeline,
    get_spacy_nlp
)
from backend.services.tree_builder import build_document_tree
from backend.services.flowchart_builder import build_document_flowchart
from backend.database import init_db, create_document, mark_document_completed, save_concepts_and_relations, save_document_flowchart


def profile_pipeline(file_path: Path, label: str) -> Dict[str, Any]:
    print(f"\n{'='*70}\nPROFILING PIPELINE: {label} ({file_path.name})\n{'='*70}")
    timings = {}
    total_start = time.perf_counter()

    # Stage 1-4: File reading (text layer, quality check, rendering, OCR)
    t0 = time.perf_counter()
    page_count, pages, full_text = read_document_file(file_path)
    t1 = time.perf_counter()
    timings["1_reading_and_ocr"] = t1 - t0
    print(f"[*] Reading + Text/OCR: {timings['1_reading_and_ocr']:.3f}s (Pages: {page_count}, Chars: {len(full_text):,})")

    # Stage 6: Chunking
    t0 = time.perf_counter()
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    t1 = time.perf_counter()
    timings["2_chunking"] = t1 - t0
    print(f"[*] Chunking: {timings['2_chunking']:.3f}s ({len(chunks)} chunks)")

    # Stage 7-8: Concept Extraction & Deduplication
    t0 = time.perf_counter()
    concepts = extract_concepts_pipeline(chunks, full_text)
    t1 = time.perf_counter()
    timings["3_extraction_and_dedupe"] = t1 - t0
    print(f"[*] Concept Extraction + Dedupe: {timings['3_extraction_and_dedupe']:.3f}s ({len(concepts)} concepts)")

    # Stage 9: Concept Tree Building
    t0 = time.perf_counter()
    tree = build_document_tree("bench_doc", file_path.stem, concepts)
    t1 = time.perf_counter()
    timings["4_tree_build"] = t1 - t0
    print(f"[*] Concept Tree Build: {timings['4_tree_build']:.3f}s (Nodes: {len(tree.get('nodes', []))})")

    # Stage 10: Flowchart Building
    t0 = time.perf_counter()
    flowchart = build_document_flowchart("bench_doc", concepts, full_text, include_related=True)
    t1 = time.perf_counter()
    timings["5_flowchart_build"] = t1 - t0
    print(f"[*] Flowchart Build: {timings['5_flowchart_build']:.3f}s")

    # Stage 11: Database write
    t0 = time.perf_counter()
    init_db()
    doc_id = f"bench_{int(time.time()*1000)}"
    create_document("bench_user", doc_id, file_path.name, file_path.suffix.lstrip("."), "processing", "reading")
    save_concepts_and_relations(doc_id, concepts)
    save_document_flowchart(doc_id, flowchart)
    mark_document_completed(doc_id, page_count, full_text)
    t1 = time.perf_counter()
    timings["6_db_write"] = t1 - t0
    print(f"[*] Database Write: {timings['6_db_write']:.3f}s")

    total_time = time.perf_counter() - total_start
    timings["total"] = total_time
    print(f"----------------------------------------------------------------------")
    print(f"[TOTAL TIME]: {total_time:.3f}s")
    print(f"----------------------------------------------------------------------")

    return {
        "label": label,
        "filename": file_path.name,
        "page_count": page_count,
        "char_count": len(full_text),
        "concept_count": len(concepts),
        "timings": timings
    }


def main():
    samples_dir = Path(__file__).resolve().parent.parent / "samples"
    test_cases = [
        ("Text PDF (52 pages)", samples_dir / "sample_text_50p.pdf"),
        ("Scanned PDF (12 pages)", samples_dir / "sample_scanned.pdf"),
        ("Photo / Image Notes", samples_dir / "scanned_notes_neural_networks.png"),
        ("Long TXT Document", samples_dir / "physics_quantum_mechanics.txt"),
    ]

    results = []
    for label, path in test_cases:
        if path.exists():
            res = profile_pipeline(path, label)
            results.append(res)
        else:
            print(f"Skipping missing file: {path}")

    print("\n" + "=" * 80)
    print("TIMING BENCHMARK SUMMARY TABLE")
    print("=" * 80)
    print(f"{'Test Case':<25} | {'Pages':<6} | {'Reading/OCR':<12} | {'Extract+Dedup':<14} | {'Tree+Flow':<10} | {'Total':<8}")
    print("-" * 80)
    for r in results:
        t = r["timings"]
        tree_flow = t["4_tree_build"] + t["5_flowchart_build"]
        print(f"{r['label']:<25} | {r['page_count']:<6} | {t['1_reading_and_ocr']:<11.2f}s | {t['3_extraction_and_dedupe']:<13.2f}s | {tree_flow:<9.2f}s | {t['total']:<7.2f}s")
    print("=" * 80)


if __name__ == "__main__":
    main()
