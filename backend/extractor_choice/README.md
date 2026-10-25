# ConceptLens Pluggable Extractor Choice

This optional module enables users to choose their concept extraction engine when uploading notes to ConceptLens:
1. **Google Gemini API** (Default; multimodal & digital PDFs read with PyMuPDF)
2. **YAKE** (Statistical keywords, 1-3 grams, unsupervised, 100% local)

---

## 1. Installation

To install the optional extractor dependencies:

```bash
# In your virtual environment:
pip install -r backend/requirements-extractors.txt
```

### Dependency Breakdown:
- **YAKE**: `yake>=0.4.8` (already included in `backend/requirements.txt`)
- **PDF Reading**: `pymupdf>=1.23.0` (already included in `backend/requirements.txt`)

---

## 2. Feature Flags

The feature is disabled by default. When flags are `false` or unset, ConceptLens behaves exactly as before (Gemini default, no picker shown in UI, zero behavior changes).

### Enable Locally:
- In `backend/.env`:
  ```env
  ENABLE_EXTRACTOR_CHOICE=true
  ```
- In `frontend/.env`:
  ```env
  VITE_ENABLE_EXTRACTOR_CHOICE=true
  ```

---

## 3. How to Test Locally

1. **Verify Extractor Registry Endpoint**:
   ```bash
   curl http://127.0.0.1:8000/api/extractors
   # Returns: {"gemini": true, "yake": true}
   ```

2. **Upload with Chosen Extractor**:
   In the ConceptLens upload view, select a method (e.g. YAKE or Google Gemini) and upload a sample note.

3. **Fallback Testing**:
   - If an extractor library is not installed, or if you upload an image / scanned PDF without a text layer, the backend automatically falls back to Gemini and returns:
     `{"fallback": true, "fallback_reason": "<clear explanation>", "extractor_used": "gemini"}`.

---

## 4. Production Deployment & Render Memory Considerations

### Render Free Tier Memory Warning (512 MB RAM limit):
- Render's free web service tier provides **512 MB of RAM**.
- The ConceptLens core application runs Uvicorn, FastAPI, SQLite/PostgreSQL, and background tasks.
- **YAKE** is very lightweight (~15–30 MB RAM overhead) and safe to run on Render.
