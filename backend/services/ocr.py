"""
backend/services/ocr.py
Robust OCR Engine with RapidOCR (ONNX Runtime, default local),
Optional Tesseract, and Gemini Cloud Vision reader.
EasyOCR has been completely removed.
"""

import os
import io
import re
import shutil
import logging
from typing import Optional, Union, Tuple
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("conceptlens.ocr")

OCR_ENGINE_CONFIG = os.getenv("OCR_ENGINE", "rapidocr").lower()
TESSERACT_CMD_CONFIG = os.getenv("TESSERACT_CMD", "").strip()

# Global Warm Singletons
_rapidocr_engine = None
_rapidocr_status: Tuple[bool, str] = (False, "Not initialized")


class OcrUnavailableError(Exception):
    """Raised when no OCR engine is available."""
    pass


def get_rapidocr_engine():
    """Lazily loads and returns the RapidOCR ONNX singleton."""
    global _rapidocr_engine
    if _rapidocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            logger.info("Initializing RapidOCR (ONNX Runtime engine)...")
            _rapidocr_engine = RapidOCR()
        except Exception as e:
            logger.error(f"Failed to initialize RapidOCR: {e}")
            raise
    return _rapidocr_engine


def check_rapidocr_available() -> Tuple[bool, str]:
    """Tests RapidOCR on a tiny test image at startup to ensure no silent failures."""
    global _rapidocr_status
    try:
        engine = get_rapidocr_engine()
        # Test on a tiny 60x60 white image
        test_img = np.ones((60, 60, 3), dtype=np.uint8) * 255
        result, _ = engine(test_img)
        _rapidocr_status = (True, "RapidOCR ONNX Runtime operational")
        return _rapidocr_status
    except Exception as e:
        _rapidocr_status = (False, f"RapidOCR failed: {e}")
        logger.warning(f"RapidOCR self-check failed: {e}")
        return _rapidocr_status


def _find_tesseract_binary() -> Optional[str]:
    """Finds Tesseract executable if installed."""
    import pytesseract

    if TESSERACT_CMD_CONFIG and os.path.isfile(TESSERACT_CMD_CONFIG):
        return TESSERACT_CMD_CONFIG

    which_cmd = shutil.which("tesseract")
    if which_cmd:
        return which_cmd

    common_windows_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe")
    ]
    for p in common_windows_paths:
        if os.path.isfile(p):
            return p

    return None


def is_tesseract_available() -> bool:
    """Checks whether pytesseract binary is available."""
    try:
        import pytesseract
        binary = _find_tesseract_binary()
        if binary:
            pytesseract.pytesseract.tesseract_cmd = binary
        _ = pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def to_numpy_bgr(image_input: Union[str, Path, Image.Image, np.ndarray]) -> np.ndarray:
    """Converts a file path, PIL Image, or existing array into an OpenCV BGR numpy array."""
    if isinstance(image_input, (str, Path)):
        img_array = np.fromfile(str(image_input), np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"Could not read image from path: {image_input}")
        return img
    elif isinstance(image_input, Image.Image):
        rgb = np.array(image_input.convert("RGB"))
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    elif isinstance(image_input, np.ndarray):
        if len(image_input.shape) == 2:
            return cv2.cvtColor(image_input, cv2.COLOR_GRAY2BGR)
        return image_input
    else:
        raise TypeError(f"Unsupported image input type: {type(image_input)}")


def downscale_if_needed(img: np.ndarray, max_edge: int = 2000) -> np.ndarray:
    """Downscales image so long edge is at most max_edge."""
    h, w = img.shape[:2]
    long_edge = max(h, w)
    if long_edge > max_edge:
        scale = max_edge / float(long_edge)
        new_w = int(w * scale)
        new_h = int(h * scale)
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return img


def _ocr_with_rapidocr(img: np.ndarray) -> str:
    """Runs RapidOCR on image array."""
    engine = get_rapidocr_engine()
    results, _ = engine(img)
    if not results:
        return ""
    lines = [item[1] for item in results if item and len(item) > 1 and item[1]]
    return "\n".join(lines).strip()


def _ocr_with_tesseract(img: np.ndarray) -> str:
    """Runs pytesseract if available."""
    import pytesseract
    binary = _find_tesseract_binary()
    if binary:
        pytesseract.pytesseract.tesseract_cmd = binary
    return pytesseract.image_to_string(img, config="--psm 3").strip()


def _ocr_with_gemini_vision(img_bytes: bytes, api_key: str, model_name: str) -> Optional[str]:
    """Extracts text from image bytes using Gemini Flash vision."""
    import requests
    import base64
    b64 = base64.b64encode(img_bytes).decode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
    payload = {
        "contents": [{
            "parts": [
                {"text": "Transcribe all readable text from this document image exactly as written. Return only the extracted text with original paragraph breaks without extra comments."},
                {"inlineData": {"mimeType": "image/jpeg", "data": b64}}
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "thinkingConfig": {"thinkingBudget": 0}
        }
    }
    try:
        resp = requests.post(url, params={"key": api_key}, json=payload, timeout=25)
        if resp.status_code == 200:
            data = resp.json()
            candidates = data.get("candidates", [])
            if candidates and "content" in candidates[0]:
                parts = candidates[0]["content"].get("parts", [])
                text_parts = [p.get("text", "") for p in parts]
                return "\n".join(text_parts).strip()
    except Exception as e:
        logger.warning(f"Gemini vision OCR call failed: {e}")
    return None


def run_ocr_on_image(
    image_input: Union[str, Path, Image.Image, np.ndarray],
    prefer_cloud: bool = False,
    gemini_api_key: Optional[str] = None,
    gemini_model: str = "gemini-flash-latest"
) -> str:
    """
    Bulletproof OCR ladder:
    1. Gemini Vision (if prefer_cloud and valid API key provided)
    2. RapidOCR (local default, fast ONNX)
    3. Tesseract (if installed)
    """
    bgr_img = to_numpy_bgr(image_input)
    bgr_img = downscale_if_needed(bgr_img, max_edge=2000)

    # 1. Cloud OCR ladder step
    if prefer_cloud and gemini_api_key:
        try:
            # Encode to JPEG
            _, buffer = cv2.imencode(".jpg", bgr_img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            cloud_text = _ocr_with_gemini_vision(buffer.tobytes(), gemini_api_key, gemini_model)
            if cloud_text and len(cloud_text.strip()) >= 20:
                logger.info(f"Cloud OCR succeeded ({len(cloud_text)} chars).")
                return cloud_text.strip()
        except Exception as e:
            logger.warning(f"Cloud OCR attempt failed, proceeding to RapidOCR: {e}")

    # 2. RapidOCR step (local default)
    try:
        text = _ocr_with_rapidocr(bgr_img)
        if text and len(text.strip()) >= 15:
            return text.strip()
    except Exception as e:
        logger.warning(f"RapidOCR failed: {e}")

    # 3. Tesseract step (optional fallback)
    if is_tesseract_available():
        try:
            text = _ocr_with_tesseract(bgr_img)
            if text and len(text.strip()) >= 15:
                return text.strip()
        except Exception as e:
            logger.warning(f"Tesseract OCR fallback failed: {e}")

    return ""
