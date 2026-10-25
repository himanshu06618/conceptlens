# Precision Post-Filter for ConceptLens (YAKE & RAKE)

## Overview
The **Precision Filter** is a modular, zero-dependency, rule-based post-filter designed to drastically improve the precision of keywords extracted by YAKE (Yet Another Keyword Extractor) and RAKE (Rapid Automatic Keyword Extraction) in ConceptLens.

It eliminates common statistical keyword artifacts—such as slide navigation labels, sentence fragments, and grammatical noise—without altering how the underlying statistical algorithms execute or making any external LLM calls.

---

## Architectural Principles
1. **Zero External Calls**: Fully local and deterministic; no Gemini calls or database queries.
2. **Strict Failsafe**: `filter_phrases(phrases_with_scores, document_text, config=None)` is wrapped in an unconditional `try...except` safety block. It **never raises an exception**; on any error, it returns the original YAKE output untouched.
3. **Feature-Flag Control**: Controlled via environment variable `YAKE_PRECISION` (`on` by default; set to `off` to disable).
4. **Independent Modular Rules**: Each rule is individually toggleable in `config.json`.
5. **No Third-Party Dependencies**: Pure Python standard library (`re`, `json`, `os`, `pathlib`).

---

## The 6 Rules

### Rule 1: Clean and Normalize (`rule1_clean`)
- Replaces unicode dashes (em-dashes, en-dashes, minus signs) with standard hyphens.
- Collapses extra whitespace and trims surrounding punctuation.
- Repeatedly strips leading and trailing stop words, articles, prepositions, conjunctions, and auxiliary verbs (e.g., `"the quantum tunnelling"` becomes `"Quantum Tunnelling"`).
- Preserves acronyms (`LED`, `YAG`) and chemical/mathematical terms (`Nd3+ ions`).

### Rule 2: Drop Pattern Violations (`rule2_drop_patterns`)
- Drops pure numbers (e.g., `"123"`, `"3.14"`).
- Drops items under 3 characters, with an explicit exception for all-caps acronyms (e.g., `LED`, `DP`, `AI`).
- Drops phrases composed solely of stop words (e.g., `"in and out"`).
- Drops phrases ending with a stop word or common verb (e.g., `"Figure Shows"`, `"Energy Produced"`).
- Drops sentence fragments containing middle auxiliary verbs (`"is"`, `"are"`, `"was"`, `"were"`, `"can"`, `"will"`), such as `"light is incident"`.

### Rule 3: Generic Academic Slide Words (`rule3_generic_words`)
- Drops single words listed in `generic_words.json` (e.g., `introduction`, `advantages`, `disadvantages`, `application`, `formulas`, `numericals`, `example`, `figure`, `fig`, `working`, `construction`, `according`, `thus`, `therefore`, `called`, `due`, `form`, `time`, `input`, `output`).
- Keeps multi-word domain phrases that merely contain them (e.g., `"Numerical Aperture"`, `"Applications Of Optic Fibre"`, `"Input Size"`).

### Rule 4: Text Support Check (`rule4_support_check`)
- Ensures a candidate phrase appears at least `min_count` times (default: 2) in the document text.
- Exceptions (kept even if count < 2):
  - Acronyms (e.g., `LED`, `TIR`, `He-Ne`).
  - Contains a digit or symbol (e.g., `Nd3+ ions`, `1D`, `3D`).
  - Appears in a document heading (sections, slide titles, numbered headers).

### Rule 5: Redundancy & Variant Merging (`rule5_redundancy`)
- **Variant Merging**: Merges plural, hyphen, and space variants (e.g., `"Polarizations"` -> `"Polarization"`), retaining the canonical singular/standard form with the best statistical score.
- **Sub-phrase Deduplication**: If a shorter phrase is fully contained in a longer kept phrase and appears fewer than 2 times outside of it (e.g., `"Tunnelling"` vs `"Quantum Tunnelling"`), the redundant sub-phrase is pruned.

### Rule 6: Size Limit Clamp (`rule6_size_limit`)
- Dynamically scales candidate count based on document length:
  $$N = \text{clamp}\left(\text{round}\left(\frac{\text{word\_count}}{40}\right), 15, 80\right)$$
- Retains the top $N$ phrases ranked by YAKE score (lower score = higher statistical significance).

---

## Configuration (`config.json`)

```json
{
  "rule1_clean": true,
  "rule2_drop_patterns": true,
  "rule3_generic_words": true,
  "rule4_support_check": true,
  "rule5_redundancy": true,
  "rule6_size_limit": true,
  "min_count": 2,
  "max_heading_words": 10,
  "min_size_limit": 15,
  "max_size_limit": 80,
  "words_per_concept": 40
}
```

---

## Benchmark Results

### Physics Chapter: *Polarisation, LASER & Fibre Optics* (6,673 words, 138 GT concepts)
| Configuration | Items | Precision | Recall | F1 |
| :--- | :---: | :---: | :---: | :---: |
| **Baseline (Raw YAKE)** | 643 | 26.0% | 71.0% | 38.0% |
| **+ Rule 1 (Clean)** | 643 | 25.8% | 71.0% | 37.9% |
| **+ Rule 2 (Drop Patterns)** | 619 | 26.8% | 71.0% | 38.9% |
| **+ Rule 3 (Generic Words)** | 600 | 27.7% | 71.0% | 39.8% |
| **+ Rule 4 (Support Check)** | 385 | 31.7% | 58.7% | 41.2% |
| **+ Rule 5 (Redundancy)** | 322 | 32.9% | 56.5% | **41.6%** |
| **+ Rule 6 (Default Capped at 80)** | 80 | **43.8%** | 23.2% | 30.3% |
| **Softer Balanced Config (min_count=1, N=120)** | 120 | 37.5% | 28.3% | 32.2% |

### Lecture 18: *Pseudopolynomial* (1,559 words, 47 GT concepts)
| Configuration | Items | Precision | Recall | F1 |
| :--- | :---: | :---: | :---: | :---: |
| **Baseline (Raw YAKE)** | 136 | 19.1% | 44.7% | 26.8% |
| **+ Rules 1–5 (No hard cap)** | 71 | 31.0% | 40.4% | **35.1%** |
| **+ Rule 6 (Default Capped at 39)** | 39 | **33.3%** | 25.5% | 28.9% |
| **Full Pipeline in Service (Page-by-page)** | 67 | **32.8%** | 40.4% | **36.2%** |
