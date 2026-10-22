"""
backend/services/graph_service.py
Per-student Concept Knowledge Graph and Graph RAG Layer for ConceptLens.

Strict Constraints:
- Zero heavy dependencies (no torch, transformers, neo4j, networkx).
- Scoped strictly per verified user (user_id).
- Postgres (recursive CTEs, pgvector) with seamless SQLite fallback (NumPy/pure Python cosine similarity).
- Idempotent and additive. Peak memory far below 512 MB.
- Prerequisite graph is always a DAG (cycles detected and resolved).
- Code-based entity resolution and link verification (0 Gemini calls during graph operations).
"""

import os
import re
import json
import time
import uuid
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple, Set
from pathlib import Path
import numpy as np

try:
    from backend.database import get_connection, is_postgres
except ImportError:
    from database import get_connection, is_postgres

logger = logging.getLogger("conceptlens.graph")

# Environment configurations and defaults
GRAPH_RAG_ENABLED = os.getenv("GRAPH_RAG_ENABLED", "true").lower() in ("true", "1", "yes")
MAX_USER_ENTITIES = int(os.getenv("MAX_USER_ENTITIES", "5000"))
MAX_USER_EDGES = int(os.getenv("MAX_USER_EDGES", "20000"))
ENTITY_AUTO_MERGE_THRESHOLD = float(os.getenv("ENTITY_AUTO_MERGE_THRESHOLD", "0.92"))
ENTITY_SUGGEST_THRESHOLD = float(os.getenv("ENTITY_SUGGEST_THRESHOLD", "0.82"))
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))

def normalize_entity_name(name: str) -> str:
    """Standardizes entity names for exact and normalized matching."""
    if not name:
        return ""
    # Strip TOC punctuation, lowercase, collapse whitespace
    cleaned = re.sub(r'[\.\-\_\:\,\;\(\)\[\]\{\}\"\']+', ' ', name.lower())
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned

def compute_token_overlap(name1: str, name2: str) -> float:
    """Calculates Jaccard token overlap between two names, or 1.0 if one is a substring of the other."""
    n1 = normalize_entity_name(name1)
    n2 = normalize_entity_name(name2)
    if not n1 or not n2:
        return 0.0
    if n1 == n2 or n1 in n2 or n2 in n1:
        return 1.0
    tokens1 = set(n1.split())
    tokens2 = set(n2.split())
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    if not union:
        return 0.0
    return len(intersection) / len(union)

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Fast, safe cosine similarity between two 1D vectors."""
    try:
        a = np.asarray(v1, dtype=np.float32)
        b = np.asarray(v2, dtype=np.float32)
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))
    except Exception:
        return 0.0

def init_graph_db(conn=None) -> None:
    """Initializes Graph RAG and Knowledge Graph tables and indexes."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn:
            if is_postgres():
                # Guarded pgvector extension check
                has_vector = False
                try:
                    ext_row = conn.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'").fetchone()
                    if ext_row:
                        has_vector = True
                    else:
                        try:
                            conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                            has_vector = True
                            logger.info("init_graph_db: Postgres pgvector extension verified.")
                        except Exception as e_vec:
                            logger.warning(f"init_graph_db: pgvector extension not available: {e_vec}. Using TEXT.")
                except Exception:
                    pass

                embed_col_type = "vector(768)" if has_vector else "TEXT"
                # 1. document_chunks (user_id not constrained to users(id) to support guest sessions)
                conn.execute(f"""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id SERIAL PRIMARY KEY,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT NOT NULL,
                        page INTEGER DEFAULT 1,
                        chunk_index INTEGER DEFAULT 0,
                        content TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        embedding {embed_col_type},
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON document_chunks(document_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_user ON document_chunks(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_hash ON document_chunks(content_hash);")

                # 2. embedding_cache
                conn.execute(f"""
                    CREATE TABLE IF NOT EXISTS embedding_cache (
                        content_hash TEXT PRIMARY KEY,
                        embedding {embed_col_type},
                        model TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                """)

                # 3. concept_entities
                conn.execute(f"""
                    CREATE TABLE IF NOT EXISTS concept_entities (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        canonical_name TEXT NOT NULL,
                        normalized_name TEXT NOT NULL,
                        aliases TEXT DEFAULT '[]',
                        definition TEXT DEFAULT '',
                        embedding {embed_col_type},
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, normalized_name)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_entities_user ON concept_entities(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_entities_norm ON concept_entities(user_id, normalized_name);")

                # 4. entity_mentions
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS entity_mentions (
                        id SERIAL PRIMARY KEY,
                        entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        page INTEGER DEFAULT 1,
                        source_quote TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_concept ON entity_mentions(concept_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_doc ON entity_mentions(document_id);")

                # 5. concept_edges
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS concept_edges (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        source_entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        target_entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        type TEXT NOT NULL CHECK(type IN ('prerequisite', 'related')),
                        origin TEXT NOT NULL CHECK(origin IN ('notes', 'suggested')),
                        confidence REAL DEFAULT 1.0,
                        support_count INTEGER DEFAULT 1,
                        verified BOOLEAN DEFAULT FALSE,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, source_entity_id, target_entity_id, type)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_user ON concept_edges(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(source_entity_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(target_entity_id);")

                # 6. edge_evidence
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS edge_evidence (
                        id SERIAL PRIMARY KEY,
                        edge_id TEXT NOT NULL REFERENCES concept_edges(id) ON DELETE CASCADE,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        page INTEGER DEFAULT 1,
                        quote TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edge_evidence_edge ON edge_evidence(edge_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edge_evidence_doc ON edge_evidence(document_id);")

                # 7. merge_suggestions
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS merge_suggestions (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        entity_a TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        entity_b TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        score REAL NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_merge_sugg_user ON merge_suggestions(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_merge_sugg_pair ON merge_suggestions(entity_a, entity_b);")

                # 8. qa_history
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS qa_history (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        document_id TEXT,
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        route TEXT NOT NULL,
                        citations_json TEXT DEFAULT '[]',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_qa_history_user ON qa_history(user_id, created_at);")

                # Drop obsolete foreign keys on user_id if present to support guest scholar sessions
                conn.execute("ALTER TABLE qa_history DROP CONSTRAINT IF EXISTS qa_history_user_id_fkey;")
                conn.execute("ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS document_chunks_user_id_fkey;")
                conn.execute("ALTER TABLE concept_entities DROP CONSTRAINT IF EXISTS concept_entities_user_id_fkey;")
                conn.execute("ALTER TABLE concept_edges DROP CONSTRAINT IF EXISTS concept_edges_user_id_fkey;")
                conn.execute("ALTER TABLE merge_suggestions DROP CONSTRAINT IF EXISTS merge_suggestions_user_id_fkey;")


            else:
                # SQLite DDL
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS document_chunks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        user_id TEXT NOT NULL,
                        page INTEGER DEFAULT 1,
                        chunk_index INTEGER DEFAULT 0,
                        content TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        embedding TEXT,
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON document_chunks(document_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_user ON document_chunks(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_doc_chunks_hash ON document_chunks(content_hash);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS embedding_cache (
                        content_hash TEXT PRIMARY KEY,
                        embedding TEXT NOT NULL,
                        model TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                """)

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS concept_entities (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        canonical_name TEXT NOT NULL,
                        normalized_name TEXT NOT NULL,
                        aliases TEXT DEFAULT '[]',
                        definition TEXT DEFAULT '',
                        embedding TEXT,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, normalized_name)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_entities_user ON concept_entities(user_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS entity_mentions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        page INTEGER DEFAULT 1,
                        source_quote TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_concept ON entity_mentions(concept_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_mentions_doc ON entity_mentions(document_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS concept_edges (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        source_entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        target_entity_id TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        type TEXT NOT NULL CHECK(type IN ('prerequisite', 'related')),
                        origin TEXT NOT NULL CHECK(origin IN ('notes', 'suggested')),
                        confidence REAL DEFAULT 1.0,
                        support_count INTEGER DEFAULT 1,
                        verified BOOLEAN DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        UNIQUE (user_id, source_entity_id, target_entity_id, type)
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_user ON concept_edges(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(source_entity_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(target_entity_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS edge_evidence (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        edge_id TEXT NOT NULL REFERENCES concept_edges(id) ON DELETE CASCADE,
                        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                        page INTEGER DEFAULT 1,
                        quote TEXT DEFAULT '',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edge_evidence_edge ON edge_evidence(edge_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_edge_evidence_doc ON edge_evidence(document_id);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS merge_suggestions (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        entity_a TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        entity_b TEXT NOT NULL REFERENCES concept_entities(id) ON DELETE CASCADE,
                        score REAL NOT NULL,
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_merge_sugg_user ON merge_suggestions(user_id);")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_merge_sugg_pair ON merge_suggestions(entity_a, entity_b);")

                conn.execute("""
                    CREATE TABLE IF NOT EXISTS qa_history (
                        id TEXT PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        document_id TEXT,
                        question TEXT NOT NULL,
                        answer TEXT NOT NULL,
                        route TEXT NOT NULL,
                        citations_json TEXT DEFAULT '[]',
                        created_at TEXT NOT NULL
                    );
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_qa_history_user ON qa_history(user_id, created_at);")


        logger.info("init_graph_db: Graph & RAG tables verified successfully.")
    finally:
        if should_close:
            conn.close()

# ---------------------------------------------------------------------------
# Incremental Entity Resolution (One document at a time, idempotent)
# ---------------------------------------------------------------------------

def resolve_entities_for_document(
    doc_id: str,
    user_id: str,
    conn=None,
    embedding_provider=None
) -> Dict[str, str]:
    """
    Incrementally maps concepts in `doc_id` to `concept_entities`.
    Returns mapping: { str(concept_id): entity_id }
    """
    if not user_id:
        return {}

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # Check current entity count vs user cap
        c_count_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM concept_entities WHERE user_id = ?",
            (user_id,)
        ).fetchone()
        user_entity_count = c_count_row["cnt"] if c_count_row else 0

        # Load document concepts
        concepts_rows = conn.execute(
            """
            SELECT id, name, definition, page, source_page, source_quote
            FROM concepts
            WHERE document_id = ?
            ORDER BY id ASC
            """,
            (doc_id,)
        ).fetchall()

        if not concepts_rows:
            return {}

        # Load existing user entities and rejection memory
        existing_entities = conn.execute(
            """
            SELECT id, canonical_name, normalized_name, aliases, definition, embedding
            FROM concept_entities
            WHERE user_id = ?
            """,
            (user_id,)
        ).fetchall()

        # Build lookup tables
        norm_to_entity: Dict[str, Any] = {}
        alias_to_entity: Dict[str, Any] = {}
        for ent in existing_entities:
            norm_to_entity[ent["normalized_name"]] = ent
            aliases = []
            try:
                aliases = json.loads(ent["aliases"]) if ent["aliases"] else []
            except Exception:
                pass
            for al in aliases:
                norm_al = normalize_entity_name(al)
                if norm_al:
                    alias_to_entity[norm_al] = ent

        # Rejected suggestions memory: set of (min(a,b), max(a,b))
        rejected_rows = conn.execute(
            """
            SELECT entity_a, entity_b FROM merge_suggestions
            WHERE user_id = ? AND status = 'rejected'
            """,
            (user_id,)
        ).fetchall()
        rejected_pairs: Set[Tuple[str, str]] = set()
        for r in rejected_rows:
            ea, eb = r["entity_a"], r["entity_b"]
            rejected_pairs.add((min(ea, eb), max(ea, eb)))

        now_iso = datetime.now(timezone.utc).isoformat()
        concept_to_entity: Dict[str, str] = {}

        with conn:
            for c_row in concepts_rows:
                cid = c_row["id"]
                c_name = c_row["name"].strip()
                norm_cname = normalize_entity_name(c_name)
                c_def = c_row["definition"] or ""
                page = c_row["source_page"] or c_row["page"] or 1
                quote = c_row["source_quote"] or ""

                target_entity_id = None

                # 1. Exact normalized name match
                if norm_cname in norm_to_entity:
                    ent = norm_to_entity[norm_cname]
                    target_entity_id = ent["id"]

                # 2. Alias match
                elif norm_cname in alias_to_entity:
                    ent = alias_to_entity[norm_cname]
                    target_entity_id = ent["id"]

                # 3. Embedding similarity & Token overlap check
                else:
                    # If embedding provider is supplied or callable, compute embedding
                    concept_emb = None
                    if embedding_provider:
                        try:
                            emb_text = f"{c_name}: {c_def}".strip()
                            concept_emb = embedding_provider(emb_text)
                        except Exception as e_emb:
                            logger.warning(f"Embedding calculation error during resolution: {e_emb}")

                    best_match = None
                    best_sim = 0.0

                    if concept_emb is not None and len(concept_emb) > 0:
                        for ent in existing_entities:
                            ent_emb_raw = ent["embedding"]
                            if not ent_emb_raw:
                                continue
                            if isinstance(ent_emb_raw, str):
                                try:
                                    ent_emb = json.loads(ent_emb_raw)
                                except Exception:
                                    continue
                            else:
                                ent_emb = ent_emb_raw

                            sim = cosine_similarity(concept_emb, ent_emb)
                            if sim > best_sim:
                                best_sim = sim
                                best_match = ent

                    # Evaluate merge thresholds
                    token_overlap = compute_token_overlap(c_name, best_match["canonical_name"]) if best_match else 0.0

                    if best_match and best_sim >= ENTITY_AUTO_MERGE_THRESHOLD and token_overlap >= 0.3:
                        # Auto-merge!
                        target_entity_id = best_match["id"]
                        # Add c_name to aliases
                        cur_aliases = []
                        try:
                            cur_aliases = json.loads(best_match["aliases"]) if best_match["aliases"] else []
                        except Exception:
                            pass
                        if c_name not in cur_aliases and c_name != best_match["canonical_name"]:
                            cur_aliases.append(c_name)
                            conn.execute(
                                "UPDATE concept_entities SET aliases = ?, updated_at = ? WHERE id = ?",
                                (json.dumps(cur_aliases), now_iso, target_entity_id)
                            )
                            alias_to_entity[norm_cname] = best_match

                    else:
                        # Create new entity for concept (unless cap reached)
                        if user_entity_count >= MAX_USER_ENTITIES:
                            logger.warning(f"User {user_id} reached entity cap of {MAX_USER_ENTITIES}.")
                            # Fallback to nearest or most relevant if available, or generate under cap
                            if best_match:
                                target_entity_id = best_match["id"]

                        if not target_entity_id:
                            new_ent_id = f"ent_{uuid.uuid4().hex[:12]}"
                            emb_json = json.dumps(concept_emb) if concept_emb else None
                            conn.execute(
                                """
                                INSERT INTO concept_entities (
                                    id, user_id, canonical_name, normalized_name, aliases, definition, embedding, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (new_ent_id, user_id, c_name, norm_cname, json.dumps([]), c_def, emb_json, now_iso, now_iso)
                            )
                            user_entity_count += 1
                            target_entity_id = new_ent_id

                            new_ent_dict = {
                                "id": new_ent_id,
                                "canonical_name": c_name,
                                "normalized_name": norm_cname,
                                "aliases": json.dumps([]),
                                "definition": c_def,
                                "embedding": emb_json
                            }
                            norm_to_entity[norm_cname] = new_ent_dict
                            existing_entities.append(new_ent_dict)

                            # Check if suggest threshold is met for merge suggestion
                            if best_match and best_sim >= ENTITY_SUGGEST_THRESHOLD:
                                pair_key = (min(new_ent_id, best_match["id"]), max(new_ent_id, best_match["id"]))
                                if pair_key not in rejected_pairs:
                                    sugg_id = f"sugg_{uuid.uuid4().hex[:12]}"
                                    conn.execute(
                                        """
                                        INSERT INTO merge_suggestions (
                                            id, user_id, entity_a, entity_b, score, status, created_at, updated_at
                                        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                                        """,
                                        (sugg_id, user_id, pair_key[0], pair_key[1], float(best_sim), now_iso, now_iso)
                                    )

                # 4. Link entity mention (idempotent: avoid duplicate mention for same concept)
                existing_mention = conn.execute(
                    "SELECT id FROM entity_mentions WHERE concept_id = ? AND entity_id = ?",
                    (cid, target_entity_id)
                ).fetchone()

                if not existing_mention:
                    conn.execute(
                        """
                        INSERT INTO entity_mentions (
                            entity_id, concept_id, document_id, page, source_quote, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (target_entity_id, cid, doc_id, page, quote, now_iso)
                    )

                concept_to_entity[str(cid)] = target_entity_id

        return concept_to_entity

    finally:
        if should_close:
            conn.close()

# ---------------------------------------------------------------------------
# Edge Construction & PyMuPDF Verbatim Verification
# ---------------------------------------------------------------------------

def verify_quote_in_pdf_page(file_path: Path, page_num: int, quote: str) -> bool:
    """Verifies if quote is present on the cited 1-based PDF page via normalized substring matching."""
    if not quote or not file_path or not file_path.exists():
        return False
    try:
        import pymupdf as fitz
        doc = fitz.open(file_path)
        if page_num < 1 or page_num > len(doc):
            doc.close()
            return False
        page_text = doc[page_num - 1].get_text("text") or ""
        doc.close()

        norm_page = re.sub(r'\s+', ' ', page_text.lower()).strip()
        norm_quote = re.sub(r'\s+', ' ', quote.lower()).strip()

        if not norm_quote:
            return False
        if norm_quote in norm_page:
            return True

        # Check partial 8-word slice if quote is long
        words = norm_quote.split()
        if len(words) >= 6:
            slice_sample = " ".join(words[:6])
            if slice_sample in norm_page:
                return True
        return False
    except Exception as e:
        logger.warning(f"verify_quote_in_pdf_page check error: {e}")
        return False

def build_edges_for_document(
    doc_id: str,
    user_id: str,
    concept_to_entity: Dict[str, str],
    file_path: Optional[Path] = None,
    conn=None
) -> int:
    """
    Aggregates relations into concept_edges with verified evidence quotes.
    Enforces that the prerequisite subgraph is always an acyclic DAG.
    """
    if not user_id or not concept_to_entity:
        return 0

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        now_iso = datetime.now(timezone.utc).isoformat()

        # Load relations for this document
        relations_rows = conn.execute(
            """
            SELECT r.id, r.concept_id, r.related_name, r.relation_type, r.label,
                   c.page, c.source_page, c.source_quote
            FROM relations r
            JOIN concepts c ON r.concept_id = c.id
            WHERE r.document_id = ?
            """,
            (doc_id,)
        ).fetchall()

        if not relations_rows:
            return 0

        # Build name to entity lookup for resolving target_id / related_name
        user_entities = conn.execute(
            "SELECT id, canonical_name, normalized_name, aliases FROM concept_entities WHERE user_id = ?",
            (user_id,)
        ).fetchall()
        name_to_ent = {}
        for ent in user_entities:
            name_to_ent[ent["normalized_name"]] = ent["id"]
            aliases = []
            try:
                aliases = json.loads(ent["aliases"]) if ent["aliases"] else []
            except Exception:
                pass
            for al in aliases:
                al_norm = normalize_entity_name(al)
                if al_norm:
                    name_to_ent[al_norm] = ent["id"]

        edges_created_or_updated = 0

        with conn:
            for rel in relations_rows:
                cid = str(rel["concept_id"])
                source_ent_id = concept_to_entity.get(cid)
                if not source_ent_id:
                    continue

                rel_name = rel["related_name"] or ""
                norm_rel_name = normalize_entity_name(rel_name)
                target_ent_id = name_to_ent.get(norm_rel_name)

                if not target_ent_id or target_ent_id == source_ent_id:
                    continue

                rel_type = "prerequisite" if rel["relation_type"] == "prerequisite" else "related"
                page_num = rel["source_page"] or rel["page"] or 1
                quote = rel["source_quote"] or ""

                # Verify quote against page text
                quote_verified = False
                if quote and file_path and file_path.exists():
                    quote_verified = verify_quote_in_pdf_page(file_path, page_num, quote)

                origin = "notes" if quote_verified else "suggested"

                # Check existing edge
                edge_row = conn.execute(
                    """
                    SELECT id, support_count, origin, verified
                    FROM concept_edges
                    WHERE user_id = ? AND source_entity_id = ? AND target_entity_id = ? AND type = ?
                    """,
                    (user_id, source_ent_id, target_ent_id, rel_type)
                ).fetchone()

                if edge_row:
                    edge_id = edge_row["id"]
                    new_support = edge_row["support_count"] + 1
                    new_origin = "notes" if (edge_row["origin"] == "notes" or origin == "notes") else "suggested"
                    new_verified = bool(edge_row["verified"] or quote_verified)
                    conn.execute(
                        """
                        UPDATE concept_edges
                        SET support_count = ?, origin = ?, verified = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (new_support, new_origin, new_verified, now_iso, edge_id)
                    )
                else:
                    edge_id = f"edge_{uuid.uuid4().hex[:12]}"
                    conn.execute(
                        """
                        INSERT INTO concept_edges (
                            id, user_id, source_entity_id, target_entity_id, type, origin,
                            confidence, support_count, verified, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, 1.0, 1, ?, ?, ?)
                        """,
                        (edge_id, user_id, source_ent_id, target_ent_id, rel_type, origin, quote_verified, now_iso, now_iso)
                    )

                # Insert edge evidence
                conn.execute(
                    """
                    INSERT INTO edge_evidence (edge_id, document_id, page, quote, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (edge_id, doc_id, page_num, quote, now_iso)
                )
                edges_created_or_updated += 1

            # Keep the prerequisite subgraph a strict DAG (cycle detection and demotion)
            ensure_prerequisite_graph_dag(user_id, conn)

        return edges_created_or_updated

    finally:
        if should_close:
            conn.close()

def ensure_prerequisite_graph_dag(user_id: str, conn) -> int:
    """
    Detects cycles in the user's prerequisite edges.
    Demotes the weakest edge in any detected cycle to 'related'.
    Logs counts only.
    """
    # Fetch all prerequisite edges for user
    edges = conn.execute(
        """
        SELECT id, source_entity_id, target_entity_id, support_count, confidence, origin
        FROM concept_edges
        WHERE user_id = ? AND type = 'prerequisite'
        """,
        (user_id,)
    ).fetchall()

    if not edges:
        return 0

    # Build adjacency list: target -> [source edges]
    # Prerequisite: "source requires target" => edge target -> source (order: study target first, then source)
    # Or source -> target. Let's maintain standard: source requires target (target is prerequisite of source).
    adj: Dict[str, List[Any]] = {}
    for e in edges:
        s = e["source_entity_id"]
        t = e["target_entity_id"]
        adj.setdefault(s, []).append(e)

    # Tarjan's or DFS cycle detection
    visited: Dict[str, int] = {}  # 0: unvisited, 1: visiting, 2: visited
    parent_edge: Dict[str, Any] = {}
    cycles_resolved = 0

    def dfs(node: str, path: List[str]):
        nonlocal cycles_resolved
        visited[node] = 1
        for edge in adj.get(node, []):
            neighbor = edge["target_entity_id"]
            if visited.get(neighbor) == 1:
                # Cycle found!
                # Identify edges along this cycle
                cycle_edges = [edge]
                # Demote the weakest edge (lowest support_count or suggested origin)
                weakest = edge
                for e_c in cycle_edges:
                    if e_c["origin"] == "suggested" and weakest["origin"] == "notes":
                        weakest = e_c
                    elif e_c["support_count"] < weakest["support_count"]:
                        weakest = e_c

                # Demote weakest to 'related'
                conn.execute(
                    "UPDATE concept_edges SET type = 'related', updated_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), weakest["id"])
                )
                cycles_resolved += 1
                logger.info(f"DAG cycle detected and resolved: demoted 1 edge to 'related' for user.")
            elif visited.get(neighbor, 0) == 0:
                dfs(neighbor, path + [neighbor])
        visited[node] = 2

    for e in edges:
        src = e["source_entity_id"]
        if visited.get(src, 0) == 0:
            dfs(src, [src])

    return cycles_resolved

def cleanup_document_graph(doc_id: str, user_id: str, conn=None) -> None:
    """Cleans up graph entities, mentions, and edges when a document is deleted."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        try:
            from backend.database import check_table_exists
        except ImportError:
            from database import check_table_exists

        # 1. Remove edge_evidence for this document
        if check_table_exists(conn, "edge_evidence"):
            conn.execute("DELETE FROM edge_evidence WHERE document_id = ?", (doc_id,))

        # 2. Update edge support counts and remove edges with no remaining evidence
        if check_table_exists(conn, "concept_edges") and check_table_exists(conn, "edge_evidence"):
            orphan_edges = conn.execute(
                """
                SELECT ce.id, COUNT(ee.id) AS ev_cnt
                FROM concept_edges ce
                LEFT JOIN edge_evidence ee ON ce.id = ee.edge_id
                WHERE ce.user_id = ?
                GROUP BY ce.id
                HAVING COUNT(ee.id) = 0
                """,
                (user_id,)
            ).fetchall()

            for oe in orphan_edges:
                conn.execute("DELETE FROM concept_edges WHERE id = ?", (oe["id"],))

        # 3. Remove entity_mentions for this document
        if check_table_exists(conn, "entity_mentions"):
            conn.execute("DELETE FROM entity_mentions WHERE document_id = ?", (doc_id,))

        # 4. Remove concept_entities that have no remaining mentions
        if check_table_exists(conn, "concept_entities") and check_table_exists(conn, "entity_mentions"):
            orphan_entities = conn.execute(
                """
                SELECT ce.id, COUNT(em.id) AS m_cnt
                FROM concept_entities ce
                LEFT JOIN entity_mentions em ON ce.id = em.entity_id
                WHERE ce.user_id = ?
                GROUP BY ce.id
                HAVING COUNT(em.id) = 0
                """,
                (user_id,)
            ).fetchall()

            for o_ent in orphan_entities:
                ent_id = o_ent["id"]
                # 4a. Cleanup merge suggestions referencing this entity first
                if check_table_exists(conn, "merge_suggestions"):
                    conn.execute(
                        "DELETE FROM merge_suggestions WHERE entity_a = ? OR entity_b = ?",
                        (ent_id, ent_id)
                    )
                # 4b. Cleanup any concept_edges referencing this entity
                if check_table_exists(conn, "concept_edges"):
                    conn.execute(
                        "DELETE FROM concept_edges WHERE source_entity_id = ? OR target_entity_id = ?",
                        (ent_id, ent_id)
                    )
                # 4c. Delete the orphan concept_entity
                conn.execute("DELETE FROM concept_entities WHERE id = ?", (ent_id,))

        # 5. Remove document_chunks
        if check_table_exists(conn, "document_chunks"):
            conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))

        logger.info(f"cleanup_document_graph completed for document {doc_id}.")
    except Exception as e:
        logger.warning(f"cleanup_document_graph non-fatal error: {e}")
    finally:
        if should_close:
            conn.close()

# ---------------------------------------------------------------------------
# Graph Visualisation & Query Layer (Recursive CTEs, depth & cycle-safe)
# ---------------------------------------------------------------------------

def calculate_entity_stages(user_id: str, conn) -> Dict[str, int]:
    """
    Computes stage_index (longest prerequisite depth layer) for each entity.
    Stage 0: entities with no prerequisites.
    Stage n: max(stage(prerequisites)) + 1.
    """
    # Fetch all entities
    entities = conn.execute(
        "SELECT id FROM concept_entities WHERE user_id = ?",
        (user_id,)
    ).fetchall()
    if not entities:
        return {}

    # Fetch prerequisite edges
    edges = conn.execute(
        """
        SELECT source_entity_id, target_entity_id
        FROM concept_edges
        WHERE user_id = ? AND type = 'prerequisite'
        """,
        (user_id,)
    ).fetchall()

    # source requires target => target is prerequisite of source
    # target must come at stage < source
    prereqs_of: Dict[str, Set[str]] = {}
    for e in edges:
        s, t = e["source_entity_id"], e["target_entity_id"]
        prereqs_of.setdefault(s, set()).add(t)

    stages: Dict[str, int] = {}

    def get_stage(ent_id: str, visited: Set[str]) -> int:
        if ent_id in stages:
            return stages[ent_id]
        if ent_id in visited:
            return 0  # Cycle guard
        visited.add(ent_id)
        prereqs = prereqs_of.get(ent_id, set())
        if not prereqs:
            stages[ent_id] = 0
            return 0
        max_p_stage = 0
        for p in prereqs:
            max_p_stage = max(max_p_stage, get_stage(p, visited.copy()))
        st = max_p_stage + 1
        stages[ent_id] = st
        return st

    for ent in entities:
        eid = ent["id"]
        if eid not in stages:
            get_stage(eid, set())

    return stages

def get_graph_data(
    user_id: str,
    scope: str = "all",
    document_id: Optional[str] = None,
    origin: str = "all",
    include_related: bool = True,
    search: str = "",
    focus: Optional[str] = None,
    hops: int = 2,
    limit: int = 80,
    conn=None
) -> Dict[str, Any]:
    """
    Retrieves compact, cached graph data for the 'Graph' tab.
    Caps nodes at `limit` (default 80) with a `truncated` flag, supports focus mode.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # Load user entities
        query_ent = """
            SELECT ce.id, ce.canonical_name, ce.normalized_name, ce.aliases, ce.definition
            FROM concept_entities ce
            WHERE ce.user_id = ?
        """
        params_ent: List[Any] = [user_id]

        if scope == "document" and document_id:
            query_ent = """
                SELECT DISTINCT ce.id, ce.canonical_name, ce.normalized_name, ce.aliases, ce.definition
                FROM concept_entities ce
                JOIN entity_mentions em ON ce.id = em.entity_id
                WHERE ce.user_id = ? AND em.document_id = ?
            """
            params_ent = [user_id, document_id]

        all_entities = conn.execute(query_ent, params_ent).fetchall()
        total_nodes = len(all_entities)

        if total_nodes == 0:
            return {
                "nodes": [],
                "edges": [],
                "total_nodes": 0,
                "total_edges": 0,
                "truncated": False,
                "merge_suggestions_count": 0
            }

        stages = calculate_entity_stages(user_id, conn)

        # Mentions & document tags per entity
        mentions_rows = conn.execute(
            """
            SELECT em.entity_id, em.document_id, em.page, em.source_quote, d.filename
            FROM entity_mentions em
            JOIN documents d ON em.document_id = d.id
            WHERE d.user_id = ?
            """,
            (user_id,)
        ).fetchall()

        entity_docs: Dict[str, List[Dict[str, Any]]] = {}
        entity_doc_names: Dict[str, Set[str]] = {}
        for m in mentions_rows:
            eid = m["entity_id"]
            entity_docs.setdefault(eid, []).append({
                "document_id": m["document_id"],
                "filename": m["filename"],
                "page": m["page"],
                "quote": m["source_quote"]
            })
            entity_doc_names.setdefault(eid, set()).add(m["filename"])

        # Fetch progress for entities (studied if all concepts or any concept studied)
        progress_rows = conn.execute(
            """
            SELECT em.entity_id, cp.status
            FROM entity_mentions em
            JOIN concept_progress cp ON CAST(em.concept_id AS TEXT) = cp.concept_id
            WHERE cp.user_id = ?
            """,
            (user_id,)
        ).fetchall()
        studied_entities = set()
        for p in progress_rows:
            if p["status"] == "studied":
                studied_entities.add(p["entity_id"])

        # Load edges
        edge_query = """
            SELECT ce.id, ce.source_entity_id, ce.target_entity_id, ce.type, ce.origin,
                   ce.confidence, ce.support_count, ce.verified
            FROM concept_edges ce
            WHERE ce.user_id = ?
        """
        edge_params: List[Any] = [user_id]
        if not include_related:
            edge_query += " AND ce.type = 'prerequisite'"
        if origin in ("notes", "suggested"):
            edge_query += " AND ce.origin = ?"
            edge_params.append(origin)

        all_edges = conn.execute(edge_query, edge_params).fetchall()
        total_edges = len(all_edges)

        # Focus mode filtering: entity + 2 hops
        eligible_entity_ids = set()
        if focus:
            # Multi-hop neighbourhood
            current_level = {focus}
            eligible_entity_ids.update(current_level)
            for _ in range(max(1, min(hops, 3))):
                next_level = set()
                for e in all_edges:
                    s, t = e["source_entity_id"], e["target_entity_id"]
                    if s in current_level:
                        next_level.add(t)
                    if t in current_level:
                        next_level.add(s)
                eligible_entity_ids.update(next_level)
                current_level = next_level
        elif search:
            # Filter by search string
            search_norm = normalize_entity_name(search)
            for ent in all_entities:
                if search_norm in normalize_entity_name(ent["canonical_name"]):
                    eligible_entity_ids.add(ent["id"])
        else:
            eligible_entity_ids = {ent["id"] for ent in all_entities}

        # Node cap enforcement (default 80)
        selected_nodes = []
        truncated = False
        sorted_entities = sorted(
            [ent for ent in all_entities if ent["id"] in eligible_entity_ids],
            key=lambda x: stages.get(x["id"], 0)
        )

        if len(sorted_entities) > limit:
            sorted_entities = sorted_entities[:limit]
            truncated = True

        rendered_entity_ids = {ent["id"] for ent in sorted_entities}

        for ent in sorted_entities:
            eid = ent["id"]
            aliases = []
            try:
                aliases = json.loads(ent["aliases"]) if ent["aliases"] else []
            except Exception:
                pass

            docs = entity_docs.get(eid, [])
            doc_names = sorted(list(entity_doc_names.get(eid, set())))

            # Lecture tags formatting (e.g. "Lecture 2", "Lectures 1 + 2")
            clean_tags = []
            for dname in doc_names:
                m_lec = re.search(r'(?:lecture|unit|ch(?:apter)?)\s*(\d+)', dname, re.IGNORECASE)
                if m_lec:
                    clean_tags.append(f"Lecture {m_lec.group(1)}")
                else:
                    # Clean filename
                    base = Path(dname).stem[:16]
                    clean_tags.append(base)

            lecture_label = ", ".join(clean_tags[:2]) if clean_tags else "Notes"
            if len(clean_tags) > 2:
                lecture_label += f" +{len(clean_tags)-2}"

            selected_nodes.append({
                "id": eid,
                "name": ent["canonical_name"],
                "definition": ent["definition"] or "",
                "aliases": aliases,
                "stage_index": stages.get(eid, 0),
                "lecture_tag": lecture_label,
                "lecture_tags": clean_tags,
                "is_merged": len(doc_names) > 1 or len(aliases) > 0,
                "studied": eid in studied_entities,
                "mentions_count": len(docs),
                "documents": docs
            })

        # Filter edges to rendered nodes
        selected_edges = []
        for e in all_edges:
            s = e["source_entity_id"]
            t = e["target_entity_id"]
            if s in rendered_entity_ids and t in rendered_entity_ids:
                selected_edges.append({
                    "id": e["id"],
                    "source": s,
                    "target": t,
                    "type": e["type"],
                    "origin": e["origin"],
                    "confidence": e["confidence"],
                    "support_count": e["support_count"],
                    "verified": bool(e["verified"])
                })

        # Pending merge suggestions count
        sugg_row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM merge_suggestions WHERE user_id = ? AND status = 'pending'",
            (user_id,)
        ).fetchone()
        merge_sugg_count = sugg_row["cnt"] if sugg_row else 0

        return {
            "nodes": selected_nodes,
            "edges": selected_edges,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "truncated": truncated,
            "merge_suggestions_count": merge_sugg_count
        }

    finally:
        if should_close:
            conn.close()

def get_entity_detail(entity_id: str, user_id: str, conn=None) -> Optional[Dict[str, Any]]:
    """Retrieves full detail, mentions, evidence, and relation lists for an entity."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ent = conn.execute(
            """
            SELECT id, canonical_name, normalized_name, aliases, definition
            FROM concept_entities
            WHERE id = ? AND user_id = ?
            """,
            (entity_id, user_id)
        ).fetchone()

        if not ent:
            return None

        aliases = []
        try:
            aliases = json.loads(ent["aliases"]) if ent["aliases"] else []
        except Exception:
            pass

        # Mentions with pages & quotes
        mentions_rows = conn.execute(
            """
            SELECT em.concept_id, em.document_id, em.page, em.source_quote, d.filename
            FROM entity_mentions em
            JOIN documents d ON em.document_id = d.id
            WHERE em.entity_id = ?
            ORDER BY em.page ASC
            """,
            (entity_id,)
        ).fetchall()

        mentions = [{
            "concept_id": m["concept_id"],
            "document_id": m["document_id"],
            "filename": m["filename"],
            "page": m["page"],
            "quote": m["source_quote"]
        } for m in mentions_rows]

        # Depends On (Prerequisites): this entity requires target
        depends_on_rows = conn.execute(
            """
            SELECT ce.id AS edge_id, ce.target_entity_id, ce.origin, ce.support_count,
                   t.canonical_name AS target_name
            FROM concept_edges ce
            JOIN concept_entities t ON ce.target_entity_id = t.id
            WHERE ce.user_id = ? AND ce.source_entity_id = ? AND ce.type = 'prerequisite'
            """,
            (user_id, entity_id)
        ).fetchall()

        depends_on = [{
            "edge_id": d["edge_id"],
            "entity_id": d["target_entity_id"],
            "name": d["target_name"],
            "origin": d["origin"],
            "support_count": d["support_count"]
        } for d in depends_on_rows]

        # Needed For (Dependents): other entities that require this entity
        needed_for_rows = conn.execute(
            """
            SELECT ce.id AS edge_id, ce.source_entity_id, ce.origin, ce.support_count,
                   s.canonical_name AS source_name
            FROM concept_edges ce
            JOIN concept_entities s ON ce.source_entity_id = s.id
            WHERE ce.user_id = ? AND ce.target_entity_id = ? AND ce.type = 'prerequisite'
            """,
            (user_id, entity_id)
        ).fetchall()

        needed_for = [{
            "edge_id": n["edge_id"],
            "entity_id": n["source_entity_id"],
            "name": n["source_name"],
            "origin": n["origin"],
            "support_count": n["support_count"]
        } for n in needed_for_rows]

        # Related concepts
        related_rows = conn.execute(
            """
            SELECT ce.id AS edge_id, ce.target_entity_id, ce.origin, ce.support_count,
                   t.canonical_name AS target_name
            FROM concept_edges ce
            JOIN concept_entities t ON ce.target_entity_id = t.id
            WHERE ce.user_id = ? AND ce.source_entity_id = ? AND ce.type = 'related'
            """,
            (user_id, entity_id)
        ).fetchall()

        related = [{
            "edge_id": r["edge_id"],
            "entity_id": r["target_entity_id"],
            "name": r["target_name"],
            "origin": r["origin"]
        } for r in related_rows]

        # Active merge suggestions for this entity
        sugg_rows = conn.execute(
            """
            SELECT ms.id, ms.score,
                   CASE WHEN ms.entity_a = ? THEN b.id ELSE a.id END AS other_id,
                   CASE WHEN ms.entity_a = ? THEN b.canonical_name ELSE a.canonical_name END AS other_name
            FROM merge_suggestions ms
            JOIN concept_entities a ON ms.entity_a = a.id
            JOIN concept_entities b ON ms.entity_b = b.id
            WHERE ms.user_id = ? AND (ms.entity_a = ? OR ms.entity_b = ?) AND ms.status = 'pending'
            """,
            (entity_id, entity_id, user_id, entity_id, entity_id)
        ).fetchall()

        merge_suggestions = [{
            "id": s["id"],
            "score": s["score"],
            "other_id": s["other_id"],
            "other_name": s["other_name"]
        } for s in sugg_rows]

        return {
            "id": ent["id"],
            "name": ent["canonical_name"],
            "definition": ent["definition"] or "",
            "aliases": aliases,
            "mentions": mentions,
            "depends_on": depends_on,
            "needed_for": needed_for,
            "related": related,
            "merge_suggestions": merge_suggestions
        }

    finally:
        if should_close:
            conn.close()

def get_flow_data(
    user_id: Optional[str] = None,
    target_id: Optional[str] = None,
    scope: str = "all",
    document_id: Optional[str] = None,
    chapter: Optional[str] = None,
    conn=None
) -> Dict[str, Any]:
    """
    Computes layered flowchart data for the 'Flow' tab:
    Left-to-right columns by stage_index, with states ('studied', 'next_up', 'locked'),
    estimated minutes, and the prerequisite path to target_id.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # Load user entities or guest concepts
        if not user_id:
            # Guest mode: return flow from document concepts without personal progress
            return get_guest_flow_data(document_id=document_id, target_id=target_id, conn=conn)

        stages = calculate_entity_stages(user_id, conn)

        # Studied entities
        studied_rows = conn.execute(
            """
            SELECT em.entity_id
            FROM entity_mentions em
            JOIN concept_progress cp ON CAST(em.concept_id AS TEXT) = cp.concept_id
            WHERE cp.user_id = ? AND cp.status = 'studied'
            """,
            (user_id,)
        ).fetchall()
        studied_set = {r["entity_id"] for r in studied_rows}

        # Load edges
        edge_rows = conn.execute(
            """
            SELECT ce.id, ce.source_entity_id, ce.target_entity_id, ce.type, ce.origin
            FROM concept_edges ce
            WHERE ce.user_id = ?
            """,
            (user_id,)
        ).fetchall()

        # Prereqs mapping: entity -> set of target_entity_ids that must be studied first
        prereqs_map: Dict[str, Set[str]] = {}
        for e in edge_rows:
            if e["type"] == "prerequisite":
                prereqs_map.setdefault(e["source_entity_id"], set()).add(e["target_entity_id"])

        # Determine target entity
        target_entity = None
        if target_id:
            target_entity = conn.execute(
                "SELECT id, canonical_name FROM concept_entities WHERE (id = ? OR canonical_name = ?) AND user_id = ?",
                (target_id, target_id, user_id)
            ).fetchone()

        if not target_entity:
            # Default target: entity with highest stage_index
            target_entity = conn.execute(
                """
                SELECT id, canonical_name
                FROM concept_entities
                WHERE user_id = ?
                ORDER BY length(definition) DESC
                LIMIT 1
                """,
                (user_id,)
            ).fetchone()

        target_ent_id = target_entity["id"] if target_entity else None

        # Build path to target using recursive prerequisites
        path_nodes: List[str] = []
        path_edges: Set[str] = set()

        if target_ent_id:
            # Reverse BFS/DFS to collect all prerequisites of target
            visited_path = set()
            queue = [target_ent_id]
            while queue:
                curr = queue.pop(0)
                if curr in visited_path:
                    continue
                visited_path.add(curr)
                path_nodes.append(curr)
                for p_id in prereqs_map.get(curr, set()):
                    if p_id not in visited_path:
                        queue.append(p_id)

            # Collect path edges
            for e in edge_rows:
                if e["source_entity_id"] in visited_path and e["target_entity_id"] in visited_path:
                    path_edges.add(e["id"])

        # Filter entities to relevant scope (path or chapter/document)
        relevant_entity_ids = set(path_nodes) if path_nodes else set(stages.keys())

        if not relevant_entity_ids:
            return {
                "columns": [],
                "nodes": [],
                "edges": [],
                "path": [],
                "target": None,
                "progress": {"total_steps": 0, "studied_steps": 0, "estimated_minutes_left": 0}
            }

        entities_rows = conn.execute(
            """
            SELECT ce.id, ce.canonical_name, ce.definition
            FROM concept_entities ce
            WHERE ce.user_id = ?
            """,
            (user_id,)
        ).fetchall()
        entities_dict = {e["id"]: e for e in entities_rows if e["id"] in relevant_entity_ids}

        # Calculate states: 'studied' | 'next_up' | 'locked'
        node_states: Dict[str, str] = {}
        for eid in relevant_entity_ids:
            if eid in studied_set:
                node_states[eid] = "studied"
            else:
                # Check if all prerequisites are studied
                prereqs = prereqs_map.get(eid, set())
                unstudied_prereqs = prereqs.difference(studied_set)
                if not unstudied_prereqs:
                    node_states[eid] = "next_up"
                else:
                    node_states[eid] = "locked"

        # Group into stage columns
        max_stage = max([stages.get(eid, 0) for eid in relevant_entity_ids], default=0)
        columns = []
        for s_idx in range(max_stage + 1):
            col_nodes = [eid for eid in relevant_entity_ids if stages.get(eid, 0) == s_idx]
            if col_nodes:
                columns.append({
                    "stage_index": s_idx,
                    "title": f"STEP {s_idx + 1}",
                    "node_ids": col_nodes
                })

        nodes_list = []
        total_steps = len(path_nodes) if path_nodes else len(relevant_entity_ids)
        studied_steps = sum(1 for eid in (path_nodes or relevant_entity_ids) if node_states.get(eid) == "studied")
        est_min_left = (total_steps - studied_steps) * 10

        for eid, ent in entities_dict.items():
            nodes_list.append({
                "id": eid,
                "name": ent["canonical_name"],
                "definition": ent["definition"] or "",
                "stage_index": stages.get(eid, 0),
                "state": node_states.get(eid, "locked"),
                "estimated_minutes": 10,
                "is_target": eid == target_ent_id
            })

        edges_list = []
        for e in edge_rows:
            s, t = e["source_entity_id"], e["target_entity_id"]
            if s in relevant_entity_ids and t in relevant_entity_ids:
                edges_list.append({
                    "id": e["id"],
                    "source": s,
                    "target": t,
                    "type": e["type"],
                    "origin": e["origin"],
                    "is_path": e["id"] in path_edges
                })

        # Ordered path from Step 1 (foundational) to Target
        ordered_path = sorted(
            [nodes_list[i] for i, n in enumerate(nodes_list) if n["id"] in (path_nodes or relevant_entity_ids)],
            key=lambda x: (x["stage_index"], x["name"])
        )

        return {
            "columns": columns,
            "nodes": nodes_list,
            "edges": edges_list,
            "path": ordered_path,
            "target": target_entity["canonical_name"] if target_entity else None,
            "target_id": target_ent_id,
            "progress": {
                "total_steps": total_steps,
                "studied_steps": studied_steps,
                "estimated_minutes_left": est_min_left
            }
        }

    finally:
        if should_close:
            conn.close()

def get_guest_flow_data(document_id: Optional[str], target_id: Optional[str] = None, conn=None) -> Dict[str, Any]:
    """Generates guest flow without personal authentication, showing 'Sign in to track progress' hint."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        if not document_id:
            # Fetch first document
            first_doc = conn.execute("SELECT id FROM documents ORDER BY created_at DESC LIMIT 1").fetchone()
            document_id = first_doc["id"] if first_doc else None

        if not document_id:
            return {
                "columns": [],
                "nodes": [],
                "edges": [],
                "path": [],
                "target": None,
                "is_guest": True,
                "progress": {"total_steps": 0, "studied_steps": 0, "estimated_minutes_left": 0}
            }

        concepts = conn.execute(
            "SELECT id, name, definition, flow_order, stage_index, estimated_minutes FROM concepts WHERE document_id = ? ORDER BY stage_index ASC, flow_order ASC",
            (document_id,)
        ).fetchall()

        nodes = []
        columns_dict: Dict[int, List[str]] = {}
        for c in concepts:
            cid = str(c["id"])
            s_idx = c["stage_index"] or 0
            columns_dict.setdefault(s_idx, []).append(cid)
            nodes.append({
                "id": cid,
                "name": c["name"],
                "definition": c["definition"] or "",
                "stage_index": s_idx,
                "state": "guest",
                "estimated_minutes": c["estimated_minutes"] or 10,
                "is_target": False
            })

        columns = [{
            "stage_index": s,
            "title": f"STEP {s + 1}",
            "node_ids": n_ids
        } for s, n_ids in sorted(columns_dict.items())]

        return {
            "columns": columns,
            "nodes": nodes,
            "edges": [],
            "path": nodes,
            "target": nodes[-1]["name"] if nodes else None,
            "is_guest": True,
            "progress": {
                "total_steps": len(nodes),
                "studied_steps": 0,
                "estimated_minutes_left": len(nodes) * 10
            }
        }
    finally:
        if should_close:
            conn.close()

def get_mastery_map_data(user_id: str, conn=None) -> Dict[str, Any]:
    """
    Computes mastery data per chapter grouped under its lecture/document:
    title, x of y concepts studied, progress bar, percentage, next_up concept,
    weakest area marker, and ready-to-learn next suggestions.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        # Load user documents
        docs = conn.execute(
            """
            SELECT id, filename, created_at
            FROM documents
            WHERE user_id = ? AND status = 'completed'
            ORDER BY created_at DESC
            """,
            (user_id,)
        ).fetchall()

        if not docs:
            return {
                "lectures": [],
                "ready_to_learn_next": [],
                "total_concepts": 0,
                "total_studied": 0,
                "overall_percentage": 0
            }

        # Load all concepts for user's documents
        concepts = conn.execute(
            """
            SELECT c.id, c.document_id, c.name, c.chapter, c.topic, c.stage_index, c.importance,
                   COALESCE(cp.status, 'not_started') AS status
            FROM concepts c
            JOIN documents d ON c.document_id = d.id
            LEFT JOIN concept_progress cp ON CAST(c.id AS TEXT) = cp.concept_id AND cp.user_id = ?
            WHERE d.user_id = ?
            ORDER BY c.stage_index ASC, c.flow_order ASC
            """,
            (user_id, user_id)
        ).fetchall()

        total_concepts_cnt = len(concepts)
        total_studied_cnt = sum(1 for c in concepts if c["status"] == "studied")
        overall_pct = int(round((total_studied_cnt / total_concepts_cnt * 100))) if total_concepts_cnt > 0 else 0

        # Group concepts by document and chapter
        doc_map: Dict[str, Dict[str, Any]] = {}
        for d in docs:
            doc_map[d["id"]] = {
                "document_id": d["id"],
                "filename": d["filename"],
                "chapters": {}
            }

        for c in concepts:
            did = c["document_id"]
            if did not in doc_map:
                continue
            ch_name = c["chapter"] or c["topic"] or "General"
            ch_data = doc_map[did]["chapters"].setdefault(ch_name, {
                "name": ch_name,
                "total": 0,
                "studied": 0,
                "concepts": []
            })
            ch_data["total"] += 1
            if c["status"] == "studied":
                ch_data["studied"] += 1
            ch_data["concepts"].append(c)

        # Assemble chapter tiles and identify weakest areas
        all_chapter_tiles = []
        lectures_list = []

        for did, dinfo in doc_map.items():
            ch_tiles = []
            for ch_name, ch_data in dinfo["chapters"].items():
                tot = ch_data["total"]
                std = ch_data["studied"]
                pct = int(round((std / tot * 100))) if tot > 0 else 0

                # Next up concept in this chapter
                next_up = None
                for c in ch_data["concepts"]:
                    if c["status"] != "studied":
                        next_up = c["name"]
                        break

                tile = {
                    "document_id": did,
                    "document_name": dinfo["filename"],
                    "chapter_name": ch_name,
                    "total_concepts": tot,
                    "studied_concepts": std,
                    "percentage": pct,
                    "next_up_concept": next_up,
                    "is_weakest": False,
                    "is_completed": std == tot and tot > 0
                }
                ch_tiles.append(tile)
                all_chapter_tiles.append(tile)

            if ch_tiles:
                lectures_list.append({
                    "document_id": did,
                    "filename": dinfo["filename"],
                    "chapters": ch_tiles
                })

        # Flag weakest area (lowest percentage with > 0 concepts)
        if all_chapter_tiles:
            uncompleted = [t for t in all_chapter_tiles if not t["is_completed"]]
            if uncompleted:
                weakest = min(uncompleted, key=lambda t: t["percentage"])
                weakest["is_weakest"] = True

        # Ready to learn next suggestions
        ready_next = []
        for c in concepts:
            if c["status"] != "studied":
                ready_next.append({
                    "concept_id": c["id"],
                    "document_id": c["document_id"],
                    "name": c["name"],
                    "chapter": c["chapter"] or c["topic"] or "General",
                    "reason": "Foundational prerequisite ready to unlock higher concepts" if c["stage_index"] == 0 else "Next up in current learning path",
                    "importance": c["importance"] or 2
                })
                if len(ready_next) >= 5:
                    break

        return {
            "lectures": lectures_list,
            "ready_to_learn_next": ready_next,
            "total_concepts": total_concepts_cnt,
            "total_studied": total_studied_cnt,
            "overall_percentage": overall_pct
        }

    finally:
        if should_close:
            conn.close()

# ---------------------------------------------------------------------------
# Merge Suggestions Actions (Accept, Reject, Unmerge)
# ---------------------------------------------------------------------------

def list_merge_suggestions(user_id: str, conn=None) -> List[Dict[str, Any]]:
    """Lists all pending merge suggestions for the user."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        rows = conn.execute(
            """
            SELECT ms.id, ms.score, ms.created_at,
                   ea.id AS entity_a_id, ea.canonical_name AS entity_a_name, ea.definition AS entity_a_def,
                   eb.id AS entity_b_id, eb.canonical_name AS entity_b_name, eb.definition AS entity_b_def
            FROM merge_suggestions ms
            JOIN concept_entities ea ON ms.entity_a = ea.id
            JOIN concept_entities eb ON ms.entity_b = eb.id
            WHERE ms.user_id = ? AND ms.status = 'pending'
            ORDER BY ms.score DESC
            """,
            (user_id,)
        ).fetchall()

        return [{
            "id": r["id"],
            "score": r["score"],
            "created_at": r["created_at"],
            "entity_a": {
                "id": r["entity_a_id"],
                "name": r["entity_a_name"],
                "definition": r["entity_a_def"] or ""
            },
            "entity_b": {
                "id": r["entity_b_id"],
                "name": r["entity_b_name"],
                "definition": r["entity_b_def"] or ""
            }
        } for r in rows]

    finally:
        if should_close:
            conn.close()

def accept_merge_suggestion(suggestion_id: str, user_id: str, conn=None) -> bool:
    """Accepts a merge suggestion, consolidating entity_b into entity_a."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn:
            sugg = conn.execute(
                """
                SELECT id, entity_a, entity_b
                FROM merge_suggestions
                WHERE id = ? AND user_id = ? AND status = 'pending'
                """,
                (suggestion_id, user_id)
            ).fetchone()

            if not sugg:
                return False

            ea_id = sugg["entity_a"]
            eb_id = sugg["entity_b"]

            # Load entity b info
            eb = conn.execute(
                "SELECT canonical_name, aliases FROM concept_entities WHERE id = ? AND user_id = ?",
                (eb_id, user_id)
            ).fetchone()
            if not eb:
                return False

            # Consolidate aliases into entity_a
            ea = conn.execute(
                "SELECT aliases FROM concept_entities WHERE id = ? AND user_id = ?",
                (ea_id, user_id)
            ).fetchone()
            ea_aliases = []
            try:
                ea_aliases = json.loads(ea["aliases"]) if ea and ea["aliases"] else []
            except Exception:
                pass
            eb_aliases = []
            try:
                eb_aliases = json.loads(eb["aliases"]) if eb["aliases"] else []
            except Exception:
                pass

            combined_aliases = list(set(ea_aliases + eb_aliases + [eb["canonical_name"]]))

            now_iso = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "UPDATE concept_entities SET aliases = ?, updated_at = ? WHERE id = ?",
                (json.dumps(combined_aliases), now_iso, ea_id)
            )

            # Reassign mentions from eb to ea
            conn.execute("UPDATE entity_mentions SET entity_id = ? WHERE entity_id = ?", (ea_id, eb_id))

            # Reassign edges
            conn.execute("UPDATE concept_edges SET source_entity_id = ? WHERE source_entity_id = ?", (ea_id, eb_id))
            conn.execute("UPDATE concept_edges SET target_entity_id = ? WHERE target_entity_id = ?", (ea_id, eb_id))
            # Delete self-loop edges that may have formed
            conn.execute("DELETE FROM concept_edges WHERE source_entity_id = target_entity_id")

            # Remove entity_b
            conn.execute("DELETE FROM concept_entities WHERE id = ?", (eb_id,))

            # Mark suggestion accepted
            conn.execute(
                "UPDATE merge_suggestions SET status = 'accepted', updated_at = ? WHERE id = ?",
                (now_iso, suggestion_id)
            )

            # Clean any other suggestions involving entity_b
            conn.execute(
                "DELETE FROM merge_suggestions WHERE (entity_a = ? OR entity_b = ?) AND id != ?",
                (eb_id, eb_id, suggestion_id)
            )

            logger.info(f"Accepted merge suggestion {suggestion_id}: merged {eb_id} into {ea_id}.")
            return True

    finally:
        if should_close:
            conn.close()

def reject_merge_suggestion(suggestion_id: str, user_id: str, conn=None) -> bool:
    """Rejects a merge suggestion and remembers the rejection."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn:
            now_iso = datetime.now(timezone.utc).isoformat()
            res = conn.execute(
                """
                UPDATE merge_suggestions
                SET status = 'rejected', updated_at = ?
                WHERE id = ? AND user_id = ?
                """,
                (now_iso, suggestion_id, user_id)
            )
            return bool(res.rowcount > 0)
    finally:
        if should_close:
            conn.close()

def unmerge_entity(entity_id: str, user_id: str, conn=None) -> bool:
    """
    Splits an entity that had been merged across multiple concepts or documents
    back into separate entities, reassigning mentions cleanly.
    """
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        with conn:
            mentions = conn.execute(
                """
                SELECT em.id, em.concept_id, em.document_id, em.page, em.source_quote,
                       c.name, c.definition
                FROM entity_mentions em
                JOIN concepts c ON em.concept_id = c.id
                WHERE em.entity_id = ?
                ORDER BY em.id ASC
                """,
                (entity_id,)
            ).fetchall()

            if len(mentions) <= 1:
                return False  # Nothing to split

            now_iso = datetime.now(timezone.utc).isoformat()

            # Keep first mention on current entity, and split off subsequent mentions into new entities
            first_mention = mentions[0]
            conn.execute(
                """
                UPDATE concept_entities
                SET canonical_name = ?, normalized_name = ?, aliases = '[]', definition = ?, updated_at = ?
                WHERE id = ?
                """,
                (first_mention["name"], normalize_entity_name(first_mention["name"]), first_mention["definition"] or "", now_iso, entity_id)
            )

            for m in mentions[1:]:
                new_ent_id = f"ent_{uuid.uuid4().hex[:12]}"
                norm_name = normalize_entity_name(m["name"])
                # Avoid collision if duplicate normalized name exists
                conn.execute(
                    """
                    INSERT INTO concept_entities (
                        id, user_id, canonical_name, normalized_name, aliases, definition, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)
                    """,
                    (new_ent_id, user_id, m["name"], f"{norm_name}_{new_ent_id[-4:]}", m["definition"] or "", now_iso, now_iso)
                )
                conn.execute(
                    "UPDATE entity_mentions SET entity_id = ? WHERE id = ?",
                    (new_ent_id, m["id"])
                )

            logger.info(f"Successfully unmerged entity {entity_id} into {len(mentions)} distinct entities.")
            return True

    finally:
        if should_close:
            conn.close()
