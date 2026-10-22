# ConceptLens Extractor Benchmark Module

An isolated, flag-gated research module comparing unsupervised keyword/concept extractors (such as **YAKE**) against the production **Gemini** extractor on course notes.

---

## 🚀 Quick Start

### 1. Install Research Dependencies
The research dependencies are isolated in `backend/requirements-research.txt` to keep the production bundle lightweight:
```bash
pip install -r backend/requirements-research.txt
```

### 2. Run Benchmark CLI
Run the benchmark across all sample notes in `backend/compare/data/samples/`:
```bash
# Evaluate both YAKE and Gemini (default)
python -m backend.compare.run_benchmark --extractors yake gemini

# Evaluate YAKE only (runs completely offline without API keys)
python -m backend.compare.run_benchmark --extractors yake

# Force re-running extractions (bypassing cached raw responses)
python -m backend.compare.run_benchmark --extractors yake gemini --force
```

### 3. Generated Artifacts
Results are generated in `backend/compare/results/`:
- `summary.json`: JSON output containing macro averages (Precision, Recall, F1, latency, concept counts) and per-note details.
- `summary.csv`: Tabular CSV of macro metrics.
- `comparison_bar.png`: Dark-mode visualization comparing Precision, Recall, and F1 across extractors.
- `raw_<extractor>.json`: Cached raw responses per extractor to avoid re-calling Gemini during iterative tests.

---

## 📊 Evaluation Methodology

- **Ground Truth**: Stored in `backend/compare/data/ground_truth.json` mapping sample note filenames to reference concept lists.
- **Normalisation**: Lowercased, stripped punctuation, normalized whitespace, and simple word plural normalization.
- **Match Criteria**: Fuzzy semantic alignment using `rapidfuzz.fuzz.token_set_ratio >= 85.0` with greedy bipartite pairing (each ground truth item matches at most one extracted concept).
- **Metrics**:
  - **Precision**: True Positives / Total Concepts Extracted
  - **Recall**: True Positives / Total Ground Truth Concepts
  - **F1 Score**: Harmonic mean of Precision and Recall
  - **Avg Concepts**: Mean number of concepts produced per note
  - **Avg Time**: Mean extraction wall-clock time in seconds

---

## 🌐 Web Viewer (Optional Flag-Gated)

To view the benchmark results in the web UI:
1. Set `ENABLE_COMPARE=true` in your environment (Render or `.env`).
2. Start the backend: `uvicorn backend.main:app --reload`
3. Navigate to `/compare` in the frontend.

When `ENABLE_COMPARE` is unset or `false`, the API endpoints return `404 Not Found` and the main app runs completely untouched.

---

## 🧹 Removal
See [REMOVE.md](file:///D:/ConceptFinder/backend/compare/REMOVE.md) for 4 simple steps to completely uninstall this module.
