#!/usr/bin/env python3
"""
scripts/run_single_benchmark.py
Measures per-stage timings for a single file and flushes output immediately.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.services.file_reader import read_document_file
from backend.services.chunking import create_chunks_from_pages
from backend.services.concept_extraction import extract_concepts_pipeline, get_spacy_nlp
from backend.services.tree_builder import build_document_tree
from backend.services.flowchart_builder import build_document_flowchart
from backend.database import init_db, create_document, mark_document_completed, save_concepts_and_relations, save_document_flowchart


def run_bench(file_path: Path):
    print(f"BENCHMARKING: {file_path.name}", flush=True)
    t_start = time.perf_counter()

    t0 = time.perf_counter()
    page_count, pages, full_text = read_document_file(file_path)
    t_read = time.perf_counter() - t0
    print(f"  Stage 1 (Reading/OCR): {t_read:.3f}s (Pages: {page_count}, Chars: {len(full_text):,})", flush=True)

    t0 = time.perf_counter()
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    t_chunk = time.perf_counter() - t0
    print(f"  Stage 2 (Chunking): {t_chunk:.3f}s ({len(chunks)} chunks)", flush=True)

    t0 = time.perf_counter()
    concepts = extract_concepts_pipeline(chunks, full_text)
    t_extract = time.perf_counter() - t0
    print(f"  Stage 3 (Extraction+Dedupe): {t_extract:.3f}s ({len(concepts)} concepts)", flush=True)

    t0 = time.perf_counter()
    tree = build_document_tree("bench_doc", file_path.stem, concepts)
    t_tree = time.perf_counter() - t0
    print(f"  Stage 4 (Tree Build): {t_tree:.3f}s", flush=True)

    t0 = time.perf_counter()
    flowchart = build_document_flowchart("bench_doc", concepts, full_text, include_related=True)
    t_flow = time.perf_counter() - t0
    print(f"  Stage 5 (Flowchart Build): {t_flow:.3f}s", flush=True)

    t0 = time.perf_counter()
    init_db()
    doc_id = f"bench_{int(time.time()*1000)}"
    create_document("bench_user", doc_id, file_path.name, file_path.suffix.lstrip("."), "processing", "reading")
    save_concepts_and_relations(doc_id, concepts)
    save_document_flowchart(doc_id, flowchart)
    mark_document_completed(doc_id, page_count, full_text)
    t_db = time.perf_counter() - t0
    print(f"  Stage 6 (DB Write): {t_db:.3f}s", flush=True)

    t_total = time.perf_counter() - t_start
    print(f"  >>> TOTAL TIME: {t_total:.3f}s\n", flush=True)


if __name__ == "__main__":
    target = Path(sys.argv[1])
    run_bench(target)
