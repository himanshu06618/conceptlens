# Complete Removal Instructions

This module was designed to be 100% cleanly removable at any time with zero residual side effects.

---

## Complete Feature Removal Steps

Follow these steps to completely remove the extractor choice feature:

### Step 1: Delete New Module Directories
```bash
# Delete backend and frontend modules
rm -rf backend/extractor_choice
rm -rf frontend/src/extractorChoice
```

### Step 2: Delete Auxiliary Dependency File
```bash
rm backend/requirements-extractors.txt
```

### Step 3: Remove Marked Blocks from Existing Files
Find all occurrences of the marked blocks across the codebase:
```bash
grep -rn "EXTRACTOR-CHOICE" backend frontend/src
```
In each matching file, delete the lines between and including:
- `# EXTRACTOR-CHOICE-START` and `# EXTRACTOR-CHOICE-END` (Python)
- `// EXTRACTOR-CHOICE-START` and `// EXTRACTOR-CHOICE-END` (JS/JSX)

The files containing marked blocks are:
1. `backend/main.py`
2. `backend/models.py`
3. `backend/services/tree_builder.py`
4. `frontend/src/components/UploadView.jsx`
5. `frontend/src/api/client.js`

### Step 4: Remove Environment Variables
- In Render dashboard: delete or unset `ENABLE_EXTRACTOR_CHOICE`.
- In Vercel dashboard: delete or unset `VITE_ENABLE_EXTRACTOR_CHOICE`.
- In local `.env` files: remove `ENABLE_EXTRACTOR_CHOICE` and `VITE_ENABLE_EXTRACTOR_CHOICE`.

### Step 5: Clean Up Git & Cache
- In `.gitignore`: remove the `.nltk_data/` line.
- If created, delete the local NLTK data folder: `rm -rf backend/extractor_choice/.nltk_data`.

---

## How to Remove a Single Extraction Method

To remove just one method without removing the rest of the feature:

1. **Delete the extractor file**:
   - For YAKE: delete `backend/extractor_choice/yake_ex.py`
   - For RAKE / TextRank: delete `backend/extractor_choice/rake_textrank_ex.py`
   - For spaCy: delete `backend/extractor_choice/spacy_ex.py`

2. **Remove its registry entry**:
   - In `backend/extractor_choice/registry.py`, delete the `try/except` block registering that extractor, and remove its key from `available()`.

3. **Remove from the frontend picker**:
   - In `frontend/src/extractorChoice/ExtractorPicker.jsx`, remove the corresponding method entry from the `METHODS` array.
