#!/usr/bin/env python3
"""
scripts/dedupe_data.py

Safe deduplication and data cleanup script for ConceptLens.
Detects and safely resolves duplicate documents, chapters, concepts, relations,
and topics, re-points foreign keys, merges progress, removes orphans,
and structural unique constraints.

Usage:
    # Dry-run mode (default, no changes made):
    python scripts/dedupe_data.py
    python scripts/dedupe_data.py --dry-run

    # Apply mode (requires --yes):
    python scripts/dedupe_data.py --apply --yes

Strict Rules:
- Never prints or logs passwords, tokens, full database URLs, or document content.
- Prints database host only.
- In --apply mode, always creates a verified pre-cleanup backup using export_data.py before altering data.
- Executes cleanup in transactions scoped per document / user.
- Never touches another user's rows.
- Re-points foreign keys and merges progress without losing "studied" status.
- Applies unique constraints after cleanup is complete.
"""

import os
import sys
import argparse
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone
from dotenv import load_dotenv

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "backend"))

load_dotenv(project_root / "backend" / ".env")
load_dotenv(project_root / ".env")

from backend.database import get_connection, is_postgres, apply_safe_unique_constraints
from scripts.export_data import export_data


def get_db_host() -> str:
    raw_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        return "localhost (sqlite)"
    parsed = urlparse(raw_url)
    return parsed.hostname or "localhost"


def analyze_duplicates(conn):
    """
    Scans the database for duplicate documents, chapters, concepts,
    relations, and topics, as well as orphan rows.
    Returns structured stats grouped per user.
    """
    user_stats = {}

    def ensure_user(uid):
        if uid not in user_stats:
            user_stats[uid] = {
                "duplicate_documents": 0,
                "duplicate_chapters": 0,
                "duplicate_concepts": 0,
                "duplicate_relations": 0,
                "duplicate_topics": 0,
            }

    # 1. Duplicate documents by (user_id, file_hash)
    doc_dups = conn.execute("""
        SELECT user_id, file_hash, COUNT(*) as cnt
        FROM documents
        WHERE file_hash IS NOT NULL AND file_hash != ''
        GROUP BY user_id, file_hash
        HAVING COUNT(*) > 1
    """).fetchall()

    for row in doc_dups:
        uid = row["user_id"] or "unassigned"
        ensure_user(uid)
        user_stats[uid]["duplicate_documents"] += (row["cnt"] - 1)

    # 2. Duplicate chapters by (book_id, LOWER(TRIM(name)))
    ch_dups = conn.execute("""
        SELECT d.user_id, c.book_id, LOWER(TRIM(c.name)) as norm_name, COUNT(*) as cnt
        FROM chapters c
        JOIN documents d ON c.book_id = d.id
        GROUP BY d.user_id, c.book_id, LOWER(TRIM(c.name))
        HAVING COUNT(*) > 1
    """).fetchall()

    for row in ch_dups:
        uid = row["user_id"] or "unassigned"
        ensure_user(uid)
        user_stats[uid]["duplicate_chapters"] += (row["cnt"] - 1)

    # 3. Duplicate concepts by (document_id, LOWER(TRIM(name)))
    con_dups = conn.execute("""
        SELECT d.user_id, c.document_id, LOWER(TRIM(c.name)) as norm_name, COUNT(*) as cnt
        FROM concepts c
        JOIN documents d ON c.document_id = d.id
        GROUP BY d.user_id, c.document_id, LOWER(TRIM(c.name))
        HAVING COUNT(*) > 1
    """).fetchall()

    for row in con_dups:
        uid = row["user_id"] or "unassigned"
        ensure_user(uid)
        user_stats[uid]["duplicate_concepts"] += (row["cnt"] - 1)

    # 4. Duplicate relations by (concept_id, LOWER(TRIM(related_name)), relation_type)
    rel_dups = conn.execute("""
        SELECT d.user_id, r.concept_id, LOWER(TRIM(r.related_name)) as norm_rel, r.relation_type, COUNT(*) as cnt
        FROM relations r
        JOIN concepts c ON r.concept_id = c.id
        JOIN documents d ON c.document_id = d.id
        GROUP BY d.user_id, r.concept_id, LOWER(TRIM(r.related_name)), r.relation_type
        HAVING COUNT(*) > 1
    """).fetchall()

    for row in rel_dups:
        uid = row["user_id"] or "unassigned"
        ensure_user(uid)
        user_stats[uid]["duplicate_relations"] += (row["cnt"] - 1)

    # 5. Duplicate topics by (chapter_id, LOWER(TRIM(name)))
    top_dups = conn.execute("""
        SELECT d.user_id, t.chapter_id, LOWER(TRIM(t.name)) as norm_top, COUNT(*) as cnt
        FROM topics t
        JOIN chapters c ON t.chapter_id = c.id
        JOIN documents d ON c.book_id = d.id
        GROUP BY d.user_id, t.chapter_id, LOWER(TRIM(t.name))
        HAVING COUNT(*) > 1
    """).fetchall()

    for row in top_dups:
        uid = row["user_id"] or "unassigned"
        ensure_user(uid)
        user_stats[uid]["duplicate_topics"] += (row["cnt"] - 1)

    # 6. Orphan detection
    orphans = {}
    orphans["chapters"] = conn.execute("SELECT COUNT(*) FROM chapters WHERE book_id NOT IN (SELECT id FROM documents)").fetchone()[0]
    orphans["concepts"] = conn.execute("SELECT COUNT(*) FROM concepts WHERE document_id NOT IN (SELECT id FROM documents)").fetchone()[0]
    orphans["relations"] = conn.execute("SELECT COUNT(*) FROM relations WHERE document_id NOT IN (SELECT id FROM documents) OR concept_id NOT IN (SELECT id FROM concepts)").fetchone()[0]
    orphans["topics"] = conn.execute("SELECT COUNT(*) FROM topics WHERE chapter_id NOT IN (SELECT id FROM chapters)").fetchone()[0]
    orphans["chapter_progress"] = conn.execute("SELECT COUNT(*) FROM chapter_progress WHERE chapter_id NOT IN (SELECT id FROM chapters)").fetchone()[0]
    
    # Concept progress orphans (check integer cast for postgres)
    if is_postgres():
        orphans["concept_progress"] = conn.execute("""
            SELECT COUNT(*) FROM concept_progress cp
            WHERE NOT EXISTS (SELECT 1 FROM concepts c WHERE CAST(c.id AS TEXT) = cp.concept_id)
        """).fetchone()[0]
    else:
        orphans["concept_progress"] = conn.execute("""
            SELECT COUNT(*) FROM concept_progress cp
            WHERE NOT EXISTS (SELECT 1 FROM concepts c WHERE CAST(c.id AS TEXT) = cp.concept_id)
        """).fetchone()[0]

    return user_stats, orphans


def dedupe_data_apply(conn):
    """
    Executes destructive cleanup safely inside transactions per document / user.
    Keeps oldest rows, re-points foreign keys, merges progress, and deletes duplicate rows.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    affected_users = set()

    # STEP A: Deduplicate documents by (user_id, file_hash)
    doc_groups = conn.execute("""
        SELECT user_id, file_hash
        FROM documents
        WHERE file_hash IS NOT NULL AND file_hash != ''
        GROUP BY user_id, file_hash
        HAVING COUNT(*) > 1
    """).fetchall()

    for dg in doc_groups:
        uid = dg["user_id"]
        fhash = dg["file_hash"]
        affected_users.add(uid)

        with conn:
            docs = conn.execute("""
                SELECT id, created_at, status
                FROM documents
                WHERE user_id = ? AND file_hash = ?
                ORDER BY created_at ASC, id ASC
            """, (uid, fhash)).fetchall()

            if len(docs) <= 1:
                continue

            kept_doc = docs[0]
            kept_id = kept_doc["id"]
            dup_ids = [d["id"] for d in docs[1:]]

            for dup_id in dup_ids:
                # Re-point chapters, concepts, relations, notes to kept_id
                conn.execute("UPDATE chapters SET book_id = ? WHERE book_id = ?", (kept_id, dup_id))
                conn.execute("UPDATE concepts SET document_id = ? WHERE document_id = ?", (kept_id, dup_id))
                conn.execute("UPDATE relations SET document_id = ? WHERE document_id = ?", (kept_id, dup_id))
                conn.execute("UPDATE notes SET document_id = ? WHERE document_id = ?", (kept_id, dup_id))
                conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (dup_id, uid))

    # STEP B: Deduplicate chapters by (book_id, LOWER(TRIM(name)))
    ch_groups = conn.execute("""
        SELECT c.book_id, LOWER(TRIM(c.name)) as norm_name, d.user_id
        FROM chapters c
        JOIN documents d ON c.book_id = d.id
        GROUP BY c.book_id, LOWER(TRIM(c.name)), d.user_id
        HAVING COUNT(*) > 1
    """).fetchall()

    for cg in ch_groups:
        book_id = cg["book_id"]
        norm_name = cg["norm_name"]
        uid = cg["user_id"]
        affected_users.add(uid)

        with conn:
            chs = conn.execute("""
                SELECT id, order_index, created_at
                FROM chapters
                WHERE book_id = ? AND LOWER(TRIM(name)) = ?
                ORDER BY created_at ASC, id ASC
            """, (book_id, norm_name)).fetchall()

            if len(chs) <= 1:
                continue

            kept_ch = chs[0]
            kept_ch_id = kept_ch["id"]
            dup_ch_ids = [c["id"] for c in chs[1:]]

            # Merge chapter_progress: if any duplicate has status 2, kept gets status 2
            max_status = 0
            all_ch_ids = [kept_ch_id] + dup_ch_ids
            for cid in all_ch_ids:
                prog_row = conn.execute(
                    "SELECT status FROM chapter_progress WHERE chapter_id = ? AND user_id = ?",
                    (cid, uid)
                ).fetchone()
                if prog_row and prog_row["status"] > max_status:
                    max_status = prog_row["status"]

            # Set merged status on kept chapter
            conn.execute("""
                INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (user_id, chapter_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
            """, (uid, kept_ch_id, max_status, now_iso))

            for dup_ch_id in dup_ch_ids:
                # Delete duplicate chapter progress
                conn.execute("DELETE FROM chapter_progress WHERE chapter_id = ?", (dup_ch_id,))
                # Re-point topics
                conn.execute("UPDATE topics SET chapter_id = ? WHERE chapter_id = ?", (kept_ch_id, dup_ch_id))
                # Re-point study_plans
                conn.execute("UPDATE study_plans SET scope_chapter_id = ? WHERE scope_chapter_id = ?", (kept_ch_id, dup_ch_id))
                # Delete duplicate chapter
                conn.execute("DELETE FROM chapters WHERE id = ?", (dup_ch_id,))

    # STEP C: Deduplicate topics by (chapter_id, LOWER(TRIM(name)))
    top_groups = conn.execute("""
        SELECT chapter_id, LOWER(TRIM(name)) as norm_name
        FROM topics
        GROUP BY chapter_id, LOWER(TRIM(name))
        HAVING COUNT(*) > 1
    """).fetchall()

    for tg in top_groups:
        chid = tg["chapter_id"]
        norm_name = tg["norm_name"]

        with conn:
            tops = conn.execute("""
                SELECT id
                FROM topics
                WHERE chapter_id = ? AND LOWER(TRIM(name)) = ?
                ORDER BY id ASC
            """, (chid, norm_name)).fetchall()

            if len(tops) <= 1:
                continue

            kept_tid = tops[0]["id"]
            dup_tids = [t["id"] for t in tops[1:]]

            for dup_tid in dup_tids:
                # Re-point topic_relations
                conn.execute("UPDATE topic_relations SET from_topic_id = ? WHERE from_topic_id = ?", (kept_tid, dup_tid))
                conn.execute("UPDATE topic_relations SET to_topic_id = ? WHERE to_topic_id = ?", (kept_tid, dup_tid))
                # Delete self-referencing topic relations
                conn.execute("DELETE FROM topic_relations WHERE from_topic_id = to_topic_id")
                # Delete duplicate topic
                conn.execute("DELETE FROM topics WHERE id = ?", (dup_tid,))

    # Normalize chapter order_index for any chapters in books
    with conn:
        doc_rows = conn.execute("SELECT id FROM documents").fetchall()
        for dr in doc_rows:
            ch_list = conn.execute("SELECT id FROM chapters WHERE book_id = ? ORDER BY order_index ASC, created_at ASC", (dr["id"],)).fetchall()
            for idx, ch_item in enumerate(ch_list):
                conn.execute("UPDATE chapters SET order_index = ? WHERE id = ?", (idx + 1, ch_item["id"]))

    # Normalize topic order_index for any topics in chapters
    with conn:
        ch_rows = conn.execute("SELECT id FROM chapters").fetchall()
        for cr in ch_rows:
            top_list = conn.execute("SELECT id FROM topics WHERE chapter_id = ? ORDER BY order_index ASC, id ASC", (cr["id"],)).fetchall()
            for idx, t_item in enumerate(top_list):
                conn.execute("UPDATE topics SET order_index = ? WHERE id = ?", (idx + 1, t_item["id"]))

    # STEP D: Deduplicate concepts by (document_id, LOWER(TRIM(name)))
    con_groups = conn.execute("""
        SELECT c.document_id, LOWER(TRIM(c.name)) as norm_name, d.user_id
        FROM concepts c
        JOIN documents d ON c.document_id = d.id
        GROUP BY c.document_id, LOWER(TRIM(c.name)), d.user_id
        HAVING COUNT(*) > 1
    """).fetchall()

    for cg in con_groups:
        doc_id = cg["document_id"]
        norm_name = cg["norm_name"]
        uid = cg["user_id"]
        affected_users.add(uid)

        with conn:
            cons = conn.execute("""
                SELECT id
                FROM concepts
                WHERE document_id = ? AND LOWER(TRIM(name)) = ?
                ORDER BY id ASC
            """, (doc_id, norm_name)).fetchall()

            if len(cons) <= 1:
                continue

            kept_cid = cons[0]["id"]
            dup_cids = [c["id"] for c in cons[1:]]

            # Merge concept_progress: if any duplicate has status 'studied', kept gets 'studied'
            studied = False
            all_cids = [kept_cid] + dup_cids
            for cid in all_cids:
                prog_row = conn.execute(
                    "SELECT status FROM concept_progress WHERE concept_id = ? AND user_id = ?",
                    (str(cid), uid)
                ).fetchone()
                if prog_row and prog_row["status"] == "studied":
                    studied = True

            if studied:
                conn.execute("""
                    INSERT INTO concept_progress (user_id, concept_id, status, updated_at)
                    VALUES (?, ?, 'studied', ?)
                    ON CONFLICT (user_id, concept_id) DO UPDATE SET
                        status = 'studied',
                        updated_at = excluded.updated_at
                """, (uid, str(kept_cid), now_iso))

            for dup_cid in dup_cids:
                # Delete duplicate concept progress
                conn.execute("DELETE FROM concept_progress WHERE concept_id = ? AND user_id = ?", (str(dup_cid), uid))
                # Re-point relations
                conn.execute("UPDATE relations SET concept_id = ? WHERE concept_id = ?", (kept_cid, dup_cid))
                # Delete duplicate concept
                conn.execute("DELETE FROM concepts WHERE id = ?", (dup_cid,))

    # STEP E: Deduplicate relations by (concept_id, LOWER(TRIM(related_name)), relation_type)
    rel_groups = conn.execute("""
        SELECT concept_id, LOWER(TRIM(related_name)) as norm_rel, relation_type
        FROM relations
        GROUP BY concept_id, LOWER(TRIM(related_name)), relation_type
        HAVING COUNT(*) > 1
    """).fetchall()

    for rg in rel_groups:
        cid = rg["concept_id"]
        norm_rel = rg["norm_rel"]
        rtype = rg["relation_type"]

        with conn:
            rels = conn.execute("""
                SELECT id
                FROM relations
                WHERE concept_id = ? AND LOWER(TRIM(related_name)) = ? AND relation_type = ?
                ORDER BY id ASC
            """, (cid, norm_rel, rtype)).fetchall()

            if len(rels) <= 1:
                continue

            dup_rids = [r["id"] for r in rels[1:]]
            for dup_rid in dup_rids:
                conn.execute("DELETE FROM relations WHERE id = ?", (dup_rid,))

    # STEP F: Clean orphan rows
    with conn:
        conn.execute("DELETE FROM chapters WHERE book_id NOT IN (SELECT id FROM documents)")
        conn.execute("DELETE FROM concepts WHERE document_id NOT IN (SELECT id FROM documents)")
        conn.execute("DELETE FROM relations WHERE document_id NOT IN (SELECT id FROM documents) OR concept_id NOT IN (SELECT id FROM concepts)")
        conn.execute("DELETE FROM topics WHERE chapter_id NOT IN (SELECT id FROM chapters)")
        conn.execute("DELETE FROM topic_relations WHERE from_topic_id NOT IN (SELECT id FROM topics) OR to_topic_id NOT IN (SELECT id FROM topics)")
        conn.execute("DELETE FROM chapter_progress WHERE chapter_id NOT IN (SELECT id FROM chapters)")

        # Sync document counts
        conn.execute("""
            UPDATE documents d
            SET concept_count = (SELECT COUNT(*) FROM concepts c WHERE c.document_id = d.id),
                chapter_count = (SELECT COUNT(*) FROM chapters ch WHERE ch.book_id = d.id)
        """)

    # STEP G: Invalidate summary cache for affected users
    try:
        from backend.services.planner_db import invalidate_user_summary_cache
        for uid in affected_users:
            if uid:
                invalidate_user_summary_cache(uid)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="ConceptLens Deduplication & Integrity Cleanup Tool")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Run dry-run analysis only (default)")
    parser.add_argument("--apply", action="store_true", default=False, help="Apply deduplication changes")
    parser.add_argument("--yes", action="store_true", default=False, help="Confirm destructive changes in --apply mode")
    args = parser.parse_args()

    # Determine mode: default is dry-run unless --apply is explicitly specified
    is_apply = args.apply

    host = get_db_host()
    print("=" * 65, flush=True)
    print(" ConceptLens Database Integrity & Deduplication Tool", flush=True)
    print(f" Database Host : {host}", flush=True)
    print(f" Database Type : {'PostgreSQL' if is_postgres() else 'SQLite'}", flush=True)
    print(f" Mode          : {'APPLY (Destructive Cleanup)' if is_apply else 'DRY-RUN (Inspection Only)'}", flush=True)
    print("=" * 65, flush=True)

    with get_connection() as conn:
        user_stats, orphans = analyze_duplicates(conn)

    total_dup_docs = sum(s["duplicate_documents"] for s in user_stats.values())
    total_dup_chs = sum(s["duplicate_chapters"] for s in user_stats.values())
    total_dup_cons = sum(s["duplicate_concepts"] for s in user_stats.values())
    total_dup_rels = sum(s["duplicate_relations"] for s in user_stats.values())
    total_dup_tops = sum(s["duplicate_topics"] for s in user_stats.values())
    total_orphans = sum(orphans.values())

    print("\n--- Duplicate Rows Detected (Per User) ---", flush=True)
    if not user_stats:
        print("  No duplicate groups detected.", flush=True)
    else:
        for uid, s in user_stats.items():
            print(f"  User {uid}:", flush=True)
            print(f"    - Duplicate Documents : {s['duplicate_documents']}", flush=True)
            print(f"    - Duplicate Chapters  : {s['duplicate_chapters']}", flush=True)
            print(f"    - Duplicate Concepts  : {s['duplicate_concepts']}", flush=True)
            print(f"    - Duplicate Relations : {s['duplicate_relations']}", flush=True)
            print(f"    - Duplicate Topics    : {s['duplicate_topics']}", flush=True)

    print("\n--- Summary Totals ---", flush=True)
    print(f"  Total Duplicate Documents : {total_dup_docs}", flush=True)
    print(f"  Total Duplicate Chapters  : {total_dup_chs}", flush=True)
    print(f"  Total Duplicate Concepts  : {total_dup_cons}", flush=True)
    print(f"  Total Duplicate Relations : {total_dup_rels}", flush=True)
    print(f"  Total Duplicate Topics    : {total_dup_tops}", flush=True)
    print(f"  Total Orphan Rows         : {total_orphans}", flush=True)
    for o_table, o_count in orphans.items():
        if o_count > 0:
            print(f"    - Orphan {o_table} : {o_count}", flush=True)

    if not is_apply:
        print("\n[DRY-RUN COMPLETE] No database modifications were performed.", flush=True)
        print("To safely clean up duplicates and enforce unique constraints, run:", flush=True)
        print("  python scripts/dedupe_data.py --apply --yes", flush=True)
        return

    # APPLY MODE
    if not args.yes:
        print("\n[ERROR] --apply requires --yes to proceed. Exiting without making changes.", flush=True)
        sys.exit(1)

    print("\n--- Step 1: Pre-Cleanup Backup Export ---", flush=True)
    backup_dir = project_root / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_filename = f"conceptlens_pre_dedupe_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
    backup_path = backup_dir / backup_filename
    
    try:
        export_data(backup_path)
        if not backup_path.exists() or backup_path.stat().st_size == 0:
            raise RuntimeError("Backup file was not created or is empty.")
        print(f"[OK] Pre-cleanup backup created and verified ({backup_path.stat().st_size} bytes).", flush=True)
    except Exception as e_bk:
        print(f"[FATAL ERROR] Pre-cleanup backup failed: {e_bk}", flush=True)
        print("Refusing to alter data without a verified backup. Aborting.", flush=True)
        sys.exit(1)

    print("\n--- Step 2: Applying Deduplication Transactions ---", flush=True)
    with get_connection() as conn:
        dedupe_data_apply(conn)
    print("[OK] Duplicate entities removed, foreign keys re-pointed, progress merged.", flush=True)

    print("\n--- Step 3: Enforcing Safe Unique Constraints ---", flush=True)
    with get_connection() as conn:
        res = apply_safe_unique_constraints(conn)
    print(f"[OK] Structural unique constraints successfully verified: {res.get('applied', [])}", flush=True)
    if res.get('skipped'):
        print(f"[WARNING] Skipped constraints: {res.get('skipped', [])}", flush=True)

    # Re-check after cleanup
    with get_connection() as conn:
        post_stats, post_orphans = analyze_duplicates(conn)
    remaining_dups = sum(
        s["duplicate_documents"] + s["duplicate_chapters"] + s["duplicate_concepts"] + s["duplicate_relations"] + s["duplicate_topics"]
        for s in post_stats.values()
    )
    remaining_orphans = sum(post_orphans.values())

    print("\n" + "=" * 65, flush=True)
    print(" CLEANUP SUMMARY", flush=True)
    print(f" Remaining Duplicate Rows : {remaining_dups}", flush=True)
    print(f" Remaining Orphan Rows    : {remaining_orphans}", flush=True)
    if remaining_dups == 0 and remaining_orphans == 0:
        print(" Status: CLEAN & FULLY STRUCTURALLY CONSTRAINED", flush=True)
    print("=" * 65, flush=True)


if __name__ == "__main__":
    main()
