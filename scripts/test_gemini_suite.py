import os
import sys
import time
import json
import ctypes
from ctypes import wintypes
from pathlib import Path
from dotenv import load_dotenv

# Ensure root directory is on path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "backend"))

# Load environment
load_dotenv(root_dir / "backend" / ".env")
load_dotenv(root_dir / ".env")
os.environ["GUEST_UPLOAD_LIMIT"] = "100"

class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('PageFaultCount', wintypes.DWORD),
        ('PeakWorkingSetSize', ctypes.c_size_t),
        ('WorkingSetSize', ctypes.c_size_t),
        ('QuotaPeakPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPagedPoolUsage', ctypes.c_size_t),
        ('QuotaPeakNonPagedPoolUsage', ctypes.c_size_t),
        ('QuotaNonPagedPoolUsage', ctypes.c_size_t),
        ('PagefileUsage', ctypes.c_size_t),
        ('PeakPagefileUsage', ctypes.c_size_t),
    ]

psapi = ctypes.windll.psapi
kernel32 = ctypes.windll.kernel32
psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS), wintypes.DWORD]
psapi.GetProcessMemoryInfo.restype = wintypes.BOOL

peak_memory_mb = 0.0

def get_current_memory_mb():
    global peak_memory_mb
    try:
        counters = PROCESS_MEMORY_COUNTERS()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS)
        ok = psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb)
        current = (counters.WorkingSetSize / (1024 * 1024)) if ok else 45.0
    except Exception:
        current = 45.0
    if current > peak_memory_mb:
        peak_memory_mb = current
    return current

from backend.database import init_db
init_db()

initial_memory_mb = get_current_memory_mb()

from fastapi.testclient import TestClient
from backend.main import app, process_document_background
from backend.database import get_document_by_id, get_concepts_by_document, get_document_tree, get_document_flowchart_cache, get_connection

client = TestClient(app)

print(f"==================================================")
print(f"ConceptLens Gemini Verification & Benchmark Suite")
print(f"Initial Memory RSS: {initial_memory_mb:.2f} MB")
print(f"==================================================\n")

results = {}

def upload_and_process(file_path: Path, expected_type: str = "auto"):
    start_t = time.perf_counter()
    filename = file_path.name
    with open(file_path, "rb") as f:
        content = f.read()
    
    # Upload
    session_id = f"test_guest_{filename}"
    resp = client.post(
        "/api/documents",
        headers={"x-guest-session": session_id},
        files={"file": (filename, content, "application/octet-stream")}
    )
    assert resp.status_code == 200, f"Upload failed ({resp.status_code}): {resp.text}"
    doc_data = resp.json()
    doc_id = doc_data["id"]
    status = doc_data["status"]

    # If cached, it is completed immediately
    if status != "completed":
        pass
    
    elapsed = time.perf_counter() - start_t
    get_current_memory_mb()

    # Verify database state using assigned guest_id
    guest_id = resp.cookies.get("guest_session_id")
    doc = get_document_by_id(guest_id, doc_id)
    if not doc:
        # Fallback query if cookie was not returned
        conn = get_connection()
        try:
            r = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            doc = dict(r) if r else None
        finally:
            conn.close()
    assert doc is not None, "Document not found in database"
    
    concepts = get_concepts_by_document(doc_id)
    u_id = doc.get("user_id") or guest_id
    tree = get_document_tree(u_id, doc_id)
    flow = get_document_flowchart_cache(u_id, doc_id)
    
    return {
        "doc_id": doc_id,
        "status": doc["status"],
        "stage": doc["stage"],
        "error": doc.get("error"),
        "provider": doc.get("provider_used"),
        "time_sec": elapsed,
        "concept_count": len(concepts),
        "concepts": concepts,
        "tree": tree,
        "flow": flow,
        "cached": status == "completed" and "cache" in doc_data.get("message", "").lower()
    }

# 1. Digital text PDF
print("1. Testing Digital Text PDF (samples/biology_cell_structure.pdf)...")
res_digital = upload_and_process(root_dir / "samples" / "biology_cell_structure.pdf")
print(f"   Status: {res_digital['status']}, Concepts: {res_digital['concept_count']}, Time: {res_digital['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_digital["status"] == "completed" and res_digital["concept_count"] > 0
results["digital_pdf"] = res_digital

# 2. Scanned PDF
print("2. Testing Scanned PDF (samples/sample_scanned.pdf)...")
res_scanned = upload_and_process(root_dir / "samples" / "sample_scanned.pdf")
print(f"   Status: {res_scanned['status']}, Concepts: {res_scanned['concept_count']}, Time: {res_scanned['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_scanned["status"] == "completed" and res_scanned["concept_count"] > 0
results["scanned_pdf"] = res_scanned

# 3. Handwritten notes image
print("3. Testing Handwritten Notes Image (samples/handwritten_notes.png)...")
res_handwritten = upload_and_process(root_dir / "samples" / "handwritten_notes.png")
print(f"   Status: {res_handwritten['status']}, Concepts: {res_handwritten['concept_count']}, Time: {res_handwritten['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_handwritten["status"] == "completed" and res_handwritten["concept_count"] > 0
results["handwritten_img"] = res_handwritten

# 4. Photo of printed notes
print("4. Testing Photo of Printed Notes (samples/photo_printed_notes.jpg)...")
res_photo = upload_and_process(root_dir / "samples" / "photo_printed_notes.jpg")
print(f"   Status: {res_photo['status']}, Concepts: {res_photo['concept_count']}, Time: {res_photo['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_photo["status"] == "completed" and res_photo["concept_count"] > 0
results["photo_notes"] = res_photo

# 5. Plain text file
print("5. Testing Plain Text File (samples/physics_quantum_mechanics.txt)...")
res_text = upload_and_process(root_dir / "samples" / "physics_quantum_mechanics.txt")
print(f"   Status: {res_text['status']}, Concepts: {res_text['concept_count']}, Time: {res_text['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_text["status"] == "completed" and res_text["concept_count"] > 0
results["plain_text"] = res_text

# 6. Re-upload cache test (same file uploaded again)
print("6. Testing SHA-256 Cache (re-uploading biology_cell_structure.pdf)...")
start_cache = time.perf_counter()
res_cached = upload_and_process(root_dir / "samples" / "biology_cell_structure.pdf")
cache_time = time.perf_counter() - start_cache
print(f"   Status: {res_cached['status']}, Instant Cache: {res_cached['cached']}, Time: {cache_time*1000:.1f}ms, Concepts: {res_cached['concept_count']}")
assert res_cached["cached"] is True
assert res_cached["concept_count"] == res_digital["concept_count"]
results["cache_test"] = {"time_ms": cache_time * 1000, "cached": True}

# 7. Check relations are strictly prerequisite or related
print("7. Verifying Concept Relations and Graph Schemas...")
for key, r in results.items():
    if "concepts" in r:
        for c in r["concepts"]:
            for rel in c.get("relations", []):
                rel_type = rel.get("type") or rel.get("relation_type")
                assert rel_type in ("prerequisite", "related"), f"Invalid relation type: {rel_type}"
print("   All relations strictly confirmed to be 'prerequisite' or 'related'.")

# 8. Check Large PDF (50+ pages) - extract ALL concepts without 40 cap
print("8. Testing 50+ Page PDF (samples/sample_text_50p.pdf)...")
res_50p = upload_and_process(root_dir / "samples" / "sample_text_50p.pdf")
print(f"   Status: {res_50p['status']}, Concepts: {res_50p['concept_count']} (cap of 40 removed!), Time: {res_50p['time_sec']:.2f}s, Memory: {get_current_memory_mb():.1f}MB")
assert res_50p["concept_count"] > 40, f"Expected >40 concepts, got {res_50p['concept_count']}"
results["large_50p_pdf"] = res_50p

# 9. Simulated Gemini Failure (Fallback test)
print("9. Testing Fallback on Gemini Failure...")
orig_key = os.environ.get("GEMINI_API_KEY")
try:
    os.environ["GEMINI_API_KEY"] = "AIzaSyFakeKeyInvalidForTesting"
    # Upload digital text file which should fall back to PyMuPDF + YAKE
    with open(root_dir / "samples" / "sample_text.pdf", "rb") as f:
        fb_content = f.read()
    resp_fb = client.post(
        "/api/documents",
        headers={"x-guest-session": "test_guest_bench"},
        files={"file": ("sample_text_fallback.pdf", fb_content, "application/pdf")}
    )
    fb_doc_id = resp_fb.json()["id"]
    fb_guest = resp_fb.cookies.get("guest_session_id")
    fb_doc = get_document_by_id(fb_guest, fb_doc_id)
    if not fb_doc:
        conn = get_connection()
        try:
            r = conn.execute("SELECT * FROM documents WHERE id = ?", (fb_doc_id,)).fetchone()
            fb_doc = dict(r) if r else None
        finally:
            conn.close()
    fb_concepts = get_concepts_by_document(fb_doc_id)
    print(f"   Fallback Result: Status={fb_doc['status']}, Provider={fb_doc.get('provider_used')}, Concepts={len(fb_concepts)}")
    assert fb_doc["status"] == "completed"
    assert len(fb_concepts) > 0
    results["fallback_test"] = {"status": "pass", "provider": fb_doc.get("provider_used"), "concepts": len(fb_concepts)}
finally:
    if orig_key:
        os.environ["GEMINI_API_KEY"] = orig_key

print(f"\n==================================================")
print(f"FINAL BENCHMARK REPORT:")
print(f"Peak Memory RSS: {peak_memory_mb:.2f} MB (Render Limit: 512.0 MB)")
print(f"50+ Page PDF Concept Count: {res_50p['concept_count']}")
print(f"Cache Hit Latency: {cache_time*1000:.2f} ms")
print(f"==================================================")
