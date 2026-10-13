#!/usr/bin/env python3
"""
scripts/export_data.py

Manual backup script for ConceptLens.
Exports users (strictly excluding password hashes), notes, and documents
(with their concepts and relations) into a portable JSON backup file.

Usage:
    python scripts/export_data.py
    python scripts/export_data.py --output backups/my_backup.json

The database URL is read strictly from the DATABASE_URL environment variable.
If DATABASE_URL is unset, it falls back to the local SQLite database.
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

# Ensure backend modules can be imported
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "backend"))

# Load environment configuration
load_dotenv(project_root / "backend" / ".env")
load_dotenv(project_root / ".env")

try:
    from backend.database import get_connection, is_postgres
except ImportError:
    from database import get_connection, is_postgres


def export_data(output_path: Path) -> None:
    conn = get_connection()
    try:
        # 1. Export users (STRICTLY omitting password_hash)
        users_cursor = conn.execute("""
            SELECT id, username, display_name, name, email, google_sub, avatar, avatar_url, role, created_at, last_login_at
            FROM users
            ORDER BY created_at ASC
        """)
        users = [dict(row) for row in users_cursor.fetchall()]

        # 2. Export notes
        notes = []
        try:
            notes_cursor = conn.execute("""
                SELECT id, user_id, title, content, tags, color, pinned, document_id, chapter, created_at, updated_at
                FROM notes
                ORDER BY created_at ASC
            """)
            notes = [dict(row) for row in notes_cursor.fetchall()]
        except Exception as e:
            print(f"[WARN] Could not export notes table: {e}")

        # 3. Export documents along with concepts and relations
        docs_cursor = conn.execute("""
            SELECT id, user_id, subject_id, filename, file_type, status, stage, error, page_count,
                   raw_text, tree_json, flow_json, result_json, processing_time_sec, provider_used,
                   skipped_pages, progress, stage_message, ocr_current_page, ocr_total_pages,
                   file_hash, concept_count, chapter_count, created_at
            FROM documents
            ORDER BY created_at ASC
        """)
        documents = [dict(row) for row in docs_cursor.fetchall()]

        # Attach concepts & relations for each document
        for doc in documents:
            doc_id = doc["id"]
            c_cursor = conn.execute("""
                SELECT id, name, definition, topic, score, importance, source_excerpt, page, flow_order, flow_group
                FROM concepts
                WHERE document_id = ?
                ORDER BY id ASC
            """, (doc_id,))
            concepts = [dict(r) for r in c_cursor.fetchall()]

            r_cursor = conn.execute("""
                SELECT id, concept_id, related_name, weight, relation_type, label
                FROM relations
                WHERE document_id = ?
                ORDER BY id ASC
            """, (doc_id,))
            relations = [dict(r) for r in r_cursor.fetchall()]

            doc["concepts"] = concepts
            doc["relations"] = relations

        # 4. Export subjects
        subjects = []
        try:
            subjects_cursor = conn.execute("SELECT * FROM subjects ORDER BY created_at ASC")
            subjects = [dict(r) for r in subjects_cursor.fetchall()]
        except Exception as e:
            print(f"[WARN] Could not export subjects: {e}")

        # 5. Export chapters & topics
        chapters = []
        topics = []
        try:
            chapters_cursor = conn.execute("SELECT * FROM chapters ORDER BY created_at ASC")
            chapters = [dict(r) for r in chapters_cursor.fetchall()]
            topics_cursor = conn.execute("SELECT * FROM topics ORDER BY id ASC")
            topics = [dict(r) for r in topics_cursor.fetchall()]
        except Exception as e:
            print(f"[WARN] Could not export chapters/topics: {e}")

        # 6. Export progress
        concept_progress = []
        chapter_progress = []
        try:
            cp_cursor = conn.execute("SELECT * FROM concept_progress")
            concept_progress = [dict(r) for r in cp_cursor.fetchall()]
            chp_cursor = conn.execute("SELECT * FROM chapter_progress")
            chapter_progress = [dict(r) for r in chp_cursor.fetchall()]
        except Exception as e:
            print(f"[WARN] Could not export progress: {e}")

        backup_payload = {
            "metadata": {
                "app": "ConceptLens",
                "version": "1.0",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "database_type": "postgresql" if is_postgres() else "sqlite",
                "counts": {
                    "users": len(users),
                    "notes": len(notes),
                    "documents": len(documents),
                    "subjects": len(subjects),
                    "chapters": len(chapters),
                    "topics": len(topics),
                    "concept_progress": len(concept_progress),
                    "chapter_progress": len(chapter_progress)
                }
            },
            "users": users,
            "notes": notes,
            "documents": documents,
            "subjects": subjects,
            "chapters": chapters,
            "topics": topics,
            "concept_progress": concept_progress,
            "chapter_progress": chapter_progress
        }

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(backup_payload, f, indent=2, ensure_ascii=False)

        print(f"[OK] Successfully exported ConceptLens backup to: {output_path}")
        print(f"     - Users: {len(users)} (password hashes omitted)")
        print(f"     - Notes: {len(notes)}")
        print(f"     - Documents: {len(documents)}")
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Export ConceptLens data to JSON backup.")
    default_filename = f"conceptlens_backup_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    parser.add_argument(
        "-o", "--output",
        default=default_filename,
        help=f"Output file path (default: {default_filename})"
    )
    args = parser.parse_args()

    out_file = Path(args.output)
    export_data(out_file)


if __name__ == "__main__":
    main()
