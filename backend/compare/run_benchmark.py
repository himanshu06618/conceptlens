import os
import sys
import time
import json
import argparse
from pathlib import Path
from typing import Dict, Any, List

# Use Agg backend for headless plotting
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from backend.compare.registry import get_extractor, list_available_extractors
from backend.compare.metrics import score_note, aggregate_metrics

CURRENT_DIR = Path(__file__).resolve().parent
DEFAULT_SAMPLES_DIR = CURRENT_DIR / "data" / "samples"
DEFAULT_GROUND_TRUTH_FILE = CURRENT_DIR / "data" / "ground_truth.json"
DEFAULT_RESULTS_DIR = CURRENT_DIR / "results"


def load_ground_truth(gt_path: Path) -> Dict[str, List[str]]:
    if not gt_path.exists():
        print(f"[WARN] Ground truth file not found at {gt_path}. Using empty ground truth.")
        return {}
    with open(gt_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_raw_cache(cache_file: Path) -> Dict[str, Any]:
    if cache_file.exists():
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to load cache from {cache_file}: {e}")
    return {}


def save_raw_cache(cache_file: Path, data: Dict[str, Any]) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def run_benchmark(
    extractor_names: List[str],
    samples_dir: Path = DEFAULT_SAMPLES_DIR,
    gt_file: Path = DEFAULT_GROUND_TRUTH_FILE,
    results_dir: Path = DEFAULT_RESULTS_DIR,
    delay: float = 2.0,
    force: bool = False
):
    results_dir.mkdir(parents=True, exist_ok=True)
    ground_truth = load_ground_truth(gt_file)

    # Collect sample files
    sample_files = sorted(list(samples_dir.glob("*.txt")))
    if not sample_files:
        print(f"[ERROR] No .txt files found in {samples_dir}")
        return

    print(f"==================================================")
    print(f" Starting Benchmark on {len(sample_files)} sample note(s)")
    print(f" Extractors requested: {', '.join(extractor_names)}")
    print(f"==================================================\n")

    summary_data = {}
    detailed_notes_data: Dict[str, Dict[str, Any]] = {s.name: {} for s in sample_files}
    table_rows = []

    for name in extractor_names:
        print(f"--> Evaluating Extractor: [{name}]")
        try:
            extractor = get_extractor(name)
        except Exception as e:
            print(f"    [SKIP] Could not initialize {name}: {e}\n")
            continue

        raw_cache_file = results_dir / f"raw_{name}.json"
        raw_cache = {} if force else load_raw_cache(raw_cache_file)

        note_evals = []

        for sample_path in sample_files:
            note_name = sample_path.name
            gt_concepts = ground_truth.get(note_name, [])

            if note_name in raw_cache and not force:
                cached_entry = raw_cache[note_name]
                concepts = cached_entry.get("concepts", [])
                elapsed_time = cached_entry.get("time_seconds", 0.0)
                print(f"    - {note_name}: using cached result ({len(concepts)} concepts in {elapsed_time:.2f}s)")
            else:
                with open(sample_path, "r", encoding="utf-8") as f:
                    text = f.read()

                start_t = time.perf_counter()
                try:
                    concepts = extractor.extract(text)
                except Exception as err:
                    print(f"    [ERROR] Extraction failed for {note_name} with {name}: {err}")
                    concepts = []
                elapsed_time = time.perf_counter() - start_t

                raw_cache[note_name] = {
                    "concepts": concepts,
                    "time_seconds": round(elapsed_time, 4)
                }
                save_raw_cache(raw_cache_file, raw_cache)
                print(f"    - {note_name}: extracted {len(concepts)} concepts in {elapsed_time:.2f}s")

                # Respect rate limits on live API calls (especially Gemini free-tier)
                if name.lower() == "gemini" and delay > 0:
                    time.sleep(delay)

            # Evaluate metrics for note
            score = score_note(gt_concepts, concepts)
            score["time_seconds"] = elapsed_time
            note_evals.append(score)

            detailed_notes_data[note_name][name] = {
                "concepts": concepts,
                "precision": score["precision"],
                "recall": score["recall"],
                "f1": score["f1"],
                "time_seconds": round(elapsed_time, 4),
                "matched_pairs": score["matched_pairs"]
            }

        # Aggregate metrics
        macro_avg = aggregate_metrics(note_evals)
        summary_data[name] = macro_avg

        table_rows.append({
            "Extractor": name,
            "Precision": macro_avg["precision"],
            "Recall": macro_avg["recall"],
            "F1": macro_avg["f1"],
            "Avg Concepts": macro_avg["avg_concepts_returned"],
            "Avg Time (s)": macro_avg["avg_time_seconds"],
            "Notes Count": macro_avg["total_notes"]
        })
        print(f"    => Macro Avg F1: {macro_avg['f1']} | Precision: {macro_avg['precision']} | Recall: {macro_avg['recall']}\n")

    if not table_rows:
        print("[WARN] No extractors succeeded. Exiting.")
        return

    # 1. Output summary.json
    final_output = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extractors": summary_data,
        "notes_detail": detailed_notes_data
    }
    summary_json_path = results_dir / "summary.json"
    with open(summary_json_path, "w", encoding="utf-8") as f:
        json.dump(final_output, f, indent=2, ensure_ascii=False)
    print(f"[OK] Saved summary JSON: {summary_json_path}")

    # 2. Output summary.csv
    df = pd.DataFrame(table_rows)
    summary_csv_path = results_dir / "summary.csv"
    df.to_csv(summary_csv_path, index=False)
    print(f"[OK] Saved summary CSV: {summary_csv_path}")

    # 3. Output comparison_bar.png
    plot_path = results_dir / "comparison_bar.png"
    generate_comparison_chart(df, plot_path)
    print(f"[OK] Saved comparison chart: {plot_path}")

    # Print summary table
    print("\n" + "=" * 65)
    print("                BENCHMARK SUMMARY RESULTS")
    print("=" * 65)
    print(df.to_string(index=False))
    print("=" * 65 + "\n")


def generate_comparison_chart(df: pd.DataFrame, output_path: Path):
    """
    Renders a clean, aesthetic bar chart comparing Precision, Recall, and F1
    in ConceptLens palette (lime & slate).
    """
    if df.empty:
        return

    extractors = df["Extractor"].tolist()
    metrics = ["Precision", "Recall", "F1"]
    
    # Modern dark/glass friendly palette
    colors = ["#38bdf8", "#a3e635", "#f59e0b"]  # sky blue, lime, amber
    
    import numpy as np
    x = np.arange(len(extractors))
    width = 0.25

    fig, ax = plt.subplots(figsize=(8, 5), dpi=150)
    fig.patch.set_facecolor("#0f172a")
    ax.set_facecolor("#1e293b")

    for i, metric in enumerate(metrics):
        values = df[metric].tolist()
        offset = (i - 1) * width
        rects = ax.bar(x + offset, values, width, label=metric, color=colors[i], edgecolor="#334155", linewidth=0.8, alpha=0.92)
        # Add value labels on top of bars
        for rect in rects:
            height = rect.get_height()
            ax.annotate(f"{height:.2f}",
                        xy=(rect.get_x() + rect.get_width() / 2, height),
                        xytext=(0, 3),  # 3 points vertical offset
                        textcoords="offset points",
                        ha="center", va="bottom",
                        fontsize=8, fontweight="bold", color="#f8fafc")

    ax.set_ylabel("Score (0.0 - 1.0)", color="#94a3b8", fontsize=10, fontweight="bold")
    ax.set_title("ConceptLens Extractor Benchmark Comparison", color="#f8fafc", fontsize=13, fontweight="bold", pad=15)
    ax.set_xticks(x)
    ax.set_xticklabels(extractors, color="#f8fafc", fontsize=11, fontweight="bold")
    ax.set_ylim(0, 1.15)
    ax.grid(axis="y", linestyle="--", alpha=0.2, color="#94a3b8")
    
    # Styling borders
    for spine in ax.spines.values():
        spine.set_color("#334155")
        
    ax.tick_params(colors="#94a3b8")
    legend = ax.legend(frameon=True, facecolor="#0f172a", edgecolor="#334155", labelcolor="#f8fafc")
    
    plt.tight_layout()
    fig.savefig(output_path, facecolor=fig.get_facecolor(), edgecolor="none")
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description="ConceptLens Extractor Benchmark Runner")
    parser.add_argument(
        "--extractors",
        nargs="+",
        default=["yake", "gemini"],
        help="Extractors to run (e.g. yake gemini)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-extraction ignoring cached raw responses"
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Delay in seconds between remote API calls to respect rate limits"
    )
    parser.add_argument(
        "--samples-dir",
        type=str,
        default=str(DEFAULT_SAMPLES_DIR),
        help="Directory containing sample .txt note files"
    )
    parser.add_argument(
        "--ground-truth",
        type=str,
        default=str(DEFAULT_GROUND_TRUTH_FILE),
        help="Path to ground_truth.json"
    )
    parser.add_argument(
        "--results-dir",
        type=str,
        default=str(DEFAULT_RESULTS_DIR),
        help="Directory to save output benchmark results"
    )

    args = parser.parse_args()

    run_benchmark(
        extractor_names=args.extractors,
        samples_dir=Path(args.samples_dir),
        gt_file=Path(args.ground_truth),
        results_dir=Path(args.results_dir),
        delay=args.delay,
        force=args.force
    )


if __name__ == "__main__":
    main()
