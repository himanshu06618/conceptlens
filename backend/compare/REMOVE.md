# Benchmark Module Clean Removal Guide

This module is designed to be 100% cleanly removable without breaking any core ConceptLens functionality or leaving orphaned dependencies.

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

## 2. Removing Only YAKE (Keeping Compare Framework & Gemini)
If you wish to remove YAKE extractor while keeping the benchmark framework:
1. Delete `backend/compare/extractors/yake_ex.py`.
2. In `backend/compare/registry.py`, remove the YAKE import and registration block:
   ```python
   try:
       from backend.compare.extractors.yake_ex import YakeExtractor
       AVAILABLE_EXTRACTORS["yake"] = YakeExtractor
   except Exception as e:
       logger.warning(f"Could not register 'yake' extractor: {e}")
   ```
3. Gemini and any future extractors will continue to operate normally as plug-ins.
