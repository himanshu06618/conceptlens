import os
import re
import uuid
import csv
import io
import json
import logging
import time
import hashlib
import threading
from contextlib import asynccontextmanager
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any, Literal

# Add backend directory and root directory to sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(backend_dir.parent) not in sys.path:
    sys.path.insert(0, str(backend_dir.parent))

from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, BackgroundTasks, Query, Request, Response, Depends
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv
import pymupdf as fitz

load_dotenv(backend_dir / ".env")
load_dotenv()

try:
    from backend.database import (
        init_db,
        get_connection,
        is_postgres,
        create_document,
        update_document_stage,
        mark_document_completed,
        mark_document_failed,
        get_documents_list,
        get_document_by_id,
        get_document_by_id_guest_fallback,
        delete_document_by_id,
        save_concepts_and_relations,
        get_concepts_by_document,
        get_distinct_topics,
        get_document_count_by_user,
        get_document_tree,
        save_document_tree,
        save_document_flowchart,
        get_document_flowchart_cache,
        document_exists,
        find_completed_document_by_hash,
        find_document_by_hash,
        find_document_by_idempotency_key,
        clone_cached_document,
        rename_document_by_id,
        get_concept_by_id_and_user,
        verify_concept_owner,
        set_concept_progress,
        bulk_set_concept_progress,
        get_concept_progress_for_document,
        get_user_concept_progress_map,
        save_document_page_coverage,
        get_document_page_coverage,
        get_document_coverage_summary,
        save_document_file_blob,
        get_document_file_blob,
        ensure_document_file_on_disk
    )
    from backend.services.normalizer import normalize_extracted_concepts, SCHEMA_VERSION
    from backend.models import (
        DocumentItem,
        DocumentDetail,
        DocumentConceptsResponse,
        UploadResponse
    )
    from backend.auth import (
        get_current_user,
        get_current_user_or_guest,
        require_role,
        verify_csrf,
        ALLOWED_ORIGINS
    )
    from backend.routers.auth import router as auth_router, limiter
    from backend.routers.planner import router as planner_router
    from backend.routers.notes import router as notes_router
    from backend.routers.graph import router as graph_router
    from backend.services.notes_db import init_notes_db
    from backend.services.planner_db import (
        init_planner_db,
        backfill_unlinked_documents,
        link_document_to_curriculum,
        ensure_default_subject_and_chapters_for_user,
        get_dashboard_summary_data
    )
    from backend.services.topic_relations import process_document_chapters_and_relations
    from backend.services.file_reader import (
        read_document_file,
        ALLOWED_EXTENSIONS,
        UnsupportedFileTypeError,
        EmptyFileError,
        EncryptedPdfError,
        CorruptedPdfError
    )
    from backend.services.concept_extraction import (
        extract_concepts_pipeline,
        extract_fallback_concepts,
        TOP_CONCEPTS_LIMIT_DEFAULT
    )
    from backend.services.tree_builder import build_document_tree
    from backend.services.flowchart_builder import build_document_flowchart, select_flowchart_view
    from backend.services.extraction_v2 import ExtractionV2Pipeline
    from backend.services.layout_extractor import LayoutExtractor
    from backend.services.cloud_extraction import (
        extract_document_with_gemini,
        check_gemini_key_valid,
        GEMINI_MODEL,
        GeminiQuotaError
    )
except ImportError:
    from database import (
        init_db,
        get_connection,
        is_postgres,
        create_document,
        update_document_stage,
        mark_document_completed,
        mark_document_failed,
        get_documents_list,
        get_document_by_id,
        get_document_by_id_guest_fallback,
        delete_document_by_id,
        save_concepts_and_relations,
        get_concepts_by_document,
        get_distinct_topics,
        get_document_count_by_user,
        get_document_tree,
        save_document_tree,
        save_document_flowchart,
        get_document_flowchart_cache,
        document_exists,
        find_completed_document_by_hash,
        find_document_by_hash,
        find_document_by_idempotency_key,
        clone_cached_document,
        rename_document_by_id,
        get_concept_by_id_and_user,
        verify_concept_owner,
        set_concept_progress,
        bulk_set_concept_progress,
        get_concept_progress_for_document,
        get_user_concept_progress_map,
        save_document_page_coverage,
        get_document_page_coverage,
        get_document_coverage_summary,
        save_document_file_blob,
        get_document_file_blob,
        ensure_document_file_on_disk
    )
    from services.normalizer import normalize_extracted_concepts, SCHEMA_VERSION
    from models import (
        DocumentItem,
        DocumentDetail,
        DocumentConceptsResponse,
        UploadResponse
    )
    from auth import (
        get_current_user,
        get_current_user_or_guest,
        require_role,
        verify_csrf,
        ALLOWED_ORIGINS
    )
    from routers.auth import router as auth_router, limiter
    from routers.planner import router as planner_router
    from routers.notes import router as notes_router
    from routers.graph import router as graph_router
    from services.notes_db import init_notes_db
    from services.planner_db import (
        init_planner_db,
        backfill_unlinked_documents,
        link_document_to_curriculum,
        ensure_default_subject_and_chapters_for_user,
        get_dashboard_summary_data
    )
    from services.topic_relations import process_document_chapters_and_relations
    from services.file_reader import (
        read_document_file,
        ALLOWED_EXTENSIONS,
        UnsupportedFileTypeError,
        EmptyFileError,
        EncryptedPdfError,
        CorruptedPdfError
    )
    from services.concept_extraction import (
        extract_concepts_pipeline,
        extract_fallback_concepts,
        TOP_CONCEPTS_LIMIT_DEFAULT
    )
    from services.tree_builder import build_document_tree
    from services.flowchart_builder import build_document_flowchart, select_flowchart_view
    from services.extraction_v2 import ExtractionV2Pipeline
    from services.layout_extractor import LayoutExtractor
    from services.cloud_extraction import (
        extract_document_with_gemini,
        check_gemini_key_valid,
        GEMINI_MODEL,
        GeminiQuotaError
    )

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("conceptlens.api")

load_dotenv()

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = Path(__file__).resolve().parent / UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB strict limit
MAX_PDF_PAGES = 100  # 100 pages strict limit
GUEST_UPLOAD_LIMIT = int(os.getenv("GUEST_UPLOAD_LIMIT", "5"))

# Single worker lock protecting Render 512 MB memory
_worker_lock = threading.Lock()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database tables and verify Gemini connection
    try:
        from backend.database import is_postgres
    except ImportError:
        from database import is_postgres
    db_type_label = "PostgreSQL (Neon)" if is_postgres() else "SQLite"
    logger.info(f"Initializing {db_type_label} database with schema...")
    init_db()
    try:
        init_notes_db()
    except Exception as e:
        logger.warning(f"Notes DB initialization warning: {e}")

    try:
        try:
            from backend.services.graph_service import init_graph_db
        except ImportError:
            from services.graph_service import init_graph_db
        init_graph_db()
    except Exception as e:
        logger.warning(f"Graph DB initialization warning in lifespan: {e}")

    try:
        init_planner_db()
        conn = get_connection()
        try:
            acquired = True
            if is_postgres():
                lock_res = conn.execute("SELECT pg_try_advisory_lock(7429104)").fetchone()
                acquired = bool(lock_res and (lock_res[0] is True or lock_res[0] == 1))
            if acquired:
                try:
                    backfilled = backfill_unlinked_documents()
                    if backfilled > 0:
                        logger.info(f"Startup backfill: linked {backfilled} earlier documents to Core Curriculum.")
                finally:
                    if is_postgres():
                        conn.execute("SELECT pg_advisory_unlock(7429104)")
            else:
                logger.info("Startup backfill skipped: advisory lock currently held by another worker.")
        finally:
            conn.close()
    except Exception as e:
        logger.warning(f"Planner DB initialization / backfill warning: {e}")

    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    if gemini_key_set:
        logger.info(f"Gemini API configured (model: {GEMINI_MODEL}). Fast startup: verification deferred to upload time.")
    else:
        logger.info("Default extraction path: LIGHTWEIGHT FALLBACK (PyMuPDF + YAKE, reason: GEMINI_API_KEY not set).")

    yield
    logger.info("Shutting down ConceptLens API server...")

app = FastAPI(
    title="ConceptLens API",
    description="Course Notes Concept Extraction & Knowledge Analysis with Open Guest Dashboard & Workspaces",
    version="1.2.0",
    lifespan=lifespan
)

# Connect rate limiter
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def custom_rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many attempts. Please try again in a minute."}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log exception traceback server-side (never secrets, tokens, or document content)
    logger.exception(f"Unhandled server error on {request.method} {request.url.path}: {type(exc).__name__}")
    response = JSONResponse(
        status_code=500,
        content={"detail": "Internal error"}
    )
    # Ensure CORS headers are explicitly present on 500 error responses
    origin = request.headers.get("origin")
    allowed = False
    if origin:
        if origin in ALLOWED_ORIGINS or origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
            allowed = True
        elif re.match(r"^https:\/\/.*\.vercel\.app$", origin):
            allowed = True
    if allowed and origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "*"
    return response

class TimingProfilerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            from backend.database import reset_query_counter, get_query_count
        except ImportError:
            from database import reset_query_counter, get_query_count

        reset_query_counter()
        t0 = time.perf_counter()
        response = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = (time.perf_counter() - t0) * 1000.0
            query_count = get_query_count()
            # Server-side timing log: endpoint name, duration, number of SQL queries (never content or secrets)
            logger.info(f"[TIMING] {request.method} {request.url.path} -> {duration_ms:.1f}ms ({query_count} SQL queries)")
            if response is not None and hasattr(response, "headers"):
                response.headers["X-Process-Time"] = f"{duration_ms:.1f}ms"

# Inner middleware: Request timing profiler
app.add_middleware(TimingProfilerMiddleware)

# Response compression middleware for fast payload transfers over 1KB
from starlette.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Outermost middleware: CORS with credentials for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# Mount authentication router under both /api/auth and /auth
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])

# Mount planner router
app.include_router(planner_router)
try:
    from backend.routers.planner import get_dashboard_bootstrap_endpoint, get_dashboard_summary_endpoint
    app.get("/dashboard/bootstrap", tags=["planner"])(get_dashboard_bootstrap_endpoint)
    app.get("/dashboard/summary", tags=["planner"])(get_dashboard_summary_endpoint)
except ImportError:
    from routers.planner import get_dashboard_bootstrap_endpoint, get_dashboard_summary_endpoint
    app.get("/dashboard/bootstrap", tags=["planner"])(get_dashboard_bootstrap_endpoint)
    app.get("/dashboard/summary", tags=["planner"])(get_dashboard_summary_endpoint)

# Mount personal notes router under both /api/notes and /notes
app.include_router(notes_router, prefix="/api/notes", tags=["notes"])
app.include_router(notes_router, prefix="/notes", tags=["notes"])

# Mount Graph RAG and Visualisations router under both /api and root
app.include_router(graph_router, prefix="/api")
app.include_router(graph_router)

# EXTRACTOR-CHOICE-START
try:
    from backend.extractor_choice.api import router as extractor_router
    app.include_router(extractor_router)
except ImportError:
    try:
        from extractor_choice.api import router as extractor_router
        app.include_router(extractor_router)
    except ImportError:
        pass
# EXTRACTOR-CHOICE-END

def process_document_background(
    doc_id: str,
    file_path: Path,
    pdf_password: Optional[str] = None,
    prefer_cloud: bool = True,
    user_id: Optional[str] = None,
    # EXTRACTOR-CHOICE-START
    extractor: str = "gemini"
    # EXTRACTOR-CHOICE-END
):
    """Background task to extract concepts with Gemini API, build tree & flowchart, and protect memory."""
    t_start = time.perf_counter()
    logger.info(f"Queued background processing for document {doc_id} ({file_path.name})...")

    # Defensive resolution of user_id if not provided
    if not user_id:
        try:
            conn_u = get_connection()
            try:
                row_u = conn_u.execute("SELECT user_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
                if row_u:
                    user_id = row_u["user_id"]
            finally:
                conn_u.close()
        except Exception as e_uid:
            logger.warning(f"Could not resolve user_id for document {doc_id}: {e_uid}")

    update_document_stage(
        doc_id,
        stage="reading",
        status="processing",
        progress=10,
        stage_message="Queued for processing..."
    )

    # Acquire worker lock to guarantee only 1 extraction job runs at a time per worker
    with _worker_lock:
        update_document_stage(
            doc_id,
            stage="reading",
            status="processing",
            progress=20,
            stage_message="Reading document layout..."
        )

        try:
            # 1. Read document structure using PyMuPDF (zero heavy models)
            page_count, pages, full_text, has_usable_text = read_document_file(
                file_path,
                pdf_password=pdf_password
            )

            # 2. Extract concepts via Gemini API (with lightweight fallback)
            update_document_stage(
                doc_id,
                stage="extracting",
                status="processing",
                progress=40,
                stage_message="Extracting educational concepts & definitions with Gemini AI..."
            )

            # EXTRACTOR-CHOICE-START
            extractor_used = "gemini"
            fallback = False
            fallback_reason = None
            concepts = []
            relations = []
            provider_used = "Pipeline-v2"
            page_coverage_records = []

            enable_extractor_choice = os.getenv("ENABLE_EXTRACTOR_CHOICE", "true").strip().lower() not in ("0", "false", "no")
            if enable_extractor_choice and extractor and extractor.strip().lower() != "gemini":
                update_document_stage(
                    doc_id,
                    stage="extracting",
                    status="processing",
                    progress=35,
                    stage_message=f"Extracting concepts using {extractor}..."
                )
                try:
                    from backend.extractor_choice.service import run_extraction
                except ImportError:
                    try:
                        from extractor_choice.service import run_extraction
                    except ImportError:
                        run_extraction = None

                if run_extraction:
                    choice_res = run_extraction(file_path, extractor, pdf_password=pdf_password)
                    if choice_res and not choice_res.get("fallback") and choice_res.get("concepts"):
                        concepts = choice_res["concepts"]
                        extractor_used = choice_res.get("extractor_used", extractor)
                        provider_used = extractor_used
                    elif choice_res and choice_res.get("fallback"):
                        fallback = True
                        fallback_reason = choice_res.get("fallback_reason")
                        logger.info(f"Extractor '{extractor}' requested fallback: {fallback_reason}. Running Gemini.")
            # EXTRACTOR-CHOICE-END

            if not concepts:
                # 2. Extract concepts via Pipeline v2 with full layout awareness & coverage guarantee
                update_document_stage(
                    doc_id,
                    stage="extracting",
                    status="processing",
                    progress=30,
                    stage_message="Extracting educational concepts with Pipeline v2 (page-batched)..."
                )

                pipeline_v2 = ExtractionV2Pipeline()
                v2_result = pipeline_v2.extract_document(
                    file_path=file_path,
                    doc_id=doc_id,
                    user_id=user_id,
                    on_progress=lambda msg, pct: update_document_stage(
                        doc_id,
                        stage="extracting",
                        status="processing",
                        progress=pct,
                        stage_message=msg
                    )
                )

                concepts = v2_result.get("concepts", [])
                relations = v2_result.get("relations", [])
                provider_used = v2_result.get("provider_used", "Pipeline-v2")
                page_coverage_records = v2_result.get("page_coverage", [])

            # Save page coverage tracking
            if page_coverage_records:
                save_document_page_coverage(doc_id, page_coverage_records)

            if not concepts:
                # Emergency fallback: derive concepts from full_text or document filename
                text_to_mine = full_text or ""
                if not text_to_mine and file_path.exists():
                    try:
                        text_to_mine = file_path.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        pass
                if text_to_mine:
                    lines = [l.strip() for l in text_to_mine.split("\n") if len(l.strip()) >= 5]
                    fallback_concepts = []
                    for idx, line in enumerate(lines[:10]):
                        parts = line.split(":", 1) if ":" in line else line.split(" - ", 1)
                        c_name = parts[0].strip() if len(parts) > 1 and len(parts[0].split()) <= 6 else line[:50].strip()
                        c_def = parts[1].strip() if len(parts) > 1 else line
                        if c_name:
                            fallback_concepts.append({
                                "id": f"c_{idx + 1}",
                                "name": c_name.title(),
                                "definition": c_def or "Concept from notes",
                                "importance": 2,
                                "source_excerpt": line[:200],
                                "source_quote": line[:200],
                                "source_page": 1,
                                "page": 1,
                                "pages": [1],
                                "source_verified": True,
                                "topic": "General"
                            })
                    if fallback_concepts:
                        concepts = fallback_concepts

            if not concepts:
                mark_document_failed(doc_id, "No key educational concepts could be extracted from this document.")
                return

            # Check if doc was deleted during processing
            if not document_exists(doc_id):
                logger.info(f"Document {doc_id} was deleted during processing; aborting.")
                return

            # 3. Background Prebuild: Concept Tree & Flowchart
            update_document_stage(
                doc_id,
                stage="extracting",
                status="processing",
                progress=85,
                stage_message="Building concept tree & flowchart graph (85%)..."
            )
            try:
                tree_data = build_document_tree(doc_id, file_path.name, concepts)
                save_document_tree(doc_id, tree_data)
            except Exception as e_tree:
                logger.warning(f"Could not build concept tree for {doc_id}: {e_tree}")

            try:
                flow_data = build_document_flowchart(doc_id, concepts, full_text, include_related=True)
                save_document_flowchart(doc_id, flow_data)
            except Exception as e_flow:
                logger.warning(f"Could not build flowchart for {doc_id}: {e_flow}")

            # 4. Database Save
            update_document_stage(
                doc_id,
                stage="extracting",
                status="processing",
                progress=95,
                stage_message="Saving knowledge structures & relations (95%)..."
            )
            save_concepts_and_relations(doc_id, concepts)

            # If S3 storage is enabled, optionally persist to S3 within user quota
            try:
                try:
                    from backend.services.file_storage import (
                        is_s3_configured,
                        upload_file_to_s3,
                        save_document_file_record,
                        get_user_storage_usage,
                        DEFAULT_QUOTA_BYTES
                    )
                except ImportError:
                    from services.file_storage import (
                        is_s3_configured,
                        upload_file_to_s3,
                        save_document_file_record,
                        get_user_storage_usage,
                        DEFAULT_QUOTA_BYTES
                    )

                if is_s3_configured() and file_path.exists():
                    conn_s3 = get_connection()
                    try:
                        doc_row = conn_s3.execute("SELECT user_id, file_hash FROM documents WHERE id = ?", (doc_id,)).fetchone()
                        u_id = user_id or (doc_row["user_id"] if doc_row else None)
                        f_hash = doc_row["file_hash"] if doc_row else None
                        if u_id:
                            f_size = file_path.stat().st_size
                            used = get_user_storage_usage(conn_s3, u_id)
                            if used + f_size <= DEFAULT_QUOTA_BYTES:
                                s3_key = f"documents/{u_id}/{doc_id}/{file_path.name}"
                                mime = "application/pdf" if file_path.suffix.lower() == ".pdf" else "application/octet-stream"
                                with open(file_path, "rb") as f_obj:
                                    uploaded = upload_file_to_s3(s3_key, f_obj, content_type=mime)
                                if uploaded:
                                    save_document_file_record(
                                        conn_s3,
                                        document_id=doc_id,
                                        user_id=u_id,
                                        provider="s3",
                                        storage_key=s3_key,
                                        size=f_size,
                                        mime=mime,
                                        sha256=f_hash or ""
                                    )
                    finally:
                        conn_s3.close()
            except Exception as e_s3:
                logger.warning(f"Could not persist file to S3 for {doc_id}: {e_s3}")

            # Process chapters & relations for Study Planner BEFORE marking completed
            try:
                process_document_chapters_and_relations(doc_id)
            except Exception as e_rel:
                logger.warning(f"Could not build chapter relations for document {doc_id}: {e_rel}")

            # Process Graph RAG & chunks for Graph / Ask features
            try:
                doc_uid = user_id
                if not doc_uid:
                    conn_doc = get_connection()
                    try:
                        doc_owner = conn_doc.execute("SELECT user_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
                        doc_uid = doc_owner["user_id"] if doc_owner else None
                    finally:
                        conn_doc.close()

                if doc_uid:
                    # 1. Chunk document and generate embeddings
                    try:
                        from backend.services.rag_service import chunk_document_file
                    except ImportError:
                        from services.rag_service import chunk_document_file
                    chunk_document_file(file_path=file_path, doc_id=doc_id, user_id=doc_uid)

                    # 2. Incrementally resolve entities & build graph edges
                    try:
                        from backend.services.graph_service import (
                            resolve_entities_for_document,
                            build_edges_for_document
                        )
                    except ImportError:
                        from services.graph_service import (
                            resolve_entities_for_document,
                            build_edges_for_document
                        )
                    concept_to_ent = resolve_entities_for_document(doc_id, doc_uid)
                    build_edges_for_document(doc_id, doc_uid, concept_to_ent, file_path=file_path)
            except Exception as e_graph:
                logger.warning(f"Could not build graph / chunks for document {doc_id}: {e_graph}")

            t_total = time.perf_counter() - t_start

            mark_document_completed(
                doc_id,
                page_count=page_count,
                raw_text=full_text,
                processing_time_sec=t_total,
                provider_used=provider_used,
                extractor_used=extractor_used
            )

            # EXTRACTOR-CHOICE-START
            try:
                meta_payload = json.dumps({
                    "extractor_used": extractor_used,
                    "fallback": fallback,
                    "fallback_reason": fallback_reason
                })
                conn_meta = get_connection()
                try:
                    with conn_meta:
                        conn_meta.execute("UPDATE documents SET result_json = ? WHERE id = ?", (meta_payload, doc_id))
                finally:
                    conn_meta.close()
            except Exception as e_m:
                logger.warning(f"Could not persist extractor metadata in result_json: {e_m}")
            # EXTRACTOR-CHOICE-END

            logger.info(f"Document {doc_id} processing completed successfully in {t_total:.2f}s ({len(concepts)} concepts).")

        except EncryptedPdfError as enc_err:
            logger.warning(f"Document {doc_id} requires password: {enc_err}")
            mark_document_failed(doc_id, "Password required: This PDF is password-protected. Please enter the password to decrypt.")
        except EmptyFileError as empty_err:
            logger.warning(f"Document {doc_id} empty text: {empty_err}")
            mark_document_failed(doc_id, str(empty_err))
        except CorruptedPdfError as corrupt_err:
            logger.warning(f"Document {doc_id} corrupted PDF: {corrupt_err}")
            mark_document_failed(doc_id, "The PDF file is corrupted or could not be parsed.")
        except UnsupportedFileTypeError as type_err:
            logger.warning(f"Document {doc_id} unsupported type: {type_err}")
            mark_document_failed(doc_id, str(type_err))
        except Exception as ex:
            logger.exception(f"Unexpected error processing document {doc_id}: {ex}")
            mark_document_failed(doc_id, f"Processing error: {str(ex)}")

@app.get("/health")
def health_check_root():
    """Lightweight health check for Render / deployment platforms."""
    return {"status": "ok"}

@app.get("/health/db")
@app.get("/api/health/db")
def health_db():
    """
    Database health check: executes 'SELECT 1' and checks that every expected table and column exists.
    Returns {"status": "ok"} or {"status": "error", "missing": [names only]}.
    Never exposes connection strings, credentials, or internal error tracebacks.
    """
    try:
        from backend.database import check_database_schema_health
    except ImportError:
        from database import check_database_schema_health
    result = check_database_schema_health()
    if result.get("status") == "ok":
        return result
    return JSONResponse(status_code=503, content=result)



@app.get("/api/health")
def health_check():
    gemini_valid, gemini_msg = check_gemini_key_valid()
    return {
        "status": "healthy",
        "app": "ConceptLens",
        "ocr_engine": "gemini-multimodal",
        "gemini_model": GEMINI_MODEL,
        "gemini_valid": gemini_valid,
        "auth_enabled": True,
        "guest_upload_limit": GUEST_UPLOAD_LIMIT
    }

@app.get("/version")
@app.get("/api/version")
def get_version():
    """
    Returns deployment build and commit metadata without exposing secrets.
    """
    commit_sha = (
        os.environ.get("RENDER_GIT_COMMIT") or 
        os.environ.get("VERCEL_GIT_COMMIT_SHA") or 
        os.environ.get("GIT_COMMIT") or 
        "3b1b4f9"
    )[:7]
    return {
        "commit": commit_sha,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "environment": os.environ.get("ENVIRONMENT", "production"),
        "status": "ok"
    }

@app.get("/api/health/providers")
def check_providers_health():
    """Reports status of Gemini API, model, and extraction mode."""
    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    gemini_valid, gemini_msg = check_gemini_key_valid()
    active_mode = "cloud" if gemini_valid else "on-device-fallback"
    return {
        "gemini_api_key_set": gemini_key_set,
        "gemini_api_key_valid": gemini_valid,
        "gemini_status_message": gemini_msg,
        "gemini_model": GEMINI_MODEL,
        "active_extraction_mode": active_mode,
        "rapidocr_available": False,
        "rapidocr_message": "Replaced by Gemini multimodal AI OCR",
        "tesseract_available": False,
        "default_upload_path": "cloud" if gemini_valid else "on-device",
        "default_upload_path_reason": "Gemini AI multimodal extraction active" if gemini_valid else f"No valid Gemini API key ({gemini_msg}), using lightweight on-device fallback"
    }

@app.get("/api/guest/status")
def get_guest_status(actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    if actor["is_authenticated"]:
        used = get_document_count_by_user(actor["id"])
        return {
            "is_authenticated": True,
            "uploads_count": used,
            "upload_limit": None,
            "remaining": None
        }
    used = get_document_count_by_user(actor["id"])
    remaining = max(0, GUEST_UPLOAD_LIMIT - used)
    return {
        "is_authenticated": False,
        "uploads_count": used,
        "upload_limit": GUEST_UPLOAD_LIMIT,
        "remaining": remaining,
        "guest_id": actor["id"]
    }

@app.post("/api/documents", response_model=UploadResponse)
@app.post("/documents", response_model=UploadResponse)
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    pdf_password: Optional[str] = Form(None),
    extraction_mode: Optional[str] = Form(None),
    # EXTRACTOR-CHOICE-START
    extractor: Optional[str] = Form("gemini"),
    # EXTRACTOR-CHOICE-END
    idempotency_key: Optional[str] = Form(None),
    x_idempotency_key: Optional[str] = Header(None, alias="X-Idempotency-Key"),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    verify_csrf(request)

    effective_key = (idempotency_key or x_idempotency_key or "").strip() or None
    if effective_key:
        existing_by_key = find_document_by_idempotency_key(effective_key, actor["id"])
        if existing_by_key:
            logger.info(f"Idempotent upload HIT for key {effective_key} (doc {existing_by_key['id']})")
            return UploadResponse(
                id=existing_by_key["id"],
                filename=existing_by_key.get("filename", Path(file.filename or "uploaded_file").name),
                file_type=Path(existing_by_key.get("filename", "")).suffix.lower().lstrip("."),
                status=existing_by_key.get("status", "processing"),
                stage=existing_by_key.get("stage", "reading"),
                message="Existing document returned for idempotency key.",
                guest_id=actor["id"] if not actor.get("is_authenticated") else None
            )

    # Enforce free guest limit (5 uploads) before requiring login
    if not actor["is_authenticated"]:
        used_count = get_document_count_by_user(actor["id"])
        if used_count >= GUEST_UPLOAD_LIMIT:
            raise HTTPException(
                status_code=403,
                detail=f"Guest upload limit reached ({GUEST_UPLOAD_LIMIT} uploads). Please sign in or create a free account to continue uploading."
            )

    raw_filename = Path(file.filename or "uploaded_file").name
    safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', raw_filename)
    ext = Path(safe_filename).suffix.lower()

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format '{ext}'. Allowed: PDF, PNG, JPG, JPEG, WEBP, TXT, MD."
        )

    # Read and validate file content & size (10 MB strict limit)
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of 10 MB ({len(content) / (1024*1024):.1f} MB provided)."
        )
    if len(content) == 0:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty (0 bytes)."
        )

    # Validate PDF page count (100 pages strict limit)
    if ext == ".pdf":
        try:
            doc_pdf = fitz.open(stream=content, filetype="pdf")
            page_count = len(doc_pdf)
            doc_pdf.close()
            if page_count > MAX_PDF_PAGES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Document exceeds maximum allowed limit of {MAX_PDF_PAGES} pages ({page_count} pages provided)."
                )
        except HTTPException:
            raise
        except Exception as pdf_err:
            logger.warning(f"Could not inspect PDF page count for {safe_filename}: {pdf_err}")

    # Compute SHA-256 hash for deduplication and quota preservation
    file_hash = hashlib.sha256(content).hexdigest()

    # Check database cache for instant return (both completed and in-flight processing)
    existing_by_hash = find_document_by_hash(file_hash, user_id=actor["id"], include_failed=False)
    if existing_by_hash:
        doc_id = existing_by_hash["id"]
        status = existing_by_hash.get("status", "processing")
        stage = existing_by_hash.get("stage", "reading")
        logger.info(f"Upload duplicate HIT for hash {file_hash[:12]}... (doc {doc_id}, status={status})")
        if status == "completed" and actor["is_authenticated"]:
            try:
                link_document_to_curriculum(doc_id, actor["id"])
            except Exception as e_link:
                logger.warning(f"Could not link cached document {doc_id} to curriculum: {e_link}")

        msg = "Document extracted instantly from cache." if status == "completed" else "Document upload in progress."
        return UploadResponse(
            id=doc_id,
            filename=existing_by_hash.get("filename", safe_filename),
            file_type=ext.lstrip("."),
            status=status,
            stage=stage,
            message=msg,
            guest_id=actor["id"] if not actor.get("is_authenticated") else None
        )

    doc_id = str(uuid.uuid4())
    # User-isolated or guest-isolated upload directory
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    actor_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = actor_upload_dir / f"{doc_id}_{safe_filename}"

    with open(save_path, "wb") as f:
        f.write(content)

    # For authenticated users, ensure default Core Curriculum subject exists
    subject_id = None
    if actor["is_authenticated"]:
        conn = get_connection()
        try:
            with conn:
                sub_row = conn.execute(
                    "SELECT id FROM subjects WHERE user_id = ? ORDER BY (CASE WHEN name = 'Core Curriculum' THEN 0 ELSE 1 END), created_at ASC LIMIT 1",
                    (actor["id"],)
                ).fetchone()
                if sub_row:
                    subject_id = sub_row["id"]
                else:
                    subject_id = str(uuid.uuid4())
                    conn.execute(
                        "INSERT INTO subjects (id, user_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)",
                        (subject_id, actor["id"], "Core Curriculum", "CC-101", datetime.now(timezone.utc).isoformat())
                    )
        except Exception as e_sub:
            logger.warning(f"Could not prepare default subject for user {actor['id']}: {e_sub}")
        finally:
            conn.close()

    # Create document row in database tied to actor["id"] and file_hash (handling concurrent conflicts)
    doc_record = create_document(
        user_id=actor["id"],
        doc_id=doc_id,
        filename=safe_filename,
        file_type=ext.lstrip("."),
        status="processing",
        stage="reading",
        file_hash=file_hash,
        subject_id=subject_id,
        idempotency_key=effective_key,
        extractor_used=extractor or "gemini"
    )

    # Persist file bytes directly into database BLOB for permanent durability across restarts
    effective_doc_id = doc_record.get("id") or doc_id
    save_document_file_blob(
        doc_id=effective_doc_id,
        content=content,
        user_id=actor["id"],
        filename=safe_filename,
        file_hash=file_hash
    )

    if doc_record.get("id") != doc_id:
        logger.info(f"Concurrent upload conflict resolved to existing doc {doc_record['id']}")
        return UploadResponse(
            id=doc_record["id"],
            filename=doc_record.get("filename", safe_filename),
            file_type=ext.lstrip("."),
            status=doc_record.get("status", "processing"),
            stage=doc_record.get("stage", "reading"),
            message="Existing document returned after concurrent upload.",
            guest_id=actor["id"] if not actor.get("is_authenticated") else None
        )

    prefer_cloud = True
    if extraction_mode and extraction_mode.lower() in ("private", "on-device", "local", "offline"):
        prefer_cloud = False

    # Log provider decision
    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    if not prefer_cloud:
        logger.info(f"Upload {doc_id} path decision: ON-DEVICE (User selected {extraction_mode} mode)")
    elif not gemini_key_set:
        logger.info(f"Upload {doc_id} path decision: ON-DEVICE (No GEMINI_API_KEY set, using offline on-device)")
    else:
        logger.info(f"Upload {doc_id} path decision: CLOUD (Gemini AI primary, on-device fallback)")

    # Enqueue background processing
    background_tasks.add_task(
        process_document_background,
        doc_id,
        save_path,
        pdf_password=pdf_password,
        prefer_cloud=prefer_cloud,
        user_id=actor["id"],
        # EXTRACTOR-CHOICE-START
        extractor=extractor or "gemini"
        # EXTRACTOR-CHOICE-END
    )

    return UploadResponse(
        id=doc_id,
        filename=safe_filename,
        file_type=ext.lstrip("."),
        status="processing",
        stage="reading",
        message="Document uploaded successfully. Processing started.",
        guest_id=actor["id"] if not actor.get("is_authenticated") else None,
        # EXTRACTOR-CHOICE-START
        extractor_used=extractor or "gemini"
        # EXTRACTOR-CHOICE-END
    )

@app.get("/api/documents/{doc_id}/status")
@app.get("/documents/{doc_id}/status")
def get_document_status(doc_id: str, actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    """Lightweight polling endpoint returning processing status, progress percentage, message, provider, time."""
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc and not actor.get("is_authenticated"):
        doc = get_document_by_id_guest_fallback(doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    skipped = []
    if doc.get("skipped_pages"):
        try:
            skipped = json.loads(doc["skipped_pages"])
        except Exception:
            skipped = []
    # EXTRACTOR-CHOICE-START
    meta_info = {}
    if doc.get("result_json"):
        try:
            meta_info = json.loads(doc["result_json"])
        except Exception:
            pass
    # EXTRACTOR-CHOICE-END
    return {
        "id": doc["id"],
        "filename": doc["filename"],
        "status": doc["status"],
        "stage": doc["stage"],
        "progress": doc.get("progress", 0),
        "stage_message": doc.get("stage_message", ""),
        "ocr_current_page": doc.get("ocr_current_page", 0),
        "ocr_total_pages": doc.get("ocr_total_pages", 0),
        "error": doc["error"],
        "page_count": doc.get("page_count", 1),
        "processing_time_sec": doc.get("processing_time_sec", 0.0),
        "provider_used": doc.get("provider_used", "on-device"),
        "skipped_pages": skipped,
        "concept_count": doc.get("concept_count", 0),
        # EXTRACTOR-CHOICE-START
        "extractor_used": meta_info.get("extractor_used", doc.get("provider_used", "gemini")),
        "fallback": meta_info.get("fallback", False),
        "fallback_reason": meta_info.get("fallback_reason", None)
        # EXTRACTOR-CHOICE-END
    }

@app.get("/api/documents/{doc_id}/file")
@app.get("/documents/{doc_id}/file")
def get_document_file(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """
    Serves the source document file inline (e.g. PDF) so the user can deep dive
    into specific pages via URL fragments like #page=N.
    """
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    filename = doc["filename"]
    file_path = ensure_document_file_on_disk(doc_id=doc_id, user_id=actor["id"], filename=filename)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Source document file not found on server or database.")

    ext = Path(filename).suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=str(file_path),
        media_type=media_type,
        filename=filename,
        content_disposition_type="inline"
    )

@app.get("/api/documents/{doc_id}/file-url")
@app.get("/documents/{doc_id}/file-url")
def get_document_file_url(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """
    Returns file source URL for the in-app PDF viewer.
    - If stored in S3: generates a temporary SigV4 presigned download URL (valid 300s).
    - If stored on server: returns local /api/documents/{doc_id}/file route.
    - Otherwise: returns provider='browser' indicating client should load from IndexedDB.
    Strictly scoped to the verified document owner.
    """
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    conn = get_connection()
    try:
        try:
            from backend.services.file_storage import (
                is_s3_configured,
                generate_presigned_download_url,
                get_document_file_record
            )
        except ImportError:
            from services.file_storage import (
                is_s3_configured,
                generate_presigned_download_url,
                get_document_file_record
            )

        file_record = get_document_file_record(conn, doc_id)
        if file_record and file_record.get("provider") == "s3" and file_record.get("storage_key") and is_s3_configured():
            presigned = generate_presigned_download_url(file_record["storage_key"], expires_in=300)
            return {
                "document_id": doc_id,
                "provider": "s3",
                "url": presigned,
                "filename": doc["filename"],
                "file_hash": doc.get("file_hash"),
                "mime": file_record.get("mime", "application/pdf")
            }
    finally:
        conn.close()

    filename = doc["filename"]
    file_path = ensure_document_file_on_disk(doc_id=doc_id, user_id=actor["id"], filename=filename)
    if file_path and file_path.exists():
        return {
            "document_id": doc_id,
            "provider": "server",
            "url": f"/api/documents/{doc_id}/file",
            "filename": doc["filename"],
            "file_hash": doc.get("file_hash"),
            "mime": "application/pdf" if Path(filename).suffix.lower() == ".pdf" else "application/octet-stream"
        }

    return {
        "document_id": doc_id,
        "provider": "browser",
        "url": None,
        "filename": doc["filename"],
        "file_hash": doc.get("file_hash"),
        "mime": "application/pdf" if Path(filename).suffix.lower() == ".pdf" else "application/octet-stream"
    }

@app.post("/api/documents/{doc_id}/file")
@app.post("/documents/{doc_id}/file")
async def reattach_document_file(
    doc_id: str,
    file: UploadFile = File(...),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """
    Re-attaches an original document file for an existing document.
    - Owner-scoped check.
    - Verifies file SHA-256 against documents.file_hash (if set).
    - Stores file in S3 if configured (quota-checked) or server disk.
    - Runs PyMuPDF page-by-page locator on stored concepts to backfill source_page and source_quote.
    - Re-saves updated concepts with verified pages.
    """
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="The uploaded file is empty (0 bytes).")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds maximum size limit of 10 MB.")

    file_sha = hashlib.sha256(content).hexdigest()
    expected_hash = doc.get("file_hash")
    if expected_hash and expected_hash != file_sha:
        raise HTTPException(
            status_code=400,
            detail="File verification failed: Content does not match the original document."
        )

    raw_filename = Path(file.filename or doc["filename"]).name
    safe_filename = re.sub(r'[^a-zA-Z0-9_.-]', '_', raw_filename)
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    actor_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = actor_upload_dir / f"{doc_id}_{safe_filename}"
    with open(save_path, "wb") as f_out:
        f_out.write(content)

    save_document_file_blob(
        doc_id=doc_id,
        content=content,
        user_id=actor["id"],
        filename=safe_filename,
        file_hash=file_sha
    )

    conn = get_connection()
    provider = "server"
    try:
        try:
            from backend.services.file_storage import (
                is_s3_configured,
                upload_file_to_s3,
                save_document_file_record,
                get_user_storage_usage,
                DEFAULT_QUOTA_BYTES
            )
        except ImportError:
            from services.file_storage import (
                is_s3_configured,
                upload_file_to_s3,
                save_document_file_record,
                get_user_storage_usage,
                DEFAULT_QUOTA_BYTES
            )

        if is_s3_configured() and actor.get("id"):
            used = get_user_storage_usage(conn, actor["id"])
            if used + len(content) <= DEFAULT_QUOTA_BYTES:
                s3_key = f"documents/{actor['id']}/{doc_id}/{safe_filename}"
                mime = "application/pdf" if safe_filename.lower().endswith(".pdf") else "application/octet-stream"
                uploaded = upload_file_to_s3(s3_key, content, content_type=mime)
                if uploaded:
                    save_document_file_record(
                        conn,
                        document_id=doc_id,
                        user_id=actor["id"],
                        provider="s3",
                        storage_key=s3_key,
                        size=len(content),
                        mime=mime,
                        sha256=file_sha
                    )
                    provider = "s3"

        if provider != "s3":
            save_document_file_record(
                conn,
                document_id=doc_id,
                user_id=actor["id"],
                provider="server",
                storage_key=str(save_path),
                size=len(content),
                mime="application/pdf" if safe_filename.lower().endswith(".pdf") else "application/octet-stream",
                sha256=file_sha
            )
    finally:
        conn.close()

    raw_concepts = get_concepts_by_document(doc_id=doc_id)
    backfilled_count = 0
    if raw_concepts:
        try:
            from backend.services.source_locator import locate_concepts_in_document
        except ImportError:
            from services.source_locator import locate_concepts_in_document

        updated_concepts = locate_concepts_in_document(content, safe_filename, raw_concepts)
        save_concepts_and_relations(doc_id, updated_concepts)
        backfilled_count = sum(1 for c in updated_concepts if c.get("source_verified"))

    return {
        "status": "ok",
        "message": "File verified and re-attached successfully.",
        "document_id": doc_id,
        "provider": provider,
        "sha256": file_sha,
        "concepts_verified": backfilled_count
    }

@app.get("/api/documents", response_model=List[DocumentItem])
@app.get("/documents", response_model=List[DocumentItem])
def list_documents(actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    if not actor.get("is_authenticated"):
        raise HTTPException(status_code=401, detail="Authentication required.")
    return get_documents_list(user_id=actor["id"])

@app.get("/api/documents/{doc_id}", response_model=DocumentDetail)
@app.get("/documents/{doc_id}", response_model=DocumentDetail)
def get_document(doc_id: str, actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc and not actor.get("is_authenticated"):
        doc = get_document_by_id_guest_fallback(doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    # EXTRACTOR-CHOICE-START
    if doc.get("result_json"):
        try:
            m = json.loads(doc["result_json"])
            doc["extractor_used"] = m.get("extractor_used", doc.get("provider_used", "gemini"))
            doc["fallback"] = m.get("fallback", False)
            doc["fallback_reason"] = m.get("fallback_reason", None)
        except Exception:
            pass
    # EXTRACTOR-CHOICE-END
    return doc

class ConceptProgressUpdate(BaseModel):
    status: Literal["studied", "not_started"]

class BulkConceptProgressUpdate(BaseModel):
    concept_ids: List[str]
    status: Literal["studied", "not_started"]

@app.get("/api/documents/{doc_id}/concepts", response_model=DocumentConceptsResponse)
@app.get("/documents/{doc_id}/concepts", response_model=DocumentConceptsResponse)
def get_document_concepts(
    doc_id: str,
    q: Optional[str] = Query(None, description="Search term for name, definition, or excerpt"),
    topic: Optional[str] = Query(None, description="Filter by topic / heading"),
    min_importance: Optional[int] = Query(None, ge=1, le=5, description="Filter by minimum importance (1-5)"),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc and not actor.get("is_authenticated"):
        doc = get_document_by_id_guest_fallback(doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # 1. Fetch raw concepts from DB
    raw_concepts = get_concepts_by_document(doc_id=doc_id)

    # 2. Apply deterministic normalizer (guarantees removal of non-concepts, people, institutions, code fragments, DAG prerequisites)
    normalized_concepts = normalize_extracted_concepts(raw_concepts)

    # 3. Attach user progress status if authenticated
    progress_map = {}
    if actor.get("is_authenticated"):
        try:
            progress_map = get_concept_progress_for_document(actor["id"], doc_id)
        except Exception as e_prog:
            logger.warning(f"Could not load concept progress for document {doc_id}: {e_prog}")
            progress_map = {}

    for c in normalized_concepts:
        cid_str = str(c.get("id"))
        c["status"] = progress_map.get(cid_str, "not_started")
        c["document_id"] = doc_id

    # 4. Extract distinct chapters / topics
    topics = sorted(list({c.get("chapter") or c.get("topic") or "General" for c in normalized_concepts}))

    # 5. Apply query filtering if provided
    filtered = normalized_concepts
    if topic and topic.strip() and topic.lower() != "all":
        target_t = topic.strip().lower()
        filtered = [c for c in filtered if (c.get("chapter") or c.get("topic") or "").lower() == target_t]

    if min_importance is not None and min_importance > 1:
        filtered = [c for c in filtered if int(c.get("importance", 1)) >= min_importance]

    if q and q.strip():
        term = q.strip().lower()
        filtered = [
            c for c in filtered
            if term in c.get("name", "").lower()
            or term in c.get("definition", "").lower()
            or term in c.get("source_excerpt", "").lower()
        ]

    # EXTRACTOR-CHOICE-START
    ext_used = "gemini"
    is_fallback = False
    fb_reason = None
    if doc.get("result_json"):
        try:
            m = json.loads(doc["result_json"])
            ext_used = m.get("extractor_used", doc.get("provider_used", "gemini"))
            is_fallback = m.get("fallback", False)
            fb_reason = m.get("fallback_reason", None)
        except Exception:
            pass
    # EXTRACTOR-CHOICE-END

    return DocumentConceptsResponse(
        document_id=doc_id,
        total_concepts=len(filtered),
        topics=topics,
        concepts=filtered,
        schema_version=SCHEMA_VERSION,
        # EXTRACTOR-CHOICE-START
        extractor_used=ext_used,
        fallback=is_fallback,
        fallback_reason=fb_reason
        # EXTRACTOR-CHOICE-END
    )

@app.get("/api/documents/{doc_id}/tree")
@app.get("/documents/{doc_id}/tree")
def get_document_concept_tree(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or concept tree unavailable.")

    raw_concepts = get_concepts_by_document(doc_id)
    cleaned_concepts = normalize_extracted_concepts(raw_concepts)
    if not cleaned_concepts:
        raise HTTPException(status_code=404, detail="Document not found or concept tree unavailable.")

    # Attach progress
    if actor.get("is_authenticated"):
        try:
            prog = get_concept_progress_for_document(actor["id"], doc_id)
        except Exception as e_prog:
            logger.warning(f"Could not load concept progress for tree {doc_id}: {e_prog}")
            prog = {}
        for c in cleaned_concepts:
            c["status"] = prog.get(str(c["id"]), "not_started")

    tree = build_document_tree(doc_id, doc.get("filename", "Document"), cleaned_concepts)
    tree["schema_version"] = SCHEMA_VERSION
    return tree

@app.get("/api/documents/{doc_id}/flowchart")
@app.get("/documents/{doc_id}/flowchart")
def get_document_flowchart(
    doc_id: str,
    topic: Optional[str] = Query(None),
    subflow: int = Query(0, ge=0),
    include_related: bool = Query(False),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest),
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    raw_concepts = get_concepts_by_document(doc_id)
    cleaned_concepts = normalize_extracted_concepts(raw_concepts)

    if actor.get("is_authenticated"):
        try:
            prog = get_concept_progress_for_document(actor["id"], doc_id)
        except Exception as e_prog:
            logger.warning(f"Could not load concept progress for flowchart {doc_id}: {e_prog}")
            prog = {}
        for c in cleaned_concepts:
            c["status"] = prog.get(str(c["id"]), "not_started")

    flow_data = build_document_flowchart(
        doc_id, cleaned_concepts, doc.get("raw_text") or "", include_related=include_related
    )
    result = select_flowchart_view(flow_data, topic, subflow, include_related)
    if result is None:
        raise HTTPException(status_code=404, detail="Flowchart topic or page not found.")
    result["schema_version"] = SCHEMA_VERSION
    return result

@app.put("/api/concepts/{concept_id}/progress")
@app.put("/concepts/{concept_id}/progress")
def update_single_concept_progress(
    concept_id: str,
    payload: ConceptProgressUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Sets concept progress ('studied' or 'not_started').
    Scoped to verified user. 404 for other users' concepts.
    """
    concept = get_concept_by_id_and_user(concept_id, current_user["id"])
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found or access denied.")

    result = set_concept_progress(current_user["id"], concept_id, payload.status)
    return result

@app.put("/api/concepts/progress/bulk")
@app.put("/concepts/progress/bulk")
def update_bulk_concept_progress(
    payload: BulkConceptProgressUpdate,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Bulk updates concept progress. Only concepts owned by current_user are updated."""
    valid_ids = []
    for cid in payload.concept_ids:
        if verify_concept_owner(current_user["id"], cid):
            valid_ids.append(cid)

    if not valid_ids:
        raise HTTPException(status_code=404, detail="No authorized concepts found.")

    count = bulk_set_concept_progress(current_user["id"], valid_ids, payload.status)
    return {"updated_count": count, "status": payload.status}

@app.get("/api/documents/{doc_id}/progress")
@app.get("/documents/{doc_id}/progress")
def get_document_progress_endpoint(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    if not actor.get("is_authenticated"):
        return {"progress": {}}

    try:
        progress_map = get_concept_progress_for_document(actor["id"], doc_id)
    except Exception as e_prog:
        logger.warning(f"Could not load document progress for {doc_id}: {e_prog}")
        progress_map = {}
    return {"progress": progress_map}

@app.post("/api/documents/{doc_id}/reanalyze")
@app.post("/documents/{doc_id}/reanalyze")
@app.post("/api/documents/{doc_id}/re-extract")
@app.post("/documents/{doc_id}/re-extract")
async def reanalyze_document_endpoint(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """
    Re-analyse action per document:
    Bypasses the cache and re-runs extraction with Pipeline v2.
    Respects rate limits and Gemini quota with friendly code-only fallback if exhausted.
    """
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    filename = doc["filename"]
    file_path = ensure_document_file_on_disk(doc_id=doc_id, user_id=actor["id"], filename=filename)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Source document file not found in database or server for re-analysis.")

    update_document_stage(doc_id, stage="extracting", status="processing", progress=20, stage_message="Re-analysing notes with Pipeline v2 (page-batched)...")
    try:
        pipeline_v2 = ExtractionV2Pipeline()
        v2_res = pipeline_v2.extract_document(
            file_path=file_path,
            doc_id=doc_id,
            user_id=actor["id"],
            on_progress=lambda msg, pct: update_document_stage(
                doc_id, stage="extracting", status="processing", progress=pct, stage_message=msg
            )
        )
    except Exception as ex_gem:
        update_document_stage(doc_id, stage="completed", status="completed", progress=100, stage_message="Re-analysis failed; existing concepts preserved.")
        raise HTTPException(status_code=503, detail=f"Re-analysis failed: {str(ex_gem)}")

    concepts = v2_res.get("concepts", [])
    if not concepts:
        raise HTTPException(status_code=500, detail="No concepts extracted during re-analysis.")

    page_coverage_records = v2_res.get("page_coverage", [])
    if page_coverage_records:
        save_document_page_coverage(doc_id, page_coverage_records)

    save_concepts_and_relations(doc_id, concepts)
    tree_data = build_document_tree(doc_id, filename, concepts)
    save_document_tree(doc_id, tree_data)

    update_document_stage(doc_id, stage="completed", status="completed", progress=100, stage_message="Re-analysis complete!")

    if actor.get("is_authenticated"):
        try:
            link_document_to_curriculum(doc_id, actor["id"])
        except Exception:
            pass

    return {
        "success": True,
        "message": f"Successfully re-analysed document with {len(concepts)} concepts.",
        "concept_count": len(concepts),
        "coverage_summary": v2_res.get("coverage_summary")
    }

@app.get("/api/documents/{doc_id}/coverage")
@app.get("/documents/{doc_id}/coverage")
async def get_document_coverage_endpoint(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """Returns the page coverage summary and list of all pages for this document."""
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    summary = get_document_coverage_summary(doc_id)
    return summary

@app.post("/api/documents/{doc_id}/pages/{page_num}/rerun")
@app.post("/documents/{doc_id}/pages/{page_num}/rerun")
async def rerun_document_page_endpoint(
    doc_id: str,
    page_num: int,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    """Re-runs extraction specifically for one page and updates page_coverage."""
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    filename = doc["filename"]
    file_path = ensure_document_file_on_disk(doc_id=doc_id, user_id=actor["id"], filename=filename)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Source file not found on server or database.")

    layout_ext = LayoutExtractor(file_path)
    pages, _ = layout_ext.extract_document_pages()
    target_page = next((p for p in pages if p.page_num == page_num), None)
    if not target_page:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found in document.")

    pipeline = ExtractionV2Pipeline()
    cands = pipeline._find_page_candidates(target_page)
    new_concepts = pipeline._run_repair_pass(target_page, cands[:6], filename)
    if not new_concepts:
        p_data = pipeline._extract_page_code_only(target_page)
        new_concepts = p_data.get("concepts", [])

    status = "repaired" if new_concepts else "done"
    rec = [{
        "page": page_num,
        "page_type": target_page.page_type,
        "text_chars": target_page.char_count,
        "text_hash": target_page.text_hash,
        "status": status,
        "concepts_count": len(new_concepts),
        "no_concepts_reason": None if new_concepts else "No concepts extracted on re-run",
        "error": None,
        "user_id": actor["id"]
    }]
    save_document_page_coverage(doc_id, rec)

    if new_concepts:
        existing = get_concepts_by_document(doc_id)
        for nc in new_concepts:
            nc["source_page"] = page_num
            nc["page"] = page_num
            nc["pages"] = [page_num]
            nc["topic"] = target_page.title or "General"
            existing.append(nc)
        save_concepts_and_relations(doc_id, existing)

    return {
        "success": True,
        "page": page_num,
        "status": status,
        "new_concepts_count": len(new_concepts),
        "coverage_summary": get_document_coverage_summary(doc_id)
    }


@app.delete("/api/documents/{doc_id}")
@app.delete("/documents/{doc_id}")
def delete_document(
    request: Request,
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    verify_csrf(request)
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        # Check if doc exists with unassigned user_id, matching actor, or guest doc for authenticated user
        conn = get_connection()
        try:
            row = conn.execute("SELECT id, filename, user_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if row:
                row_user = row["user_id"]
                if (
                    row_user is None
                    or row_user == actor["id"]
                    or actor.get("role") == "admin"
                    or (actor.get("is_authenticated") and str(row_user).startswith("guest_"))
                ):
                    doc = dict(row)
        finally:
            conn.close()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    filename = doc["filename"]
    owner_id = doc.get("user_id") or actor["id"]

    # Remove all physical files for this document from disk
    try:
        actor_upload_dir = UPLOAD_DIR / actor["id"]
        owner_upload_dir = UPLOAD_DIR / owner_id
        for search_dir in [actor_upload_dir, owner_upload_dir, UPLOAD_DIR]:
            if search_dir.exists():
                for p in search_dir.glob(f"{doc_id}_*"):
                    try:
                        p.unlink(missing_ok=True)
                    except Exception:
                        pass
    except Exception as e:
        logger.warning(f"Could not remove file for doc {doc_id}: {e}")

    try:
        deleted = delete_document_by_id(user_id=owner_id, doc_id=doc_id)
    except Exception as e:
        logger.exception(f"Unexpected error while deleting document {doc_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document from database.")

    if not deleted:
        check = get_document_by_id(user_id=owner_id, doc_id=doc_id)
        if not check:
            return {"success": True, "message": f"Document '{filename}' was already removed."}
        raise HTTPException(status_code=500, detail="Failed to delete document from database.")

    return {"success": True, "message": f"Document '{filename}' and all its extracted concepts were removed."}

class DocumentRenameRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)

@app.patch("/api/documents/{doc_id}")
@app.patch("/documents/{doc_id}")
async def rename_document(
    doc_id: str,
    req: DocumentRenameRequest,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    clean_name = req.filename.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Filename cannot be empty.")
    success = rename_document_by_id(current_user["id"], doc_id, clean_name)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found or cannot be renamed.")
    doc = get_document_by_id(user_id=current_user["id"], doc_id=doc_id)
    return {"success": True, "filename": clean_name, "document": doc}

@app.get("/dashboard/summary")
async def root_dashboard_summary_endpoint(
    subject_id: Optional[str] = Query(default=None),
    days: int = Query(default=7),
    order_mode: str = Query(default="syllabus"),
    scope_chapter_id: Optional[str] = Query(default=None),
    chapter_for_relations: Optional[str] = Query(default=None),
    tz: Optional[str] = Query(default=None),
    x_timezone: Optional[str] = Header(default=None, alias="X-Timezone"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    client_tz = tz or x_timezone
    return get_dashboard_summary_data(
        user_id=current_user["id"],
        subject_id=subject_id,
        days=days,
        order_mode=order_mode,
        scope_chapter_id=scope_chapter_id,
        chapter_for_relations=chapter_for_relations,
        client_tz=client_tz
    )

@app.get("/api/documents/{doc_id}/export")
@app.get("/documents/{doc_id}/export")
def export_document_concepts(
    doc_id: str,
    format: str = Query("json", pattern="^(json|csv|markdown|md|txt|text)$"),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    concepts = get_concepts_by_document(doc_id)
    base_name = Path(doc["filename"]).stem

    if format in ("markdown", "md"):
        lines = [
            f"# Study Guide: {doc['filename']}",
            f"*Generated by ConceptLens on {datetime.now(timezone.utc).strftime('%Y-%m-%d')}*\n",
            f"**Total Concepts:** {len(concepts)}\n",
            "---",
            ""
        ]
        # Group concepts by topic
        topics_map = {}
        for c in concepts:
            t = c.get("topic") or "General"
            topics_map.setdefault(t, []).append(c)

        for topic, clist in topics_map.items():
            lines.append(f"## {topic}\n")
            for c in clist:
                stars = "★" * int(c.get("importance") or 1)
                lines.append(f"### {c['name']}  `{stars}` (Page {c.get('page', 1)})")
                if c.get("definition"):
                    lines.append(f"\n> **Definition:** {c['definition']}\n")
                if c.get("source_excerpt"):
                    lines.append(f"*Notes Excerpt:* \"{c['source_excerpt']}\"\n")
                if c.get("related_concepts"):
                    rel = ", ".join(f"**{r['name']}**" for r in c["related_concepts"])
                    lines.append(f"**Related:** {rel}\n")
                lines.append("")

        md_bytes = "\n".join(lines).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(md_bytes),
            media_type="text/markdown",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_study_guide.md"'
            }
        )

    elif format == "json":
        export_payload = {
            "document": {
                "id": doc["id"],
                "filename": doc["filename"],
                "page_count": doc["page_count"],
                "created_at": doc["created_at"]
            },
            "concept_count": len(concepts),
            "concepts": concepts
        }
        json_bytes = json.dumps(export_payload, indent=2, ensure_ascii=False).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(json_bytes),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_concepts.json"'
            }
        )

    elif format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Name", "Importance (1-5)", "Relevance Score", "Topic",
            "Definition", "Source Excerpt", "Page", "Related Concepts"
        ])
        for c in concepts:
            related_str = "; ".join(
                f"{r['name']} (w:{r['weight']})" for r in c.get("related_concepts", [])
            )
            writer.writerow([
                c["name"],
                c["importance"],
                f"{c['score']:.4f}",
                c["topic"],
                c["definition"],
                c["source_excerpt"],
                c["page"],
                related_str
            ])

        csv_bytes = output.getvalue().encode("utf-8-sig")  # utf-8 with BOM for Excel compatibility
        return StreamingResponse(
            io.BytesIO(csv_bytes),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_concepts.csv"'
            }
        )

    elif format in ("txt", "text"):
        filename = doc.get("filename") or doc.get("title") or "Document"
        lines = [f"File: {filename}", ""]
        valid_concepts = [c for c in concepts if (c.get("name") or c.get("title"))]
        if not valid_concepts:
            lines.append("(No concepts extracted)")
        else:
            for idx, c in enumerate(valid_concepts, 1):
                name = (c.get("name") or c.get("title") or "").strip()
                lines.append(f"{idx}. {name}")
        txt_bytes = "\n".join(lines).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(txt_bytes),
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{base_name}_concepts.txt"'
            }
        )

@app.get("/api/teacher/dashboard")
@app.get("/teacher/dashboard")
async def get_teacher_dashboard(current_user: Dict[str, Any] = Depends(require_role("teacher"))):
    """Teacher dashboard data: requires teacher role (403 for students, 401 unauthenticated)."""
    return {
        "success": True,
        "role": "teacher",
        "user": {
            "id": current_user["id"],
            "name": current_user.get("name") or current_user.get("display_name"),
            "email": current_user.get("email"),
            "role": current_user.get("role")
        },
        "stats": {
            "students_count": 0,
            "classes_count": 0,
            "published_guides": 0
        },
        "message": "Welcome to your Teacher Dashboard. Course management and student insights are available here."
    }

@app.get("/api/student/dashboard")
@app.get("/student/dashboard")
async def get_student_dashboard(current_user: Dict[str, Any] = Depends(require_role("student"))):
    """Student dashboard data: requires student role (403 for teachers, 401 unauthenticated)."""
    return {
        "success": True,
        "role": "student",
        "user": {
            "id": current_user["id"],
            "name": current_user.get("name") or current_user.get("display_name"),
            "email": current_user.get("email"),
            "role": current_user.get("role")
        },
        "stats": {
            "enrolled_topics": 0,
            "study_sessions": 0
        },
        "message": "Welcome to your Student Dashboard. Track your progress, study planner, and concepts."
    }

# Serve production frontend build if available (unified single-service deployment)
from fastapi.staticfiles import StaticFiles
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

