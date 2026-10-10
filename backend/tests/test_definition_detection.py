import pytest
from backend.services.concept_extraction import detect_definition_sentence

def test_detect_explicit_definition():
    sentences = [
        "Today we will study thermodynamics.",
        "Entropy is defined as a measure of molecular disorder or randomness in a closed system.",
        "It was discovered by Clausius in the 19th century."
    ]

    definition, excerpt = detect_definition_sentence("entropy", sentences)
    assert definition is not None
    assert "Entropy is defined as" in definition
    assert "molecular disorder" in definition

def test_detect_refers_to_definition():
    sentences = [
        "In quantum physics, entanglement is very special.",
        "Quantum entanglement refers to a phenomenon where quantum particles become inextricably linked.",
        "Einstein called this spooky action at a distance."
    ]

    definition, excerpt = detect_definition_sentence("quantum entanglement", sentences)
    assert definition is not None
    assert "refers to a phenomenon" in definition

def test_fallback_when_no_definition_found():
    sentences = [
        "We observed the spectrum in laboratory experiment number four.",
        "The spectrum exhibited distinct dark emission bands."
    ]

    definition, excerpt = detect_definition_sentence("spectrum", sentences)
    assert definition is None
    assert "laboratory experiment" in excerpt
