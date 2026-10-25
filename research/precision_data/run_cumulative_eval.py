import re
import sys
import json
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "backend"))
from extractor_choice.service import run_extraction
from extractor_choice.text_reader import read_pages_from_file
from extractor_choice.base import clean_phrase, is_valid_phrase
from precision_filter.filter import filter_phrases
from test_rules_eval import load_ground_truth, evaluate_items

def get_doc_text_and_raw_yake(pdf_path):
    pages, _ = read_pages_from_file(pdf_path)
    usable_pages = [p for p in pages if p.get("is_usable")]
    full_text = "\n\n".join(p["text"] for p in usable_pages)
    
    # Run baseline YAKE extraction as done by service.py
    res = run_extraction(pdf_path, method="yake")
    # Raw items from baseline
    baseline_items = [c["name"] for c in res["concepts"]]
    
    # We also collect raw_phrases with their YAKE scores from the document
    import yake
    kw_extractor = yake.KeywordExtractor(
        lan="en",
        n=3,
        dedupLim=0.9,
        top=len(baseline_items) * 2,
        windowsSize=1
    )
    # Also score baseline items
    scored_items = []
    # To preserve the exact baseline items and scores from service.py:
    for c in res["concepts"]:
        # In service.py: score was 1.0 - cand_score, or cand['score'] was round(1.0 - yake_score, 3)
        # c['score'] = round(max(0.1, min(0.99, 1.0 - score)), 3)
        # So yake_score approx 1.0 - c['score']
        yake_score = round(1.0 - c["score"], 3)
        scored_items.append((c["name"], yake_score))
        
    return full_text, baseline_items, scored_items

def run_evaluation_suite():
    gt_phys = load_ground_truth("research/precision_data/Polarisation_LASER_FibreOptics_concept_extraction_comparison.xlsx")
    gt_l18 = load_ground_truth("research/precision_data/Lecture18_concept_extraction_comparison.xlsx")
    
    phys_pdf = "research/precision_data/Polarisation LASER & Fibre Optics -PPW.pdf"
    l18_pdf = "research/precision_data/Lecture 18 Pseudopolynomial.pdf"
    
    datasets = [
        ("Physics (Polarisation, LASER & Fibre Optics)", phys_pdf, gt_phys),
        ("Lecture 18 (Pseudopolynomial)", l18_pdf, gt_l18)
    ]
    
    rules_steps = [
        ("Baseline (no filter)", {
            "rule1_clean": False, "rule2_drop_patterns": False, "rule3_generic_words": False,
            "rule4_support_check": False, "rule5_redundancy": False, "rule6_size_limit": False
        }),
        ("+ Rule 1: Clean phrase", {
            "rule1_clean": True, "rule2_drop_patterns": False, "rule3_generic_words": False,
            "rule4_support_check": False, "rule5_redundancy": False, "rule6_size_limit": False
        }),
        ("+ Rule 2: Drop patterns", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": False,
            "rule4_support_check": False, "rule5_redundancy": False, "rule6_size_limit": False
        }),
        ("+ Rule 3: Generic words", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": True,
            "rule4_support_check": False, "rule5_redundancy": False, "rule6_size_limit": False
        }),
        ("+ Rule 4: Support check", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": True,
            "rule4_support_check": True, "rule5_redundancy": False, "rule6_size_limit": False
        }),
        ("+ Rule 5: Redundancy", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": True,
            "rule4_support_check": True, "rule5_redundancy": True, "rule6_size_limit": False
        }),
        ("+ Rule 6: Size limit (Default)", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": True,
            "rule4_support_check": True, "rule5_redundancy": True, "rule6_size_limit": True
        }),
        ("Softer Config (min_count=1, N=120)", {
            "rule1_clean": True, "rule2_drop_patterns": True, "rule3_generic_words": True,
            "rule4_support_check": True, "rule5_redundancy": True, "rule6_size_limit": True,
            "min_count": 1, "max_size_limit": 120, "words_per_concept": 25
        })
    ]
    
    all_results = {}
    
    for name, pdf_path, gt in datasets:
        print(f"\n==================================================")
        print(f"Dataset: {name}")
        print(f"==================================================")
        full_text, baseline_items, scored_items = get_doc_text_and_raw_yake(pdf_path)
        print(f"Document word count: {len(full_text.split())}")
        
        table = []
        final_kept_items = []
        
        for step_name, cfg in rules_steps:
            if step_name.startswith("Baseline"):
                items = baseline_items
            else:
                items = filter_phrases(scored_items, full_text, config=cfg)
                
            m = evaluate_items(items, gt)
            table.append({
                "step": step_name,
                "items": m["items"],
                "precision": m["precision"],
                "recall": m["recall"],
                "f1": m["f1"],
                "correct_items": m["correct_items"],
                "matched_concepts": m["matched_concepts"]
            })
            if "Default" in step_name:
                final_kept_items = items
                
        all_results[name] = {
            "table": table,
            "final_items": final_kept_items,
            "gt": gt
        }
        
        print(f"{'Step':<35} | {'Items':<6} | {'Precision':<10} | {'Recall':<8} | {'F1':<8}")
        print("-" * 75)
        for row in table:
            print(f"{row['step']:<35} | {row['items']:<6} | {row['precision']:>8.1%}   | {row['recall']:>6.1%} | {row['f1']:>6.1%}")

    # Top 20 kept items NOT in reference list
    for name, data in all_results.items():
        print(f"\n--------------------------------------------------")
        print(f"Top 20 Kept Items NOT in Ground Truth for {name}:")
        print(f"--------------------------------------------------")
        gt_phrases = set()
        for c in data["gt"]:
            for acc in c["accepted"]:
                gt_phrases.add(acc.lower().strip())
        
        not_in_gt = []
        for item in data["final_items"]:
            if item.lower().strip() not in gt_phrases:
                not_in_gt.append(item)
            if len(not_in_gt) == 20:
                break
                
        for i, item in enumerate(not_in_gt, 1):
            print(f"{i:2d}. {item}")

if __name__ == "__main__":
    run_evaluation_suite()
