import pytest
from backend.services.tree_builder import build_document_tree, MAX_LEVELS, MAX_TOPICS, MAX_CHILDREN_PER_NODE

def test_empty_document():
    tree = build_document_tree("doc_empty", "Empty Doc", [])
    assert tree["document_id"] == "doc_empty"
    assert tree["node_count"] == 1
    assert tree["nodes"][0]["level"] == 0
    assert tree["edge_count"] == 0

def test_very_short_document():
    concepts = [
        {
            "id": 1,
            "name": "Machine Learning",
            "definition": "A field of study concerned with algorithms that learn from data.",
            "topic": "AI",
            "importance": 5,
            "score": 0.95,
            "page": 1,
            "source_excerpt": "Machine Learning is an application of AI.",
            "related_concepts": []
        }
    ]
    tree = build_document_tree("doc_short", "Short Note", concepts)
    assert tree["node_count"] >= 3  # Root, Topic AI, Concept Machine Learning
    levels = {n["level"] for n in tree["nodes"]}
    assert 0 in levels
    assert 1 in levels
    assert 2 in levels
    assert max(levels) <= 3

def test_document_with_no_headings_clusters_automatically():
    # 12 concepts all marked "General"
    concepts = [
        {"id": i, "name": f"Concept {i}", "definition": f"Definition of concept {i}", "topic": "General", "importance": 3, "score": 0.5 + i * 0.02, "page": 1}
        for i in range(1, 13)
    ]
    tree = build_document_tree("doc_no_headings", "Lecture Notes", concepts)
    assert tree["topic_count"] >= 2
    assert tree["topic_count"] <= MAX_TOPICS
    # Level 1 nodes must be topics
    topic_nodes = [n for n in tree["nodes"] if n["level"] == 1]
    assert len(topic_nodes) == tree["topic_count"]

def test_single_topic_document():
    concepts = [
        {"id": i, "name": f"Term {i}", "definition": f"Definition {i}", "topic": "Quantum Mechanics", "importance": 4 if i < 3 else 2, "score": 0.8, "page": 1}
        for i in range(1, 8)
    ]
    tree = build_document_tree("doc_quantum", "Quantum Physics", concepts)
    assert tree["topic_count"] >= 1
    topic_nodes = [n for n in tree["nodes"] if n["level"] == 1]
    assert len(topic_nodes) >= 1
    # Check that levels do not exceed MAX_LEVELS
    for n in tree["nodes"]:
        assert n["level"] < MAX_LEVELS

def test_subconcepts_attachment():
    concepts = [
        {
            "id": 1,
            "name": "Neural Networks",
            "definition": "Computational models inspired by biological neural systems.",
            "topic": "Deep Learning",
            "importance": 5,
            "score": 0.95
        },
        {
            "id": 2,
            "name": "Convolutional Neural Networks",
            "definition": "Specialized Neural Networks for image data processing.",
            "topic": "Deep Learning",
            "importance": 3,
            "score": 0.70
        }
    ]
    tree = build_document_tree("doc_dl", "Deep Learning Lecture", concepts)
    cnn_node = next((n for n in tree["nodes"] if "Convolutional" in n["label"]), None)
    assert cnn_node is not None
    # CNN should be recognized as sub-concept (level 3) under Neural Networks
    assert cnn_node["level"] == 3

def test_large_topics_retain_every_concept():
    concepts = [
        {"id": i, "name": f"Physics Law {i}", "definition": f"Law description {i}", "topic": "Mechanics", "importance": 3, "score": 0.5, "page": 1}
        for i in range(1, 21)
    ]
    tree = build_document_tree("doc_overflow", "Physics", concepts)
    concept_ids = {node.get("concept_id") for node in tree["nodes"] if node.get("concept_id") is not None}
    assert concept_ids == {item["id"] for item in concepts}
    assert not any(node.get("is_more_node") for node in tree["nodes"])

def test_tree_retains_topics_after_legacy_limit():
    concepts = [
        {"id": i, "name": f"Term {i}", "topic": f"Topic {i}", "importance": 3, "score": 0.5, "page": i}
        for i in range(1, 13)
    ]
    tree = build_document_tree("doc_many_topics", "Many Topics", concepts)
    topic_nodes = [node for node in tree["nodes"] if node["level"] == 1]
    concept_ids = {node.get("concept_id") for node in tree["nodes"] if node.get("concept_id") is not None}
    assert len(topic_nodes) == len(concepts)
    assert concept_ids == {item["id"] for item in concepts}

def test_cross_links_related_flag():
    concepts = [
        {
            "id": 1,
            "name": "Entropy",
            "definition": "Measure of disorder.",
            "topic": "Thermodynamics",
            "importance": 4,
            "score": 0.8,
            "related_concepts": [{"name": "Information Theory", "weight": 2}]
        },
        {
            "id": 2,
            "name": "Information Theory",
            "definition": "Mathematical study of information quantification.",
            "topic": "Computing",
            "importance": 4,
            "score": 0.8,
            "related_concepts": [{"name": "Entropy", "weight": 2}]
        }
    ]
    tree = build_document_tree("doc_cross", "Cross-disciplinary", concepts)
    rel_edges = [e for e in tree["edges"] if e.get("is_related")]
    assert len(rel_edges) >= 1
    assert rel_edges[0]["is_related"] is True

def test_every_concept_has_exact_one_parent():
    concepts = [
        {"id": i, "name": f"Concept {i}", "definition": f"Definition {i}", "topic": f"Topic {i % 3}", "importance": 3, "score": 0.6}
        for i in range(1, 10)
    ]
    tree = build_document_tree("doc_parents", "Parent Test", concepts)
    # Check tree edges (non-related) form a valid tree where each non-root has 1 incoming edge
    non_rel_edges = [e for e in tree["edges"] if not e.get("is_related")]
    target_counts = {}
    for e in non_rel_edges:
        target = e["target"]
        target_counts[target] = target_counts.get(target, 0) + 1

    for target, count in target_counts.items():
        assert count == 1, f"Target node {target} has {count} parents in tree hierarchy!"
