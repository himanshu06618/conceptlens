import os
import sqlite3
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pathlib import Path
from dotenv import load_dotenv

# Load environment configuration
load_dotenv()

DB_PATH = os.getenv("DATABASE_PATH", "conceptlens.db")

COMMON_ACRONYMS = {
    "AI", "ML", "NLP", "OCR", "API", "SQL", "DB", "REST", "HTTP", "HTTPS",
    "CPU", "GPU", "RAM", "ROM", "HTML", "CSS", "JS", "TS", "UI", "UX",
    "OS", "URL", "JSON", "XML", "PDF", "PWA", "SVM", "CNN", "RNN", "LLM",
    "BERT", "GPT", "GAN", "AWS", "GCP", "IOT", "TCP", "IP", "DNS", "TOC", "USA"
}

MINOR_WORDS = {"of", "and", "in", "to", "for", "on", "a", "an", "the", "by", "with", "at"}

def join_spaced_single_letters(text: str) -> str:
    """Joins sequences of single letters separated by spaces into words: 'D A T A L O G I C' -> 'DATALOGIC'."""
    pattern = r'\b([A-Za-z](?:\s+[A-Za-z])+)\b'
    return re.sub(pattern, lambda m: re.sub(r'\s+', '', m.group(1)), text)

def clean_topic_heading(text: str, cap_at_32: bool = True) -> str:
    """
    Cleans OCR heading text:
    1. Joins sequences of single letters separated by spaces into words
    2. Strips '(cont\'d)', '(contd)', and 'continued'
    3. Collapses repeated spaces
    4. Converts ALL CAPS to Title Case (keeping acronyms uppercase)
    5. Caps topic labels at 32 characters
    """
    if not text:
        return "General"
    cleaned = join_spaced_single_letters(text)
    cleaned = re.sub(r'(?i)\s*[\(\[\{]?(?:cont\'?d|continued)[\)\]\}]?', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip(' \t\n\r-:,.;')
    if not cleaned or cleaned.lower() in ('none', 'null', 'general'):
        return "General"

    words = cleaned.split(' ')
    title_words = []
    for idx, w in enumerate(words):
        clean_w = re.sub(r'[^A-Za-z0-9]', '', w)
        if clean_w.upper() in COMMON_ACRONYMS:
            title_words.append(clean_w.upper())
        elif idx > 0 and clean_w.lower() in MINOR_WORDS:
            title_words.append(w.lower())
        elif clean_w.isupper() and len(clean_w) > 1:
            title_words.append(w.capitalize())
        elif w.islower():
            title_words.append(w.capitalize())
        else:
            title_words.append(w)
    cleaned = ' '.join(title_words)

    if cap_at_32 and len(cleaned) > 32:
        cleaned = cleaned[:32].rstrip(' \t\n\r-:,.;')

    return cleaned or "General"

def normalize_concept_display_name(name: str) -> str:
    """
    Normalizes concept display names to consistent Title Case style,
    keeping recognized acronyms uppercase (e.g. 'algorithms' -> 'Algorithms', 'api' -> 'API').
    """
    if not name:
        return ""
    # Strip TOC leader dots or dashes if present
    cleaned = re.sub(r'(?:\.\s*){2,}', ' ', name)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    words = re.split(r'(\s+)', cleaned)
    norm = []
    for w in words:
        if not w or w.isspace():
            norm.append(w)
            continue
        clean_w = re.sub(r'[^A-Za-z0-9]', '', w)
        if clean_w.upper() in COMMON_ACRONYMS:
            norm.append(re.sub(r'[A-Za-z0-9]+', clean_w.upper(), w, count=1))
        elif clean_w and clean_w.isupper() and len(clean_w) <= 4 and clean_w.isalpha():
            norm.append(w)
        elif w[0].islower():
            norm.append(w[0].upper() + w[1:])
        else:
            norm.append(w)
    return ''.join(norm).strip()


def get_db_path() -> Path:
    p = Path(DB_PATH)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent / p
    return p

def get_connection() -> sqlite3.Connection:
    """Returns a SQLite connection with foreign keys and row factory enabled."""
    db_file = get_db_path()
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_file), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA temp_store = MEMORY;")
    return conn

def init_db() -> None:
    """Initializes the database schema and performs safe migrations."""
    conn = get_connection()
    try:
        with conn:
            # Users table
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                    display_name TEXT NOT NULL,
                    name TEXT,
                    email TEXT UNIQUE,
                    password_hash TEXT,
                    google_sub TEXT UNIQUE,
                    avatar TEXT,
                    avatar_url TEXT,
                    role TEXT,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
                CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);

                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    filename TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT DEFAULT 'pending',
                    error TEXT,
                    page_count INTEGER DEFAULT 1,
                    raw_text TEXT,
                    tree_json TEXT,
                    flow_json TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS concepts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    definition TEXT DEFAULT '',
                    topic TEXT DEFAULT 'General',
                    score REAL NOT NULL,
                    importance INTEGER NOT NULL,
                    source_excerpt TEXT NOT NULL,
                    page INTEGER DEFAULT 1,
                    flow_order INTEGER NOT NULL DEFAULT 0,
                    flow_group TEXT NOT NULL DEFAULT 'General'
                );

                CREATE TABLE IF NOT EXISTS relations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                    concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
                    related_name TEXT NOT NULL,
                    weight INTEGER NOT NULL,
                    relation_type TEXT NOT NULL DEFAULT 'related',
                    label TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_concepts_document_id ON concepts(document_id);
                CREATE INDEX IF NOT EXISTS idx_concepts_importance ON concepts(importance);
                CREATE INDEX IF NOT EXISTS idx_relations_concept_id ON relations(concept_id);
                CREATE INDEX IF NOT EXISTS idx_relations_document_id ON relations(document_id);
            """)

            # Migration: Ensure user_id and tree_json columns exist on documents
            cursor = conn.execute("PRAGMA table_info(documents);")
            columns = [row["name"] for row in cursor.fetchall()]
            if "user_id" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN user_id TEXT;")
            if "tree_json" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN tree_json TEXT;")
            if "flow_json" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN flow_json TEXT;")
            concept_columns = {row["name"] for row in conn.execute("PRAGMA table_info(concepts)")}
            if "flow_order" not in concept_columns:
                conn.execute("ALTER TABLE concepts ADD COLUMN flow_order INTEGER NOT NULL DEFAULT 0;")
            if "flow_group" not in concept_columns:
                conn.execute("ALTER TABLE concepts ADD COLUMN flow_group TEXT NOT NULL DEFAULT 'General';")
            relation_columns = {row["name"] for row in conn.execute("PRAGMA table_info(relations)")}
            if "relation_type" not in relation_columns:
                conn.execute("ALTER TABLE relations ADD COLUMN relation_type TEXT NOT NULL DEFAULT 'related';")
            if "processing_time_sec" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN processing_time_sec REAL DEFAULT 0.0;")
            if "provider_used" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN provider_used TEXT DEFAULT 'on-device';")
            if "skipped_pages" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN skipped_pages TEXT DEFAULT '[]';")
            if "progress" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN progress INTEGER DEFAULT 0;")
            if "stage_message" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN stage_message TEXT DEFAULT '';")
            if "ocr_current_page" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN ocr_current_page INTEGER DEFAULT 0;")
            if "ocr_total_pages" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN ocr_total_pages INTEGER DEFAULT 0;")
            if "file_hash" not in columns:
                conn.execute("ALTER TABLE documents ADD COLUMN file_hash TEXT;")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);")

            # Migration: Ensure role, name, avatar exist on users and role is nullable
            u_info = list(conn.execute("PRAGMA table_info(users);"))
            u_cols = {row["name"] for row in u_info}
            role_col = next((row for row in u_info if row["name"] == "role"), None)

            if "name" not in u_cols:
                conn.execute("ALTER TABLE users ADD COLUMN name TEXT;")
                conn.execute("UPDATE users SET name = COALESCE(display_name, username) WHERE name IS NULL;")
            if "avatar" not in u_cols:
                conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT;")
                conn.execute("UPDATE users SET avatar = avatar_url WHERE avatar IS NULL;")

            if "role" not in u_cols:
                conn.execute("ALTER TABLE users ADD COLUMN role TEXT;")
            elif role_col and role_col["notnull"] == 1:
                # Make role nullable by rebuilding users table
                conn.execute("PRAGMA foreign_keys = OFF;")
                conn.execute("""
                    CREATE TABLE users_migrated (
                        id TEXT PRIMARY KEY,
                        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
                        display_name TEXT NOT NULL,
                        name TEXT,
                        email TEXT UNIQUE,
                        password_hash TEXT,
                        google_sub TEXT UNIQUE,
                        avatar TEXT,
                        avatar_url TEXT,
                        role TEXT,
                        created_at TEXT NOT NULL,
                        last_login_at TEXT NOT NULL
                    );
                """)
                conn.execute("""
                    INSERT INTO users_migrated (id, username, display_name, name, email, password_hash, google_sub, avatar, avatar_url, role, created_at, last_login_at)
                    SELECT id, username, display_name, COALESCE(name, display_name), email, password_hash, google_sub, avatar, avatar_url, role, created_at, last_login_at
                    FROM users;
                """)
                conn.execute("DROP TABLE users;")
                conn.execute("ALTER TABLE users_migrated RENAME TO users;")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);")
                conn.execute("PRAGMA foreign_keys = ON;")

            # Migration: Re-clean topics and normalize concept names for existing notes
            try:
                cursor = conn.execute("SELECT id, name, topic FROM concepts")
                rows = cursor.fetchall()
                concept_updates = []
                for row in rows:
                    cid = row["id"]
                    old_name = row["name"] or ""
                    old_topic = row["topic"] or "General"
                    new_name = normalize_concept_display_name(old_name)
                    new_topic = clean_topic_heading(old_topic)
                    if new_name != old_name or new_topic != old_topic:
                        concept_updates.append((new_name, new_topic, cid))
                if concept_updates:
                    conn.executemany("UPDATE concepts SET name = ?, topic = ? WHERE id = ?", concept_updates)
            except Exception:
                pass

            # Initialize study planner schema & migrations
            try:
                try:
                    from backend.services.planner_db import init_planner_db
                except ImportError:
                    from services.planner_db import init_planner_db
                init_planner_db()
            except Exception as plan_mig_err:
                pass

            # Initialize personal notes schema & migrations
            try:
                try:
                    from backend.services.notes_db import init_notes_db
                except ImportError:
                    from services.notes_db import init_notes_db
                init_notes_db()
            except Exception as notes_mig_err:
                pass
    finally:
        conn.close()

# ==================== User Operations ====================

def _normalize_user_row(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    d = dict(row)
    name_val = d.get("name") or d.get("display_name") or d.get("username") or ""
    avatar_val = d.get("avatar") or d.get("avatar_url")
    d["name"] = name_val
    d["display_name"] = name_val
    d["avatar"] = avatar_val
    d["avatar_url"] = avatar_val
    return d

def create_user(
    user_id: str,
    username: str,
    display_name: str,
    email: Optional[str] = None,
    password_hash: Optional[str] = None,
    google_sub: Optional[str] = None,
    avatar_url: Optional[str] = None,
    role: Optional[str] = "student",
    name: Optional[str] = None,
    avatar: Optional[str] = None
) -> Dict[str, Any]:
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_name = (name or display_name or username).strip()
    clean_avatar = avatar or avatar_url
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO users (id, username, display_name, name, email, password_hash, google_sub, avatar, avatar_url, role, created_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, username.strip().lower(), clean_name, clean_name, email, password_hash, google_sub, clean_avatar, clean_avatar, role, now_iso, now_iso)
            )
        return {
            "id": user_id,
            "username": username.strip().lower(),
            "display_name": clean_name,
            "name": clean_name,
            "email": email,
            "avatar": clean_avatar,
            "avatar_url": clean_avatar,
            "role": role,
            "has_password": password_hash is not None,
            "created_at": now_iso
        }
    finally:
        conn.close()

def update_user_role(user_id: str, role: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role.strip().lower(), user_id))
    finally:
        conn.close()

def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return _normalize_user_row(row)
    finally:
        conn.close()

def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", (username.strip(),))
        row = cursor.fetchone()
        return _normalize_user_row(row)
    finally:
        conn.close()

def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    if not email:
        return None
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email.strip(),))
        row = cursor.fetchone()
        return _normalize_user_row(row)
    finally:
        conn.close()

def get_user_by_google_sub(google_sub: str) -> Optional[Dict[str, Any]]:
    if not google_sub:
        return None
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT * FROM users WHERE google_sub = ?", (google_sub,))
        row = cursor.fetchone()
        return _normalize_user_row(row)
    finally:
        conn.close()

def update_user_last_login(user_id: str) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso, user_id))
    finally:
        conn.close()

def update_user_display_name(user_id: str, display_name: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET display_name = ?, name = ? WHERE id = ?", (display_name.strip(), display_name.strip(), user_id))
    finally:
        conn.close()

def update_user_password(user_id: str, password_hash: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    finally:
        conn.close()

def link_google_account(user_id: str, google_sub: str, avatar_url: Optional[str] = None) -> None:
    conn = get_connection()
    try:
        with conn:
            if avatar_url:
                conn.execute(
                    "UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?), avatar = COALESCE(avatar, ?) WHERE id = ?",
                    (google_sub, avatar_url, avatar_url, user_id)
                )
            else:
                conn.execute("UPDATE users SET google_sub = ? WHERE id = ?", (google_sub, user_id))
    finally:
        conn.close()

def get_document_count_by_user(user_id: str) -> int:
    """Returns the total number of documents uploaded by a user or guest session."""
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT COUNT(*) as cnt FROM documents WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        return row["cnt"] if row else 0
    finally:
        conn.close()

def transfer_documents_user(old_user_id: str, new_user_id: str) -> int:
    """Transfers documents from a guest session to a registered user account."""
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute(
                "UPDATE documents SET user_id = ? WHERE user_id = ?",
                (new_user_id, old_user_id)
            )
            return cursor.rowcount
    finally:
        conn.close()

def delete_user_and_all_data(user_id: str) -> List[Dict[str, str]]:
    """
    Deletes the user and all their associated documents, concepts, and relations.
    Returns the list of deleted document dicts ({id, filename}) to allow cleaning up disk files.
    """
    conn = get_connection()
    try:
        with conn:
            # Get list of documents for cleanup
            cursor = conn.execute("SELECT id, filename FROM documents WHERE user_id = ?", (user_id,))
            docs = [dict(row) for row in cursor.fetchall()]

            # Delete documents (cascade deletes concepts and relations)
            conn.execute("DELETE FROM documents WHERE user_id = ?", (user_id,))
            # Delete user
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

            return docs
    finally:
        conn.close()

# ==================== Document Operations (Per-User) ====================

def find_completed_document_by_hash(file_hash: str) -> Optional[Dict[str, Any]]:
    """Finds an existing completed document with the identical SHA-256 hash."""
    if not file_hash:
        return None
    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            SELECT id, filename, page_count, raw_text, tree_json, flow_json, provider_used
            FROM documents
            WHERE file_hash = ? AND status = 'completed'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (file_hash,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def clone_cached_document(source_doc_id: str, target_doc_id: str) -> bool:
    """
    Clones concepts, relations, tree, and flowchart from an existing completed document
    to a newly uploaded document with matching file_hash.
    """
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute(
                "SELECT page_count, raw_text, tree_json, flow_json FROM documents WHERE id = ?",
                (source_doc_id,)
            )
            src_doc = cursor.fetchone()
            if not src_doc:
                return False

            conn.execute(
                """
                UPDATE documents
                SET status = 'completed', stage = 'completed', progress = 100,
                    stage_message = 'Extraction completed instantly from cache!',
                    page_count = ?, raw_text = ?, tree_json = ?, flow_json = ?,
                    processing_time_sec = 0.05, provider_used = 'cache', error = NULL
                WHERE id = ?
                """,
                (src_doc["page_count"], src_doc["raw_text"], src_doc["tree_json"], src_doc["flow_json"], target_doc_id)
            )

            c_cursor = conn.execute(
                """
                SELECT id, name, definition, topic, score, importance,
                       source_excerpt, page, flow_order, flow_group
                FROM concepts
                WHERE document_id = ?
                """,
                (source_doc_id,)
            )
            src_concepts = c_cursor.fetchall()
            old_to_new_id = {}

            for sc in src_concepts:
                ins_c = conn.execute(
                    """
                    INSERT INTO concepts (
                        document_id, name, definition, topic, score, importance,
                        source_excerpt, page, flow_order, flow_group
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        target_doc_id, sc["name"], sc["definition"], sc["topic"],
                        sc["score"], sc["importance"], sc["source_excerpt"],
                        sc["page"], sc["flow_order"], sc["flow_group"]
                    )
                )
                old_to_new_id[sc["id"]] = ins_c.lastrowid

            rel_cursor = conn.execute(
                """
                SELECT concept_id, related_name, weight, relation_type, label
                FROM relations
                WHERE document_id = ?
                """,
                (source_doc_id,)
            )
            new_rels = []
            for r in rel_cursor.fetchall():
                new_c_id = old_to_new_id.get(r["concept_id"])
                if new_c_id:
                    new_rels.append((
                        target_doc_id, new_c_id, r["related_name"],
                        r["weight"], r["relation_type"], r["label"]
                    ))

            if new_rels:
                conn.executemany(
                    """
                    INSERT INTO relations (
                        document_id, concept_id, related_name, weight, relation_type, label
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    new_rels
                )
            return True
    finally:
        conn.close()

def create_document(
    user_id: str,
    doc_id: str,
    filename: str,
    file_type: str,
    status: str = "processing",
    stage: str = "reading",
    file_hash: Optional[str] = None
) -> Dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO documents (
                    id, user_id, filename, file_type, status, stage, page_count, raw_text,
                    progress, stage_message, ocr_current_page, ocr_total_pages, file_hash, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 1, '', 5, 'Initializing document analysis...', 0, 0, ?, ?)
                """,
                (doc_id, user_id, filename, file_type, status, stage, file_hash, created_at)
            )
        return {
            "id": doc_id,
            "user_id": user_id,
            "filename": filename,
            "file_type": file_type,
            "status": status,
            "stage": stage,
            "progress": 5,
            "stage_message": "Initializing document analysis...",
            "ocr_current_page": 0,
            "ocr_total_pages": 0,
            "page_count": 1,
            "file_hash": file_hash,
            "created_at": created_at
        }
    finally:
        conn.close()

def update_document_stage(
    doc_id: str,
    stage: str,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    stage_message: Optional[str] = None,
    current_page: Optional[int] = None,
    total_pages: Optional[int] = None
) -> None:
    conn = get_connection()
    try:
        with conn:
            fields = ["stage = ?"]
            params: List[Any] = [stage]
            if status is not None:
                fields.append("status = ?")
                params.append(status)
            if progress is not None:
                fields.append("progress = ?")
                params.append(max(0, min(100, int(progress))))
            if stage_message is not None:
                fields.append("stage_message = ?")
                params.append(stage_message)
            if current_page is not None:
                fields.append("ocr_current_page = ?")
                params.append(int(current_page))
            if total_pages is not None:
                fields.append("ocr_total_pages = ?")
                params.append(int(total_pages))
            params.append(doc_id)
            query = f"UPDATE documents SET {', '.join(fields)} WHERE id = ?"
            conn.execute(query, params)
    finally:
        conn.close()

def mark_document_completed(
    doc_id: str,
    page_count: int,
    raw_text: str,
    processing_time_sec: float = 0.0,
    provider_used: str = "on-device",
    skipped_pages: Optional[List[int]] = None
) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                UPDATE documents 
                SET status = 'completed', stage = 'completed', progress = 100,
                    stage_message = 'Extraction completed successfully!',
                    page_count = ?, raw_text = ?,
                    processing_time_sec = ?, provider_used = ?, skipped_pages = ?, error = NULL
                WHERE id = ?
                """,
                (page_count, raw_text, round(processing_time_sec, 2), provider_used, json.dumps(skipped_pages or []), doc_id)
            )
    finally:
        conn.close()

def mark_document_failed(doc_id: str, error_message: str) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                UPDATE documents 
                SET status = 'failed', stage = 'failed', error = ?,
                    stage_message = ?
                WHERE id = ?
                """,
                (error_message, f"Failed: {error_message[:60]}", doc_id)
            )
    finally:
        conn.close()

def get_documents_list(user_id: str) -> List[Dict[str, Any]]:
    """Returns documents strictly owned by the specified user."""
    conn = get_connection()
    try:
        cursor = conn.execute("""
            SELECT 
                d.id,
                d.filename,
                d.file_type,
                d.status,
                d.stage,
                d.progress,
                d.stage_message,
                d.ocr_current_page,
                d.ocr_total_pages,
                d.error,
                d.page_count,
                d.processing_time_sec,
                d.provider_used,
                d.skipped_pages,
                d.created_at,
                COUNT(c.id) AS concept_count
            FROM documents d
            LEFT JOIN concepts c ON d.id = c.document_id
            WHERE d.user_id = ?
            GROUP BY d.id
            ORDER BY d.created_at DESC
        """, (user_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

def get_document_by_id(user_id: str, doc_id: str) -> Optional[Dict[str, Any]]:
    """Returns document by id strictly matching user_id. Returns None if belongs to someone else."""
    conn = get_connection()
    try:
        cursor = conn.execute("""
            SELECT 
                d.id,
                d.filename,
                d.file_type,
                d.status,
                d.stage,
                d.progress,
                d.stage_message,
                d.ocr_current_page,
                d.ocr_total_pages,
                d.error,
                d.page_count,
                d.raw_text,
                d.processing_time_sec,
                d.provider_used,
                d.skipped_pages,
                d.created_at,
                COUNT(c.id) AS concept_count
            FROM documents d
            LEFT JOIN concepts c ON d.id = c.document_id
            WHERE d.id = ? AND d.user_id = ?
            GROUP BY d.id
        """, (doc_id, user_id))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def delete_document_by_id(user_id: str, doc_id: str) -> bool:
    """Deletes document strictly matching user_id."""
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
            return cursor.rowcount > 0
    finally:
        conn.close()

def document_exists(doc_id: str) -> bool:
    """Checks whether a document exists in the database by doc_id."""
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT 1 FROM documents WHERE id = ?", (doc_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()

def save_document_tree(doc_id: str, tree_data: Dict[str, Any]) -> None:
    """Saves the precomputed concept tree hierarchy JSON for a document."""
    conn = get_connection()
    try:
        with conn:
            json_str = json.dumps(tree_data, ensure_ascii=False)
            conn.execute("UPDATE documents SET tree_json = ? WHERE id = ?", (json_str, doc_id))
    finally:
        conn.close()

def save_document_flowchart(doc_id: str, flow_data: Dict[str, Any]) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                "UPDATE documents SET flow_json = ? WHERE id = ?",
                (json.dumps(flow_data, ensure_ascii=False), doc_id)
            )
    finally:
        conn.close()

def get_document_flowchart_cache(user_id: str, doc_id: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT flow_json FROM documents WHERE id = ? AND user_id = ?",
            (doc_id, user_id)
        ).fetchone()
        if not row:
            return None
        return json.loads(row["flow_json"]) if row["flow_json"] else {}
    finally:
        conn.close()

def get_document_tree(user_id: str, doc_id: str) -> Optional[Dict[str, Any]]:
    """
    Returns the concept tree for a document strictly matching user_id.
    If tree_json is not yet cached, computes it on demand from stored concepts, caches it, and returns it.
    """
    conn = get_connection()
    try:
        cursor = conn.execute("SELECT id, filename, tree_json FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
        row = cursor.fetchone()
        if not row:
            return None

        if row["tree_json"]:
            try:
                return json.loads(row["tree_json"])
            except Exception:
                pass

        # Build on demand if not cached
        concepts = get_concepts_by_document(doc_id)
        try:
            try:
                from backend.services.tree_builder import build_document_tree
            except ImportError:
                from services.tree_builder import build_document_tree
            tree = build_document_tree(doc_id, row["filename"], concepts)
            save_document_tree(doc_id, tree)
            return tree
        except Exception as e:
            return None
    finally:
        conn.close()

# Concept & Relation operations
def save_concepts_and_relations(
    doc_id: str,
    concepts_data: List[Dict[str, Any]]
) -> None:
    conn = get_connection()
    try:
        with conn:
            conn.execute("DELETE FROM concepts WHERE document_id = ?", (doc_id,))
            relation_rows = []
            for c in concepts_data:
                clean_name = normalize_concept_display_name(c["name"])
                clean_topic = clean_topic_heading(c.get("topic", "General"))
                cursor = conn.execute(
                    """
                    INSERT INTO concepts (
                        document_id, name, definition, topic, score, importance,
                        source_excerpt, page, flow_order, flow_group
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        doc_id,
                        clean_name,
                        c.get("definition", ""),
                        clean_topic,
                        float(c.get("score", 0.0)),
                        int(c.get("importance", 1)),
                        c.get("source_excerpt", ""),
                        int(c.get("page", 1)),
                        int(c.get("flow_order", 0)),
                        clean_topic_heading(c.get("flow_group") or c.get("topic", "General"))
                    )
                )
                concept_id = cursor.lastrowid
                
                related = c.get("related_concepts", [])
                for rel in related:
                    rel_name = rel.get("name") if isinstance(rel, dict) else str(rel)
                    clean_rel_name = normalize_concept_display_name(rel_name)
                    rel_weight = rel.get("weight", 1) if isinstance(rel, dict) else 1
                    if clean_rel_name and clean_rel_name.lower() != clean_name.lower():
                        relation_rows.append((
                            doc_id, concept_id, clean_rel_name, int(rel_weight),
                            rel.get("type", "related") if isinstance(rel, dict) else "related",
                            rel.get("label", "") if isinstance(rel, dict) else ""
                        ))
            if relation_rows:
                conn.executemany(
                    """
                    INSERT INTO relations (
                        document_id, concept_id, related_name, weight, relation_type, label
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    relation_rows
                )
            conn.execute("UPDATE documents SET tree_json = NULL, flow_json = NULL WHERE id = ?", (doc_id,))
    finally:
        conn.close()

def get_concepts_by_document(
    doc_id: str,
    q: Optional[str] = None,
    topic: Optional[str] = None,
    min_importance: Optional[int] = None
) -> List[Dict[str, Any]]:
    conn = get_connection()
    try:
        query = """
            SELECT 
                c.id,
                c.document_id,
                c.name,
                c.definition,
                c.topic,
                c.score,
                c.importance,
                c.source_excerpt,
                c.page,
                c.flow_order,
                c.flow_group
            FROM concepts c
            WHERE c.document_id = ?
        """
        params: List[Any] = [doc_id]

        if topic and topic.strip() and topic.lower() != "all":
            query += " AND LOWER(c.topic) = LOWER(?)"
            params.append(topic.strip())

        if min_importance is not None and min_importance > 1:
            query += " AND c.importance >= ?"
            params.append(min_importance)

        if q and q.strip():
            search_term = f"%{q.strip().lower()}%"
            query += " AND (LOWER(c.name) LIKE ? OR LOWER(c.definition) LIKE ? OR LOWER(c.source_excerpt) LIKE ?)"
            params.extend([search_term, search_term, search_term])

        query += " ORDER BY c.importance DESC, c.score DESC, c.name ASC"

        cursor = conn.execute(query, params)
        concepts = [dict(row) for row in cursor.fetchall()]

        if concepts:
            concept_ids = [c["id"] for c in concepts]
            placeholders = ",".join("?" for _ in concept_ids)
            rel_cursor = conn.execute(f"""
                SELECT concept_id, related_name, weight, relation_type, label
                FROM relations
                WHERE concept_id IN ({placeholders})
                ORDER BY weight DESC
            """, concept_ids)
            
            relations_by_id: Dict[int, List[Dict[str, Any]]] = {}
            for row in rel_cursor.fetchall():
                c_id = row["concept_id"]
                relations_by_id.setdefault(c_id, []).append({
                    "name": row["related_name"],
                    "weight": row["weight"],
                    "type": row["relation_type"],
                    "label": row["label"],
                })

            for c in concepts:
                c["related_concepts"] = relations_by_id.get(c["id"], [])
        
        return concepts
    finally:
        conn.close()

def get_distinct_topics(doc_id: str) -> List[str]:
    conn = get_connection()
    try:
        cursor = conn.execute("""
            SELECT DISTINCT topic 
            FROM concepts 
            WHERE document_id = ? AND topic IS NOT NULL AND topic != ''
            ORDER BY topic ASC
        """, (doc_id,))
        return [row["topic"] for row in cursor.fetchall()]
    finally:
        conn.close()
