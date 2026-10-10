import pytest
from pathlib import Path
from backend.services.file_reader import read_document_file
from backend.services.chunking import create_chunks_from_pages
from backend.services.concept_extraction import extract_concepts_pipeline, get_spacy_nlp

def test_pipeline_on_txt_sample():
    p = Path("samples/physics_quantum_mechanics.txt")
    assert p.exists()
    pages_cnt, pages, full_text, skipped = read_document_file(p)
    assert pages_cnt == 1
    assert "quantum mechanics" in full_text.lower()
    
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    assert len(chunks) >= 1
    
    concepts_res = extract_concepts_pipeline(chunks, full_text)
    concepts = concepts_res[0] if isinstance(concepts_res, tuple) else concepts_res
    assert len(concepts) >= 5
    concept_names = [c["name"].lower() for c in concepts]
    assert any("quantum" in name or "wave" in name or "planck" in name for name in concept_names)
    
    # Check definition extracted
    has_definition = any(bool(c.get("definition")) for c in concepts)
    assert has_definition

def test_pipeline_on_pdf_sample():
    p = Path("samples/biology_cell_structure.pdf")
    assert p.exists()
    pages_cnt, pages, full_text, skipped = read_document_file(p)
    assert pages_cnt == 2
    assert "mitochondria" in full_text.lower()
    
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    concepts_res = extract_concepts_pipeline(chunks, full_text)
    concepts = concepts_res[0] if isinstance(concepts_res, tuple) else concepts_res
    assert len(concepts) >= 5
    concept_names = [c["name"].lower() for c in concepts]
    assert any("mitochondria" in name or "cell" in name or "ribosome" in name for name in concept_names)

def test_pipeline_on_image_ocr_sample():
    p = Path("samples/scanned_notes_neural_networks.png")
    assert p.exists()
    pages_cnt, pages, full_text, skipped = read_document_file(p)
    assert pages_cnt == 1
    assert len(full_text) > 100
    
    nlp = get_spacy_nlp()
    chunks = create_chunks_from_pages(pages, nlp)
    concepts_res = extract_concepts_pipeline(chunks, full_text)
    concepts = concepts_res[0] if isinstance(concepts_res, tuple) else concepts_res
    assert len(concepts) >= 3
    concept_names = [c["name"].lower() for c in concepts]
    assert any("neural" in name or "activation" in name or "backpropagation" in name or "gradient" in name for name in concept_names)
