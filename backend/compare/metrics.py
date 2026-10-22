import re
import string
from typing import List, Dict, Any, Tuple
from rapidfuzz import fuzz

def normalize_concept(text: str) -> str:
    """
    Normalizes a concept string:
    - Lowercase
    - Remove punctuation
    - Collapse multiple whitespaces
    - Simple plural handling (e.g., 'trees' -> 'tree', 'matrices' -> 'matrix', 'boxes' -> 'box')
    """
    if not text:
        return ""
    
    # Lowercase
    text = text.lower().strip()
    
    # Strip punctuation
    # Replace punctuation characters with space so 'self-attention' -> 'self attention'
    for ch in string.punctuation:
        text = text.replace(ch, " ")
    
    # Collapse whitespace
    words = [w for w in re.split(r"\s+", text) if w]
    
    # Simple plural reduction per word
    norm_words = []
    for word in words:
        if len(word) > 4 and word.endswith("ies"):
            word = word[:-3] + "y"
        elif len(word) > 4 and word.endswith("es") and (word.endswith("shes") or word.endswith("ches") or word.endswith("xes") or word.endswith("sses")):
            word = word[:-2]
        elif len(word) > 3 and word.endswith("s") and not word.endswith("ss") and not word.endswith("us") and not word.endswith("is"):
            word = word[:-1]
        norm_words.append(word)
        
    return " ".join(norm_words)


def score_note(
    ground_truth: List[str],
    predictions: List[str],
    match_threshold: float = 85.0
) -> Dict[str, Any]:
    """
    Computes Precision, Recall, and F1 for a single note using rapidfuzz token_set_ratio.
    Uses greedy bipartite matching so each ground-truth item can be matched at most once.
    """
    norm_gt = [normalize_concept(g) for g in ground_truth if g.strip()]
    norm_pred = [normalize_concept(p) for p in predictions if p.strip()]

    # If no ground truth exists
    if not norm_gt:
        precision = 1.0 if not norm_pred else 0.0
        recall = 1.0
        f1 = 1.0 if not norm_pred else 0.0
        return {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "true_positives": 0,
            "ground_truth_count": 0,
            "prediction_count": len(norm_pred),
            "matched_pairs": []
        }

    # If no predictions were made
    if not norm_pred:
        return {
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "true_positives": 0,
            "ground_truth_count": len(norm_gt),
            "prediction_count": 0,
            "matched_pairs": []
        }

    matched_gt_indices = set()
    matched_pred_indices = set()
    matched_pairs = []

    # Calculate similarity matrix: (pred_idx, gt_idx, score)
    candidate_matches = []
    for p_idx, p_text in enumerate(norm_pred):
        for g_idx, g_text in enumerate(norm_gt):
            score = fuzz.token_set_ratio(p_text, g_text)
            if score >= match_threshold:
                candidate_matches.append((score, p_idx, g_idx, predictions[p_idx], ground_truth[g_idx]))

    # Sort descending by score for greedy best-match pairing
    candidate_matches.sort(key=lambda x: x[0], reverse=True)

    for score, p_idx, g_idx, orig_p, orig_g in candidate_matches:
        if p_idx not in matched_pred_indices and g_idx not in matched_gt_indices:
            matched_pred_indices.add(p_idx)
            matched_gt_indices.add(g_idx)
            matched_pairs.append({
                "prediction": orig_p,
                "ground_truth": orig_g,
                "score": score
            })

    tp = len(matched_pairs)
    precision = tp / len(norm_pred) if norm_pred else 0.0
    recall = tp / len(norm_gt) if norm_gt else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "true_positives": tp,
        "ground_truth_count": len(norm_gt),
        "prediction_count": len(norm_pred),
        "matched_pairs": matched_pairs
    }


def aggregate_metrics(
    eval_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Computes macro-averages over all notes.
    """
    if not eval_results:
        return {
            "precision": 0.0,
            "recall": 0.0,
            "f1": 0.0,
            "avg_concepts_returned": 0.0,
            "avg_time_seconds": 0.0,
            "total_notes": 0
        }

    n = len(eval_results)
    avg_precision = sum(r.get("precision", 0.0) for r in eval_results) / n
    avg_recall = sum(r.get("recall", 0.0) for r in eval_results) / n
    avg_f1 = sum(r.get("f1", 0.0) for r in eval_results) / n
    avg_concepts = sum(r.get("prediction_count", 0) for r in eval_results) / n
    avg_time = sum(r.get("time_seconds", 0.0) for r in eval_results) / n

    return {
        "precision": round(avg_precision, 4),
        "recall": round(avg_recall, 4),
        "f1": round(avg_f1, 4),
        "avg_concepts_returned": round(avg_concepts, 2),
        "avg_time_seconds": round(avg_time, 4),
        "total_notes": n
    }
