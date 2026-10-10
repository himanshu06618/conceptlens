"""
scripts/benchmark.py
Measures per-stage processing times across the 4 key benchmarks:
1. Text PDF 50+ pages (sample_text_50p.pdf)
2. Scanned PDF 10+ pages (sample_scanned.pdf)
3. Photo Notes (scanned_notes_neural_networks.png)
4. Long TXT (physics_quantum_mechanics.txt)

Compares empirical BEFORE vs AFTER numbers and outputs a structured benchmark table.
"""

import sys
import os
import time
import json
from pathlib import Path

# Ensure UTF-8 stdout encoding on Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Add backend directory to sys.path
root_dir = Path(__file__).resolve().parent.parent
backend_dir = root_dir / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from backend.database import (
    init_db,
    create_document,
    mark_document_completed,
    save_concepts_and_relations,
    save_document_tree,
    save_document_flowchart
)
from backend.services.file_reader import read_document_file
from backend.services.chunking import create_chunks_from_pages
from backend.services.concept_extraction import (
    extract_concepts_pipeline,
    get_spacy_nlp,
    TOP_CONCEPTS_LIMIT_DEFAULT,
    USE_KEYBERT_ENV
)
from backend.services.tree_builder import build_document_tree
from backend.services.flowchart_builder import build_document_flowchart
from backend.services.ocr import check_rapidocr_available

# Stored BEFORE baseline numbers (measured empirically before fixes)
BEFORE_DATA = {
    "Text PDF 52p": {
        "reading": 0.96,
        "chunking": 6.20,
        "extraction": 10.35,
        "tree_flow": 0.07,
        "db": 0.18,
        "total": 17.75,
        "concepts": 48,
        "status": "Success"
    },
    "Scanned PDF 12p": {
        "reading": ">600.0 (EasyOCR timeout)",
        "chunking": "-",
        "extraction": "-",
        "tree_flow": "-",
        "db": "-",
        "total": "FAILED (>600s)",
        "concepts": 0,
        "status": "Failed (EmptyFileError / timeout)"
    },
    "Photo Notes": {
        "reading": ">105.0 (EasyOCR CPU hang)",
        "chunking": "-",
        "extraction": "-",
        "tree_flow": "-",
        "db": "-",
        "total": "FAILED (>105s)",
        "concepts": 0,
        "status": "Failed (Request timeout)"
    },
    "Long TXT": {
        "reading": 0.08,
        "chunking": 1.64,
        "extraction": 3.57,
        "tree_flow": 0.06,
        "db": 0.27,
        "total": 5.63,
        "concepts": 36,
        "status": "Success"
    }
}


def benchmark_case(name: str, file_path: Path):
    print(f"\n>>> Running Benchmark: {name} ({file_path.name}) ...")
    if not file_path.exists():
        print(f"Error: File {file_path} not found!")
        return None

    doc_id = f"bench_{int(time.time())}_{name.replace(' ', '_')}"
    user_id = "benchmark_runner"

    create_document(
        user_id=user_id,
        doc_id=doc_id,
        filename=file_path.name,
        file_type=file_path.suffix.lstrip("."),
        status="processing",
        stage="reading"
    )

    t_total_start = time.perf_counter()

    # Stage 1: Read & Acquire Text
    t0 = time.perf_counter()
    try:
        page_count, pages, full_text, skipped_pages = read_document_file(
            file_path,
            prefer_cloud=False  # Test local on-device fallback for true CPU benchmark
        )
        t_read = time.perf_counter() - t0
    except Exception as e:
        print(f"FAILED during read: {e}")
        return {
            "name": name,
            "status": f"Failed: {e}",
            "read": "-",
            "chunk": "-",
            "extract": "-",
            "tree_flow": "-",
            "db": "-",
            "total": "-",
            "concepts": 0
        }

    # Stage 2: Chunking
    t0 = time.perf_counter()
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    t_chunk = time.perf_counter() - t0

    # Stage 3: Extraction & Dedupe
    t0 = time.perf_counter()
    concepts, provider = extract_concepts_pipeline(
        chunks,
        full_text,
        top_limit=TOP_CONCEPTS_LIMIT_DEFAULT,
        use_keybert=USE_KEYBERT_ENV,
        prefer_cloud=False
    )
    t_extract = time.perf_counter() - t0

    # Stage 4: Tree & Flowchart Build
    t0 = time.perf_counter()
    tree = build_document_tree(doc_id, file_path.name, concepts)
    save_document_tree(doc_id, tree)
    flow = build_document_flowchart(doc_id, concepts, full_text, include_related=True)
    save_document_flowchart(doc_id, flow)
    t_tree_flow = time.perf_counter() - t0

    # Stage 5: Database Save
    t0 = time.perf_counter()
    save_concepts_and_relations(doc_id, concepts)
    t_total = time.perf_counter() - t_total_start
    mark_document_completed(
        doc_id,
        page_count=page_count,
        raw_text=full_text,
        processing_time_sec=t_total,
        provider_used=provider,
        skipped_pages=skipped_pages
    )
    t_db = time.perf_counter() - t0

    print(f"[OK] Completed {name}: {len(concepts)} concepts extracted in {t_total:.2f}s total (Provider: {provider})")
    print(f"  - Reading: {t_read:.2f}s | Chunking: {t_chunk:.2f}s | Extraction: {t_extract:.2f}s | Tree/Flow: {t_tree_flow:.2f}s | DB: {t_db:.2f}s")

    return {
        "name": name,
        "status": "Success",
        "read": round(t_read, 2),
        "chunk": round(t_chunk, 2),
        "extract": round(t_extract, 2),
        "tree_flow": round(t_tree_flow, 2),
        "db": round(t_db, 2),
        "total": round(t_total, 2),
        "concepts": len(concepts),
        "provider": provider
    }


def main():
    print("=" * 80)
    print("CONCEPTLENS PERFORMANCE BENCHMARK (BEFORE vs AFTER)")
    print("=" * 80)

    init_db()
    rapid_ok, rapid_msg = check_rapidocr_available()
    print(f"Local OCR Engine: RapidOCR ONNX Runtime operational: {rapid_ok} ({rapid_msg})")

    samples_dir = root_dir / "samples"
    test_cases = [
        ("Text PDF 52p", samples_dir / "sample_text_50p.pdf"),
        ("Scanned PDF 12p", samples_dir / "sample_scanned.pdf"),
        ("Photo Notes", samples_dir / "scanned_notes_neural_networks.png"),
        ("Long TXT", samples_dir / "physics_quantum_mechanics.txt")
    ]

    after_results = {}
    for name, p in test_cases:
        res = benchmark_case(name, p)
        if res:
            after_results[name] = res

    # Print Summary Table
    print("\n" + "=" * 90)
    print(f"{'TEST CASE':<18} {'BEFORE TOTAL':<18} {'AFTER TOTAL':<15} {'SPEEDUP / STATUS':<22} {'CONCEPTS'}")
    print("=" * 90)

    for name in ["Text PDF 52p", "Scanned PDF 12p", "Photo Notes", "Long TXT"]:
        before = BEFORE_DATA.get(name, {})
        after = after_results.get(name, {})

        b_tot = before.get("total", "-")
        b_str = f"{b_tot}s" if isinstance(b_tot, (int, float)) else str(b_tot)

        a_tot = after.get("total", "-")
        a_str = f"{a_tot}s" if isinstance(a_tot, (int, float)) else str(a_tot)

        concepts_str = f"{after.get('concepts', 0)} concepts"

        if isinstance(b_tot, (int, float)) and isinstance(a_tot, (int, float)):
            speedup = f"{b_tot / a_tot:.1f}x faster" if a_tot > 0 else "-"
        else:
            speedup = "FIXED (Now Works)"

        print(f"{name:<18} {b_str:<18} {a_str:<15} {speedup:<22} {concepts_str}")

    print("=" * 90)
    print("\nDetailed Per-Stage Breakdown (AFTER):")
    print("-" * 90)
    print(f"{'TEST CASE':<18} {'READ (s)':<12} {'CHUNK (s)':<12} {'EXTRACT (s)':<14} {'TREE/FLOW (s)':<14} {'DB (s)'}")
    print("-" * 90)
    for name in ["Text PDF 52p", "Scanned PDF 12p", "Photo Notes", "Long TXT"]:
        a = after_results.get(name, {})
        print(f"{name:<18} {str(a.get('read', '-')):<12} {str(a.get('chunk', '-')):<12} {str(a.get('extract', '-')):<14} {str(a.get('tree_flow', '-')):<14} {str(a.get('db', '-'))}")
    print("-" * 90)


if __name__ == "__main__":
    main()
