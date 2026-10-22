import os
import sqlite3
import json
import re
import logging
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set
from pathlib import Path
from contextvars import ContextVar
from dotenv import load_dotenv

logger = logging.getLogger("conceptlens.db")

def get_upload_dir() -> Path:
    """Returns the absolute uploads directory."""
    up = Path(os.getenv("UPLOAD_DIR", "uploads"))
    if not up.is_absolute():
        up = Path(__file__).resolve().parent / up
    up.mkdir(parents=True, exist_ok=True)
    return up


# Thread-safe & request-scoped query counter for performance metrics
query_counter_var: ContextVar[int] = ContextVar("query_counter_var", default=-1)

def get_query_count() -> int:
    """Returns the number of SQL queries executed in the current request context."""
    return query_counter_var.get()

def reset_query_counter() -> None:
    """Resets the SQL query counter to 0 for the current request."""
    query_counter_var.set(0)

def increment_query_counter() -> None:
    """Increments the SQL query counter if tracking is active (>= 0)."""
    val = query_counter_var.get()
    if val >= 0:
        query_counter_var.set(val + 1)


# Load environment configuration
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir / ".env")
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


from sqlalchemy import create_engine, text, event
from sqlalchemy.orm import sessionmaker, Session

def get_database_url() -> str:
    """
    Retrieves and normalizes the database URL strictly from the DATABASE_URL environment variable.
    If unset or empty, falls back to local SQLite.
    Never logs or hardcodes credentials.
    """
    raw_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        db_file = get_db_path()
        db_file.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{db_file}"

    # Normalise postgres:// to postgresql://
    if raw_url.startswith("postgres://"):
        raw_url = "postgresql://" + raw_url[len("postgres://"):]

    # Ensure sslmode=require for Neon Postgres
    if "sslmode=" not in raw_url:
        sep = "&" if "?" in raw_url else "?"
        raw_url = f"{raw_url}{sep}sslmode=require"

    return raw_url

def is_postgres() -> bool:
    """Checks if the configured database is PostgreSQL."""
    url = get_database_url()
    return url.startswith("postgresql://") or url.startswith("postgres://")

def get_db_path() -> Path:
    p = Path(DB_PATH)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent / p
    return p

def create_app_engine():
    """
    Creates and returns the shared SQLAlchemy engine with Neon-optimised connection pooling.
    For Postgres:
      - pool_pre_ping=True (drops broken connections before checkout)
      - pool_recycle=280 (refreshes before Neon's 5-minute compute suspension)
      - pool_size=5, max_overflow=2
      - connect_timeout=10
    For SQLite:
      - check_same_thread=False, timeout=30.0
      - WAL mode & foreign keys enabled
    """
    db_url = get_database_url()
    if is_postgres():
        eng = create_engine(
            db_url,
            pool_pre_ping=True,
            pool_recycle=280,
            pool_size=5,
            max_overflow=2,
            connect_args={"connect_timeout": 10, "prepare_threshold": None}
        )
    else:
        eng = create_engine(
            db_url,
            connect_args={"check_same_thread": False, "timeout": 30.0}
        )

        @event.listens_for(eng, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys = ON;")
            cursor.execute("PRAGMA journal_mode = WAL;")
            cursor.execute("PRAGMA synchronous = NORMAL;")
            cursor.execute("PRAGMA temp_store = MEMORY;")
            cursor.close()

    return eng

# Shared singleton SQLAlchemy engine and SessionLocal
engine = create_app_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@event.listens_for(engine, "before_cursor_execute")
def _receive_before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    increment_query_counter()


class RowAdapter(dict):
    """A dictionary-like row adapter supporting dict, attribute, and index-based access."""
    def __init__(self, mapping: dict, tuple_vals: tuple):
        super().__init__(mapping)
        self._tuple_vals = tuple_vals

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._tuple_vals[key]
        return super().__getitem__(key)

    def get(self, key, default=None):
        if isinstance(key, int):
            try:
                return self._tuple_vals[key]
            except IndexError:
                return default
        return super().get(key, default)

class DBCursorAdapter:
    def __init__(self, cursor, lastrowid=None):
        self._cursor = cursor
        self.lastrowid = lastrowid

    @property
    def rowcount(self):
        return getattr(self._cursor, "rowcount", -1)

    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        if hasattr(row, "_mapping"):
            return RowAdapter(dict(row._mapping), tuple(row))
        desc = getattr(self._cursor, "description", None)
        if desc:
            col_names = [d[0] for d in desc]
            return RowAdapter(dict(zip(col_names, row)), tuple(row))
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        if not rows:
            return []
        desc = getattr(self._cursor, "description", None)
        if desc:
            col_names = [d[0] for d in desc]
            return [RowAdapter(dict(zip(col_names, r)), tuple(r)) for r in rows]
        return rows

    def fetchmany(self, size=None):
        rows = self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany()
        if not rows:
            return []
        desc = getattr(self._cursor, "description", None)
        if desc:
            col_names = [d[0] for d in desc]
            return [RowAdapter(dict(zip(col_names, r)), tuple(r)) for r in rows]
        return rows

    def close(self):
        try:
            self._cursor.close()
        except Exception:
            pass

class DBConnectionAdapter:
    """
    Transparent connection adapter providing a uniform interface for SQLite and Postgres.
    Translates '?' parameter placeholders to '%s', supports lastrowid, handles transactions,
    and returns pooled connections back to the SQLAlchemy pool on close().
    """
    def __init__(self, raw_conn, is_pg: bool = False):
        self._conn = raw_conn
        self._is_pg = is_pg
        self._active_cursor = None

    def cursor(self):
        return self._conn.cursor()

    @property
    def row_factory(self):
        return getattr(self._conn, "row_factory", None)

    @row_factory.setter
    def row_factory(self, val):
        if hasattr(self._conn, "row_factory"):
            self._conn.row_factory = val

    def execute(self, sql: str, params: Optional[Any] = None):
        increment_query_counter()
        cursor = self._conn.cursor()
        self._active_cursor = cursor
        lastrowid = None
        if self._is_pg:
            translated_sql = self._translate_sql(sql)
            # Detect autoincrement primary-key tables where lastrowid is required
            is_auto_insert = bool(re.search(r"^\s*INSERT\s+INTO\s+(concepts|relations|topics|topic_relations|chapter_progress)\b", sql, re.IGNORECASE))
            if is_auto_insert and "RETURNING" not in translated_sql.upper():
                translated_sql = translated_sql.strip().rstrip(";") + " RETURNING id"
                if params:
                    cursor.execute(translated_sql, tuple(params))
                else:
                    cursor.execute(translated_sql)
                try:
                    ret_row = cursor.fetchone()
                    if ret_row:
                        lastrowid = ret_row[0]
                except Exception:
                    pass
                return DBCursorAdapter(cursor, lastrowid=lastrowid)
            else:
                if params:
                    cursor.execute(translated_sql, tuple(params))
                else:
                    cursor.execute(translated_sql)
                return DBCursorAdapter(cursor, lastrowid=getattr(cursor, "lastrowid", None))
        else:
            if params:
                cursor.execute(sql, tuple(params))
            else:
                cursor.execute(sql)
            return cursor

    def executemany(self, sql: str, seq_of_params: Any):
        increment_query_counter()
        cursor = self._conn.cursor()
        self._active_cursor = cursor
        if self._is_pg:
            translated_sql = self._translate_sql(sql)
            cursor.executemany(translated_sql, seq_of_params)
            return DBCursorAdapter(cursor)
        else:
            cursor.executemany(sql, seq_of_params)
            return cursor

    def executescript(self, script: str):
        increment_query_counter()
        if self._is_pg:
            cursor = self._conn.cursor()
            for stmt in script.strip().split(";"):
                stmt = stmt.strip()
                if stmt:
                    cursor.execute(stmt)
            return DBCursorAdapter(cursor)
        else:
            return self._conn.executescript(script)


    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        try:
            if self._active_cursor:
                self._active_cursor.close()
        except Exception:
            pass
        if self._is_pg:
            try:
                self._conn.rollback()
            except Exception:
                pass
        try:
            self._conn.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self.rollback()
        else:
            self.commit()

    @staticmethod
    def _translate_sql(sql: str) -> str:
        # 1. Translate SQLite 'INSERT OR REPLACE INTO table (cols) VALUES (vals)' to Postgres ON CONFLICT (id) DO UPDATE
        pattern = r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*?)\)"
        m = re.match(pattern, sql, re.IGNORECASE | re.DOTALL)
        if m:
            table = m.group(1)
            cols = [c.strip() for c in m.group(2).split(",")]
            vals = m.group(3)
            update_cols = [c for c in cols if c.lower() != "id"]
            if update_cols:
                set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
                sql = f"INSERT INTO {table} ({m.group(2)}) VALUES ({vals}) ON CONFLICT (id) DO UPDATE SET {set_clause}"
            else:
                sql = f"INSERT INTO {table} ({m.group(2)}) VALUES ({vals}) ON CONFLICT (id) DO NOTHING"

        # 2. Translate SQLite 'INSERT OR IGNORE INTO table (cols) VALUES (vals)' to Postgres ON CONFLICT DO NOTHING
        ignore_pattern = r"^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\((.*?)\)\s*VALUES\s*\((.*?)\)"
        m_ignore = re.match(ignore_pattern, sql, re.IGNORECASE | re.DOTALL)
        if m_ignore:
            table = m_ignore.group(1)
            cols = m_ignore.group(2)
            vals = m_ignore.group(3)
            sql = f"INSERT INTO {table} ({cols}) VALUES ({vals}) ON CONFLICT DO NOTHING"

        # 3. Replace '?' with '%s' outside string literals
        in_quote = False
        quote_char = ''
        out = []
        for ch in sql:
            if ch in ("'", '"'):
                if not in_quote:
                    in_quote = True
                    quote_char = ch
                elif ch == quote_char:
                    in_quote = False
                out.append(ch)
            elif ch == '?' and not in_quote:
                out.append('%s')
            else:
                out.append(ch)
        return "".join(out)

def get_connection():
    """
    Returns a pooled database connection (DBConnectionAdapter for Postgres, sqlite3.Connection for SQLite).
    Always release the connection via conn.close() in a finally block.
    """
    if is_postgres():
        raw_conn = engine.raw_connection()
        return DBConnectionAdapter(raw_conn, is_pg=True)
    else:
        db_file = get_db_path()
        db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_file), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA temp_store = MEMORY;")
        return DBConnectionAdapter(conn, is_pg=False)


def init_db() -> None:
    """Initializes the database schema and performs safe, non-destructive startup migrations."""
    if is_postgres():
        # Postgres DDL
        logger.info("init_db: connecting to Postgres...")
        conn = get_connection()
        logger.info("init_db: connected. Checking lock...")
        lock_acquired = False
        try:
            try:
                lock_res = conn.execute("SELECT pg_try_advisory_lock(7429103);").fetchone()
                lock_acquired = bool(lock_res and (lock_res[0] is True or lock_res[0] == 1))
                logger.info(f"init_db: advisory lock status: {lock_acquired}")
            except Exception as e_lock:
                logger.warning(f"Advisory lock warning (non-fatal): {e_lock}")

            logger.info("init_db: executing schema DDL...")
            with conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS users (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL,
                        display_name TEXT NOT NULL,
                        name TEXT,
                        email TEXT,
                        password_hash TEXT,
                        google_sub TEXT,
                        avatar TEXT,
                        avatar_url TEXT,
                        role TEXT DEFAULT 'student',
                        created_at TEXT NOT NULL,
                        last_login_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email)) WHERE email IS NOT NULL;")
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS documents (
                        id TEXT PRIMARY KEY,
                        user_id TEXT,
                        subject_id TEXT,
                        filename TEXT NOT NULL,
                        file_type TEXT NOT NULL,
                        status TEXT NOT NULL,
                        stage TEXT DEFAULT 'pending',
                        error TEXT,
                        page_count INTEGER DEFAULT 1,
                        raw_text TEXT,
                        tree_json TEXT,
                        flow_json TEXT,
                        result_json TEXT,
                        processing_time_sec REAL DEFAULT 0.0,
                        provider_used TEXT DEFAULT 'on-device',
                        skipped_pages TEXT DEFAULT '[]',
                        progress INTEGER DEFAULT 0,
                        stage_message TEXT DEFAULT '',
                        ocr_current_page INTEGER DEFAULT 0,
                        ocr_total_pages INTEGER DEFAULT 0,
                        file_hash TEXT,
                        concept_count INTEGER DEFAULT 0,
                        chapter_count INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_subject_id ON documents(subject_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_subject ON documents(user_id, subject_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS concepts (
                        id SERIAL PRIMARY KEY,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        definition TEXT DEFAULT '',
                        topic TEXT DEFAULT 'General',
                        score REAL NOT NULL,
                        importance INTEGER NOT NULL,
                        source_excerpt TEXT NOT NULL,
                        page INTEGER DEFAULT 1,
                        source_page INTEGER,
                        source_quote TEXT DEFAULT '',
                        source_verified BOOLEAN DEFAULT FALSE,
                        flow_order INTEGER NOT NULL DEFAULT 0,
                        flow_group TEXT NOT NULL DEFAULT 'General'
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concepts_document_id ON concepts(document_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concepts_importance ON concepts(importance);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concepts_doc_flow ON concepts(document_id, flow_order);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS relations (
                        id SERIAL PRIMARY KEY,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
                        related_name TEXT NOT NULL,
                        weight INTEGER NOT NULL,
                        relation_type TEXT NOT NULL DEFAULT 'related',
                        label TEXT NOT NULL DEFAULT ''
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_relations_document_id ON relations(document_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_relations_concept_id ON relations(concept_id);")
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS concept_progress (
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        concept_id TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('studied', 'not_started')),
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, concept_id)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_progress_user ON concept_progress(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_progress_concept ON concept_progress(concept_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS document_files (
                        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT NOT NULL,
                        provider TEXT NOT NULL DEFAULT 'browser',
                        storage_key TEXT,
                        size INTEGER NOT NULL DEFAULT 0,
                        mime TEXT NOT NULL DEFAULT 'application/pdf',
                        sha256 TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_document_files_user ON document_files(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_document_files_sha ON document_files(sha256);")

                # Safe non-destructive column additions
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS subject_id TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS tree_json TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS flow_json TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_time_sec REAL DEFAULT 0.0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS provider_used TEXT DEFAULT 'on-device';")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS skipped_pages TEXT DEFAULT '[]';")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS progress INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS stage_message TEXT DEFAULT '';")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_current_page INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS ocr_total_pages INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_hash TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS result_json TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS concept_count INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS chapter_count INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS idempotency_key TEXT;")
                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA;")
                conn.execute("ALTER TABLE document_files ADD COLUMN IF NOT EXISTS file_data BYTEA;")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_idempotency_key ON documents(user_id, idempotency_key);")

                conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 3;")

                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS flow_order INTEGER NOT NULL DEFAULT 0;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS flow_group TEXT NOT NULL DEFAULT 'General';")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS chapter TEXT DEFAULT 'General';")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS schema_version INTEGER DEFAULT 3;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS stage_index INTEGER DEFAULT 0;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS chapter_order INTEGER DEFAULT 1;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER DEFAULT 10;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_page INTEGER;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_quote TEXT DEFAULT '';")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_verified BOOLEAN DEFAULT FALSE;")
                conn.execute("ALTER TABLE concepts ADD COLUMN IF NOT EXISTS pages_json TEXT DEFAULT '[]';")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS page_coverage (
                        id SERIAL PRIMARY KEY,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT,
                        page INTEGER NOT NULL,
                        page_type TEXT NOT NULL,
                        text_chars INTEGER NOT NULL DEFAULT 0,
                        text_hash TEXT DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'done',
                        concepts_count INTEGER NOT NULL DEFAULT 0,
                        no_concepts_reason TEXT,
                        error TEXT,
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_page_coverage_doc_page ON page_coverage(document_id, page);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_page_coverage_doc_status ON page_coverage(document_id, status);")

                conn.execute("ALTER TABLE relations ADD COLUMN IF NOT EXISTS relation_type TEXT NOT NULL DEFAULT 'related';")
                conn.execute("ALTER TABLE relations ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';")
                conn.execute("ALTER TABLE relations ADD COLUMN IF NOT EXISTS target_id TEXT DEFAULT '';")

                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;")
                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;")
                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student';")
                conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 1;")
            logger.info("init_db: finished Postgres DDL successfully!")
        finally:
            if lock_acquired:
                try:
                    conn.execute("SELECT pg_advisory_unlock(7429103);")
                except Exception:
                    pass
            conn.close()

    else:
        # SQLite DDL
        conn = get_connection()
        try:
            with conn:
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
                        flow_group TEXT NOT NULL DEFAULT 'General',
                        source_page INTEGER,
                        source_quote TEXT DEFAULT '',
                        source_verified BOOLEAN DEFAULT 0
                    );

                    CREATE TABLE IF NOT EXISTS document_files (
                        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT NOT NULL,
                        provider TEXT NOT NULL DEFAULT 'browser',
                        storage_key TEXT,
                        size INTEGER NOT NULL DEFAULT 0,
                        mime TEXT NOT NULL DEFAULT 'application/pdf',
                        sha256 TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_document_files_user ON document_files(user_id);
                    CREATE INDEX IF NOT EXISTS idx_document_files_sha ON document_files(sha256);

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

                    CREATE TABLE IF NOT EXISTS concept_progress (
                        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        concept_id TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('studied', 'not_started')),
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (user_id, concept_id)
                    );
                    CREATE INDEX IF NOT EXISTS idx_concept_progress_user ON concept_progress(user_id);
                    CREATE INDEX IF NOT EXISTS idx_concept_progress_concept ON concept_progress(concept_id);
                """)

                cursor = conn.execute("PRAGMA table_info(documents);")
                columns = [row["name"] for row in cursor.fetchall()]
                if "user_id" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN user_id TEXT;")
                if "subject_id" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN subject_id TEXT;")
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
                if "label" not in relation_columns:
                    conn.execute("ALTER TABLE relations ADD COLUMN label TEXT NOT NULL DEFAULT '';")
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
                if "result_json" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN result_json TEXT;")
                if "concept_count" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN concept_count INTEGER DEFAULT 0;")
                if "chapter_count" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN chapter_count INTEGER DEFAULT 0;")
                if "idempotency_key" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN idempotency_key TEXT;")
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_idempotency_key ON documents(user_id, idempotency_key);")
                if "file_data" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN file_data BLOB;")
                doc_file_cols = [row["name"] for row in conn.execute("PRAGMA table_info(document_files)").fetchall()]
                if "file_data" not in doc_file_cols:
                    conn.execute("ALTER TABLE document_files ADD COLUMN file_data BLOB;")
                if "schema_version" not in columns:
                    conn.execute("ALTER TABLE documents ADD COLUMN schema_version INTEGER DEFAULT 2;")
                if "chapter" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN chapter TEXT DEFAULT 'General';")
                if "schema_version" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN schema_version INTEGER DEFAULT 2;")
                if "stage_index" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN stage_index INTEGER DEFAULT 0;")
                if "chapter_order" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN chapter_order INTEGER DEFAULT 1;")
                if "estimated_minutes" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN estimated_minutes INTEGER DEFAULT 10;")
                if "source_page" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN source_page INTEGER;")
                if "source_quote" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN source_quote TEXT DEFAULT '';")
                if "source_verified" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN source_verified BOOLEAN DEFAULT 0;")
                if "pages_json" not in concept_columns:
                    conn.execute("ALTER TABLE concepts ADD COLUMN pages_json TEXT DEFAULT '[]';")
                if "target_id" not in relation_columns:
                    conn.execute("ALTER TABLE relations ADD COLUMN target_id TEXT DEFAULT '';")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS page_coverage (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT,
                        page INTEGER NOT NULL,
                        page_type TEXT NOT NULL,
                        text_chars INTEGER NOT NULL DEFAULT 0,
                        text_hash TEXT DEFAULT '',
                        status TEXT NOT NULL DEFAULT 'done',
                        concepts_count INTEGER NOT NULL DEFAULT 0,
                        no_concepts_reason TEXT,
                        error TEXT,
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_page_coverage_doc_page ON page_coverage(document_id, page);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_page_coverage_doc_status ON page_coverage(document_id, status);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_subject_id ON documents(subject_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_user_subject ON documents(user_id, subject_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concepts_doc_flow ON concepts(document_id, flow_order);")

                u_info = list(conn.execute("PRAGMA table_info(users);"))
                u_cols = {row["name"] for row in u_info}
                if "name" not in u_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN name TEXT;")
                    conn.execute("UPDATE users SET name = COALESCE(display_name, username) WHERE name IS NULL;")
                if "avatar" not in u_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT;")
                    conn.execute("UPDATE users SET avatar = avatar_url WHERE avatar IS NULL;")
                if "role" not in u_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN role TEXT;")
                if "token_version" not in u_cols:
                    conn.execute("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1;")
        finally:
            conn.close()

    # Re-clean topics and normalize concept names for existing concepts
    try:
        conn = get_connection()
        try:
            with conn:
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
        finally:
            conn.close()
    except Exception:
        pass

    # Initialize study planner schema & migrations
    try:
        try:
            from backend.services.planner_db import init_planner_db
        except ImportError:
            from services.planner_db import init_planner_db
        init_planner_db()
    except Exception:
        pass

    # Initialize personal notes schema & migrations
    try:
        try:
            from backend.services.notes_db import init_notes_db
        except ImportError:
            from services.notes_db import init_notes_db
        init_notes_db()
    except Exception:
        pass

    # Initialize graph & RAG schema & migrations
    try:
        try:
            from backend.services.graph_service import init_graph_db
        except ImportError:
            from services.graph_service import init_graph_db
        init_graph_db()
    except Exception as e_gdb:
        logger.warning(f"Graph DB initialization warning: {e_gdb}")

    # Apply safe structural unique constraints (skips and logs warnings if duplicates exist)
    try:
        conn = get_connection()
        try:
            with conn:
                apply_safe_unique_constraints(conn)
                _backfill_files_into_database(conn)
                _sanitize_and_sync_all_document_concepts(conn)
        finally:
            conn.close()
    except Exception as e_uq:
        logger.warning(f"Safe unique constraints and data sync warning: {e_uq}")


def apply_safe_unique_constraints(conn) -> Dict[str, Any]:
    """
    Safely adds unique constraints or unique indexes:
      - documents (user_id, file_hash)
      - chapters (book_id, order_index) and (book_id, LOWER(TRIM(name)))
      - concepts (document_id, LOWER(TRIM(name)))
      - relations (concept_id, LOWER(TRIM(related_name)), relation_type)
      - topics (chapter_id, LOWER(TRIM(name))) and (chapter_id, order_index)

    Strict Migration Rule:
    A migration may add a constraint only after existing duplicates in that table have been removed.
    If duplicates exist, the migration skips creating that constraint, logs a clear warning
    (table name and count, no content), and does not crash.
    """
    applied = []
    skipped = []

    # 1. documents (user_id, file_hash)
    try:
        dup_docs = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT user_id, file_hash FROM documents
                WHERE file_hash IS NOT NULL AND file_hash != ''
                GROUP BY user_id, file_hash HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        if dup_docs > 0:
            logger.warning(f"Skipping UNIQUE constraint on documents(user_id, file_hash): {dup_docs} duplicate groups exist. Run scripts/dedupe_data.py to resolve.")
            skipped.append(("documents", dup_docs))
        else:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_documents_user_file_hash ON documents(user_id, file_hash) WHERE file_hash IS NOT NULL AND file_hash != '';")
            conn.commit()
            applied.append("documents(user_id, file_hash)")
    except Exception as e:
        logger.warning(f"Could not apply unique constraint on documents: {e}")

    # 2. chapters (book_id, name) & (book_id, order_index)
    try:
        dup_chs = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT book_id, LOWER(TRIM(name)) FROM chapters
                GROUP BY book_id, LOWER(TRIM(name)) HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        dup_ch_order = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT book_id, order_index FROM chapters
                GROUP BY book_id, order_index HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        if dup_chs > 0 or dup_ch_order > 0:
            logger.warning(f"Skipping UNIQUE constraint on chapters: {max(dup_chs, dup_ch_order)} duplicate groups exist. Run scripts/dedupe_data.py to resolve.")
            skipped.append(("chapters", max(dup_chs, dup_ch_order)))
        else:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_chapters_book_name_norm ON chapters(book_id, LOWER(TRIM(name)));")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_chapters_book_order ON chapters(book_id, order_index);")
            conn.commit()
            applied.append("chapters(book_id, name/order)")
    except Exception as e:
        logger.warning(f"Could not apply unique constraint on chapters: {e}")

    # 3. concepts (document_id, LOWER(TRIM(name)))
    try:
        dup_cons = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT document_id, LOWER(TRIM(name)) FROM concepts
                GROUP BY document_id, LOWER(TRIM(name)) HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        if dup_cons > 0:
            logger.warning(f"Skipping UNIQUE constraint on concepts(document_id, name): {dup_cons} duplicate groups exist. Run scripts/dedupe_data.py to resolve.")
            skipped.append(("concepts", dup_cons))
        else:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_concepts_doc_name_norm ON concepts(document_id, LOWER(TRIM(name)));")
            conn.commit()
            applied.append("concepts(document_id, name)")
    except Exception as e:
        logger.warning(f"Could not apply unique constraint on concepts: {e}")

    # 4. relations (concept_id, LOWER(TRIM(related_name)), relation_type)
    try:
        dup_rels = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT concept_id, LOWER(TRIM(related_name)), relation_type FROM relations
                GROUP BY concept_id, LOWER(TRIM(related_name)), relation_type HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        if dup_rels > 0:
            logger.warning(f"Skipping UNIQUE constraint on relations(concept_id, related_name, type): {dup_rels} duplicate groups exist. Run scripts/dedupe_data.py to resolve.")
            skipped.append(("relations", dup_rels))
        else:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_relations_concept_rel_type ON relations(concept_id, LOWER(TRIM(related_name)), relation_type);")
            conn.commit()
            applied.append("relations(concept_id, related_name, type)")
    except Exception as e:
        logger.warning(f"Could not apply unique constraint on relations: {e}")

    # 5. topics (chapter_id, LOWER(TRIM(name))) & (chapter_id, order_index)
    try:
        dup_tops = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT chapter_id, LOWER(TRIM(name)) FROM topics
                GROUP BY chapter_id, LOWER(TRIM(name)) HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        dup_top_order = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT chapter_id, order_index FROM topics
                GROUP BY chapter_id, order_index HAVING COUNT(*) > 1
            ) sub
        """).fetchone()[0]
        if dup_tops > 0 or dup_top_order > 0:
            logger.warning(f"Skipping UNIQUE constraint on topics: {max(dup_tops, dup_top_order)} duplicate groups exist. Run scripts/dedupe_data.py to resolve.")
            skipped.append(("topics", max(dup_tops, dup_top_order)))
        else:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_chapter_name_norm ON topics(chapter_id, LOWER(TRIM(name)));")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_chapter_order ON topics(chapter_id, order_index);")
            conn.commit()
            applied.append("topics(chapter_id, name/order)")
    except Exception as e:
        logger.warning(f"Could not apply unique constraint on topics: {e}")

    return {"applied": applied, "skipped": skipped}


EXPECTED_TABLE_COLUMNS: Dict[str, List[str]] = {
    "users": ["id", "username", "display_name", "created_at", "last_login_at"],
    "documents": ["id", "filename", "file_type", "status", "created_at"],
    "concepts": ["id", "document_id", "name", "score", "importance", "source_excerpt"],
    "relations": ["id", "document_id", "concept_id", "related_name", "weight"],
    "concept_progress": ["user_id", "concept_id", "status", "updated_at"],
    "subjects": ["id", "user_id", "name", "created_at"],
    "chapters": ["id", "book_id", "name", "order_index", "concept_count", "difficulty", "est_hours", "created_at"],
    "topics": ["id", "chapter_id", "order_index", "name"],
    "topic_relations": ["id", "from_topic_id", "to_topic_id", "type"],
    "chapter_progress": ["id", "user_id", "chapter_id", "status", "updated_at"],
    "study_plans": ["id", "user_id", "subject_id", "days", "order_mode", "start_date", "route_json", "done_days", "created_at", "updated_at"],
    "reminders": ["id", "user_id", "time", "weekdays", "label", "enabled", "created_at"],
    "notes": ["id", "user_id", "title", "content", "created_at", "updated_at"],
}

def check_database_schema_health() -> Dict[str, Any]:
    """
    Checks database health: executes 'SELECT 1', then verifies that every expected table and column exists.
    Returns {"status": "ok"} or {"status": "error", "missing": [names only]}.
    Never exposes connection strings, passwords, or internal error tracebacks.
    """
    try:
        conn = get_connection()
        try:
            # 1. Verify connectivity with SELECT 1
            conn.execute("SELECT 1")

            missing: List[str] = []

            if is_postgres():
                # Query Postgres information_schema for existing tables and columns
                rows = conn.execute(
                    """
                    SELECT table_name, column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    """
                ).fetchall()
                existing_schema: Dict[str, Set[str]] = {}
                for r in rows:
                    t_name = str(r["table_name"]).lower()
                    c_name = str(r["column_name"]).lower()
                    existing_schema.setdefault(t_name, set()).add(c_name)

                for table, cols in EXPECTED_TABLE_COLUMNS.items():
                    if table.lower() not in existing_schema:
                        missing.append(table)
                    else:
                        table_cols = existing_schema[table.lower()]
                        for col in cols:
                            if col.lower() not in table_cols:
                                missing.append(f"{table}.{col}")
            else:
                # Query SQLite sqlite_master and PRAGMA table_info
                t_rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                existing_tables = {str(r["name"]).lower() for r in t_rows}
                for table, cols in EXPECTED_TABLE_COLUMNS.items():
                    if table.lower() not in existing_tables:
                        missing.append(table)
                    else:
                        c_rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
                        table_cols = {str(r["name"]).lower() for r in c_rows}
                        for col in cols:
                            if col.lower() not in table_cols:
                                missing.append(f"{table}.{col}")

            if missing:
                return {"status": "error", "missing": missing}
            return {"status": "ok"}
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Health check connectivity failure: {type(e).__name__}")
        return {"status": "error", "missing": ["database_unreachable"]}



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
    clean_email = email.strip().lower() if email else None
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO users (id, username, display_name, name, email, password_hash, google_sub, avatar, avatar_url, role, created_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, username.strip().lower(), clean_name, clean_name, clean_email, password_hash, google_sub, clean_avatar, clean_avatar, role, now_iso, now_iso)
            )
        return {
            "id": user_id,
            "username": username.strip().lower(),
            "display_name": clean_name,
            "name": clean_name,
            "email": clean_email,
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

def find_completed_document_by_hash(file_hash: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Finds an existing completed document with identical SHA-256 hash strictly belonging to user_id."""
    if not file_hash:
        return None
    conn = get_connection()
    try:
        if user_id:
            cursor = conn.execute(
                """
                SELECT id, filename, page_count, raw_text, tree_json, flow_json, provider_used
                FROM documents
                WHERE file_hash = ? AND status = 'completed' AND user_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (file_hash, user_id)
            )
        else:
            cursor = conn.execute(
                """
                SELECT id, filename, page_count, raw_text, tree_json, flow_json, provider_used
                FROM documents
                WHERE file_hash = ? AND status = 'completed' AND user_id IS NULL
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

def find_document_by_hash(file_hash: str, user_id: str, include_failed: bool = False) -> Optional[Dict[str, Any]]:
    """Finds an existing document with matching SHA-256 hash strictly belonging to user_id."""
    if not file_hash or not user_id:
        return None
    conn = get_connection()
    try:
        query = "SELECT * FROM documents WHERE file_hash = ? AND user_id = ?"
        if not include_failed:
            query += " AND status != 'failed'"
        query += " ORDER BY created_at DESC LIMIT 1"
        cursor = conn.execute(query, (file_hash, user_id))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def find_document_by_idempotency_key(idempotency_key: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Finds an existing document with matching idempotency key strictly belonging to user_id."""
    if not idempotency_key or not user_id:
        return None
    conn = get_connection()
    try:
        cursor = conn.execute(
            "SELECT * FROM documents WHERE idempotency_key = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1",
            (idempotency_key, user_id)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def create_document(
    user_id: str,
    doc_id: str,
    filename: str,
    file_type: str,
    status: str = "processing",
    stage: str = "reading",
    file_hash: Optional[str] = None,
    subject_id: Optional[str] = None,
    idempotency_key: Optional[str] = None
) -> Dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO documents (
                        id, user_id, subject_id, filename, file_type, status, stage, page_count, raw_text,
                        progress, stage_message, ocr_current_page, ocr_total_pages, file_hash, idempotency_key, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, '', 5, 'Initializing document analysis...', 0, 0, ?, ?, ?)
                    """,
                    (doc_id, user_id, subject_id, filename, file_type, status, stage, file_hash, idempotency_key, created_at)
                )
            return {
                "id": doc_id,
                "user_id": user_id,
                "subject_id": subject_id,
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
                "idempotency_key": idempotency_key,
                "created_at": created_at
            }
        except Exception as exc:
            # Handle conflict from concurrent uploads with same (user_id, file_hash) or idempotency_key
            if file_hash:
                cursor = conn.execute(
                    "SELECT * FROM documents WHERE user_id = ? AND file_hash = ? ORDER BY created_at DESC LIMIT 1",
                    (user_id, file_hash)
                )
                existing = cursor.fetchone()
                if existing:
                    return dict(existing)
            if idempotency_key:
                cursor = conn.execute(
                    "SELECT * FROM documents WHERE user_id = ? AND idempotency_key = ? ORDER BY created_at DESC LIMIT 1",
                    (user_id, idempotency_key)
                )
                existing = cursor.fetchone()
                if existing:
                    return dict(existing)
            raise exc
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
                COUNT(DISTINCT c.id) AS concept_count
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
                d.file_hash,
                d.user_id,
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

def get_document_by_id_guest_fallback(doc_id: str) -> Optional[Dict[str, Any]]:
    """Returns document by id if and only if the document belongs to a guest user (starts with 'guest_')."""
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
                d.file_hash,
                d.user_id,
                d.created_at,
                COUNT(c.id) AS concept_count
            FROM documents d
            LEFT JOIN concepts c ON d.id = c.document_id
            WHERE d.id = ? AND d.user_id LIKE 'guest_%'
            GROUP BY d.id
        """, (doc_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def check_table_exists(conn, table_name: str) -> bool:
    """Safely checks if a table exists in SQLite or PostgreSQL without aborting transactions."""
    try:
        if is_postgres():
            row = conn.execute("SELECT to_regclass(?)", (f"public.{table_name}",)).fetchone()
            return bool(row and row[0])
        else:
            row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", (table_name,)).fetchone()
            return row is not None
    except Exception:
        return False

def delete_document_by_id(user_id: str, doc_id: str) -> bool:
    """Deletes document completely from the database, along with all chapters, topics, progress, relations, files, and cache."""
    conn = get_connection()
    try:
        with conn:
            # 1. Verify document exists and belongs to user (or unassigned/guest)
            doc = conn.execute(
                "SELECT id, subject_id, filename, user_id FROM documents WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
                (doc_id, user_id)
            ).fetchone()
            if not doc:
                doc = conn.execute("SELECT id, subject_id, filename, user_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
                if not doc or (doc["user_id"] and doc["user_id"] != user_id):
                    return False

            effective_user_id = doc["user_id"] or user_id
            subject_id = doc["subject_id"]

            # 2. Get chapter IDs for this document
            ch_ids = []
            if check_table_exists(conn, "chapters"):
                ch_rows = conn.execute("SELECT id FROM chapters WHERE book_id = ?", (doc_id,)).fetchall()
                ch_ids = [r["id"] for r in ch_rows]

                if ch_ids:
                    # Get topic IDs for these chapters
                    if check_table_exists(conn, "topics"):
                        t_rows = conn.execute(
                            "SELECT id FROM topics WHERE chapter_id IN ({seq})".format(seq=",".join("?" * len(ch_ids))),
                            ch_ids
                        ).fetchall()
                        t_ids = [r["id"] for r in t_rows]

                        if t_ids:
                            if check_table_exists(conn, "topic_relations"):
                                conn.execute(
                                    "DELETE FROM topic_relations WHERE from_topic_id IN ({seq}) OR to_topic_id IN ({seq})".format(seq=",".join("?" * len(t_ids))),
                                    t_ids + t_ids
                                )
                            conn.execute(
                                "DELETE FROM topics WHERE id IN ({seq})".format(seq=",".join("?" * len(t_ids))),
                                t_ids
                            )

                    if check_table_exists(conn, "chapter_progress"):
                        conn.execute(
                            "DELETE FROM chapter_progress WHERE chapter_id IN ({seq})".format(seq=",".join("?" * len(ch_ids))),
                            ch_ids
                        )
                    conn.execute("DELETE FROM chapters WHERE book_id = ?", (doc_id,))

            # 3. Delete concept progress, relations and concepts
            # Both TEXT and INT casts for cross-DB compatibility
            if check_table_exists(conn, "concept_progress") and check_table_exists(conn, "concepts"):
                conn.execute(
                    """
                    DELETE FROM concept_progress 
                    WHERE concept_id IN (SELECT CAST(id AS TEXT) FROM concepts WHERE document_id = ?)
                       OR concept_id IN (SELECT id FROM concepts WHERE document_id = ?)
                    """,
                    (doc_id, doc_id)
                )
            if check_table_exists(conn, "relations"):
                conn.execute("DELETE FROM relations WHERE document_id = ?", (doc_id,))
            if check_table_exists(conn, "concepts"):
                conn.execute("DELETE FROM concepts WHERE document_id = ?", (doc_id,))

            # 3b. Delete page_coverage, document_files, document_chunks
            if check_table_exists(conn, "page_coverage"):
                conn.execute("DELETE FROM page_coverage WHERE document_id = ?", (doc_id,))

            if check_table_exists(conn, "document_files"):
                conn.execute("DELETE FROM document_files WHERE document_id = ?", (doc_id,))

            if check_table_exists(conn, "document_chunks"):
                conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))

            # 3c. Delete QA history referencing this document
            if check_table_exists(conn, "qa_history"):
                conn.execute("DELETE FROM qa_history WHERE document_id = ?", (doc_id,))

            # 3d. Unlink personal notes from this deleted document so notes are preserved without dangling FK
            if check_table_exists(conn, "notes"):
                conn.execute("UPDATE notes SET document_id = NULL WHERE document_id = ?", (doc_id,))

            # 4. Nullify or clean up study plans
            if check_table_exists(conn, "study_plans"):
                if ch_ids:
                    conn.execute(
                        "DELETE FROM study_plans WHERE scope_chapter_id IN ({seq})".format(seq=",".join("?" * len(ch_ids))),
                        ch_ids
                    )
                # If subject has no remaining chapters, clean up any active study plan for it
                if subject_id and check_table_exists(conn, "chapters"):
                    remaining_count = conn.execute(
                        "SELECT COUNT(*) FROM chapters c JOIN documents d ON c.book_id = d.id WHERE d.subject_id = ?",
                        (subject_id,)
                    ).fetchone()[0]
                    if remaining_count == 0:
                        conn.execute("DELETE FROM study_plans WHERE subject_id = ?", (subject_id,))

            # 5. Delete associated document file (and remove from S3 if configured)
            try:
                try:
                    from backend.services.file_storage import delete_document_file
                except ImportError:
                    from services.file_storage import delete_document_file
                delete_document_file(conn, doc_id)
            except Exception as e:
                logger.warning(f"Failed to delete document file for {doc_id}: {e}")

            # 5b. Cleanup graph entities, mentions, edges, and chunks
            try:
                try:
                    from backend.services.graph_service import cleanup_document_graph
                except ImportError:
                    from services.graph_service import cleanup_document_graph
                cleanup_document_graph(doc_id, effective_user_id, conn=conn)
            except Exception as e_gc:
                logger.warning(f"Failed to cleanup document graph for {doc_id}: {e_gc}")

            # 5c. Remove physical files from local upload directory
            try:
                up_dir = get_upload_dir()
                candidate_dirs = [up_dir / effective_user_id, up_dir / user_id, up_dir]
                for c_dir in candidate_dirs:
                    if c_dir.exists():
                        for f_match in c_dir.glob(f"{doc_id}_*"):
                            try:
                                f_match.unlink(missing_ok=True)
                            except Exception:
                                pass
            except Exception as e_disk:
                logger.warning(f"Failed to remove local upload files for {doc_id}: {e_disk}")

            # 6. Delete document
            cursor = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
            if cursor.rowcount > 0:
                try:
                    try:
                        from backend.services.planner_db import invalidate_user_summary_cache
                    except ImportError:
                        from services.planner_db import invalidate_user_summary_cache
                    invalidate_user_summary_cache(effective_user_id)
                    if user_id != effective_user_id:
                        invalidate_user_summary_cache(user_id)
                except Exception:
                    pass
                return True
            return False
    finally:
        conn.close()

def rename_document_by_id(user_id: str, doc_id: str, new_filename: str) -> bool:
    """Renames document strictly matching user_id."""
    clean_title = (new_filename or "").strip()
    if not clean_title:
        return False
    conn = get_connection()
    try:
        with conn:
            cursor = conn.execute(
                "UPDATE documents SET filename = ? WHERE id = ? AND user_id = ?",
                (clean_title, doc_id, user_id)
            )
            # If chapter name was derived from old filename or default, update it as well
            stem_title = Path(clean_title).stem.replace("_", " ").title()
            conn.execute(
                "UPDATE chapters SET name = ? WHERE book_id = ? AND (order_index = 1 OR order_index = 0)",
                (stem_title, doc_id)
            )
            if cursor.rowcount > 0:
                try:
                    try:
                        from backend.services.planner_db import invalidate_user_summary_cache
                    except ImportError:
                        from services.planner_db import invalidate_user_summary_cache
                    invalidate_user_summary_cache(user_id)
                except Exception:
                    pass
                return True
            return False
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
            conn.execute("DELETE FROM relations WHERE document_id = ?", (doc_id,))
            conn.execute("DELETE FROM concepts WHERE document_id = ?", (doc_id,))
            
            # Apply deterministic normalization first so only valid concepts enter the DB
            try:
                try:
                    from backend.services.normalizer import normalize_extracted_concepts
                except ImportError:
                    from services.normalizer import normalize_extracted_concepts
                concepts_data = normalize_extracted_concepts(concepts_data)
            except Exception as e_norm:
                logger.warning(f"Normalizer before save exception for doc {doc_id}: {e_norm}")

            seen_concepts: Set[str] = set()
            deduped_concepts = []
            for c in concepts_data:
                clean_name = normalize_concept_display_name(c.get("name", ""))
                norm_key = clean_name.strip().lower()
                if not norm_key or norm_key in seen_concepts:
                    continue
                seen_concepts.add(norm_key)
                deduped_concepts.append(c)

            relation_rows = []
            seen_relations: Set[tuple] = set()
            for c in deduped_concepts:
                clean_name = normalize_concept_display_name(c["name"])
                clean_topic = clean_topic_heading(c.get("topic", "General"))
                src_page = c.get("source_page")
                if src_page is None and c.get("page") is not None and c.get("source_verified"):
                    src_page = c.get("page")
                src_quote = c.get("source_quote") or c.get("source_excerpt", "")
                src_verified = bool(c.get("source_verified", False))

                pages_list = c.get("pages") or [src_page or c.get("page", 1)]
                pages_json = json.dumps(sorted(list(set(p for p in pages_list if isinstance(p, int)))))

                cursor = conn.execute(
                    """
                    INSERT INTO concepts (
                        document_id, name, definition, topic, score, importance,
                        source_excerpt, page, flow_order, flow_group,
                        source_page, source_quote, source_verified, pages_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        clean_topic_heading(c.get("flow_group") or c.get("topic", "General")),
                        src_page,
                        src_quote,
                        src_verified,
                        pages_json
                    )
                )
                concept_id = cursor.lastrowid
                
                related = c.get("related_concepts", [])
                for rel in related:
                    rel_name = rel.get("name") if isinstance(rel, dict) else str(rel)
                    clean_rel_name = normalize_concept_display_name(rel_name)
                    rel_weight = rel.get("weight", 1) if isinstance(rel, dict) else 1
                    rel_type = rel.get("type", "related") if isinstance(rel, dict) else "related"
                    rel_label = rel.get("label", "") if isinstance(rel, dict) else ""
                    if clean_rel_name and clean_rel_name.lower() != clean_name.lower():
                        rel_key = (concept_id, clean_rel_name.strip().lower(), rel_type)
                        if rel_key not in seen_relations:
                            seen_relations.add(rel_key)
                            relation_rows.append((
                                doc_id, concept_id, clean_rel_name, int(rel_weight),
                                rel_type, rel_label
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
            conn.execute("UPDATE documents SET tree_json = NULL, flow_json = NULL, concept_count = ? WHERE id = ?", (len(deduped_concepts), doc_id))
            conn.execute("UPDATE chapters SET concept_count = ? WHERE book_id = ?", (len(deduped_concepts), doc_id))
    finally:
        conn.close()


def save_document_page_coverage(doc_id: str, coverage_records: List[Dict[str, Any]]) -> None:
    """Saves or updates per-page coverage records for a document."""
    if not coverage_records:
        return
    conn = get_connection()
    now_str = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            for rec in coverage_records:
                page = rec.get("page", 1)
                page_type = rec.get("page_type", "content")
                text_chars = rec.get("text_chars", 0)
                text_hash = rec.get("text_hash", "")
                status = rec.get("status", "done")
                concepts_count = rec.get("concepts_count", 0)
                no_concepts_reason = rec.get("no_concepts_reason")
                error = rec.get("error")
                user_id = rec.get("user_id")

                if is_postgres():
                    conn.execute("""
                        INSERT INTO page_coverage (
                            document_id, user_id, page, page_type, text_chars, text_hash,
                            status, concepts_count, no_concepts_reason, error, updated_at
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (document_id, page) DO UPDATE SET
                            page_type = EXCLUDED.page_type,
                            text_chars = EXCLUDED.text_chars,
                            text_hash = EXCLUDED.text_hash,
                            status = EXCLUDED.status,
                            concepts_count = EXCLUDED.concepts_count,
                            no_concepts_reason = EXCLUDED.no_concepts_reason,
                            error = EXCLUDED.error,
                            updated_at = EXCLUDED.updated_at
                    """, (doc_id, user_id, page, page_type, text_chars, text_hash, status, concepts_count, no_concepts_reason, error, now_str))
                else:
                    conn.execute("""
                        INSERT INTO page_coverage (
                            document_id, user_id, page, page_type, text_chars, text_hash,
                            status, concepts_count, no_concepts_reason, error, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(document_id, page) DO UPDATE SET
                            page_type = excluded.page_type,
                            text_chars = excluded.text_chars,
                            text_hash = excluded.text_hash,
                            status = excluded.status,
                            concepts_count = excluded.concepts_count,
                            no_concepts_reason = excluded.no_concepts_reason,
                            error = excluded.error,
                            updated_at = excluded.updated_at
                    """, (doc_id, user_id, page, page_type, text_chars, text_hash, status, concepts_count, no_concepts_reason, error, now_str))
    finally:
        conn.close()


def get_document_page_coverage(doc_id: str) -> List[Dict[str, Any]]:
    """Fetches all page coverage records for a document ordered by page number."""
    conn = get_connection()
    try:
        cursor = conn.execute("""
            SELECT page, page_type, text_chars, text_hash, status, concepts_count, no_concepts_reason, error, updated_at
            FROM page_coverage
            WHERE document_id = ?
            ORDER BY page ASC
        """, (doc_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_document_coverage_summary(doc_id: str) -> Dict[str, Any]:
    """Computes high-level coverage summary for the Coverage UI panel."""
    pages = get_document_page_coverage(doc_id)
    total_pages = len(pages)
    if total_pages == 0:
        return {
            "total_pages": 0,
            "processed_pages": 0,
            "pages_with_concepts": 0,
            "pages_skipped": 0,
            "pages_needing_attention": 0,
            "pages": []
        }
    pages_with_concepts = sum(1 for p in pages if p["concepts_count"] > 0)
    pages_skipped = sum(1 for p in pages if p["status"] == "empty_ok")
    pages_needing_attention = sum(1 for p in pages if p["status"] in ("low_text", "failed"))
    return {
        "total_pages": total_pages,
        "processed_pages": total_pages,
        "pages_with_concepts": pages_with_concepts,
        "pages_skipped": pages_skipped,
        "pages_needing_attention": pages_needing_attention,
        "pages": pages
    }


def get_concepts_by_document(
    doc_id: str,
    q: Optional[str] = None,
    topic: Optional[str] = None,
    min_importance: Optional[int] = None,
    conn=None
) -> List[Dict[str, Any]]:
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
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
                c.flow_group,
                c.source_page,
                c.source_quote,
                c.source_verified,
                c.pages_json
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
                if c.get("pages_json"):
                    try:
                        c["pages"] = json.loads(c["pages_json"])
                    except Exception:
                        c["pages"] = [c.get("source_page") or c.get("page", 1)]
                else:
                    c["pages"] = [c.get("source_page") or c.get("page", 1)]
        
        return concepts
    finally:
        if should_close:
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


# ==================== Concept Progress Operations ====================

def get_concept_by_id_and_user(concept_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Fetches a concept verifying document ownership by user_id. Returns None if unauthorized."""
    conn = get_connection()
    try:
        cid_str = str(concept_id)
        cursor = conn.execute(
            """
            SELECT c.*, d.user_id, d.id as doc_id
            FROM concepts c
            JOIN documents d ON c.document_id = d.id
            WHERE CAST(c.id AS TEXT) = ? AND d.user_id = ?
            """,
            (cid_str, user_id)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    except Exception as e:
        logger.warning(f"Error looking up concept {concept_id} for user {user_id}: {e}")
        return None
    finally:
        conn.close()


def verify_concept_owner(user_id: str, concept_id: str) -> bool:
    """Verifies that the concept belongs to a document owned by user_id."""
    return get_concept_by_id_and_user(concept_id, user_id) is not None


def set_concept_progress(user_id: str, concept_id: str, status: str) -> Dict[str, Any]:
    """
    Sets individual concept progress ('studied' or 'not_started').
    Scoped to authenticated user. Updates concept_progress table and syncs chapter progress.
    """
    if status not in ("studied", "not_started"):
        raise ValueError("Status must be 'studied' or 'not_started'.")

    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO concept_progress (user_id, concept_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, concept_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (user_id, str(concept_id), status, now_iso)
            )
    finally:
        conn.close()

    # Sync chapter progress based on updated concept statuses
    try:
        sync_chapter_progress_from_concept_change(user_id, str(concept_id))
    except Exception as e_sync:
        # Non-fatal sync logging
        pass

    try:
        try:
            from backend.services.planner_db import invalidate_user_summary_cache
        except ImportError:
            from services.planner_db import invalidate_user_summary_cache
        invalidate_user_summary_cache(user_id)
    except Exception:
        pass

    return {
        "user_id": user_id,
        "concept_id": str(concept_id),
        "status": status,
        "updated_at": now_iso
    }


def bulk_set_concept_progress(user_id: str, concept_ids: List[str], status: str) -> int:
    """Sets status for multiple concepts owned by user_id in one transaction."""
    if status not in ("studied", "not_started"):
        raise ValueError("Status must be 'studied' or 'not_started'.")

    if not concept_ids:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    updated_count = 0
    try:
        with conn:
            for cid in concept_ids:
                conn.execute(
                    """
                    INSERT INTO concept_progress (user_id, concept_id, status, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, concept_id) DO UPDATE SET
                        status = excluded.status,
                        updated_at = excluded.updated_at
                    """,
                    (user_id, str(cid), status, now_iso)
                )
                updated_count += 1
    finally:
        conn.close()

    # Sync chapters affected
    if concept_ids:
        try:
            sync_chapter_progress_from_concept_change(user_id, str(concept_ids[0]))
        except Exception:
            pass

    try:
        try:
            from backend.services.planner_db import invalidate_user_summary_cache
        except ImportError:
            from services.planner_db import invalidate_user_summary_cache
        invalidate_user_summary_cache(user_id)
    except Exception:
        pass

    return updated_count


def get_concept_progress_for_document(user_id: str, doc_id: str) -> Dict[str, str]:
    """Returns a map of {concept_id_str: status} for all concepts in the document."""
    if not user_id or not doc_id:
        return {}

    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            SELECT cp.concept_id, cp.status
            FROM concept_progress cp
            JOIN concepts c ON CAST(c.id AS TEXT) = cp.concept_id
            WHERE cp.user_id = ? AND c.document_id = ?
            """,
            (user_id, doc_id)
        )
        return {str(row["concept_id"]): row["status"] for row in cursor.fetchall()}
    except Exception as e:
        logger.warning(f"Error fetching concept progress for document {doc_id}: {e}")
        return {}
    finally:
        conn.close()


def get_user_concept_progress_map(user_id: str) -> Dict[str, str]:
    """Returns full map of {concept_id_str: status} for the user."""
    if not user_id:
        return {}

    conn = get_connection()
    try:
        cursor = conn.execute(
            "SELECT concept_id, status FROM concept_progress WHERE user_id = ?",
            (user_id,)
        )
        return {str(row["concept_id"]): row["status"] for row in cursor.fetchall()}
    finally:
        conn.close()


def sync_chapter_progress_from_concept_change(user_id: str, concept_id: str) -> None:
    """
    Checks if all concepts in a chapter are studied, updating chapter_progress:
    - all studied -> status 2 (complete)
    - some studied -> status 1 (in-progress)
    - none studied -> status 0 (not_started)
    """
    conn = get_connection()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with conn:
            # 1. Identify concept and its document
            cid_str = str(concept_id)
            row = conn.execute(
                """
                SELECT c.id, c.document_id, c.topic, c.flow_group
                FROM concepts c
                JOIN documents d ON c.document_id = d.id
                WHERE CAST(c.id AS TEXT) = ? AND d.user_id = ?
                """,
                (cid_str, user_id)
            ).fetchone()
            if not row:
                return

            doc_id = row["document_id"]
            topic_name = (row["topic"] or row["flow_group"] or "General").strip()

            # 2. Find corresponding chapter in chapters table
            ch_rows = conn.execute(
                "SELECT id, name FROM chapters WHERE book_id = ?",
                (doc_id,)
            ).fetchall()
            if not ch_rows:
                return

            target_chapter_id = None
            if len(ch_rows) == 1:
                target_chapter_id = ch_rows[0]["id"]
            else:
                for ch in ch_rows:
                    if ch["name"].strip().lower() == topic_name.lower():
                        target_chapter_id = ch["id"]
                        break
                if not target_chapter_id:
                    # Partial match
                    for ch in ch_rows:
                        if topic_name.lower() in ch["name"].lower() or ch["name"].lower() in topic_name.lower():
                            target_chapter_id = ch["id"]
                            break
            if not target_chapter_id:
                target_chapter_id = ch_rows[0]["id"]

            # 3. Find all concepts in this chapter
            if len(ch_rows) == 1:
                chapter_concepts = conn.execute(
                    "SELECT id FROM concepts WHERE document_id = ?",
                    (doc_id,)
                ).fetchall()
            else:
                chapter_concepts = conn.execute(
                    "SELECT id FROM concepts WHERE document_id = ? AND (LOWER(topic) = LOWER(?) OR LOWER(flow_group) = LOWER(?))",
                    (doc_id, topic_name, topic_name)
                ).fetchall()
                if not chapter_concepts:
                    chapter_concepts = conn.execute(
                        "SELECT id FROM concepts WHERE document_id = ?",
                        (doc_id,)
                    ).fetchall()

            total_concepts = len(chapter_concepts)
            if total_concepts == 0:
                return

            concept_id_strs = [str(c["id"]) for c in chapter_concepts]
            placeholders = ",".join("?" for _ in concept_id_strs)

            studied_row = conn.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM concept_progress
                WHERE user_id = ? AND concept_id IN ({placeholders}) AND status = 'studied'
                """,
                [user_id] + concept_id_strs
            ).fetchone()
            studied_count = studied_row["cnt"] if studied_row else 0

            new_status = 0
            if studied_count == total_concepts:
                new_status = 2  # Complete
            elif studied_count > 0:
                new_status = 1  # In progress

            conn.execute(
                """
                INSERT INTO chapter_progress (user_id, chapter_id, status, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, chapter_id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                (user_id, target_chapter_id, new_status, now_iso)
            )
    finally:
        conn.close()


# ==================== Document File BLOB Storage & File Sync ====================

def save_document_file_blob(
    doc_id: str,
    content: bytes,
    user_id: str = "",
    filename: str = "",
    file_hash: Optional[str] = None,
    conn=None
) -> None:
    """
    Saves uploaded file bytes directly into database BLOB column.
    Ensures that even if ephemeral disk storage is wiped (e.g. Render restart),
    the file is permanently preserved for re-analysis, PDF viewer, and Graph RAG.
    """
    if not content:
        return
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        if not file_hash:
            file_hash = hashlib.sha256(content).hexdigest()
        ext = Path(filename).suffix.lower() if filename else ".pdf"
        mime = "application/pdf" if ext == ".pdf" else ("text/plain" if ext in (".txt", ".md") else "application/octet-stream")
        with conn:
            conn.execute("UPDATE documents SET file_data = ? WHERE id = ?", (content, doc_id))
            cursor = conn.execute("SELECT document_id FROM document_files WHERE document_id = ?", (doc_id,))
            if cursor.fetchone():
                conn.execute(
                    """
                    UPDATE document_files
                    SET user_id = ?, provider = 'server', size = ?, mime = ?, sha256 = ?, file_data = ?, created_at = ?
                    WHERE document_id = ?
                    """,
                    (user_id, len(content), mime, file_hash, content, now_iso, doc_id)
                )
            else:
                conn.execute(
                    """
                    INSERT INTO document_files (
                        document_id, user_id, provider, storage_key, size, mime, sha256, created_at, file_data
                    ) VALUES (?, ?, 'server', NULL, ?, ?, ?, ?, ?)
                    """,
                    (doc_id, user_id, len(content), mime, file_hash, now_iso, content)
                )
    finally:
        if should_close:
            conn.close()


def get_document_file_blob(doc_id: str, conn=None) -> Optional[bytes]:
    """Retrieves document file bytes from documents or document_files table."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True
    try:
        cursor = conn.execute("SELECT file_data FROM documents WHERE id = ?", (doc_id,))
        row = cursor.fetchone()
        if row and row["file_data"]:
            return bytes(row["file_data"])
        cursor = conn.execute("SELECT file_data FROM document_files WHERE document_id = ?", (doc_id,))
        row = cursor.fetchone()
        if row and row["file_data"]:
            return bytes(row["file_data"])
        return None
    finally:
        if should_close:
            conn.close()


def ensure_document_file_on_disk(
    doc_id: str,
    user_id: Optional[str] = None,
    filename: Optional[str] = None
) -> Optional[Path]:
    """
    Guarantees the document file is present on local disk.
    If the file was removed from ephemeral disk (e.g. Render container restart),
    restores it directly from the database BLOB.
    """
    upload_dir = get_upload_dir()
    conn = get_connection()
    try:
        if not filename or not user_id:
            row = conn.execute("SELECT user_id, filename FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if row:
                if not user_id:
                    user_id = row["user_id"] or ""
                if not filename:
                    filename = row["filename"] or f"{doc_id}.pdf"
            else:
                return None

        candidates = []
        if user_id:
            candidates.append(upload_dir / user_id / f"{doc_id}_{filename}")
        candidates.append(upload_dir / f"{doc_id}_{filename}")

        for cand in candidates:
            if cand.exists() and cand.is_file() and cand.stat().st_size > 0:
                return cand

        # Reconstitute from DB BLOB
        file_bytes = get_document_file_blob(doc_id, conn=conn)
        if file_bytes and len(file_bytes) > 0:
            target_dir = upload_dir / user_id if user_id else upload_dir
            target_dir.mkdir(parents=True, exist_ok=True)
            target_path = target_dir / f"{doc_id}_{filename}"
            with open(target_path, "wb") as f_out:
                f_out.write(file_bytes)
            logger.info(f"Restored file {filename} ({len(file_bytes)} bytes) from database BLOB for doc_id {doc_id}.")
            return target_path

        # If S3 is configured, try downloading from S3
        try:
            from backend.services.file_storage import get_document_file_record, is_s3_configured, generate_presigned_download_url
            rec = get_document_file_record(conn, doc_id)
            if rec and rec.get("provider") == "s3" and rec.get("storage_key") and is_s3_configured():
                presigned = generate_presigned_download_url(rec["storage_key"], expires_in=300)
                import urllib.request
                target_dir = upload_dir / user_id if user_id else upload_dir
                target_dir.mkdir(parents=True, exist_ok=True)
                target_path = target_dir / f"{doc_id}_{filename}"
                urllib.request.urlretrieve(presigned, str(target_path))
                with open(target_path, "rb") as bf:
                    save_document_file_blob(doc_id, bf.read(), user_id=user_id, filename=filename, conn=conn)
                return target_path
        except Exception as e_s3:
            logger.warning(f"Could not restore file from S3: {e_s3}")

        return None
    finally:
        conn.close()


def _backfill_files_into_database(conn) -> None:
    """Backfills file_data BLOB for any existing documents whose files are on disk."""
    upload_dir = get_upload_dir()
    try:
        rows = conn.execute("SELECT id, user_id, filename FROM documents WHERE file_data IS NULL").fetchall()
        now_iso = datetime.now(timezone.utc).isoformat()
        for row in rows:
            doc_id = row["id"]
            user_id = row["user_id"] or ""
            filename = row["filename"]
            if not filename:
                continue
            candidates = [upload_dir / user_id / f"{doc_id}_{filename}", upload_dir / f"{doc_id}_{filename}"]
            for p in candidates:
                if p.exists() and p.is_file() and p.stat().st_size > 0:
                    try:
                        with open(p, "rb") as f:
                            data = f.read()
                        if data:
                            conn.execute("UPDATE documents SET file_data = ? WHERE id = ?", (data, doc_id))
                            ext = Path(filename).suffix.lower()
                            mime = "application/pdf" if ext == ".pdf" else "application/octet-stream"
                            file_hash = hashlib.sha256(data).hexdigest()
                            conn.execute(
                                """
                                INSERT INTO document_files (
                                    document_id, user_id, provider, storage_key, size, mime, sha256, created_at, file_data
                                ) VALUES (?, ?, 'server', NULL, ?, ?, ?, ?, ?)
                                ON CONFLICT (document_id) DO UPDATE SET
                                    file_data = excluded.file_data,
                                    size = excluded.size,
                                    mime = excluded.mime,
                                    sha256 = excluded.sha256,
                                    provider = 'server'
                                """,
                                (doc_id, user_id, len(data), mime, file_hash, now_iso, data)
                            )
                    except Exception as ef:
                        logger.debug(f"Could not backfill file for doc {doc_id}: {ef}")
                    break
    except Exception as e:
        logger.debug(f"File backfill notice: {e}")


def _sanitize_and_sync_all_document_concepts(conn) -> None:
    """
    Sanitizes concepts for all documents so that only normalized concepts remain.
    Prunes unnormalized concepts from concepts & relations tables and updates documents.concept_count
    and chapters.concept_count to match normalized counts (e.g. 15 instead of 16).
    """
    try:
        try:
            from backend.services.normalizer import normalize_extracted_concepts
        except ImportError:
            from services.normalizer import normalize_extracted_concepts

        doc_rows = conn.execute("SELECT id FROM documents").fetchall()
        for d in doc_rows:
            doc_id = d["id"]
            raw_concepts = get_concepts_by_document(doc_id, conn=conn)
            if not raw_concepts:
                continue
            normalized = normalize_extracted_concepts(raw_concepts)
            if len(normalized) != len(raw_concepts):
                norm_keys = {re.sub(r"[^a-z0-9]", "", c["name"].lower()) for c in normalized}
                for rc in raw_concepts:
                    rc_key = re.sub(r"[^a-z0-9]", "", rc["name"].lower())
                    if rc_key not in norm_keys:
                        conn.execute("DELETE FROM relations WHERE concept_id = ?", (rc["id"],))
                        conn.execute("DELETE FROM concepts WHERE id = ?", (rc["id"],))
            conn.execute(
                "UPDATE documents SET concept_count = ? WHERE id = ?",
                (len(normalized), doc_id)
            )
            conn.execute(
                "UPDATE chapters SET concept_count = ? WHERE book_id = ?",
                (len(normalized), doc_id)
            )
    except Exception as e_san:
        logger.debug(f"Concept sanitization notice: {e_san}")

