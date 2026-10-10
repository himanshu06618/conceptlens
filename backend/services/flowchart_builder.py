import re
from collections import defaultdict
from typing import Any, Dict, List, Optional

DETAIL_PAGE_SIZE = 25
ORDERED_STEP = re.compile(r"^\s*(?:step\s*)?\d{1,3}[.):\-]\s*(.+)$", re.I)
ORDER_WORD = re.compile(r"\b(first|second|third|then|next|finally|after that)\b", re.I)
CONDITION = re.compile(r"\b(if|whether|unless|otherwise)\b[^.!?;]*", re.I)


def _edge(source: str, target: str, relation_type: str = "sequence", label: str = "") -> Dict[str, Any]:
    return {
        "id": f"{relation_type}:{source}:{target}",
        "source": source,
        "target": target,
        "type": relation_type,
        "label": label,
    }


def build_document_flowchart(
    doc_id: str,
    concepts: List[Dict[str, Any]],
    raw_text: str = "",
    include_related: bool = False,
) -> Dict[str, Any]:
    groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for concept in concepts:
        groups[str(concept.get("flow_group") or concept.get("topic") or "General")].append(concept)
    topics = list(groups) or ["General"]
    start_id, end_id = f"start:{doc_id}", f"end:{doc_id}"
    overview_nodes = [{"id": start_id, "label": "Start", "node_type": "start"}]
    overview_nodes.extend(
        {
            "id": f"topic:{index}",
            "label": topic,
            "node_type": "group",
            "topic": topic,
            "concept_count": len(groups[topic]),
        }
        for index, topic in enumerate(topics)
    )
    overview_nodes.append({"id": end_id, "label": "End", "node_type": "end"})
    overview_edges = [
        _edge(overview_nodes[index]["id"], overview_nodes[index + 1]["id"])
        for index in range(len(overview_nodes) - 1)
    ]

    step_sentences = []
    for sentence in re.split(r"(?<=[.!?])\s+|\n+", raw_text):
        sentence = sentence.strip()
        match = ORDERED_STEP.match(sentence)
        if match or ORDER_WORD.search(sentence) or CONDITION.search(sentence):
            step_sentences.append((sentence, bool(CONDITION.search(sentence))))

    details: Dict[str, List[Dict[str, Any]]] = {}
    concept_topic = {str(item.get("id")): topic for topic, items in groups.items() for item in items}
    for topic_index, (topic, items) in enumerate(groups.items()):
        records = [
            {
                "id": f"concept:{item.get('id')}",
                "label": str(item.get("name") or "Concept"),
                "node_type": "concept",
                "concept_id": item.get("id"),
                "definition": item.get("definition") or "",
                "source_excerpt": item.get("source_excerpt") or "",
                "page": item.get("page") or 1,
                "flow_order": item.get("flow_order") or 0,
            }
            for item in items
        ]
        records.extend(
            {
                "id": f"step:{topic_index}:{index}",
                "label": text,
                "node_type": "decision" if decision else "process",
                "flow_order": index,
            }
            for index, (text, decision) in enumerate(step_sentences)
        )
        records.sort(key=lambda item: (int(item.get("flow_order") or 0), item["id"]))
        pages = []
        page_count = max(1, (len(records) + DETAIL_PAGE_SIZE - 1) // DETAIL_PAGE_SIZE)
        for page_index in range(page_count):
            page_records = records[page_index * DETAIL_PAGE_SIZE:(page_index + 1) * DETAIL_PAGE_SIZE]
            page_start = f"start:{topic_index}:{page_index}"
            page_end = f"end:{topic_index}:{page_index}"
            nodes = [{"id": page_start, "label": "Start", "node_type": "start"}, *page_records]
            edges = []
            chain = [page_start, *[record["id"] for record in page_records]]
            for left, right in zip(chain, chain[1:]):
                edges.append(_edge(left, right))
            if page_index + 1 < page_count:
                next_id = f"connector:{topic_index}:{page_index}"
                nodes.append({"id": next_id, "label": f"Part {page_index + 2}", "node_type": "connector"})
                edges.append(_edge(chain[-1], next_id, "sequence", "continues"))
            else:
                chain.append(page_end)
                nodes.append({"id": page_end, "label": "End", "node_type": "end"})
                edges.append(_edge(chain[-2], page_end))

            concept_ids = {str(record.get("concept_id")): record["id"] for record in page_records if record.get("concept_id") is not None}
            for index, record in enumerate(page_records):
                if record.get("node_type") == "decision" and index + 2 < len(page_records):
                    edges.append(_edge(record["id"], page_records[index + 2]["id"], "branch", "No"))
                    matching = next((edge for edge in edges if edge["source"] == record["id"] and edge["target"] == page_records[index + 1]["id"]), None)
                    if matching:
                        matching["label"] = "Yes"
            label_to_record_id = {record.get("label", "").casefold(): record["id"] for record in page_records}
            for concept in items:
                source = concept_ids.get(str(concept.get("id")))
                if not source:
                    continue
                for relation in concept.get("related_concepts", []):
                    target_name = (relation.get("name") if isinstance(relation, dict) else str(relation)).casefold()
                    target = label_to_record_id.get(target_name)
                    relation_type = relation.get("type", "related") if isinstance(relation, dict) else "related"
                    if target and target != source and (include_related or relation_type != "related"):
                        edges.append(_edge(
                            source,
                            target,
                            relation_type,
                            relation.get("label", "related") if isinstance(relation, dict) else "related",
                        ))
            pages.append({
                "nodes": nodes,
                "edges": edges,
                "subflow": page_index,
                "subflow_count": page_count,
                "total_concepts": len(items),
            })
        details[topic] = pages
    return {
        "document_id": doc_id,
        "overview": {"nodes": overview_nodes, "edges": overview_edges},
        "details": details,
        "topics": topics,
        "total_concepts": len(concepts),
    }


def select_flowchart_view(
    flowchart: Dict[str, Any],
    topic: Optional[str] = None,
    subflow: int = 0,
    include_related: bool = False,
) -> Optional[Dict[str, Any]]:
    if not topic:
        return {**flowchart["overview"], "overview": True, "topics": flowchart["topics"], "total_concepts": flowchart["total_concepts"]}
    pages = flowchart["details"].get(topic)
    if not pages or subflow >= len(pages):
        return None
    result = {**pages[subflow], "overview": False, "topic": topic, "topics": flowchart["topics"]}
    if not include_related:
        result["edges"] = [edge for edge in result["edges"] if edge["type"] != "related"]
    return result
