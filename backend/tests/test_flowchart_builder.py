from backend.services.flowchart_builder import build_document_flowchart, select_flowchart_view


def test_overview_topic_pages_keep_all_concepts_and_select_typed_relations():
    concepts = [
        {
            "id": index,
            "name": f"Concept {index}",
            "topic": "Theory",
            "flow_group": "Theory",
            "flow_order": index,
            "related_concepts": [{"name": "Concept 1", "weight": 2, "type": "depends_on", "label": "requires"}] if index > 1 else [],
        }
        for index in range(1, 302)
    ]
    graph = build_document_flowchart("doc", concepts, "First, gather inputs. If valid, continue.")
    assert graph["total_concepts"] == 301
    overview = select_flowchart_view(graph)
    assert overview["overview"] is True
    first_page = select_flowchart_view(graph, "Theory", 0)
    second_page = select_flowchart_view(graph, "Theory", 1, include_related=True)
    ids = {
        node.get("concept_id")
        for page_index in range(first_page["subflow_count"])
        for node in select_flowchart_view(graph, "Theory", page_index)["nodes"]
        if node.get("concept_id")
    }
    assert ids == set(range(1, 302))
    assert first_page["subflow_count"] == 13
    assert any(edge["type"] == "depends_on" for edge in first_page["edges"])


def test_invalid_topic_or_page_returns_none():
    graph = build_document_flowchart("empty", [])
    assert select_flowchart_view(graph, "missing") is None
