import os
import re
import uuid
import csv
import io
import json
import logging
import time
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
        document_exists
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
        CorruptedPdfError,
        ScannedNoOcrError
    )
    from backend.services.chunking import create_chunks_from_pages
    from backend.services.concept_extraction import (
        extract_concepts_pipeline,
        get_spacy_nlp,
        TOP_CONCEPTS_LIMIT_DEFAULT,
        USE_KEYBERT_ENV
    )
    from backend.services.tree_builder import build_document_tree
    from backend.services.flowchart_builder import build_document_flowchart, select_flowchart_view
    from backend.services.flowchart_provider import apply_flowchart_enrichment, enrich_flowchart_with_cloud
    from backend.services.ocr import (
        is_tesseract_available,
        check_rapidocr_available,
        OCR_ENGINE_CONFIG,
        OcrUnavailableError
    )
    from backend.services.cloud_extraction import (
        check_gemini_key_valid,
        GEMINI_MODEL
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
        document_exists
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
        CorruptedPdfError,
        ScannedNoOcrError
    )
    from services.chunking import create_chunks_from_pages
    from services.concept_extraction import (
        extract_concepts_pipeline,
        get_spacy_nlp,
        TOP_CONCEPTS_LIMIT_DEFAULT,
        USE_KEYBERT_ENV
    )
    from services.tree_builder import build_document_tree
    from services.flowchart_builder import build_document_flowchart, select_flowchart_view
    from services.flowchart_provider import apply_flowchart_enrichment, enrich_flowchart_with_cloud
    from services.ocr import (
        is_tesseract_available,
        check_rapidocr_available,
        OCR_ENGINE_CONFIG,
        OcrUnavailableError
    )
    from services.cloud_extraction import (
        check_gemini_key_valid,
        GEMINI_MODEL
    )

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("conceptlens.api")

load_dotenv()

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = Path(__file__).resolve().parent / UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB
GUEST_UPLOAD_LIMIT = int(os.getenv("GUEST_UPLOAD_LIMIT", "5"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialize database tables and warm up models
    logger.info("Initializing SQLite database with schema...")
    init_db()

    logger.info("Pre-warming spaCy model...")
    try:
        get_spacy_nlp()
        logger.info("spaCy en_core_web_sm loaded successfully.")
    except Exception as e:
        logger.error(f"Error loading spaCy: {e}")

    rapid_ok, rapid_msg = check_rapidocr_available()
    tess_ok = is_tesseract_available()
    logger.info(f"RapidOCR ONNX Runtime operational: {rapid_ok} ({rapid_msg})")
    logger.info(f"Tesseract available on system: {tess_ok}")

    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    gemini_valid, gemini_msg = check_gemini_key_valid()
    logger.info(f"Gemini API check: key_set={gemini_key_set}, valid={gemini_valid} ({gemini_msg}), model={GEMINI_MODEL}")

    if gemini_valid:
        logger.info("Default upload path: CLOUD (Gemini Flash primary, on-device RapidOCR fallback).")
    else:
        logger.info(f"Default upload path: ON-DEVICE (RapidOCR + spaCy/YAKE, reason: {gemini_msg}).")

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

# Mount authentication router
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# Mount planner router
app.include_router(planner_router)

def process_document_background(
    doc_id: str,
    file_path: Path,
    pdf_password: Optional[str] = None,
    prefer_cloud: bool = True
):
    """Background task to read document, run OCR if needed, extract concepts, and prebuild tree/flowchart."""
    t_start = time.perf_counter()
    logger.info(f"Processing document {doc_id} ({file_path.name}) [prefer_cloud={prefer_cloud}]...")
    update_document_stage(
        doc_id,
        stage="reading",
        status="processing",
        progress=5,
        stage_message="Reading document layout..."
    )

    def on_ocr_page(page_idx, total_pages):
        pct = min(65, max(10, int(10 + (page_idx / max(1, total_pages)) * 55)))
        msg = f"OCR scanning page {page_idx} of {total_pages} ({pct}%)..."
        update_document_stage(
            doc_id,
            stage="ocr",
            status="processing",
            progress=pct,
            stage_message=msg,
            current_page=page_idx,
            total_pages=total_pages
        )

    def on_page_progress(page_idx, total_pages, is_ocr=False):
        if not is_ocr:
            pct = min(45, max(5, int(5 + (page_idx / max(1, total_pages)) * 40)))
            msg = f"Reading page {page_idx} of {total_pages} ({pct}%)..."
            update_document_stage(
                doc_id,
                stage="reading",
                status="processing",
                progress=pct,
                stage_message=msg,
                current_page=page_idx,
                total_pages=total_pages
            )

    t_read_start = time.perf_counter()
    try:
        # 1. Read and parse document with multi-library fallback ladder
        page_count, pages, full_text, skipped_pages = read_document_file(
            file_path,
            on_ocr_page=on_ocr_page,
            on_page_progress=on_page_progress,
            pdf_password=pdf_password,
            prefer_cloud=prefer_cloud
        )
        t_read = time.perf_counter() - t_read_start
        logger.info(f"Document {doc_id} read in {t_read:.2f}s ({page_count} pages, {len(skipped_pages)} skipped).")

        # 2. Chunking
        update_document_stage(
            doc_id,
            stage="extracting",
            status="processing",
            progress=68,
            stage_message="Chunking & tokenizing text segments (68%)..."
        )
        t_chunk_start = time.perf_counter()
        nlp_model = get_spacy_nlp()
        chunks = create_chunks_from_pages(pages, nlp_model)
        t_chunk = time.perf_counter() - t_chunk_start
        logger.info(f"Document {doc_id} chunked in {t_chunk:.2f}s ({len(chunks)} chunks).")

        # 3. Concept Extraction (Cloud primary with local fallback)
        update_document_stage(
            doc_id,
            stage="extracting",
            status="processing",
            progress=75,
            stage_message="Extracting core concepts & definitions (75%)..."
        )
        t_extract_start = time.perf_counter()
        concepts, provider_used = extract_concepts_pipeline(
            chunks,
            full_text,
            top_limit=TOP_CONCEPTS_LIMIT_DEFAULT,
            use_keybert=USE_KEYBERT_ENV,
            prefer_cloud=prefer_cloud
        )
        t_extract = time.perf_counter() - t_extract_start
        logger.info(f"Document {doc_id} extracted {len(concepts)} concepts in {t_extract:.2f}s using {provider_used}.")

        # Check if doc was deleted during processing
        if not document_exists(doc_id):
            logger.info(f"Document {doc_id} was deleted during processing; aborting.")
            return

        # 4. Background Prebuild: Concept Tree & Flowchart (Linear algorithms)
        update_document_stage(
            doc_id,
            stage="extracting",
            status="processing",
            progress=88,
            stage_message="Building concept tree & flowchart graph (88%)..."
        )
        t_tree_start = time.perf_counter()
        tree_data = build_document_tree(doc_id, file_path.name, concepts)
        save_document_tree(doc_id, tree_data)
        t_tree = time.perf_counter() - t_tree_start

        t_flow_start = time.perf_counter()
        flow_data = build_document_flowchart(doc_id, concepts, full_text, include_related=True)
        save_document_flowchart(doc_id, flow_data)
        t_flow = time.perf_counter() - t_flow_start

        # 5. Database Save (WAL mode + executemany batch insert)
        update_document_stage(
            doc_id,
            stage="extracting",
            status="processing",
            progress=96,
            stage_message="Saving knowledge structures & relations (96%)..."
        )
        t_db_start = time.perf_counter()
        save_concepts_and_relations(doc_id, concepts)
        t_total = time.perf_counter() - t_start
        mark_document_completed(
            doc_id,
            page_count=page_count,
            raw_text=full_text,
            processing_time_sec=t_total,
            provider_used=provider_used,
            skipped_pages=skipped_pages
        )
        t_db = time.perf_counter() - t_db_start

        # Process chapters & relations for Study Planner
        try:
            process_document_chapters_and_relations(doc_id)
        except Exception as e_rel:
            logger.warning(f"Could not build chapter relations for document {doc_id}: {e_rel}")

        # Per-stage timing summary table
        logger.info(
            "\n" + "=" * 70 + "\n"
            f"UPLOAD TIMING SUMMARY: {doc_id} ({file_path.name})\n"
            + "-" * 70 + "\n"
            f"{'Stage':<35} {'Duration (s)':<15}\n"
            + "-" * 70 + "\n"
            f"{'Text Acquisition & Reading':<35} {t_read:>8.2f}s\n"
            f"{'Chunking':<35} {t_chunk:>8.2f}s\n"
            f"{f'Concept Extraction ({provider_used})':<35} {t_extract:>8.2f}s\n"
            f"{'Knowledge Tree Prebuild':<35} {t_tree:>8.2f}s\n"
            f"{'Flowchart Prebuild':<35} {t_flow:>8.2f}s\n"
            f"{'Database Batch Save':<35} {t_db:>8.2f}s\n"
            + "-" * 70 + "\n"
            f"{'TOTAL PIPELINE TIME':<35} {t_total:>8.2f}s\n"
            + "=" * 70
        )

    except EncryptedPdfError as enc_err:
        logger.warning(f"Document {doc_id} requires password: {enc_err}")
        mark_document_failed(doc_id, "Password required: This PDF is password-protected. Please enter the password to decrypt.")
    except ScannedNoOcrError as ocr_err:
        logger.warning(f"Document {doc_id} scanned with no OCR: {ocr_err}")
        mark_document_failed(doc_id, str(ocr_err))
    except EmptyFileError as empty_err:
        logger.warning(f"Document {doc_id} empty text: {empty_err}")
        mark_document_failed(doc_id, str(empty_err))
    except CorruptedPdfError as corrupt_err:
        logger.warning(f"Document {doc_id} corrupted PDF: {corrupt_err}")
        mark_document_failed(doc_id, "The PDF file is corrupted or could not be parsed.")
    except UnsupportedFileTypeError as type_err:
        logger.warning(f"Document {doc_id} unsupported type: {type_err}")
        mark_document_failed(doc_id, str(type_err))
    except OcrUnavailableError as ocr_unavail:
        logger.warning(f"Document {doc_id} OCR unavailable: {ocr_unavail}")
        mark_document_failed(doc_id, str(ocr_unavail))
    except Exception as ex:
        logger.exception(f"Unexpected error processing document {doc_id}: {ex}")
        mark_document_failed(doc_id, f"Processing error: {str(ex)}")

@app.get("/health")
def health_check_root():
    """Lightweight health check for Render / deployment platforms."""
    return {"status": "ok"}

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": "ConceptLens",
        "ocr_engine": OCR_ENGINE_CONFIG,
        "tesseract_available": is_tesseract_available(),
        "keybert_enabled": USE_KEYBERT_ENV,
        "auth_enabled": True,
        "guest_upload_limit": GUEST_UPLOAD_LIMIT
    }

@app.get("/api/health/providers")
def check_providers_health():
    """Reports status of Gemini API, model, extraction mode, and RapidOCR."""
    gemini_key_set = bool(os.getenv("GEMINI_API_KEY", "").strip())
    gemini_valid, gemini_msg = check_gemini_key_valid()
    rapid_ok, rapid_msg = check_rapidocr_available()
    tess_ok = is_tesseract_available()
    active_mode = "cloud" if gemini_valid else "on-device"
    return {
        "gemini_api_key_set": gemini_key_set,
        "gemini_api_key_valid": gemini_valid,
        "gemini_status_message": gemini_msg,
        "gemini_model": GEMINI_MODEL,
        "active_extraction_mode": active_mode,
        "rapidocr_available": rapid_ok,
        "rapidocr_message": rapid_msg,
        "tesseract_available": tess_ok,
        "default_upload_path": "cloud" if gemini_valid else "on-device",
        "default_upload_path_reason": "Gemini API key is configured and valid" if gemini_valid else f"No valid Gemini API key ({gemini_msg}), using offline on-device pipeline"
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

    # Read and validate file content & size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of 25 MB ({len(content) / (1024*1024):.1f} MB provided)."
        )
    if len(content) == 0:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is empty (0 bytes)."
        )

    doc_id = str(uuid.uuid4())
    # User-isolated or guest-isolated upload directory
    actor_upload_dir = UPLOAD_DIR / actor["id"]
    actor_upload_dir.mkdir(parents=True, exist_ok=True)
    save_path = actor_upload_dir / f"{doc_id}_{safe_filename}"

    with open(save_path, "wb") as f:
        f.write(content)

    # Create document row in database tied to actor["id"]
    create_document(
        user_id=actor["id"],
        doc_id=doc_id,
        filename=safe_filename,
        file_type=ext.lstrip("."),
        status="processing",
        stage="reading"
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
        logger.info(f"Upload {doc_id} path decision: CLOUD (Gemini Flash primary, on-device fallback)")

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

# Serve production frontend build if available (unified single-service deployment)
from fastapi.staticfiles import StaticFiles
frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

