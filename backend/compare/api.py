import os
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(tags=["compare"])

CURRENT_DIR = Path(__file__).resolve().parent
RESULTS_DIR = CURRENT_DIR / "results"
SUMMARY_JSON_PATH = RESULTS_DIR / "summary.json"
CHART_PNG_PATH = RESULTS_DIR / "comparison_bar.png"


def is_compare_enabled() -> bool:
    return os.getenv("ENABLE_COMPARE", "false").lower() == "true"


@router.get("/compare/results")
@router.get("/api/compare/results")
def get_benchmark_results():
    """
    Read-only endpoint returning summary.json from the benchmark.
    Returns 404 when ENABLE_COMPARE is not true.
    """
    if not is_compare_enabled():
        raise HTTPException(
            status_code=404,
            detail="Benchmark module is disabled. Set ENABLE_COMPARE=true to enable."
        )

    if not SUMMARY_JSON_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="No benchmark summary found. Run 'python -m backend.compare.run_benchmark' to generate results."
        )

    try:
        with open(SUMMARY_JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to read benchmark results: {str(e)}"
        )


@router.get("/compare/chart")
@router.get("/api/compare/chart")
def get_benchmark_chart():
    """
    Read-only endpoint returning comparison_bar.png.
    Returns 404 when ENABLE_COMPARE is not true or chart is missing.
    """
    if not is_compare_enabled():
        raise HTTPException(status_code=404, detail="Benchmark module is disabled.")

    if not CHART_PNG_PATH.exists():
        raise HTTPException(status_code=404, detail="Benchmark chart not found.")

    return FileResponse(CHART_PNG_PATH, media_type="image/png")
