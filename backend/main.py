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
from typing import Optional, List, Dict, Any

# Add backend directory and root directory to sys.path
backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(backend_dir.parent) not in sys.path:
    sys.path.insert(0, str(backend_dir.parent))

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Request, Response, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from slowapi.errors import RateLimitExceeded
from dotenv import load_dotenv
import pymupdf as fitz

load_dotenv(backend_dir / ".env")
load_dotenv()

try:
    from backend.database import (
        init_db,
        create_document,
        update_document_stage,
        mark_document_completed,
        mark_document_failed,
        get_documents_list,
        get_document_by_id,
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
        clone_cached_document
    )
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
    from backend.services.cloud_extraction import (
        extract_document_with_gemini,
        check_gemini_key_valid,
        GEMINI_MODEL,
        GeminiQuotaError
    )
except ImportError:
    from database import (
        init_db,
        create_document,
        update_document_stage,
        mark_document_completed,
        mark_document_failed,
        get_documents_list,
        get_document_by_id,
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
        clone_cached_document
    )
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
    logger.info("Initializing SQLite database with schema...")
    init_db()

    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    gemini_valid, gemini_msg = check_gemini_key_valid()
    logger.info(f"Gemini API check: key_set={gemini_key_set}, valid={gemini_valid} ({gemini_msg}), model={GEMINI_MODEL}")

    if gemini_valid:
        logger.info(f"Default extraction path: GEMINI AI ({GEMINI_MODEL}) multimodal OCR + structured concepts.")
    else:
        logger.info(f"Default extraction path: LIGHTWEIGHT FALLBACK (PyMuPDF + YAKE, reason: {gemini_msg}).")

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

# Enable CORS with credentials for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount authentication router under both /api/auth and /auth
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])

# Mount planner router
app.include_router(planner_router)

def process_document_background(
    doc_id: str,
    file_path: Path,
    pdf_password: Optional[str] = None,
    prefer_cloud: bool = True
):
    """Background task to extract concepts with Gemini API, build tree & flowchart, and protect memory."""
    t_start = time.perf_counter()
    logger.info(f"Queued background processing for document {doc_id} ({file_path.name})...")
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

            def on_progress_update(pct, msg):
                update_document_stage(
                    doc_id,
                    stage="extracting",
                    status="processing",
                    progress=pct,
                    stage_message=msg
                )

            concepts = []
            provider_used = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
            gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())

            if prefer_cloud and gemini_key_set:
                try:
                    concepts = extract_document_with_gemini(
                        file_path=file_path,
                        on_progress=on_progress_update
                    )
                    provider_used = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
                except GeminiQuotaError:
                    logger.warning(f"Document {doc_id}: Gemini quota exceeded.")
                    if has_usable_text:
                        logger.info(f"Document {doc_id}: Falling back to lightweight PyMuPDF + YAKE...")
                        concepts = extract_fallback_concepts(full_text=full_text)
                        provider_used = "lightweight-fallback"
                    else:
                        mark_document_failed(doc_id, "Daily free limit reached, try again later")
                        return
                except Exception as ex_gemini:
                    logger.warning(f"Document {doc_id}: Gemini extraction error: {ex_gemini}")
                    if has_usable_text:
                        logger.info(f"Document {doc_id}: Falling back to lightweight PyMuPDF + YAKE...")
                        concepts = extract_fallback_concepts(full_text=full_text)
                        provider_used = "lightweight-fallback"
                    else:
                        mark_document_failed(doc_id, "Gemini AI is temporarily unavailable and this scanned document requires AI vision. Please try again later.")
                        return
            else:
                # User chose local mode or no Gemini key configured
                if has_usable_text:
                    concepts = extract_fallback_concepts(full_text=full_text)
                    provider_used = "lightweight-fallback"
                else:
                    mark_document_failed(doc_id, "Gemini API key is not configured and this document has no digital text layer.")
                    return

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
            tree_data = build_document_tree(doc_id, file_path.name, concepts)
            save_document_tree(doc_id, tree_data)

            flow_data = build_document_flowchart(doc_id, concepts, full_text, include_related=True)
            save_document_flowchart(doc_id, flow_data)

            # 4. Database Save
            update_document_stage(
                doc_id,
                stage="extracting",
                status="processing",
                progress=95,
                stage_message="Saving knowledge structures & relations (95%)..."
            )
            save_concepts_and_relations(doc_id, concepts)
            t_total = time.perf_counter() - t_start

            mark_document_completed(
                doc_id,
                page_count=page_count,
                raw_text=full_text,
                processing_time_sec=t_total,
                provider_used=provider_used
            )

            # Process chapters & relations for Study Planner
            try:
                process_document_chapters_and_relations(doc_id)
            except Exception as e_rel:
                logger.warning(f"Could not build chapter relations for document {doc_id}: {e_rel}")

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
@limiter.limit("10/minute")
async def upload_document(
    request: Request,
    response: Response,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    pdf_password: Optional[str] = Form(None),
    extraction_mode: Optional[str] = Form(None),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    verify_csrf(request)

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

    # Check database cache for instant return
    cached_doc = find_completed_document_by_hash(file_hash)
    if cached_doc:
        logger.info(f"Cache HIT for hash {file_hash[:12]}... (source doc {cached_doc['id']})")
        doc_id = str(uuid.uuid4())
        actor_upload_dir = UPLOAD_DIR / actor["id"]
        actor_upload_dir.mkdir(parents=True, exist_ok=True)
        save_path = actor_upload_dir / f"{doc_id}_{safe_filename}"
        with open(save_path, "wb") as f:
            f.write(content)

        create_document(
            user_id=actor["id"],
            doc_id=doc_id,
            filename=safe_filename,
            file_type=ext.lstrip("."),
            status="completed",
            stage="completed",
            file_hash=file_hash
        )
        clone_cached_document(cached_doc["id"], doc_id)
        try:
            process_document_chapters_and_relations(doc_id)
        except Exception as e_ch:
            logger.warning(f"Could not build chapter relations for cached document {doc_id}: {e_ch}")

        return UploadResponse(
            id=doc_id,
            filename=safe_filename,
            file_type=ext.lstrip("."),
            status="completed",
            stage="completed",
            message="Document extracted instantly from cache."
        )

    doc_id = str(uuid.uuid4())
    # User-isolated or guest-isolated upload directory
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    actor_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = actor_upload_dir / f"{doc_id}_{safe_filename}"

    with open(save_path, "wb") as f:
        f.write(content)

    # Create document row in database tied to actor["id"] and file_hash
    create_document(
        user_id=actor["id"],
        doc_id=doc_id,
        filename=safe_filename,
        file_type=ext.lstrip("."),
        status="processing",
        stage="reading",
        file_hash=file_hash
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
        prefer_cloud=prefer_cloud
    )

    return UploadResponse(
        id=doc_id,
        filename=safe_filename,
        file_type=ext.lstrip("."),
        status="processing",
        stage="reading",
        message="Document uploaded successfully. Processing started."
    )

@app.get("/api/documents/{doc_id}/status")
def get_document_status(doc_id: str, actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    """Lightweight polling endpoint returning processing status, progress percentage, message, provider, time."""
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    skipped = []
    if doc.get("skipped_pages"):
        try:
            skipped = json.loads(doc["skipped_pages"])
        except Exception:
            skipped = []
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
        "concept_count": doc.get("concept_count", 0)
    }

@app.get("/api/documents/{doc_id}/file")
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
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    file_path = actor_upload_dir / f"{doc_id}_{filename}"
    if not file_path.exists():
        fallback_path = UPLOAD_DIR / f"{doc_id}_{filename}"
        if fallback_path.exists():
            file_path = fallback_path
        else:
            raise HTTPException(status_code=404, detail="Source document file not found on server.")

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

@app.get("/api/documents", response_model=List[DocumentItem])
def list_documents(actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    return get_documents_list(user_id=actor["id"])

@app.get("/api/documents/{doc_id}", response_model=DocumentDetail)
def get_document(doc_id: str, actor: Dict[str, Any] = Depends(get_current_user_or_guest)):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc

@app.get("/api/documents/{doc_id}/concepts", response_model=DocumentConceptsResponse)
def get_document_concepts(
    doc_id: str,
    q: Optional[str] = Query(None, description="Search term for name, definition, or excerpt"),
    topic: Optional[str] = Query(None, description="Filter by topic / heading"),
    min_importance: Optional[int] = Query(None, ge=1, le=5, description="Filter by minimum importance (1-5)"),
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    concepts = get_concepts_by_document(
        doc_id=doc_id,
        q=q,
        topic=topic,
        min_importance=min_importance
    )
    topics = get_distinct_topics(doc_id)

    return DocumentConceptsResponse(
        document_id=doc_id,
        total_concepts=len(concepts),
        topics=topics,
        concepts=concepts
    )

@app.get("/api/documents/{doc_id}/tree")
def get_document_concept_tree(
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    tree = get_document_tree(user_id=actor["id"], doc_id=doc_id)
    if not tree:
        raise HTTPException(status_code=404, detail="Document not found or concept tree unavailable.")
    return tree

@app.get("/api/documents/{doc_id}/flowchart")
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
    cached = get_document_flowchart_cache(actor["id"], doc_id)
    if not cached:
        cached = build_document_flowchart(
            doc_id, get_concepts_by_document(doc_id), doc.get("raw_text") or "", include_related=True
        )
        save_document_flowchart(doc_id, cached)
    result = select_flowchart_view(cached, topic, subflow, include_related)
    if result is None:
        raise HTTPException(status_code=404, detail="Flowchart topic or page not found.")
    return result

@app.delete("/api/documents/{doc_id}")
def delete_document(
    request: Request,
    doc_id: str,
    actor: Dict[str, Any] = Depends(get_current_user_or_guest)
):
    verify_csrf(request)
    doc = get_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    filename = doc["filename"]
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    file_path = actor_upload_dir / f"{doc_id}_{filename}"
    if file_path.exists():
        try:
            file_path.unlink()
        except Exception as e:
            logger.warning(f"Could not remove file {file_path}: {e}")

    deleted = delete_document_by_id(user_id=actor["id"], doc_id=doc_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete document from database.")

    return {"success": True, "message": f"Document '{filename}' and all its extracted concepts were removed."}

@app.get("/api/documents/{doc_id}/export")
def export_document_concepts(
    doc_id: str,
    format: str = Query("json", pattern="^(json|csv|markdown|md)$"),
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

