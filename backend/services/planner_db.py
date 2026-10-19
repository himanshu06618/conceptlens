import os
import json
import uuid
import logging
from datetime import datetime, timezone, date
try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None
from typing import Optional, List, Dict, Any, Tuple, Set
from pathlib import Path

logger = logging.getLogger("conceptlens.planner.db")

try:
    from backend.database import get_connection, is_postgres
except ImportError:
    from database import get_connection, is_postgres

try:
    from backend.services.plan_engine import build_route, remaining_hours, calculate_plan_status
except ImportError:
    from services.plan_engine import build_route, remaining_hours, calculate_plan_status

def calc_default_est_hours(concept_count: int, difficulty: int = 1) -> float:
    """
    est_hours default = concept_count x minutes per concept (easy 4, medium 6, hard 9) / 60.
    Minimum 0.5 hours.
    """
    minutes_map = {0: 4, 1: 6, 2: 9}
    minutes = minutes_map.get(difficulty, 6)
    if concept_count <= 0:
        return 1.0
    raw = (concept_count * minutes) / 60.0
    return max(0.5, round(raw, 1))

def derive_chapter_difficulty(concept_count: int, avg_importance: float = 2.0, prereq_links_count: int = 0) -> int:
    """
    Derives chapter difficulty (0=Easy, 1=Medium, 2=Hard) from:
    - concept_count (normalized against baseline 15)
    - avg_importance (scale 1-3 or 1-5, normalized against baseline 2.5)
    - prereq_links_count (normalized against baseline 8)
    """
    if concept_count <= 0:
        return 0
    c_weight = (concept_count / 15.0) * 0.4
    i_weight = (avg_importance / 2.5) * 0.35
    p_weight = (prereq_links_count / 8.0) * 0.25
    score = c_weight + i_weight + p_weight

    if score < 0.85:
        return 0  # Easy
    elif score > 1.35:
        return 2  # Hard
    return 1  # Medium

def init_planner_db() -> None:
    """Initializes Study Planner tables and applies safe schema migrations."""
    conn = get_connection()
    try:
        with conn:
            if is_postgres():
                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS subject_id TEXT;")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS subjects (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        code TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON subjects(user_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS chapters (
                        id TEXT PRIMARY KEY,
                        book_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        concept_count INTEGER NOT NULL DEFAULT 0,
                        difficulty INTEGER NOT NULL DEFAULT 1 CHECK (difficulty IN (0, 1, 2)),
                        est_hours REAL NOT NULL DEFAULT 1.0,
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS topics (
                        id SERIAL PRIMARY KEY,
                        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        name TEXT NOT NULL,
                        cluster_id TEXT DEFAULT NULL,
                        cluster_name TEXT DEFAULT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_topics_chapter_id ON topics(chapter_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS topic_relations (
                        id SERIAL PRIMARY KEY,
                        from_topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                        to_topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                        type TEXT NOT NULL CHECK(type IN ('prerequisite', 'related')),
                        CHECK (from_topic_id != to_topic_id),
                        UNIQUE (from_topic_id, to_topic_id, type)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_topic_relations_from ON topic_relations(from_topic_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_topic_relations_to ON topic_relations(to_topic_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS chapter_progress (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                        status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0, 1, 2)),
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, chapter_id)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_chapter_progress_user ON chapter_progress(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_chapter_progress_user_chapter ON chapter_progress(user_id, chapter_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_chapter_progress_chapter ON chapter_progress(chapter_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS study_plans (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                        scope_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
                        days INTEGER NOT NULL CHECK(days IN (7, 15, 30)),
                        order_mode TEXT NOT NULL CHECK(order_mode IN ('syllabus', 'easy', 'hard')),
                        start_date TEXT NOT NULL,
                        route_json TEXT NOT NULL,
                        done_days TEXT NOT NULL DEFAULT '[]',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_study_plans_user ON study_plans(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_study_plans_subject ON study_plans(subject_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS reminders (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        time TEXT NOT NULL,
                        weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
                        label TEXT NOT NULL DEFAULT 'Study Session',
                        enabled INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);")
            else:
                # 1. Migrate users table to include role if missing
                cursor = conn.execute("PRAGMA table_info(users);")
                user_cols = {row["name"] for row in cursor.fetchall()}
                if "role" not in user_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student';")

                # 2. Migrate documents table to include subject_id if missing
                cursor = conn.execute("PRAGMA table_info(documents);")
                doc_cols = {row["name"] for row in cursor.fetchall()}
                if "subject_id" not in doc_cols:
                    conn.execute("ALTER TABLE documents ADD COLUMN subject_id TEXT;")

                # 3. Create subjects table
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS subjects (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        code TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_subjects_user_id ON subjects(user_id);

                    CREATE TABLE IF NOT EXISTS chapters (
                        id TEXT PRIMARY KEY,
                        book_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        concept_count INTEGER NOT NULL DEFAULT 0,
                        difficulty INTEGER NOT NULL DEFAULT 1,
                        est_hours REAL NOT NULL DEFAULT 1.0,
                        created_at TEXT NOT NULL,
                        CHECK (difficulty IN (0, 1, 2))
                    );
                    CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);

                    CREATE TABLE IF NOT EXISTS topics (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                        order_index INTEGER NOT NULL DEFAULT 0,
                        name TEXT NOT NULL,
                        cluster_id TEXT DEFAULT NULL,
                        cluster_name TEXT DEFAULT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_topics_chapter_id ON topics(chapter_id);

                    CREATE TABLE IF NOT EXISTS topic_relations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        from_topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                        to_topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
                        type TEXT NOT NULL CHECK(type IN ('prerequisite', 'related')),
                        CHECK (from_topic_id != to_topic_id),
                        UNIQUE (from_topic_id, to_topic_id, type)
                    );
                    CREATE INDEX IF NOT EXISTS idx_topic_relations_from ON topic_relations(from_topic_id);
                    CREATE INDEX IF NOT EXISTS idx_topic_relations_to ON topic_relations(to_topic_id);

                    CREATE TABLE IF NOT EXISTS chapter_progress (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                        status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0, 1, 2)),
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, chapter_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_chapter_progress_user ON chapter_progress(user_id);
                    CREATE INDEX IF NOT EXISTS idx_chapter_progress_user_chapter ON chapter_progress(user_id, chapter_id);
                    CREATE INDEX IF NOT EXISTS idx_chapter_progress_chapter ON chapter_progress(chapter_id);

                    CREATE TABLE IF NOT EXISTS study_plans (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                        scope_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
                        days INTEGER NOT NULL CHECK(days IN (7, 15, 30)),
                        order_mode TEXT NOT NULL CHECK(order_mode IN ('syllabus', 'easy', 'hard')),
                        start_date TEXT NOT NULL,
                        route_json TEXT NOT NULL,
                        done_days TEXT NOT NULL DEFAULT '[]',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_study_plans_user ON study_plans(user_id);
                    CREATE INDEX IF NOT EXISTS idx_study_plans_subject ON study_plans(subject_id);

                    CREATE TABLE IF NOT EXISTS reminders (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        time TEXT NOT NULL,
                        weekdays TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
                        label TEXT NOT NULL DEFAULT 'Study Session',
                        enabled INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
                """)
    finally:
        conn.close()

def link_document_to_curriculum(doc_id: str, user_id: str) -> bool:
    """
    Links an extracted document to the user's Core Curriculum and persists its
    chapters, topics, relations, and progress rows idempotently.
    Safe to run multiple times without duplicate chapters, topics, or counts.
    Outputs Task 10 log line: counts only (doc id, chapters, concepts).
    """
    if not doc_id or not user_id:
        return False

    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            # 1. Fetch document and verify / assign user ownership
            doc_row = conn.execute(
                "SELECT id, user_id, subject_id, filename, created_at FROM documents WHERE id = ?",
                (doc_id,)
            ).fetchone()
            if not doc_row:
                return False

            doc = dict(doc_row)
            if doc.get("user_id") != user_id:
                if not doc.get("user_id"):
                    conn.execute("UPDATE documents SET user_id = ? WHERE id = ?", (user_id, doc_id))
                    doc["user_id"] = user_id
                else:
                    return False

            # Verify that the user exists in users table (subjects has FK constraint on users.id)
            user_exists = conn.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
            if not user_exists:
                return False

            # 2. Ensure default "Core Curriculum" subject exists for this user
            sub_row = conn.execute(
                "SELECT id FROM subjects WHERE user_id = ? ORDER BY (CASE WHEN name = 'Core Curriculum' THEN 0 ELSE 1 END), created_at ASC LIMIT 1",
                (user_id,)
            ).fetchone()
            if sub_row:
                subject_id = sub_row["id"]
            else:
                subject_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO subjects (id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)",
                    (subject_id, user_id, "Core Curriculum", "CC-101", now_iso)
                )

            # Link document to subject
            if doc.get("subject_id") != subject_id:
                conn.execute("UPDATE documents SET subject_id = ? WHERE id = ?", (subject_id, doc_id))

            # 3. Check existing chapters for this document
            # 3. Check existing chapters for this document (1 file = 1 chapter)
            existing_chs = conn.execute(
                "SELECT id, name, order_index FROM chapters WHERE book_id = ? ORDER BY order_index ASC, created_at ASC",
                (doc_id,)
            ).fetchall()
            existing_ch_cnt = len(existing_chs)

            concept_cnt = conn.execute(
                "SELECT COUNT(*) as cnt FROM concepts WHERE document_id = ?",
                (doc_id,)
            ).fetchone()["cnt"]

            if existing_ch_cnt > 1:
                # 1 File = 1 Chapter: consolidate multiple legacy chapters into 1 single primary chapter
                primary_ch_id = existing_chs[0]["id"]
                ch_name = Path(doc["filename"]).stem.replace("_", " ").title()
                extra_ch_ids = [ch["id"] for ch in existing_chs[1:]]
                for ech_id in extra_ch_ids:
                    conn.execute("UPDATE topics SET chapter_id = ? WHERE chapter_id = ?", (primary_ch_id, ech_id))
                    conn.execute("DELETE FROM chapter_progress WHERE chapter_id = ?", (ech_id,))
                    conn.execute("DELETE FROM chapters WHERE id = ?", (ech_id,))
                conn.execute(
                    "UPDATE chapters SET name = ?, concept_count = ? WHERE id = ?",
                    (ch_name, concept_cnt, primary_ch_id)
                )
                conn.execute(
                    "UPDATE documents SET chapter_count = 1, concept_count = ? WHERE id = ?",
                    (concept_cnt, doc_id)
                )
                conn.execute(
                    """
                    INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                    VALUES (?, ?, 0, ?)
                    ON CONFLICT (user_id, chapter_id) DO NOTHING
                    """,
                    (user_id, primary_ch_id, now_iso)
                )
                logger.info(f"[CurriculumLink] doc_id={doc_id} consolidated_to_chapters=1 concepts={concept_cnt}")
                print(f"[CurriculumLink] doc_id={doc_id} consolidated_to_chapters=1 concepts={concept_cnt}")
                return True

            if existing_ch_cnt == 1:
                # Ensure chapter_progress records exist for this chapter
                ch_id = existing_chs[0]["id"]
                conn.execute(
                    """
                    INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                    VALUES (?, ?, 0, ?)
                    ON CONFLICT (user_id, chapter_id) DO NOTHING
                    """,
                    (user_id, ch_id, now_iso)
                )
                conn.execute(
                    "UPDATE documents SET chapter_count = 1, concept_count = ? WHERE id = ?",
                    (concept_cnt, doc_id)
                )
                logger.info(f"[CurriculumLink] doc_id={doc_id} chapters=1 concepts={concept_cnt}")
                print(f"[CurriculumLink] doc_id={doc_id} chapters=1 concepts={concept_cnt}")
                return True

            if concept_cnt == 0:
                logger.info(f"[CurriculumLink] doc_id={doc_id} chapters=0 concepts=0 (no concepts)")
                print(f"[CurriculumLink] doc_id={doc_id} chapters=0 concepts=0 (no concepts)")
                return False

            # 4. Synthesize 1 chapter for the document (1 File = 1 Chapter)
            ch_name = Path(doc["filename"]).stem.replace("_", " ").title() or "Chapter 1: Foundations"
            concept_name_to_topic_id = {}
            created_chapters_count = 1

            # Count total prerequisite relations for document
            total_prereqs = conn.execute(
                """
                SELECT COUNT(*) as cnt FROM relations r
                JOIN concepts c ON r.concept_id = c.id
                WHERE c.document_id = ? AND r.relation_type = 'prerequisite'
                """,
                (doc_id,)
            ).fetchone()["cnt"]

            # Document order index among user's documents
            doc_order_row = conn.execute(
                "SELECT COUNT(*) as cnt FROM documents WHERE user_id = ? AND created_at <= ?",
                (user_id, doc["created_at"] or now_iso)
            ).fetchone()
            order_idx = max(1, doc_order_row["cnt"] if doc_order_row else 1)

            avg_imp_row = conn.execute(
                "SELECT AVG(importance) as avg_imp FROM concepts WHERE document_id = ?",
                (doc_id,)
            ).fetchone()
            avg_imp = float(avg_imp_row["avg_imp"] or 2.0) if avg_imp_row else 2.0
            difficulty = derive_chapter_difficulty(concept_cnt, avg_imp, total_prereqs)
            est_hours = calc_default_est_hours(concept_cnt, difficulty)

            ch_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO chapters (id, book_id, name, order_index, concept_count, difficulty, est_hours, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (ch_id, doc_id, ch_name, order_idx, concept_cnt, difficulty, est_hours, doc["created_at"] or now_iso)
            )

            # Map all concepts into topics under this 1 chapter
            concepts = conn.execute(
                "SELECT id, name FROM concepts WHERE document_id = ? ORDER BY page ASC, flow_order ASC, id ASC",
                (doc_id,)
            ).fetchall()
            for t_idx, c in enumerate(concepts):
                cluster_idx = (t_idx // 4) + 1
                c_cursor = conn.execute(
                    """
                    INSERT INTO topics (chapter_id, order_index, name, cluster_id, cluster_name)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (ch_id, t_idx + 1, c["name"], f"c{cluster_idx}", f"Cluster {cluster_idx}")
                )
                tid = getattr(c_cursor, "lastrowid", None)
                if tid:
                    concept_name_to_topic_id[c["name"].strip().lower()] = tid

            conn.execute(
                """
                INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                VALUES (?, ?, 0, ?)
                ON CONFLICT (user_id, chapter_id) DO NOTHING
                """,
                (user_id, ch_id, now_iso)
            )

            # 5. Populate topic_relations from relations table
            rel_rows = conn.execute(
                """
                SELECT c.name as from_name, r.related_name as to_name, r.relation_type
                FROM relations r
                JOIN concepts c ON r.concept_id = c.id
                WHERE r.document_id = ?
                """,
                (doc_id,)
            ).fetchall()

            for r in rel_rows:
                from_key = (r["from_name"] or "").strip().lower()
                to_key = (r["to_name"] or "").strip().lower()
                r_type = r["relation_type"] if r["relation_type"] in ("prerequisite", "related") else "related"
                f_id = concept_name_to_topic_id.get(from_key)
                t_id = concept_name_to_topic_id.get(to_key)
                if f_id and t_id and f_id != t_id:
                    if r_type == "related" and f_id > t_id:
                        f_id, t_id = t_id, f_id
                    conn.execute(
                        """
                        INSERT INTO topic_relations (from_topic_id, to_topic_id, type)
                        VALUES (?, ?, ?)
                        ON CONFLICT (from_topic_id, to_topic_id, type) DO NOTHING
                        """,
                        (f_id, t_id, r_type)
                    )

            # Update document concept_count and chapter_count
            conn.execute(
                "UPDATE documents SET concept_count = ?, chapter_count = ? WHERE id = ?",
                (concept_cnt, created_chapters_count, doc_id)
            )

            # Task 10 log line: counts only (doc id, chapters, concepts)
            logger.info(f"[CurriculumLink] doc_id={doc_id} chapters={created_chapters_count} concepts={concept_cnt}")
            print(f"[CurriculumLink] doc_id={doc_id} chapters={created_chapters_count} concepts={concept_cnt}")
            return True
    finally:
        conn.close()

def backfill_unlinked_documents() -> int:
    """
    Idempotent routine linking documents extracted before this fix (e.g. Lecture_3_Sorting.pdf)
    to each owner's Core Curriculum and creating missing chapter, topic, and progress rows.
    Safe to run twice and never touches other users' data.
    """
    conn = get_connection()
    linked_count = 0
    try:
        docs = conn.execute(
            """
            SELECT d.id, d.user_id, d.filename, d.subject_id, d.status
            FROM documents d
            JOIN users u ON d.user_id = u.id
            WHERE d.status = 'completed' AND d.user_id IS NOT NULL AND d.user_id != ''
            """
        ).fetchall()
        for doc in docs:
            doc_id = doc["id"]
            user_id = doc["user_id"]
            ch_count = conn.execute("SELECT COUNT(*) as cnt FROM chapters WHERE book_id = ?", (doc_id,)).fetchone()["cnt"]
            if not doc["subject_id"] or ch_count != 1:
                success = link_document_to_curriculum(doc_id, user_id)
                if success:
                    linked_count += 1
        return linked_count
    finally:
        conn.close()

def ensure_default_subject_and_chapters_for_user(user_id: str) -> str:
    """
    Ensures the user has at least one subject (Core Curriculum) and that all
    documents owned by the user are properly linked to it with chapters and progress.
    Returns the active subject_id.
    """
    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            cursor = conn.execute(
                "SELECT id FROM subjects WHERE user_id = ? ORDER BY (CASE WHEN name = 'Core Curriculum' THEN 0 ELSE 1 END), created_at ASC LIMIT 1",
                (user_id,)
            )
            row = cursor.fetchone()
            if row:
                subject_id = row["id"]
            else:
                subject_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO subjects (id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)",
                    (subject_id, user_id, "Core Curriculum", "CC-101", now_iso)
                )

            # Link any documents owned by user without subject_id
            conn.execute(
                "UPDATE documents SET subject_id = ? WHERE user_id = ? AND (subject_id IS NULL OR subject_id = '')",
                (subject_id, user_id)
            )

            # Link unlinked completed documents owned by user to this subject
            docs = conn.execute(
                """
                SELECT d.id FROM documents d
                WHERE d.user_id = ? AND d.status = 'completed'
                  AND NOT EXISTS (SELECT 1 FROM chapters c WHERE c.book_id = d.id)
                """,
                (user_id,)
            ).fetchall()

        for d in docs:
            link_document_to_curriculum(d["id"], user_id)

        return subject_id
    finally:
        conn.close()

def get_user_subjects(user_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM subjects WHERE user_id = ? ORDER BY created_at ASC",
            (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

def get_subject_overview_data(user_id: str, subject_id: str) -> Dict[str, Any]:
    """
    Returns complete overview data for the study planner:
    - Subject details
    - Books with mastery %
    - Chapters with difficulty, est_hours, concept_count, and progress status
    - Total concepts, chapters done, study time left, mastery %
    """
    conn = get_connection()
    try:
        subject_row = conn.execute(
            "SELECT * FROM subjects WHERE id = ? AND user_id = ?",
            (subject_id, user_id)
        ).fetchone()
        if not subject_row:
            return {}

        subject = dict(subject_row)

        # Books (documents)
        books_rows = conn.execute(
            """
            SELECT d.id, d.filename, d.file_type, d.created_at,
                   COUNT(DISTINCT c.id) as chapter_count
            FROM documents d
            LEFT JOIN chapters c ON c.book_id = d.id
            WHERE d.subject_id = ?
            GROUP BY d.id
            ORDER BY d.created_at DESC
            """,
            (subject_id,)
        ).fetchall()

        # Performance optimization: Batch fetch all chapters for all books in this subject in 1 single query (eliminating N+1)
        all_ch_rows = conn.execute(
            """
            SELECT c.id, c.book_id, c.name, c.order_index, c.concept_count,
                   c.difficulty, c.est_hours,
                   COALESCE(cp.status, 0) as status
            FROM chapters c
            JOIN documents d ON c.book_id = d.id
            LEFT JOIN chapter_progress cp ON cp.chapter_id = c.id AND cp.user_id = ?
            WHERE d.subject_id = ?
            ORDER BY c.book_id, c.order_index ASC
            """,
            (user_id, subject_id)
        ).fetchall()

        book_chapters_map: Dict[str, List[Dict[str, Any]]] = {}
        seen_ch_keys: Set[tuple] = set()
        for ch in all_ch_rows:
            ch_key = (ch["book_id"], (ch["name"] or "").strip().lower())
            if ch_key in seen_ch_keys:
                continue
            seen_ch_keys.add(ch_key)
            book_chapters_map.setdefault(ch["book_id"], []).append(dict(ch))

        # Check concepts progress for each document
        doc_concepts_prog = conn.execute(
            """
            SELECT c.document_id, c.id, cp.status
            FROM concepts c
            JOIN documents d ON c.document_id = d.id
            LEFT JOIN concept_progress cp ON cp.concept_id = CAST(c.id AS TEXT) AND cp.user_id = ?
            WHERE d.subject_id = ?
            """,
            (user_id, subject_id)
        ).fetchall()
        doc_concepts_map: Dict[str, List[str]] = {}
        for row in doc_concepts_prog:
            doc_concepts_map.setdefault(row["document_id"], []).append(row["status"] or "not_started")

        books = []
        all_chapters = []
        total_concepts = 0
        total_est_hours = 0.0
        remaining_hours = 0.0
        done_chapters_count = 0
        total_chapters_count = 0

        for b in books_rows:
            b_id = b["id"]
            ch_rows = book_chapters_map.get(b_id, [])

            ch_list = []
            book_done = 0
            for ch_dict in ch_rows:
                st = ch_dict["status"]

                doc_prog_list = doc_concepts_map.get(b_id, [])
                if doc_prog_list and all(s == "studied" for s in doc_prog_list):
                    st = 2
                    ch_dict["status"] = 2
                elif doc_prog_list and any(s == "studied" for s in doc_prog_list) and st == 0:
                    st = 1
                    ch_dict["status"] = 1

                total_concepts += ch_dict["concept_count"]
                total_chapters_count += 1
                total_est_hours += ch_dict["est_hours"]

                if st == 2:
                    done_chapters_count += 1
                    book_done += 1
                    rem = 0.0
                elif st == 1:
                    rem = round(ch_dict["est_hours"] * 0.5, 2)
                else:
                    rem = ch_dict["est_hours"]
                remaining_hours += rem
                ch_dict["remaining_hours"] = rem
                ch_dict["difficulty_label"] = {0: "Easy", 1: "Medium", 2: "Hard"}.get(ch_dict.get("difficulty", 1), "Medium")
                ch_dict["completed"] = (st == 2)

                ch_list.append(ch_dict)
                all_chapters.append(ch_dict)

            book_mastery = round((book_done / len(ch_list) * 100)) if ch_list else 0
            b_dict = dict(b)
            b_dict["name"] = b_dict.get("filename", "")
            b_dict["chapters"] = ch_list
            b_dict["mastery_pct"] = book_mastery
            books.append(b_dict)

        mastery_pct = round((done_chapters_count / max(1, total_chapters_count)) * 100) if total_chapters_count else 0

        stats = {
            "total_concepts": total_concepts,
            "chapters_done": done_chapters_count,
            "total_chapters": total_chapters_count,
            "study_time_left_hours": round(remaining_hours, 1),
            "total_study_time_hours": round(total_est_hours, 1),
            "mastery_pct": mastery_pct
        }

        return {
            "subject": subject,
            "stats": stats,
            "books": books,
            "chapters": all_chapters
        }
    finally:
        conn.close()

def get_subject_books_with_chapters(subject_id: str, user_id: str) -> List[Dict[str, Any]]:
    """
    Returns books with their chapters and user progress.
    """
    overview = get_subject_overview_data(user_id, subject_id)
    return overview.get("books", [])

def update_chapter_progress_status(user_id: str, chapter_id: str, status: int) -> Dict[str, Any]:
    if status not in (0, 1, 2):
        raise ValueError("Status must be 0, 1, or 2.")
    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, chapter_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (user_id, chapter_id, status, now_iso)
            )

            # TASK 2: Marking a chapter complete (status=2) marks all its concepts studied; unmarking reverses it (status=0 or 1).
            ch_row = conn.execute("SELECT book_id, name FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
            if ch_row:
                doc_id = ch_row["book_id"]
                ch_name = (ch_row["name"] or "").strip()
                ch_cnt = conn.execute("SELECT COUNT(*) as cnt FROM chapters WHERE book_id = ?", (doc_id,)).fetchone()["cnt"]

                if ch_cnt <= 1:
                    concept_rows = conn.execute("SELECT id FROM concepts WHERE document_id = ?", (doc_id,)).fetchall()
                else:
                    concept_rows = conn.execute(
                        "SELECT id FROM concepts WHERE document_id = ? AND (LOWER(topic) = LOWER(?) OR LOWER(flow_group) = LOWER(?))",
                        (doc_id, ch_name, ch_name)
                    ).fetchall()
                    if not concept_rows:
                        concept_rows = conn.execute("SELECT id FROM concepts WHERE document_id = ?", (doc_id,)).fetchall()

                target_concept_status = "studied" if status == 2 else "not_started"
                for cr in concept_rows:
                    conn.execute(
                        """
                        INSERT INTO concept_progress (user_id, concept_id, status, updated_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(user_id, concept_id) DO UPDATE SET
                            status = excluded.status,
                            updated_at = excluded.updated_at
                        """,
                        (user_id, str(cr["id"]), target_concept_status, now_iso)
                    )

        invalidate_user_summary_cache(user_id)
        return {"chapter_id": chapter_id, "status": status, "updated_at": now_iso}
    finally:
        conn.close()

def update_chapter_meta(chapter_id: str, difficulty: Optional[int] = None, est_hours: Optional[float] = None) -> Dict[str, Any]:
    conn = get_connection()
    try:
        with conn:
            updates = []
            params = []
            if difficulty is not None:
                if difficulty not in (0, 1, 2):
                    raise ValueError("Difficulty must be 0 (easy), 1 (medium), or 2 (hard).")
                updates.append("difficulty = ?")
                params.append(difficulty)
            if est_hours is not None:
                updates.append("est_hours = ?")
                params.append(max(0.2, float(est_hours)))
            if updates:
                params.append(chapter_id)
                conn.execute(f"UPDATE chapters SET {', '.join(updates)} WHERE id = ?", params)
            row = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
            return dict(row) if row else {}
    finally:
        conn.close()

def save_topic_relations(chapter_id: str, clusters_data: List[Dict[str, Any]], edges_data: List[Dict[str, Any]]) -> None:
    """
    Saves clusters (updating topics) and edges (in topic_relations table) for a chapter.
    """
    conn = get_connection()
    try:
        with conn:
            topic_rows = conn.execute("SELECT id FROM topics WHERE chapter_id = ?", (chapter_id,)).fetchall()
            valid_tids = {r["id"] for r in topic_rows}
            if not valid_tids:
                return

            # Update clusters in topics
            for idx, cl in enumerate(clusters_data):
                c_id = f"c{idx + 1}"
                c_name = cl.get("name", f"Cluster {idx + 1}")
                for tid in cl.get("topic_ids", []):
                    if tid in valid_tids:
                        conn.execute(
                            "UPDATE topics SET cluster_id = ?, cluster_name = ? WHERE id = ? AND chapter_id = ?",
                            (c_id, c_name, tid, chapter_id)
                        )

            # Delete old relations for these topics
            tids_list = list(valid_tids)
            conn.execute(
                """
                DELETE FROM topic_relations
                WHERE from_topic_id IN ({seq}) OR to_topic_id IN ({seq})
                """.format(seq=",".join("?" * len(tids_list))),
                tids_list + tids_list
            )

            # Insert edges
            for edge in edges_data:
                f_id = edge.get("from")
                t_id = edge.get("to")
                edge_type = edge.get("type")
                if f_id in valid_tids and t_id in valid_tids and f_id != t_id and edge_type in ("prerequisite", "related"):
                    if edge_type == "related" and f_id > t_id:
                        f_id, t_id = t_id, f_id
                    conn.execute(
                        """
                        INSERT INTO topic_relations (from_topic_id, to_topic_id, type)
                        VALUES (?, ?, ?)
                        ON CONFLICT (from_topic_id, to_topic_id, type) DO NOTHING
                        """,
                        (f_id, t_id, edge_type)
                    )
    finally:
        conn.close()

def get_chapter_relations_data(chapter_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Returns clusters with topics; per topic: prerequisites[], related[], leads_to[]
    and each cluster's 'runs until' topic and next topic.
    Includes cross-document connections for the same user.
    """
    conn = get_connection()
    try:
        chapter_row = conn.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,)).fetchone()
        if not chapter_row:
            return {}

        topics_rows = conn.execute(
            "SELECT * FROM topics WHERE chapter_id = ? ORDER BY order_index ASC",
            (chapter_id,)
        ).fetchall()

        topics = [dict(t) for t in topics_rows]
        topic_ids = [t["id"] for t in topics]
        topic_map = {t["id"]: t for t in topics}

        if not topic_ids:
            return {
                "chapter": dict(chapter_row),
                "clusters": [],
                "topics": []
            }

        # Fetch internal relations
        rel_rows = conn.execute(
            """
            SELECT * FROM topic_relations
            WHERE from_topic_id IN ({seq}) OR to_topic_id IN ({seq})
            """.format(seq=",".join("?" * len(topic_ids))),
            topic_ids + topic_ids
        ).fetchall()

        prereqs_map = {tid: [] for tid in topic_ids}
        leads_to_map = {tid: [] for tid in topic_ids}
        related_map = {tid: [] for tid in topic_ids}

        for r in rel_rows:
            f_id = r["from_topic_id"]
            t_id = r["to_topic_id"]
            r_type = r["type"]

            if r_type == "prerequisite":
                if t_id in prereqs_map and f_id in topic_map:
                    prereqs_map[t_id].append(topic_map[f_id]["name"])
                if f_id in leads_to_map and t_id in topic_map:
                    leads_to_map[f_id].append(topic_map[t_id]["name"])
            elif r_type == "related":
                if f_id in related_map and t_id in topic_map:
                    related_map[f_id].append(topic_map[t_id]["name"])
                if t_id in related_map and f_id in topic_map:
                    related_map[t_id].append(topic_map[f_id]["name"])

        # Fetch cross-document relations for the same user if available
        if not user_id:
            u_row = conn.execute(
                "SELECT d.user_id FROM chapters c JOIN documents d ON c.book_id = d.id WHERE c.id = ?",
                (chapter_id,)
            ).fetchone()
            if u_row:
                user_id = u_row["user_id"]

        if user_id:
            other_topics = conn.execute(
                """
                SELECT t.id, t.name, ch.name as chapter_name
                FROM topics t
                JOIN chapters ch ON t.chapter_id = ch.id
                JOIN documents d ON ch.book_id = d.id
                WHERE d.user_id = ? AND t.chapter_id != ?
                """,
                (user_id, chapter_id)
            ).fetchall()
            other_map = {ot["id"]: ot for ot in other_topics}
            other_ids = list(other_map.keys())

            if other_ids:
                cross_rels = conn.execute(
                    """
                    SELECT tr.* FROM topic_relations tr
                    WHERE (tr.from_topic_id IN ({s_this}) AND tr.to_topic_id IN ({s_other}))
                       OR (tr.from_topic_id IN ({s_other}) AND tr.to_topic_id IN ({s_this}))
                    """.format(
                        s_this=",".join("?" * len(topic_ids)),
                        s_other=",".join("?" * len(other_ids))
                    ),
                    topic_ids + other_ids + other_ids + topic_ids
                ).fetchall()

                for cr in cross_rels:
                    f_id = cr["from_topic_id"]
                    t_id = cr["to_topic_id"]
                    r_type = cr["type"]
                    if f_id in topic_map and t_id in other_map:
                        ot = other_map[t_id]
                        label = f"{ot['name']} ({ot['chapter_name']})"
                        if r_type == "prerequisite":
                            leads_to_map[f_id].append(label)
                        else:
                            related_map[f_id].append(label)
                    elif t_id in topic_map and f_id in other_map:
                        ot = other_map[f_id]
                        label = f"{ot['name']} ({ot['chapter_name']})"
                        if r_type == "prerequisite":
                            prereqs_map[t_id].append(label)
                        else:
                            related_map[t_id].append(label)

        # Group into clusters
        cluster_dict = {}
        for t in topics:
            c_id = t.get("cluster_id") or "c1"
            c_name = t.get("cluster_name") or "Core Knowledge"
            if c_id not in cluster_dict:
                cluster_dict[c_id] = {
                    "id": c_id,
                    "name": c_name,
                    "topics": []
                }
            topic_enhanced = {
                "id": t["id"],
                "name": t["name"],
                "order_index": t["order_index"],
                "prerequisites": sorted(list(set(prereqs_map.get(t["id"], [])))),
                "related": sorted(list(set(related_map.get(t["id"], [])))),
                "leads_to": sorted(list(set(leads_to_map.get(t["id"], []))))
            }
            cluster_dict[c_id]["topics"].append(topic_enhanced)

        clusters_list = list(cluster_dict.values())
        # Annotate each cluster with 'runs_until_topic' and 'next_topic'
        for i, cl in enumerate(clusters_list):
            if cl["topics"]:
                cl["runs_until_topic"] = cl["topics"][-1]["name"]
            else:
                cl["runs_until_topic"] = ""

            if i + 1 < len(clusters_list) and clusters_list[i + 1]["topics"]:
                cl["next_topic"] = clusters_list[i + 1]["topics"][0]["name"]
            else:
                cl["next_topic"] = None

        return {
            "chapter": dict(chapter_row),
            "clusters": clusters_list,
            "topics": [
                {
                    "id": t["id"],
                    "name": t["name"],
                    "order_index": t["order_index"],
                    "cluster_id": t.get("cluster_id"),
                    "cluster_name": t.get("cluster_name"),
                    "prerequisites": sorted(list(set(prereqs_map.get(t["id"], [])))),
                    "related": sorted(list(set(related_map.get(t["id"], [])))),
                    "leads_to": sorted(list(set(leads_to_map.get(t["id"], []))))
                }
                for t in topics
            ]
        }
    finally:
        conn.close()

# ==================== Plan Operations ====================

def save_study_plan_record(
    user_id: str,
    subject_id: str,
    days: int,
    order_mode: str,
    start_date: str,
    route_json: str,
    scope_chapter_id: Optional[str] = None
) -> Dict[str, Any]:
    plan_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            # Delete any previous plan for this subject & user to keep one active plan
            conn.execute(
                "DELETE FROM study_plans WHERE user_id = ? AND subject_id = ?",
                (user_id, subject_id)
            )
            conn.execute(
                """
                INSERT INTO study_plans (id, user_id, subject_id, scope_chapter_id, days, order_mode, start_date, route_json, done_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)
                """,
                (plan_id, user_id, subject_id, scope_chapter_id, days, order_mode, start_date, route_json, now_iso, now_iso)
            )
        invalidate_user_summary_cache(user_id)
        return {
            "id": plan_id,
            "user_id": user_id,
            "subject_id": subject_id,
            "scope_chapter_id": scope_chapter_id,
            "days": days,
            "order_mode": order_mode,
            "start_date": start_date,
            "route": json.loads(route_json),
            "done_days": [],
            "created_at": now_iso,
            "updated_at": now_iso
        }
    finally:
        conn.close()

def get_active_study_plan(user_id: str, subject_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM study_plans WHERE user_id = ? AND subject_id = ? ORDER BY created_at DESC LIMIT 1",
            (user_id, subject_id)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["route"] = json.loads(d["route_json"]) if d.get("route_json") else []
        d["done_days"] = json.loads(d["done_days"]) if d.get("done_days") else []
        return d
    finally:
        conn.close()

def toggle_plan_day_completion(plan_id: str, user_id: str, day_index: int) -> Dict[str, Any]:
    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            row = conn.execute(
                "SELECT * FROM study_plans WHERE id = ? AND user_id = ?",
                (plan_id, user_id)
            ).fetchone()
            if not row:
                raise ValueError("Plan not found.")

            done = json.loads(row["done_days"]) if row["done_days"] else []
            if day_index in done:
                done.remove(day_index)
            else:
                done.append(day_index)
                done.sort()

            conn.execute(
                "UPDATE study_plans SET done_days = ?, updated_at = ? WHERE id = ?",
                (json.dumps(done), now_iso, plan_id)
            )
            invalidate_user_summary_cache(user_id)
            d = dict(row)
            d["done_days"] = done
            d["route"] = json.loads(d["route_json"]) if d.get("route_json") else []
            return d
    finally:
        conn.close()

def delete_study_plan_record(plan_id: str, user_id: str) -> bool:
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute(
                "DELETE FROM study_plans WHERE id = ? AND user_id = ?",
                (plan_id, user_id)
            )
            invalidate_user_summary_cache(user_id)
            return cursor.rowcount > 0
    finally:
        conn.close()


# ==================== Reminder Operations ====================

def get_user_reminders_list(user_id: str) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM reminders WHERE user_id = ? ORDER BY time ASC",
            (user_id,)
        ).fetchall()
        result = []
        for r in rows:
            rd = dict(r)
            rd["weekdays"] = json.loads(rd["weekdays"]) if rd.get("weekdays") else [0, 1, 2, 3, 4, 5, 6]
            rd["enabled"] = bool(rd["enabled"])
            result.append(rd)
        return result
    finally:
        conn.close()

def create_reminder_record(
    user_id: str,
    time_str: str,
    weekdays: List[int],
    label: str,
    enabled: bool = True
) -> Dict[str, Any]:
    rem_id = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO reminders (id, user_id, time, weekdays, label, enabled, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (rem_id, user_id, time_str, json.dumps(weekdays), label, 1 if enabled else 0, now_iso)
            )
        invalidate_user_summary_cache(user_id)
        return {
            "id": rem_id,
            "user_id": user_id,
            "time": time_str,
            "weekdays": weekdays,
            "label": label,
            "enabled": enabled,
            "created_at": now_iso
        }
    finally:
        conn.close()

def update_reminder_record(
    reminder_id: str,
    user_id: str,
    enabled: Optional[bool] = None,
    time_str: Optional[str] = None,
    weekdays: Optional[List[int]] = None,
    label: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        with conn:
            updates = []
            params = []
            if enabled is not None:
                updates.append("enabled = ?")
                params.append(1 if enabled else 0)
            if time_str is not None:
                updates.append("time = ?")
                params.append(time_str)
            if weekdays is not None:
                updates.append("weekdays = ?")
                params.append(json.dumps(weekdays))
            if label is not None:
                updates.append("label = ?")
                params.append(label)

            if updates:
                params.extend([reminder_id, user_id])
                conn.execute(
                    f"UPDATE reminders SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
                    params
                )

            row = conn.execute(
                "SELECT * FROM reminders WHERE id = ? AND user_id = ?",
                (reminder_id, user_id)
            ).fetchone()
            if not row:
                return None
            rd = dict(row)
            rd["weekdays"] = json.loads(rd["weekdays"]) if rd.get("weekdays") else []
            rd["enabled"] = bool(rd["enabled"])
            invalidate_user_summary_cache(user_id)
            return rd
    finally:
        conn.close()

def delete_reminder_record(reminder_id: str, user_id: str) -> bool:
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute(
                "DELETE FROM reminders WHERE id = ? AND user_id = ?",
                (reminder_id, user_id)
            )
            deleted = cursor.rowcount > 0
            if deleted:
                invalidate_user_summary_cache(user_id)
            return deleted
    finally:
        conn.close()

# Functional aliases
delete_study_plan = delete_study_plan_record
get_user_reminders = get_user_reminders_list
create_reminder = create_reminder_record
update_reminder = update_reminder_record
delete_reminder = delete_reminder_record

def _gather_chapter_topics_and_relations_internal(chapter_ids: List[str]) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, Dict[str, Any]]]:
    """Helper to fetch topic lists and relations mapping for chapters."""
    if not chapter_ids:
        return {}, {}

    conn = get_connection()
    try:
        t_rows = conn.execute(
            """
            SELECT * FROM topics
            WHERE chapter_id IN ({seq})
            ORDER BY order_index ASC
            """.format(seq=",".join("?" * len(chapter_ids))),
            chapter_ids
        ).fetchall()

        topics_map: Dict[str, List[Dict[str, Any]]] = {cid: [] for cid in chapter_ids}
        all_tids = []
        for tr in t_rows:
            d = dict(tr)
            topics_map[d["chapter_id"]].append(d)
            all_tids.append(d["id"])

        relations_map: Dict[str, Dict[str, Any]] = {cid: {"edges": []} for cid in chapter_ids}
        if all_tids:
            rel_rows = conn.execute(
                """
                SELECT tr.*, t1.chapter_id as from_chapter_id, t2.chapter_id as to_chapter_id
                FROM topic_relations tr
                JOIN topics t1 ON tr.from_topic_id = t1.id
                JOIN topics t2 ON tr.to_topic_id = t2.id
                WHERE tr.from_topic_id IN ({seq})
                """.format(seq=",".join("?" * len(all_tids))),
                all_tids
            ).fetchall()

            for rr in rel_rows:
                cid = rr["from_chapter_id"]
                if cid in relations_map:
                    relations_map[cid]["edges"].append({
                        "from": rr["from_topic_id"],
                        "to": rr["to_topic_id"],
                        "from_chapter_id": rr["from_chapter_id"],
                        "to_chapter_id": rr["to_chapter_id"],
                        "type": rr["type"]
                    })

        return topics_map, relations_map
    finally:
        conn.close()

_user_summary_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_user_bootstrap_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}

def invalidate_user_summary_cache(user_id: Optional[str] = None) -> None:
    """Invalidates the short-lived summary and bootstrap cache for a specific user, or all users if user_id is None."""
    if not user_id:
        _user_summary_cache.clear()
        _user_bootstrap_cache.clear()
        return
    prefix = f"{user_id}:"
    for k in list(_user_summary_cache.keys()):
        if k.startswith(prefix):
            _user_summary_cache.pop(k, None)
    for k in list(_user_bootstrap_cache.keys()):
        if k.startswith(prefix):
            _user_bootstrap_cache.pop(k, None)

def get_dashboard_summary_data(
    user_id: str,
    subject_id: Optional[str] = None,
    days: int = 7,
    order_mode: str = "syllabus",
    scope_chapter_id: Optional[str] = None,
    chapter_for_relations: Optional[str] = None,
    client_tz: Optional[str] = None
) -> Dict[str, Any]:
    """
    Unified source of truth endpoint data for the student dashboard.
    Returns:
    - Subject details & subjects list
    - 4 Core Stat card values (total_concepts, chapters_done, study_time_left, mastery_percent)
    - Status line (synchronized with plan progress or material hours)
    - Notes Analysis & Chapters (books with chapter breakdown, difficulty, and study hours)
    - Active Study Plan & Plan Status (daily pace)
    - Study Route Planner data (topologically sorted with prerequisite awareness)
    - Related Topics & Learning Clusters (including cross-document links)
    """
    import time
    now_ts = time.time()
    cache_key = f"{user_id}:{subject_id}:{days}:{order_mode}:{scope_chapter_id}:{chapter_for_relations}:{client_tz or 'utc'}"
    cached = _user_summary_cache.get(cache_key)
    if cached:
        cached_ts, cached_data = cached
        if (now_ts - cached_ts) < 15.0:
            return cached_data

    days = 7 if days not in (7, 15, 30) else days
    order_mode = "syllabus" if order_mode not in ("syllabus", "easy", "hard") else order_mode

    subjects = get_user_subjects(user_id)
    if not subjects:
        return {
            "subject": None,
            "subjects": [],
            "stats": {
                "total_concepts": 0,
                "chapters_done": 0,
                "completed_chapters": 0,
                "total_chapters": 0,
                "remaining_to_master": 0,
                "study_time_left": 0.0,
                "mastery_percent": 0.0,
                "mastery_percentage": 0.0
            },
            "status_line": "You have 0h left. Upload notes to begin.",
            "books": [],
            "active_plan": None,
            "plan_status": None,
            "route": [],
            "preview_route": {"route": [], "days": days},
            "course_status": {"chapters": [], "active_plan": None, "plan_status": None},
            "related_topics": {"clusters": [], "topics": []},
            "relations": {"clusters": [], "topics": []},
            "selected_chapter_id": None
        }

    # Pick selected or default subject
    selected_subject = None
    if subject_id:
        for s in subjects:
            if s["id"] == subject_id:
                selected_subject = s
                break
    if not selected_subject:
        selected_subject = subjects[0]

    books_data = get_subject_books_with_chapters(selected_subject["id"], user_id)

    all_chapters = []
    for b in books_data:
        for ch in b.get("chapters", []):
            ch_copy = dict(ch)
            ch_copy["bookFilename"] = b["filename"]
            all_chapters.append(ch_copy)

    conn = get_connection()
    try:
        user_concepts = conn.execute(
            """
            SELECT DISTINCT c.id, c.importance, c.definition, c.topic, c.document_id
            FROM concepts c
            JOIN documents d ON c.document_id = d.id
            WHERE d.user_id = ?
            """,
            (user_id,)
        ).fetchall()

        prog_rows = conn.execute(
            "SELECT concept_id, status, updated_at FROM concept_progress WHERE user_id = ?",
            (user_id,)
        ).fetchall()
        prog_map = {str(r["concept_id"]): r["status"] for r in prog_rows}
    finally:
        conn.close()

    # Sync each chapter's status with concept progress (if all concepts in file are studied, chapter is done)
    for ch in all_chapters:
        ch_book_id = ch.get("book_id")
        ch_concepts = [c for c in user_concepts if c["document_id"] == ch_book_id]
        if ch_concepts:
            studied_in_ch = sum(1 for c in ch_concepts if prog_map.get(str(c["id"])) == "studied")
            if studied_in_ch == len(ch_concepts):
                ch["status"] = 2
                ch["completed"] = True
            elif studied_in_ch > 0 and ch.get("status") == 0:
                ch["status"] = 1

    total_concepts = len(user_concepts) if user_concepts else sum(ch.get("concept_count", 0) for ch in all_chapters)
    studied_concept_count = sum(1 for c in user_concepts if prog_map.get(str(c["id"])) == "studied")

    # Calculate active study days in current month from concept progress with timezone support
    target_tz = None
    if client_tz and ZoneInfo:
        try:
            target_tz = ZoneInfo(client_tz.strip())
        except Exception:
            target_tz = None

    if target_tz:
        now_local = datetime.now(target_tz)
        cur_ym = now_local.strftime("%Y-%m")
        cur_day = now_local.day
    else:
        now_utc = datetime.now(timezone.utc)
        cur_ym = now_utc.strftime("%Y-%m")
        cur_day = now_utc.day

    active_days_set = set()
    active_timestamps = []
    for r in prog_rows:
        if r["status"] == "studied" and r["updated_at"]:
            ts_str = str(r["updated_at"])
            active_timestamps.append(ts_str)
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if target_tz:
                    dt_local = dt.astimezone(target_tz)
                    if dt_local.strftime("%Y-%m") == cur_ym:
                        if 1 <= dt_local.day <= 31:
                            active_days_set.add(dt_local.day)
                else:
                    if dt.strftime("%Y-%m") == cur_ym:
                        if 1 <= dt.day <= 31:
                            active_days_set.add(dt.day)
            except Exception:
                if ts_str.startswith(cur_ym):
                    try:
                        day_val = int(ts_str[8:10])
                        if 1 <= day_val <= 31:
                            active_days_set.add(day_val)
                    except (ValueError, TypeError, IndexError):
                        pass

    if studied_concept_count > 0 and not active_days_set:
        active_days_set.add(cur_day)
    active_days_list = sorted(list(active_days_set)) if studied_concept_count > 0 else []

    not_studied_minutes = 0
    for c in user_concepts:
        if prog_map.get(str(c["id"])) != "studied":
            imp = max(1, min(3, int(c["importance"] or 2)))
            d_len = len(c["definition"] or "")
            est_m = max(1, min(30, 4 + imp * 3 + min(8, d_len // 30)))
            not_studied_minutes += est_m

    if user_concepts:
        study_time_left = round(not_studied_minutes / 60.0, 1)
    else:
        study_time_left = round(sum(remaining_hours(ch) for ch in all_chapters), 1)

    total_chapters = len(all_chapters)
    done_chapters = sum(1 for ch in all_chapters if ch.get("status") == 2)
    remaining_chapters = max(0, total_chapters - done_chapters)

    if total_concepts > 0:
        mastery_percent = round((studied_concept_count / total_concepts) * 100, 1)
    elif total_chapters > 0:
        mastery_percent = round((done_chapters / total_chapters) * 100, 1)
    else:
        mastery_percent = 0.0

    stats = {
        "total_concepts": total_concepts,
        "chapters_done": done_chapters,
        "completed_chapters": done_chapters,
        "total_chapters": total_chapters,
        "remaining_to_master": remaining_chapters,
        "study_time_left": study_time_left,
        "mastery_percent": mastery_percent,
        "mastery_percentage": mastery_percent,
        "studied_concepts_count": studied_concept_count,
        "active_days": active_days_list,
        "active_timestamps": active_timestamps,
        "streak_days": len(active_days_list)
    }

    # Active plan
    active_plan = get_active_study_plan(user_id, selected_subject["id"])
    plan_status = None
    if active_plan:
        plan_status = calculate_plan_status(active_plan, date.today().strftime("%Y-%m-%d"))

    # Status line formatting per Task 6
    sub_name = selected_subject.get("name") or "Core Curriculum"
    if active_plan:
        plan_days = active_plan.get("days", 7)
        days_left = max(1, plan_status.get("days_left", plan_days)) if plan_status else plan_days
        daily_pace = round(study_time_left / days_left, 1)
        today_idx = plan_status.get("today_index", 1) if plan_status else 1
        today_day_item = next((d for d in active_plan.get("route", []) if d.get("day_index") == today_idx), None)
        ch_names = ", ".join(it.get("chapter", "") for it in today_day_item.get("items", [])) if today_day_item else ""
        if ch_names:
            status_line = f"Day {today_idx} of your {plan_days}-day plan ({daily_pace}h/day needed). Today: {ch_names}."
        else:
            status_line = f"Day {today_idx} of your {plan_days}-day plan ({daily_pace}h/day needed in {sub_name})."
    elif study_time_left > 0:
        status_line = f"{study_time_left}h of study material in {sub_name}. Choose a deadline to start your plan."
    elif total_chapters > 0 and study_time_left == 0:
        status_line = f"All chapters mastered in {sub_name}! Great job!"
    else:
        status_line = f"You have 0h left in {sub_name}. Choose a deadline to begin."

    # Study route
    if active_plan:
        route = active_plan.get("route", [])
    else:
        ch_ids = [c["id"] for c in all_chapters]
        topics_map, relations_map = _gather_chapter_topics_and_relations_internal(ch_ids)
        route = build_route(
            chapters=all_chapters,
            days=days,
            order_mode=order_mode,
            scope_chapter_id=scope_chapter_id,
            chapter_topics_map=topics_map,
            chapter_relations_map=relations_map,
            start_date=date.today().strftime("%Y-%m-%d")
        )

    # Related Topics target chapter
    target_ch_id = chapter_for_relations
    if not target_ch_id and all_chapters:
        target_ch_id = all_chapters[0]["id"]

    related_topics_data = {"clusters": [], "topics": []}
    if target_ch_id:
        related_topics_data = get_chapter_relations_data(target_ch_id, user_id=user_id)
        if related_topics_data.get("topics") and not related_topics_data.get("clusters"):
            try:
                try:
                    from backend.services.topic_relations import generate_fallback_relations
                except ImportError:
                    from services.topic_relations import generate_fallback_relations
                # Fast deterministic relations - NEVER call Gemini on a read endpoint
                extracted = generate_fallback_relations(related_topics_data["topics"])
                save_topic_relations(target_ch_id, extracted.get("clusters", []), extracted.get("edges", []))
                related_topics_data = get_chapter_relations_data(target_ch_id, user_id=user_id)
            except Exception as e_rel:
                logger.warning(f"Could not extract clusters for chapter {target_ch_id}: {e_rel}")

    summary_result = {
        "subject": selected_subject,
        "subjects": subjects,
        "stats": stats,
        "status_line": status_line,
        "books": books_data,
        "active_plan": active_plan,
        "plan_status": plan_status,
        "route": route,
        "preview_route": {"route": route, "days": days},
        "course_status": {"chapters": all_chapters, "active_plan": active_plan, "plan_status": plan_status},
        "related_topics": related_topics_data,
        "relations": related_topics_data,
        "selected_chapter_id": target_ch_id
    }
    # Cache per-user for 15s to speed up rapid dashboard re-renders
    _user_summary_cache[cache_key] = (now_ts, summary_result)
    return summary_result


def get_dashboard_bootstrap_data(
    user_id: str,
    user_profile: Dict[str, Any],
    subject_id: Optional[str] = None,
    days: int = 7,
    order_mode: str = "syllabus",
    client_tz: Optional[str] = None
) -> Dict[str, Any]:
    """
    Consolidated single-trip bootstrap payload for instant first-paint dashboard rendering.
    Returns:
    - user: current authenticated user profile
    - guest_status: guest / upload status
    - documents: user's document list with chapter/concept counts
    - overview: full curriculum overview (4 stats, status_line, books with chapters, route, active_plan)
    - notes: recent notes preview (up to 4 items) and total count for MyNotesCard
    - reminders: user's reminder list for RemindersCard
    - cached_at: epoch timestamp
    """
    import time
    now_ts = time.time()
    cache_key = f"{user_id}:{subject_id or 'default'}:{days}:{order_mode}:{client_tz or 'utc'}"
    cached = _user_bootstrap_cache.get(cache_key)
    if cached:
        cached_ts, cached_data = cached
        if (now_ts - cached_ts) < 20.0:
            return cached_data

    # 1. Full dashboard overview
    overview = get_dashboard_summary_data(
        user_id=user_id,
        subject_id=subject_id,
        days=days,
        order_mode=order_mode,
        client_tz=client_tz
    )

    # 2. Documents list & count
    try:
        from backend.database import get_documents_list, get_document_count_by_user
    except ImportError:
        from database import get_documents_list, get_document_count_by_user
    docs = get_documents_list(user_id=user_id)
    doc_count = get_document_count_by_user(user_id)

    # 3. Notes preview (4 items for card)
    try:
        from backend.services.notes_db import list_notes
    except ImportError:
        from services.notes_db import list_notes
    notes_data = list_notes(user_id=user_id, limit=4, page=1)

    # 4. Reminders
    reminders_data = get_user_reminders_list(user_id=user_id)

    result = {
        "user": user_profile,
        "is_guest": False,
        "guest_status": {
            "is_authenticated": True,
            "uploads_count": doc_count,
            "upload_limit": None,
            "remaining": None
        },
        "documents": docs,
        "documents_count": doc_count,
        "overview": overview,
        "notes": {
            "items": notes_data.get("items", []),
            "total": notes_data.get("total", 0)
        },
        "notes_preview": {
            "items": notes_data.get("items", []),
            "total": notes_data.get("total", 0)
        },
        "reminders": reminders_data,
        "cached_at": now_ts
    }
    _user_bootstrap_cache[cache_key] = (now_ts, result)
    return result



