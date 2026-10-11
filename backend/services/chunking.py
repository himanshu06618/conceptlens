import re
from typing import List, Dict, Any, Optional

# Regex for common section headings in academic/course notes
HEADING_PATTERNS = [
    re.compile(r"^(?:#{1,6}\s+)(.+)$", re.MULTILINE),  # Markdown headings
    re.compile(r"^(?:chapter|section|module|unit|part)\s+\d+[:\.\-]?\s*(.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^(?:\d+\.){1,3}\s+(.+)$", re.MULTILINE),  # 1.1 Topic
    re.compile(r"^[A-Z\s0-9]{4,50}$", re.MULTILINE)  # ALL CAPS HEADINGS
]

def is_likely_heading(line: str) -> Optional[str]:
    """Determines if a single line acts as a section heading or topic header."""
    s = line.strip()
    if not s or len(s) > 100:
        return None

    # Check explicit patterns
    for pat in HEADING_PATTERNS:
        m = pat.match(s)
        if m:
            heading = m.group(1).strip() if m.groups() else s
            return heading.strip("# -:.")

    # Short line (<= 7 words) without terminal punctuation (., ;, ?), Title Case
    words = s.split()
    if 1 <= len(words) <= 7:
        if not s.endswith((".", ";", "?", "!", ":", ",")):
            # Check title case or uppercase
            if s.istitle() or s.isupper():
                return s

    return None

def create_chunks_from_pages(
    pages: List[Dict[str, Any]],
    nlp_model: Any = None,
    target_min_words: int = 250,
    target_max_words: int = 500
) -> List[Dict[str, Any]]:
    """
    Splits text across pages into chunks (approx 300 to 500 words each) using
    sentence boundaries and heading awareness. Works fast without requiring spaCy.
    """
    chunks: List[Dict[str, Any]] = []
    chunk_index = 0
    current_heading = "General"

    for page_item in pages:
        page_num = page_item.get("page", 1)
        page_text = page_item.get("text", "")
        if not page_text.strip():
            continue

        paragraphs = page_text.split("\n\n")

        current_sentences: List[str] = []
        current_word_count = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # Check if paragraph is just a heading
            detected_heading = is_likely_heading(para)
            if detected_heading:
                # If we already have accumulated enough text, flush previous chunk
                if current_sentences and current_word_count >= target_min_words:
                    chunk_text = " ".join(current_sentences)
                    chunks.append({
                        "id": chunk_index,
                        "page": page_num,
                        "text": chunk_text,
                        "word_count": current_word_count,
                        "heading": current_heading,
                        "sentences": list(current_sentences)
                    })
                    chunk_index += 1
                    current_sentences = []
                    current_word_count = 0

                current_heading = detected_heading
                continue

            # Parse paragraph sentences
            if nlp_model is not None:
                try:
                    doc = nlp_model(para)
                    sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
                except Exception:
                    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", para) if s.strip()]
            else:
                sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", para) if s.strip()]

            for sent in sentences:
                sent_words = len(sent.split())
                if (current_word_count + sent_words > target_max_words) and current_sentences:
                    # Flush current chunk
                    chunk_text = " ".join(current_sentences)
                    chunks.append({
                        "id": chunk_index,
                        "page": page_num,
                        "text": chunk_text,
                        "word_count": current_word_count,
                        "heading": current_heading,
                        "sentences": list(current_sentences)
                    })
                    chunk_index += 1
                    current_sentences = [sent]
                    current_word_count = sent_words
                else:
                    current_sentences.append(sent)
                    current_word_count += sent_words

        # Flush any remaining sentences from this page
        if current_sentences:
            chunk_text = " ".join(current_sentences)
            chunks.append({
                "id": chunk_index,
                "page": page_num,
                "text": chunk_text,
                "word_count": current_word_count,
                "heading": current_heading,
                "sentences": list(current_sentences)
            })
            chunk_index += 1

    # Fallback: If no chunks were created (e.g., short text), create one chunk
    if not chunks and pages:
        combined = " ".join(p.get("text", "") for p in pages).strip()
        if combined:
            doc = nlp_model(combined)
            sents = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
            chunks.append({
                "id": 0,
                "page": 1,
                "text": combined,
                "word_count": len(combined.split()),
                "heading": "General",
                "sentences": sents
            })

    return chunks
