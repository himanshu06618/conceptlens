import os
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pathlib import Path

try:
    from backend.database import get_connection, is_postgres
except ImportError:
    from database import get_connection, is_postgres

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

def ensure_default_subject_and_chapters_for_user(user_id: str) -> str:
    """
    Ensures the user has at least one subject.
    If the user has uploaded documents (books) without chapters,
    synthesizes chapters from the concepts/topics for a seamless experience.
    Returns the active subject_id.
    """
    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            # Check existing subjects for user
            cursor = conn.execute("SELECT id FROM subjects WHERE user_id = ? ORDER BY created_at ASC LIMIT 1", (user_id,))
            row = cursor.fetchone()
            if row:
                subject_id = row["id"]
            else:
                subject_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO subjects (id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)",
                    (subject_id, user_id, "Core Curriculum", "CC-101", now_iso)
                )

            # Link any documents owned by user without a subject_id
            conn.execute(
                "UPDATE documents SET subject_id = ? WHERE user_id = ? AND (subject_id IS NULL OR subject_id = '')",
                (subject_id, user_id)
            )

            # For every document in this subject, ensure chapters exist
            docs = conn.execute(
                "SELECT id, filename, created_at FROM documents WHERE subject_id = ?",
                (subject_id,)
            ).fetchall()

            for doc in docs:
                doc_id = doc["id"]
                # Check if chapters already exist for this book
                ch_count = conn.execute(
                    "SELECT COUNT(*) as cnt FROM chapters WHERE book_id = ?",
                    (doc_id,)
                ).fetchone()["cnt"]

                if ch_count == 0:
                    # Synthesize chapters from concepts
                    # Look at distinct topics in concepts for this document
                    topic_rows = conn.execute(
                        """
                        SELECT topic, COUNT(*) as c_count, MIN(page) as min_page
                        FROM concepts
                        WHERE document_id = ?
                        GROUP BY topic
                        ORDER BY min_page ASC, c_count DESC
                        """,
                        (doc_id,)
                    ).fetchall()

                    if topic_rows and len(topic_rows) > 1:
                        # Multiple topics -> each topic is a chapter
                        for idx, tr in enumerate(topic_rows):
                            t_name = tr["topic"] or f"Unit {idx + 1}"
                            c_count = tr["c_count"]
                            ch_id = str(uuid.uuid4())
                            difficulty = 1
                            est_hours = calc_default_est_hours(c_count, difficulty)
                            conn.execute(
                                """
                                INSERT INTO chapters (id, book_id, name, order_index, concept_count, difficulty, est_hours, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (ch_id, doc_id, t_name, idx + 1, c_count, difficulty, est_hours, doc["created_at"] or now_iso)
                            )
                            # Populate topics in this chapter from the concepts
                            concepts = conn.execute(
                                "SELECT id, name FROM concepts WHERE document_id = ? AND topic = ? ORDER BY page ASC, flow_order ASC, id ASC",
                                (doc_id, tr["topic"])
                            ).fetchall()
                            for t_idx, c in enumerate(concepts):
                                conn.execute(
                                    """
                                    INSERT INTO topics (chapter_id, order_index, name, cluster_id, cluster_name)
                                    VALUES (?, ?, ?, ?, ?)
                                    """,
                                    (ch_id, t_idx + 1, c["name"], "c1", "Core Concepts")
                                )
                    else:
                        # Single topic or general -> create 1 or 2 structured chapters
                        total_concepts = conn.execute(
                            "SELECT COUNT(*) as cnt FROM concepts WHERE document_id = ?",
                            (doc_id,)
                        ).fetchone()["cnt"]
                        ch_name = Path(doc["filename"]).stem.replace("_", " ").title()
                        ch_id = str(uuid.uuid4())
                        difficulty = 1
                        est_hours = calc_default_est_hours(total_concepts, difficulty)
                        conn.execute(
                            """
                            INSERT INTO chapters (id, book_id, name, order_index, concept_count, difficulty, est_hours, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (ch_id, doc_id, ch_name or "Chapter 1: Foundations", 1, total_concepts, difficulty, est_hours, doc["created_at"] or now_iso)
                        )
                        concepts = conn.execute(
                            "SELECT id, name FROM concepts WHERE document_id = ? ORDER BY page ASC, flow_order ASC, id ASC",
                            (doc_id,)
                        ).fetchall()
                        for t_idx, c in enumerate(concepts):
                            cluster_idx = (t_idx // 4) + 1
                            conn.execute(
                                """
                                INSERT INTO topics (chapter_id, order_index, name, cluster_id, cluster_name)
                                VALUES (?, ?, ?, ?, ?)
                                """,
                                (ch_id, t_idx + 1, c["name"], f"c{cluster_idx}", f"Cluster {cluster_idx}")
                            )

            # Ensure chapter_progress records exist for all chapters for this user
            all_chapters = conn.execute(
                """
                SELECT c.id FROM chapters c
                JOIN documents d ON c.book_id = d.id
                WHERE d.subject_id = ?
                """,
                (subject_id,)
            ).fetchall()
            for ch in all_chapters:
                ch_id = ch["id"]
                conn.execute(
                    """
                    INSERT OR IGNORE INTO chapter_progress (user_id, chapter_id, status, updated_at)
                    VALUES (?, ?, 0, ?)
                    """,
                    (user_id, ch_id, now_iso)
                )

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
                   COUNT(c.id) as chapter_count
            FROM documents d
            LEFT JOIN chapters c ON c.book_id = d.id
            WHERE d.subject_id = ?
            GROUP BY d.id
            ORDER BY d.created_at DESC
            """,
            (subject_id,)
        ).fetchall()

        books = []
        all_chapters = []
        total_concepts = 0
        total_est_hours = 0.0
        remaining_hours = 0.0
        done_chapters_count = 0
        total_chapters_count = 0

        for b in books_rows:
            b_id = b["id"]
            # Fetch chapters for this book with user's progress
            ch_rows = conn.execute(
                """
                SELECT c.id, c.book_id, c.name, c.order_index, c.concept_count,
                       c.difficulty, c.est_hours,
                       COALESCE(cp.status, 0) as status
                FROM chapters c
                LEFT JOIN chapter_progress cp ON cp.chapter_id = c.id AND cp.user_id = ?
                WHERE c.book_id = ?
                ORDER BY c.order_index ASC
                """,
                (user_id, b_id)
            ).fetchall()

            ch_list = []
            book_done = 0
            for ch in ch_rows:
                ch_dict = dict(ch)
                st = ch_dict["status"]
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

                ch_list.append(ch_dict)
                all_chapters.append(ch_dict)

            book_mastery = round((book_done / len(ch_list) * 100)) if ch_list else 0
            b_dict = dict(b)
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
                        INSERT OR IGNORE INTO topic_relations (from_topic_id, to_topic_id, type)
                        VALUES (?, ?, ?)
                        """,
                        (f_id, t_id, edge_type)
                    )
    finally:
        conn.close()

def get_chapter_relations_data(chapter_id: str) -> Dict[str, Any]:
    """
    Returns clusters with topics; per topic: prerequisites[], related[], leads_to[]
    and each cluster's 'runs until' topic and next topic.
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

        # Fetch relations
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
                "prerequisites": prereqs_map.get(t["id"], []),
                "related": related_map.get(t["id"], []),
                "leads_to": leads_to_map.get(t["id"], [])
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
                    "prerequisites": prereqs_map.get(t["id"], []),
                    "related": related_map.get(t["id"], []),
                    "leads_to": leads_to_map.get(t["id"], [])
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
            return cursor.rowcount > 0
    finally:
        conn.close()

# Functional aliases
delete_study_plan = delete_study_plan_record
get_user_reminders = get_user_reminders_list
create_reminder = create_reminder_record
update_reminder = update_reminder_record
delete_reminder = delete_reminder_record
