# How to Remove the Precision Filter (YAKE & RAKE)

If you ever wish to completely remove the precision filter and restore YAKE and RAKE extractions to their original, raw behavior, follow these 3 simple steps:

---

### Step 1: Delete the Precision Filter Directory
Delete the entire `backend/precision_filter/` folder:

```bash
# On Linux / macOS / Git Bash
rm -rf backend/precision_filter/

# On Windows PowerShell
Remove-Item -Recurse -Force backend\precision_filter
```

---

### Step 2: Remove the Marked Blocks in the Extractors
Delete the blocks marked `# PRECISION-FILTER-START` / `# PRECISION-FILTER-END`:

1. **In `backend/extractor_choice/yake_ex.py`**:
   - Inside `YakeExtractor.extract()`
   - Inside `YakeExtractor.extract_with_scores()`

2. **In `backend/extractor_choice/rake_textrank_ex.py`**:
   - Inside `RakeTextRankExtractor.extract()`
   - Inside `RakeTextRankExtractor.extract_with_scores()`

Simply delete those lines. The functions will return to their original baseline behavior (`clean_phrases(combined)` and `results`).

---

### Step 3: Remove or Unset the Environment Variables
If you defined `YAKE_PRECISION` or `RAKE_PRECISION` in your `.env`, Render, or Vercel environment settings, remove or unset them:

```bash
# Linux / macOS
unset YAKE_PRECISION
unset RAKE_PRECISION

# Windows PowerShell
Remove-Item Env:\YAKE_PRECISION -ErrorAction SilentlyContinue
Remove-Item Env:\RAKE_PRECISION -ErrorAction SilentlyContinue
```

---

### Verification
1. Run tests to confirm original behavior:
   ```bash
   python -m pytest backend/tests/test_extractor_choice.py
   ```
2. Check that no markers remain:
   ```bash
   git grep -ni "PRECISION-FILTER"
   ```
   *(Should return 0 matches)*.
3. Commit and push:
   ```bash
   git commit -am "Remove precision filter"
   git push origin main
   ```

**Nothing else was modified.** No database migrations, no dependencies in `requirements.txt`, and no Gemini components were touched.
