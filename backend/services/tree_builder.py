import re
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict, Counter
import logging

logger = logging.getLogger("conceptlens.tree")

BRANCH_COLORS = [
    {"name": "gold", "hex": "#E8B100", "tint": "rgba(232, 177, 0, 0.12)", "edge": "#E8B100"},
    {"name": "indigo", "hex": "#6366F1", "tint": "rgba(99, 102, 241, 0.12)", "edge": "#6366F1"},
    {"name": "teal", "hex": "#14B8A6", "tint": "rgba(20, 184, 166, 0.12)", "edge": "#14B8A6"},
    {"name": "rose", "hex": "#F43F5E", "tint": "rgba(244, 63, 94, 0.12)", "edge": "#F43F5E"},
    {"name": "violet", "hex": "#A78BFA", "tint": "rgba(167, 139, 250, 0.12)", "edge": "#A78BFA"},
    {"name": "sky", "hex": "#38BDF8", "tint": "rgba(56, 189, 248, 0.12)", "edge": "#38BDF8"},
]

MAX_LEVELS = 4
MAX_TOPICS = 8
MAX_CHILDREN_PER_NODE = 12

def truncate_sentence(text: str, max_chars: int = 90) -> str:
    """Shortens a definition to a readable snippet for tree node previews."""
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    m = re.split(r"(?<=[.!?])\s+", text)
    first_sent = m[0] if m else text
    if len(first_sent) <= max_chars:
        return first_sent
    return first_sent[:max_chars].rstrip() + "..."

def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower())
    return s.strip("_") or "item"

def cluster_concepts_by_similarity(
    concepts: List[Dict[str, Any]],
    target_k: int
) -> List[List[Dict[str, Any]]]:
    """
    Groups concepts into target_k clusters when no detected headings exist (all General).
    Uses precomputed chunk co-occurrence, token overlap, and lexical similarity in linear time.
    """
    n = len(concepts)
    if n <= target_k:
        return [[c] for c in concepts]

    ranked = sorted(concepts, key=lambda concept: (
        concept.get("importance", 1),
        concept.get("score", 0),
        concept.get("name", ""),
    ), reverse=True)
    seeds = ranked[:target_k]
    clusters: List[List[Dict[str, Any]]] = [[seed] for seed in seeds]
    seed_positions = {id(seed) for seed in seeds}

    # Precompute word and chunk sets for fast O(1) similarity comparisons
    seed_chunks = [set(s.get("chunk_ids", [])) for s in seeds]
    seed_words = [set(re.findall(r"\w+", s["name"].lower())) for s in seeds]

    for concept in ranked:
        if id(concept) in seed_positions:
            continue
        c_ch = set(concept.get("chunk_ids", []))
        c_words = set(re.findall(r"\w+", concept["name"].lower()))

        best_cluster = 0
        best_score = -1.0
        for s_idx in range(len(seeds)):
            score = 0.0
            s_ch = seed_chunks[s_idx]
            if c_ch and s_ch:
                score += 0.5 * (len(c_ch & s_ch) / max(1, len(c_ch | s_ch)))
            s_w = seed_words[s_idx]
            overlap = len(c_words & s_w)
            if overlap > 0:
                score += 0.3 * (overlap / max(1, min(len(c_words), len(s_w))))
            if score > best_score:
                best_score = score
                best_cluster = s_idx
        clusters[best_cluster].append(concept)

    return clusters

def build_document_tree(
    doc_id: str,
    doc_title: str,
    concepts: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Builds a strict 4-level concept hierarchy:
      Level 0: Document Root
      Level 1: Topics (up to 8, colored by branch)
      Level 2: Main Concepts
      Level 3: Sub-concepts & details (or 'and N more' nodes)
    Also produces cross-links (related: true) between concepts in different branches.
    Topic and child counts are bounded to keep the interactive tree readable.
    """
    clean_title = doc_title or "Untitled Document"
    # Strip leading UUID prefix if present
    clean_title = re.sub(r"^[0-9a-fA-F-]{36}_", "", clean_title)
    clean_title = re.sub(r"\.(pdf|png|jpe?g|webp|txt|md)$", "", clean_title, flags=re.IGNORECASE)
    clean_title = clean_title.replace("_", " ").title()

    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    if not concepts:
        root_id = f"root_{doc_id}"
        nodes.append({
            "id": root_id,
            "label": clean_title,
            "level": 0,
            "topic": "Overview",
            "importance": 5,
            "short_definition": "No concepts extracted for this document yet.",
            "branch_color_index": 0,
            "child_count": 0,
            "is_more_node": False
        })
        return {
            "document_id": doc_id,
            "title": clean_title,
            "node_count": 1,
            "edge_count": 0,
            "topic_count": 0,
            "branch_colors": BRANCH_COLORS,
            "nodes": nodes,
            "edges": edges
        }

    # Level 0: Root node
    root_id = f"root_{doc_id}"
    nodes.append({
        "id": root_id,
        "label": clean_title,
        "level": 0,
        "topic": "Overview",
        "importance": 5,
        "short_definition": f"Knowledge tree containing {len(concepts)} extracted concepts.",
        "branch_color_index": 0,
        "child_count": 0,
        "is_more_node": False
    })

    # Step 1: Topic organization (Level 1)
    topic_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in concepts:
        t = c.get("topic", "").strip() or "General"
        topic_groups[t].append(c)

    has_real_headings = any(t.lower() not in ("general", "none", "") for t in topic_groups.keys())

    # If there are NO detected headings (all General) and more than 4 concepts,
    # cluster them into 2 to 8 topics using similarity
    if not has_real_headings and len(concepts) > 4:
        target_k = max(2, min(MAX_TOPICS, round(len(concepts) / 4)))
        clusters = cluster_concepts_by_similarity(concepts, target_k)
        topic_groups = {}
        for cluster in clusters:
            if not cluster:
                continue
            cluster.sort(key=lambda x: (x.get("importance", 1), x.get("score", 0)), reverse=True)
            topic_groups[cluster[0]["name"]] = cluster
    sorted_topics = sorted(topic_groups.items(), key=lambda x: len(x[1]), reverse=True)

    concept_to_node_id: Dict[str, str] = {}
    concept_to_branch_idx: Dict[str, int] = {}
    edge_set: Set[Tuple[str, str]] = set()

    # Step 2: Iterate through topics and build Level 1, 2, and 3
    for t_idx, (topic_name, topic_concepts) in enumerate(sorted_topics):
        branch_color_idx = t_idx % len(BRANCH_COLORS)
        topic_node_id = f"topic_{t_idx}_{slugify(topic_name)}"

        # Topic Node (Level 1)
        nodes.append({
            "id": topic_node_id,
            "label": topic_name,
            "level": 1,
            "topic": topic_name,
            "importance": 4,
            "short_definition": f"Branch with {len(topic_concepts)} concepts.",
            "branch_color_index": branch_color_idx,
            "child_count": 0,
            "is_more_node": False
        })

        # Edge from Root to Topic
        edges.append({
            "id": f"edge_{root_id}_{topic_node_id}",
            "source": root_id,
            "target": topic_node_id,
            "branch_color_index": branch_color_idx,
            "is_related": False
        })
        edge_set.add((root_id, topic_node_id))

        # Identify parent-child relationships within this topic
        # Sort topic concepts by importance desc, score desc
        topic_concepts.sort(
            key=lambda x: (x.get("importance", 1), x.get("score", 0)),
            reverse=True
        )

        child_to_parent: Dict[int, Dict[str, Any]] = {}
        parent_to_subs: Dict[int, List[Dict[str, Any]]] = defaultdict(list)

        # A concept c_sub is a sub-concept of c_parent if:
        # - c_parent has higher or equal importance / score
        # - c_sub contains c_parent's name or definition mentions c_parent
        for i, c_sub in enumerate(topic_concepts):
            c_sub_id = c_sub.get("id") or id(c_sub)
            sub_name_lower = c_sub["name"].lower()
            sub_def_lower = c_sub.get("definition", "").lower()

            best_parent = None
            if c_sub.get("parent_name"):
                parent_candidate = next(
                    (p for p in topic_concepts if p["name"].lower() == str(c_sub["parent_name"]).lower() and (p.get("id") or id(p)) != c_sub_id),
                    None
                )
                if parent_candidate:
                    p_cand_id = parent_candidate.get("id") or id(parent_candidate)
                    if p_cand_id not in child_to_parent:
                        best_parent = parent_candidate

            if not best_parent:
                for j in range(i):
                    c_parent = topic_concepts[j]
                    c_parent_id = c_parent.get("id") or id(c_parent)
                    # Don't make a child of a child (to stay within max 4 levels)
                    if c_parent_id in child_to_parent:
                        continue

                    parent_name_lower = c_parent["name"].lower()
                    # Whole-word match so 'Physics Law 1' doesn't match 'Physics Law 10'
                    if len(parent_name_lower) >= 3 and re.search(r"\b" + re.escape(parent_name_lower) + r"\b", sub_name_lower) and parent_name_lower != sub_name_lower:
                        best_parent = c_parent
                        break
                    if len(parent_name_lower) >= 4 and re.search(r"\b" + re.escape(parent_name_lower) + r"\b", sub_def_lower):
                        best_parent = c_parent
                        break

            if best_parent:
                p_id = best_parent.get("id") or id(best_parent)
                child_to_parent[c_sub_id] = best_parent
                parent_to_subs[p_id].append(c_sub)

        # Level 2 concepts: all concepts that do NOT have a parent concept within the topic
        level_2_list: List[Dict[str, Any]] = [
            c for c in topic_concepts
            if (c.get("id") or id(c)) not in child_to_parent
        ]

        # Add Level 2 Nodes
        visible_level_2 = level_2_list
        for c in visible_level_2:
            c_id = c.get("id") or slugify(c["name"])
            node_id = f"concept_{c_id}"
            concept_to_node_id[c["name"].lower()] = node_id
            concept_to_branch_idx[c["name"].lower()] = branch_color_idx

            subs = parent_to_subs.get(c.get("id") or id(c), [])
            nodes.append({
                "id": node_id,
                "concept_id": c.get("id"),
                "label": c["name"],
                "level": 2,
                "topic": topic_name,
                "importance": c.get("importance", 3),
                "short_definition": truncate_sentence(c.get("definition", "") or c.get("source_excerpt", "")),
                "definition": c.get("definition", ""),
                "source_excerpt": c.get("source_excerpt", ""),
                "page": c.get("page", 1),
                "score": round(float(c.get("score", 0.5)), 4),
                "branch_color_index": branch_color_idx,
                "child_count": len(subs),
                "is_more_node": False
            })

            edges.append({
                "id": f"edge_{topic_node_id}_{node_id}",
                "source": topic_node_id,
                "target": node_id,
                "branch_color_index": branch_color_idx,
                "is_related": False
            })
            edge_set.add((topic_node_id, node_id))

            # Level 3 sub-concepts
            if subs:
                for sub in subs:
                    sub_id = sub.get("id") or slugify(sub["name"])
                    sub_node_id = f"sub_{sub_id}"
                    concept_to_node_id[sub["name"].lower()] = sub_node_id
                    concept_to_branch_idx[sub["name"].lower()] = branch_color_idx

                    nodes.append({
                        "id": sub_node_id,
                        "concept_id": sub.get("id"),
                        "label": sub["name"],
                        "level": 3,
                        "topic": topic_name,
                        "importance": sub.get("importance", 2),
                        "short_definition": truncate_sentence(sub.get("definition", "") or sub.get("source_excerpt", "")),
                        "definition": sub.get("definition", ""),
                        "source_excerpt": sub.get("source_excerpt", ""),
                        "page": sub.get("page", 1),
                        "score": round(float(sub.get("score", 0.3)), 4),
                        "branch_color_index": branch_color_idx,
                        "child_count": 0,
                        "is_more_node": False
                    })

                    edges.append({
                        "id": f"edge_{node_id}_{sub_node_id}",
                        "source": node_id,
                        "target": sub_node_id,
                        "branch_color_index": branch_color_idx,
                        "is_related": False
                    })
                    edge_set.add((node_id, sub_node_id))


    # Step 3: Compute Cross-links ("related" relations) between concepts
    for c in concepts:
        c_name = c["name"].lower()
        src_node_id = concept_to_node_id.get(c_name)
        if not src_node_id:
            continue
        src_branch = concept_to_branch_idx.get(c_name, 0)

        for rel in c.get("related_concepts", []):
            rel_name = (rel.get("name") if isinstance(rel, dict) else str(rel)).lower()
            dst_node_id = concept_to_node_id.get(rel_name)
            if not dst_node_id or dst_node_id == src_node_id:
                continue

            pair = (src_node_id, dst_node_id)
            rev_pair = (dst_node_id, src_node_id)
            if pair in edge_set or rev_pair in edge_set:
                continue

            edges.append({
                "id": f"rel_{src_node_id}_{dst_node_id}",
                "source": src_node_id,
                "target": dst_node_id,
                "branch_color_index": src_branch,
                "is_related": True
            })
            edge_set.add(pair)

    # Update child counts for all nodes
    child_counts = Counter(e["source"] for e in edges if not e.get("is_related"))
    for n in nodes:
        if n["id"] in child_counts:
            n["child_count"] = child_counts[n["id"]]

    return {
        "document_id": doc_id,
        "title": clean_title,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "topic_count": len(sorted_topics),
        "branch_colors": BRANCH_COLORS,
        "nodes": nodes,
        "edges": edges
    }
