#!/usr/bin/env python3
"""
ConceptLens Curriculum Backfill Script
Task 9: Idempotent routine linking documents extracted before this fix (e.g. Lecture_3_Sorting.pdf)
to each owner's Core Curriculum, creating missing chapter, topic, relation, and progress rows.
Safe to run multiple times without duplicating chapters, concepts, or double counting.
Strictly isolated to document owners.
"""

import sys
import os
from pathlib import Path

# Setup paths
root_dir = Path(__file__).resolve().parent.parent
backend_dir = root_dir / "backend"
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from backend.database import get_connection, is_postgres, init_db
from backend.services.planner_db import init_planner_db, backfill_unlinked_documents

def main():
    print(f"[Backfill] Target database is PostgreSQL: {is_postgres()}")
    init_db()
    init_planner_db()
    print("[Backfill] Starting curriculum backfill...")
    linked_count = backfill_unlinked_documents()
    print(f"[Backfill] Successfully linked {linked_count} document(s) to user Core Curriculums.")
    
    # Run a second pass to verify idempotency
    second_pass = backfill_unlinked_documents()
    print(f"[Backfill] Idempotency check second pass: {second_pass} documents linked (expected 0).")
    print("[Backfill] Completed successfully.")

if __name__ == "__main__":
    main()
