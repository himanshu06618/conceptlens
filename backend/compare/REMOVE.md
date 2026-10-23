# Benchmark Module Clean Removal Guide

This module is designed to be 100% cleanly removable without breaking any core ConceptLens functionality or leaving orphaned dependencies.

Extractors are plug-ins: deleting an extractor file plus its registry entry removes it without affecting the others.

---

## 1. Complete Module Removal (4 Steps)

### Step 1: Delete Research Directories
Delete the compare directories in backend and frontend:
```bash
# Windows PowerShell
Remove-Item -Recurse -Force backend\compare
Remove-Item -Recurse -Force frontend\src\compare

# Linux/macOS
rm -rf backend/compare frontend/src/compare
```

### Step 2: Delete Research Dependencies File
```bash
# Windows PowerShell
Remove-Item backend\requirements-research.txt

# Linux/macOS
rm backend/requirements-research.txt
```

### Step 3: Remove Marked Registration Code
1. In `backend/main.py`:
   Delete the block between `# COMPARE-START` and `# COMPARE-END`:
   ```python
   # COMPARE-START
   if os.getenv("ENABLE_COMPARE", "false").lower() == "true":
       try:
           from backend.compare.api import router as compare_router
           app.include_router(compare_router)
       except ImportError:
           pass
   # COMPARE-END
   ```
2. In `frontend/src/App.jsx`:
   Delete the lazy import and route between `// COMPARE-START` and `// COMPARE-END`:
   ```javascript
   // COMPARE-START
   const CompareView = React.lazy(() => import('./compare/CompareView'));
   // COMPARE-END
   ```
   and
   ```jsx
   {/* COMPARE-START */}
   <Route path="/compare" element={<CompareView onToast={addToast} />} />
   {/* COMPARE-END */}
   ```

### Step 4: Remove Environment Variable
- In Render Dashboard (or `.env`), delete `ENABLE_COMPARE`.

---

## 2. Removing Individual Extractors

Extractors are modular plug-ins. Removing one extractor leaves all other extractors (such as Gemini) fully operational.

### RAKE Removal
To cleanly remove only the RAKE extractor:
1. **Archive results**: Move `backend/compare/results/raw_rake.json` and its summary row into `backend/compare/results/archive/rake/`.
2. **Delete implementation**: Delete `backend/compare/extractors/rake_ex.py`.
3. **Unregister**: In `backend/compare/registry.py`, remove the `"rake"` import and registration block. Also remove `"rake"` from CLI default lists in `run_benchmark.py`.
4. **Remove dependencies**: Remove `rake-nltk` and `nltk` from `backend/requirements-research.txt`.
5. **Clean cached data**: Delete the `backend/compare/.nltk_data/` directory.
6. **Update docs**: Remove RAKE mentions from `backend/compare/README.md`.

### TEXTRANK Removal
To cleanly remove only the TextRank extractor:
1. **Archive results**: Move `backend/compare/results/raw_textrank.json` and its summary row into `backend/compare/results/archive/textrank/`.
2. **Delete implementation**: Delete `backend/compare/extractors/textrank_ex.py`.
3. **Unregister**: In `backend/compare/registry.py`, remove the `"textrank"` import and registration block. Also remove `"textrank"` from CLI default lists in `run_benchmark.py`.
4. **Remove dependencies**: Remove `summa` from `backend/requirements-research.txt`.
5. **Update docs**: Remove TextRank mentions from `backend/compare/README.md`.

---

## 3. Post-Removal Verification
After removing any extractor, run:
```bash
grep -rni "<extractor name>" backend frontend/src
```
Matches are allowed only inside `results/archive/`.
