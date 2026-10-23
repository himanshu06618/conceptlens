# ConceptLens Pluggable Extractor Choice

This optional module enables users to choose their concept extraction engine when uploading notes to ConceptLens:
1. **Google Gemini API** (Default; multimodal & digital PDFs read with PyMuPDF)
2. **YAKE** (Statistical keywords, 1-3 grams, unsupervised, 100% local)
3. **RAKE / TextRank** (Hybrid phrase co-occurrence statistics & graph ranking, 100% local)
4. **spaCy noun chunks** (Grammar-based noun phrase chunking, 100% local)

---

## 1. Installation

To install all optional extractor dependencies:

```bash
# In your virtual environment:
pip install -r backend/requirements-extractors.txt

# Download the small spaCy English model:
python -m spacy download en_core_web_sm
```

### Dependency Breakdown:
- **YAKE**: `yake>=0.4.8` (already included in `backend/requirements.txt`)
- **RAKE / TextRank**: `rake-nltk>=1.0.6`, `nltk>=3.8.1`, `summa>=1.2.0`
- **spaCy**: `spacy>=3.7.0` plus `en_core_web_sm`
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
   # Returns: {"gemini": true, "yake": true, "rake_textrank": true, "spacy": true}
   ```

2. **Upload with Chosen Extractor**:
   In the ConceptLens upload view, select a method from the radio-style cards (e.g. YAKE, RAKE / TextRank, or spaCy) and upload a sample note.

3. **Fallback Testing**:
   - If an extractor library is not installed, or if you upload an image / scanned PDF without a text layer, the backend automatically falls back to Gemini and returns:
     `{"fallback": true, "fallback_reason": "<clear explanation>", "extractor_used": "gemini"}`.

---

## 4. Production Deployment & Render Memory Considerations

### Render Free Tier Memory Warning (512 MB RAM limit):
- Render's free web service tier provides **512 MB of RAM**.
- The ConceptLens core application runs Uvicorn, FastAPI, SQLite/PostgreSQL, and background tasks.
- **YAKE** and **RAKE/TextRank** are very lightweight (~15–30 MB RAM overhead) and safe to run on Render.
- **spaCy** with `en_core_web_sm` loads syntactic parsing models and word vectors that consume ~150–250 MB of memory. When combined with Uvicorn worker overhead and PyMuPDF document parsing, running spaCy on Render's 512 MB free tier carries a significant risk of triggering an Out-Of-Memory (OOM) kill.
- **Recommendation**: **spaCy should stay local-only** unless your Render service is upgraded to a paid plan with at least 1 GB RAM. On Render free tier, keep `spacy` uninstalled; the defensive registry will report `"spacy": false` without any runtime errors.

### Lines to Add to `backend/requirements.txt` to Enable on Render:
If you choose to enable the lightweight extractors on Render:
```text
rake-nltk>=1.0.6
nltk>=3.8.1
summa>=1.2.0
```
(If also enabling spaCy on a paid tier, add `spacy>=3.7.0` and append `python -m spacy download en_core_web_sm` to your Render build command).
