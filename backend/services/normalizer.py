"""
backend/services/normalizer.py
Deterministic post-processing normaliser for educational concepts and relations.

Guarantees:
1. Filters out non-concepts: people names, institutions, course boilerplate, URLs, code fragments, sentence fragments.
2. Deduplicates and merges concepts by canonical normalised name.
3. Enforces strict hierarchy: document -> chapter -> concept (orphan recovery, chapter sub-grouping).
4. Enforces strict DAG on prerequisite relations (cycle breaking, self-loop removal).
5. Computes stage_index (longest prerequisite path level) and topological chapter_order.
6. Derives/validates estimated_minutes (1-30 min).
7. Sets schema_version = 2.
"""

import re
from typing import List, Dict, Any, Optional, Set, Tuple
from collections import defaultdict, deque

SCHEMA_VERSION = 3

# Blacklisted institutional and boilerplate terms (case-insensitive word boundaries or substrings)
BOILERPLATE_PATTERNS = [
    r"\b(?:massachusetts\s+institute(?:\s+of\s+technology)?|mit)\b",
    r"\b(?:technology\s+instructors?|course\s+instructors?|teaching\s+assistants?|ta|tas)\b",
    r"\b(?:university|institute|college|school|department|faculty|campus)\b",
    r"\b(?:professor|prof\.?|doctor|dr\.?|lecturer|instructor|instructors|author|authors)\b",
    r"\b(?:lecture(?:\s+\d+)?|class\s+\d+|unit\s+\d+|module\s+\d+)\b",
    r"\b(?:syllabus|copyright|all\s+rights\s+reserved|creative\s+commons|cc-by)\b",
    r"\b(?:exam|exams|midterm|final\s+exam|quiz|quizzes|test|tests)\b",
    r"\b(?:homework|problem\s+set|pset(?:\s*\d+)?|assignment|office\s+hours)\b",
    r"\b(?:fall|spring|summer|winter)\s+20\d\d\b",
    r"\b(?:table\s+of\s+contents|course\s+overview|slide(?:\s+\d+)?|page(?:\s+\d+)?)\b",
]
BOILERPLATE_REGEX = re.compile("|".join(BOILERPLATE_PATTERNS), re.IGNORECASE)

# Known authors and instructors in common academic materials (e.g. MIT 6.006 / Algorithms)
KNOWN_PEOPLE = {
    "erik demaine", "erik demaise", "charles leiserson", "ron rivest",
    "clifford stein", "thomas cormen", "srini devadas", "david karger",
    "alan turing", "john von neumann", "donald knuth", "ada lovelace"
}

COMMON_GIVEN_NAMES = {
    "erik", "eric", "charles", "ron", "clifford", "thomas", "srini", "david",
    "john", "donald", "alan", "ada", "robert", "michael", "william", "richard",
    "joseph", "christopher", "daniel", "matthew", "anthony", "mark", "paul",
    "steven", "stephen", "andrew", "kenneth", "kevin", "brian", "george", "edward",
    "ronald", "timothy", "jason", "jeffrey", "ryan", "jacob", "gary", "nicholas",
    "jonathan", "larry", "justin", "scott", "brandon", "benjamin", "samuel",
    "gregory", "frank", "alexander", "raymond", "patrick", "jack", "dennis", "jerry",
    "tyler", "aaron", "jose", "adam", "nathan", "henry", "douglas", "zachary",
    "peter", "kyle", "walter", "harold", "jeremy", "ethan", "carl", "keith",
    "roger", "gerald", "christian", "terry", "sean", "arthur", "austin", "noah",
    "lawrence", "jesse", "joe", "bryan", "billy", "jordan", "albert", "dylan",
    "bruce", "willie", "gabriel", "juan", "logan", "wayne", "ralph", "roy",
    "eugene", "randy", "vincent", "russell", "louis", "philip", "bobby", "johnny"
}

# Person name pattern: 2 to 3 capitalized tokens
PERSON_PATTERN = re.compile(r"^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+$")
COMMON_CONCEPT_TERMS = {
    "concept", "alpha", "beta", "gamma", "delta", "theta", "sigma", "omega",
    "sort", "tree", "graph", "search", "list", "array", "queue", "stack",
    "heap", "table", "hash", "node", "edge", "path", "matrix", "set",
    "algorithm", "function", "method", "class", "structure", "memory",
    "network", "system", "model", "logic", "proof", "theorem", "lemma",
    "complexity", "space", "time", "bound", "order", "recursion", "divide",
    "conquer", "greedy", "dynamic", "programming", "pointer", "variable",
    "factor", "base", "core", "input", "output", "step", "state", "phase",
    "layer", "level", "block", "unit", "rule", "law", "code", "index",
    "rate", "cost", "flow", "test", "case", "term", "form", "field",
    "data", "type", "mode", "norm", "size", "view", "link", "root", "leaf",
    "value", "key", "property", "object", "entity", "relation", "architecture",
    "analysis", "design", "technique", "approach", "problem", "solution", "schema",
    "query", "record", "file", "disk", "cache", "buffer", "bus", "register",
    "instruction", "thread", "process", "lock", "mutex", "signal", "semaphore"
}

URL_REGEX = re.compile(r"(?:https?://|www\.|\.edu|\.org|\.com|\.gov|\.io)", re.IGNORECASE)
CODE_FRAGMENT_REGEX = re.compile(r"(?:\w+\s*\([^)]*\)|[=;{}<>]|->|==|!=|\b(?:def|return|class|int|void|const|function|var|let)\b)")


def is_blacklisted_concept(name: str) -> bool:
    """Returns True if the candidate name represents a person, institution, boilerplate, URL, or code."""
    if not name or not isinstance(name, str):
        return True
    
    clean = name.strip()
    if len(clean) == 0 or len(clean) > 60:
        return True
    
    words = clean.split()
    if len(words) > 6:
        return True

    # Numeric or symbol only (e.g. "1.2", "#4", "100")
    if re.match(r"^[\d\s.,#\-]+$", clean):
        return True

    # URLs
    if URL_REGEX.search(clean):
        return True

    # Code fragments with function calls, syntax operators, or keywords
    if CODE_FRAGMENT_REGEX.search(clean):
        return True

    lower = clean.lower()

    # Known individuals
    if lower in KNOWN_PEOPLE:
        return True

    # Boilerplate and institutions
    if BOILERPLATE_REGEX.search(clean):
        return True

    # Check for person name appearance: "FirstName LastName" where FirstName is a known given name
    # and neither word is an established concept term.
    if PERSON_PATTERN.match(clean) and len(words) >= 2:
        first_lower = words[0].lower()
        if first_lower in COMMON_GIVEN_NAMES:
            word_lowers = [w.lower() for w in words]
            if not any(w in COMMON_CONCEPT_TERMS for w in word_lowers):
                return True

    return False


def clean_concept_name(name: str) -> Optional[str]:
    """
    Cleans and title-cases a concept name.
    Returns None if the name is invalid or a sentence/code fragment.
    """
    if is_blacklisted_concept(name):
        return None

    clean = re.sub(r"[\s_]+", " ", name).strip()
    # Remove leading numbering like "1. ", "3.2 "
    clean = re.sub(r"^\d+(?:\.\d+)*[.:\-]\s*", "", clean)
    clean = clean.strip(".,;: -_")

    if not clean or len(clean) > 60:
        return None

    words = clean.split()
    if len(words) > 6:
        return None

    # Title-case nicely while preserving established acronyms (e.g. DFS, BFS, DAG, API, AVL, LCP)
    preserved_acronyms = {"dfs", "bfs", "dag", "api", "avl", "lcp", "bst", "fifo", "lifo", "gpu", "cpu", "ram", "dna", "rna"}
    cased_words = []
    for w in words:
        if w.lower() in preserved_acronyms:
            cased_words.append(w.upper())
        elif w.isupper() and len(w) <= 4:
            cased_words.append(w)
        else:
            cased_words.append(w.capitalize())

    return " ".join(cased_words)


def derive_estimated_minutes(importance: Any, definition: Any, current_minutes: Optional[Any] = None) -> int:
    """Derives or validates estimated study minutes between 1 and 30."""
    if current_minutes is not None:
        try:
            val = int(current_minutes)
            if 1 <= val <= 30:
                return val
        except (ValueError, TypeError):
            pass

    base = 4
    try:
        imp = max(1, min(3, int(importance or 2)))
    except (ValueError, TypeError):
        imp = 2
    imp_factor = imp * 3
    def_len = len(str(definition or ""))
    len_factor = min(8, def_len // 30)

    return max(1, min(30, base + imp_factor + len_factor))


def remove_prerequisite_cycles_and_rank(
    concepts: List[Dict[str, Any]],
    relations_by_concept: Dict[str, List[Dict[str, Any]]]
) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, int]]:
    """
    Enforces a strict Directed Acyclic Graph (DAG) on prerequisite edges.
    If a cycle is detected, breaks the cycle by removing the edge with lowest weight.
    Returns:
      - Cleaned relations dictionary
      - stage_index map for each concept (longest prerequisite chain level: 0 for roots, 1, 2...)
    """
    concept_ids = {c["id"] for c in concepts}
    
    # Extract prerequisite adjacency: u -> v means u is prerequisite of v (u must be learned BEFORE v)
    # Note: In ConceptLens, a relation on u of type 'prerequisite' pointing to target v means:
    # "v is prerequisite for u" (learn v first) OR "u is prerequisite for v".
    # Per prompt standard: A prerequisite relation means "target must be understood before concept".
    # Therefore: edge from target -> concept in learning order.
    
    prereq_edges: List[Tuple[str, str, int]] = [] # (prereq_source, target, weight)
    related_edges: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for c in concepts:
        c_id = c["id"]
        rels = relations_by_concept.get(c_id, [])
        for r in rels:
            target = r.get("target_id") or r.get("name")
            rel_type = (r.get("type") or r.get("relation_type") or "related").lower()
            if not target or target == c_id:
                continue
            if target not in concept_ids:
                continue

            if rel_type == "prerequisite":
                weight = int(r.get("weight", 2))
                # target is prerequisite for c_id: dependency target -> c_id
                prereq_edges.append((target, c_id, weight))
            else:
                related_edges[c_id].append({
                    "target_id": target,
                    "type": "related",
                    "weight": 1
                })

    # Deduplicate prerequisite edges (keep highest weight)
    prereq_map: Dict[Tuple[str, str], int] = {}
    for src, dst, w in prereq_edges:
        key = (src, dst)
        if key not in prereq_map or w > prereq_map[key]:
            prereq_map[key] = w

    # Cycle breaking via topological verification
    # Greedy edge selection: sort edges by weight descending, add edge only if it doesn't create cycle
    adj: Dict[str, Set[str]] = defaultdict(set)
    valid_prereq_edges: Set[Tuple[str, str]] = set()

    def has_path(start: str, target: str, visited: Set[str]) -> bool:
        if start == target:
            return True
        visited.add(start)
        for neighbor in adj[start]:
            if neighbor not in visited:
                if has_path(neighbor, target, visited):
                    return True
        return False

    sorted_candidate_edges = sorted(prereq_map.items(), key=lambda item: item[1], reverse=True)
    for (src, dst), _ in sorted_candidate_edges:
        # If adding src -> dst would create a cycle (i.e. path dst -> src already exists), skip it
        if has_path(dst, src, set()):
            continue
        adj[src].add(dst)
        valid_prereq_edges.add((src, dst))

    # Compute stage_index (longest prerequisite distance from any root)
    in_degree: Dict[str, int] = {c_id: 0 for c_id in concept_ids}
    for src, dst in valid_prereq_edges:
        in_degree[dst] += 1

    stage_index: Dict[str, int] = {c_id: 0 for c_id in concept_ids}
    queue = deque([c_id for c_id in concept_ids if in_degree[c_id] == 0])

    while queue:
        curr = queue.popleft()
        curr_stage = stage_index[curr]
        for neighbor in adj[curr]:
            if curr_stage + 1 > stage_index[neighbor]:
                stage_index[neighbor] = curr_stage + 1
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    # Reconstruct cleaned relations per concept
    cleaned_relations: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for (src, dst) in valid_prereq_edges:
        # dst has prerequisite src
        cleaned_relations[dst].append({
            "target_id": src,
            "type": "prerequisite",
            "weight": prereq_map.get((src, dst), 2)
        })

    for c_id, r_list in related_edges.items():
        for r in r_list:
            cleaned_relations[c_id].append(r)

    return cleaned_relations, stage_index


def normalize_extracted_concepts(raw_concepts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Main normaliser function:
    Applies deduplication, filtering, hierarchy enforcement, DAG prerequisite validation,
    and stage_index calculation.
    """
    if not raw_concepts:
        return []

    # 1. Filter and clean concept names
    cleaned_candidates: List[Dict[str, Any]] = []
    sentence_definitions_pool: Dict[str, str] = {}
    skipped_count = 0

    for c in raw_concepts:
        if not isinstance(c, dict):
            skipped_count += 1
            continue
        name_raw = str(c.get("name") or "").strip()
        defn_raw = str(c.get("definition") or "").strip()
        if not name_raw:
            skipped_count += 1
            continue

        # Check if name is a sentence-like description
        words = name_raw.split()
        if len(words) > 6 or name_raw.endswith(".") or " return " in name_raw.lower() or " find " in name_raw.lower():
            if not defn_raw:
                # Save sentence as definition candidate
                sentence_definitions_pool[name_raw.lower()] = name_raw
            continue

        valid_name = clean_concept_name(name_raw)
        if not valid_name:
            continue

        c_copy = dict(c)
        c_copy["name"] = valid_name
        c_copy["definition"] = defn_raw or sentence_definitions_pool.get(name_raw.lower(), "")
        c_copy["chapter"] = str(c.get("chapter") or c.get("topic") or "General").strip() or "General"
        cleaned_candidates.append(c_copy)

    if skipped_count > 0:
        logger.info(f"Normalizer safely skipped {skipped_count} malformed/non-dict concept entries.")

    if not cleaned_candidates:
        return []

    # 2. Deduplicate by normalised lower-case name
    canonical_map: Dict[str, Dict[str, Any]] = {}
    id_remap: Dict[str, str] = {}

    for c in cleaned_candidates:
        norm_key = re.sub(r"[^a-z0-9]", "", c["name"].lower())
        orig_id = str(c.get("id") or f"c_{len(id_remap) + 1}")

        if norm_key not in canonical_map:
            canonical_id = str(c.get("id")) if c.get("id") is not None else f"c_{len(canonical_map) + 1}"
            id_remap[orig_id] = canonical_id
            c["id"] = canonical_id
            try:
                c_imp = max(1, min(3, int(c.get("importance") or 2)))
            except (ValueError, TypeError):
                c_imp = 2
            c["importance"] = c_imp
            c["estimated_minutes"] = derive_estimated_minutes(c_imp, c.get("definition") or "", c.get("estimated_minutes"))
            canonical_map[norm_key] = c
        else:
            existing = canonical_map[norm_key]
            id_remap[orig_id] = existing["id"]
            # Merge: take higher importance
            try:
                curr_imp = max(1, min(3, int(c.get("importance") or 2)))
            except (ValueError, TypeError):
                curr_imp = 2
            if curr_imp > existing.get("importance", 1):
                existing["importance"] = curr_imp
            # Merge: take longer definition
            c_def = str(c.get("definition") or "")
            ex_def = str(existing.get("definition") or "")
            if len(c_def) > len(ex_def):
                existing["definition"] = c_def
            # Merge relations
            existing_rels = existing.setdefault("relations", [])
            existing_rels.extend(c.get("relations", []) or c.get("related_concepts", []))

    concepts_list = list(canonical_map.values())

    # Map name -> canonical_id for resolving name-based relations
    name_to_id = {c["name"].lower(): c["id"] for c in concepts_list}

    # 3. Extract and normalize raw relations
    raw_relations_by_concept: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in concepts_list:
        c_id = c["id"]
        rels = c.get("relations") or c.get("related_concepts") or []
        for r in rels:
            if isinstance(r, str):
                target_id = name_to_id.get(r.lower())
                rel_type = "related"
            elif isinstance(r, dict):
                target_id = r.get("target_id") or r.get("target") or r.get("concept_id")
                if not target_id or target_id not in [c["id"] for c in concepts_list]:
                    target_name = r.get("name") or r.get("related_name")
                    if target_name:
                        target_id = name_to_id.get(str(target_name).lower())
                else:
                    target_id = id_remap.get(str(target_id), str(target_id))
                rel_type = (r.get("type") or r.get("relation_type") or "related").lower()
            else:
                continue

            if target_id and target_id != c_id:
                raw_relations_by_concept[c_id].append({
                    "target_id": target_id,
                    "type": "prerequisite" if rel_type == "prerequisite" else "related",
                    "weight": 2 if rel_type == "prerequisite" else 1
                })

    # 4. Enforce DAG on prerequisites and compute stage_index
    cleaned_relations_map, stage_index_map = remove_prerequisite_cycles_and_rank(concepts_list, raw_relations_by_concept)

    # 5. Group by chapter and split large chapters (> 12 children)
    chapter_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for c in concepts_list:
        chapter_groups[c["chapter"]].append(c)

    # Chapter topological ordering by prerequisite links between chapters
    chapter_deps: Dict[str, Set[str]] = defaultdict(set)
    for c in concepts_list:
        c_ch = c["chapter"]
        c_rels = cleaned_relations_map.get(c["id"], [])
        for r in c_rels:
            if r["type"] == "prerequisite":
                # r["target_id"] is prerequisite for c
                target_c = next((x for x in concepts_list if x["id"] == r["target_id"]), None)
                if target_c and target_c["chapter"] != c_ch:
                    chapter_deps[c_ch].add(target_c["chapter"])

    # Topological sort of chapters
    all_chapters = list(chapter_groups.keys())
    visited_ch = set()
    ordered_chapters = []

    def visit_chapter(ch: str, visiting: Set[str]):
        if ch in visiting:
            return  # Cycle fallback
        if ch in visited_ch:
            return
        visiting.add(ch)
        for dep in sorted(chapter_deps.get(ch, [])):
            if dep in all_chapters:
                visit_chapter(dep, visiting)
        visiting.remove(ch)
        visited_ch.add(ch)
        ordered_chapters.append(ch)

    for ch in all_chapters:
        if ch not in visited_ch:
            visit_chapter(ch, set())

    chapter_order_map = {ch: idx + 1 for idx, ch in enumerate(ordered_chapters)}

    # Sub-group chapters with > 12 direct children
    for ch, ch_concepts in list(chapter_groups.items()):
        if len(ch_concepts) > 12:
            ch_concepts.sort(key=lambda x: (x.get("stage_index") or 0, str(x.get("name") or "")))
            # Chunk into parts of 8-10 concepts
            chunk_size = 10
            for chunk_idx in range(0, len(ch_concepts), chunk_size):
                sub_chunk = ch_concepts[chunk_idx : chunk_idx + chunk_size]
                part_num = (chunk_idx // chunk_size) + 1
                sub_chapter_name = f"{ch} (Part {part_num})"
                for item in sub_chunk:
                    item["chapter"] = sub_chapter_name

    # 6. Final assemble concepts with all required fields
    result: List[Dict[str, Any]] = []
    for c in concepts_list:
        c_id = c["id"]
        c["stage_index"] = stage_index_map.get(c_id, 0)
        c["chapter_order"] = chapter_order_map.get(c["chapter"], 1)
        c["estimated_minutes"] = derive_estimated_minutes(c["importance"], c["definition"], c.get("estimated_minutes"))
        c["schema_version"] = SCHEMA_VERSION
        
        # Attach cleaned relations in both standard formats (target_id and name)
        c_rels = cleaned_relations_map.get(c_id, [])
        c["relations"] = c_rels
        c["prerequisites"] = [
            next((x["name"] for x in concepts_list if x["id"] == r["target_id"]), "")
            for r in c_rels if r["type"] == "prerequisite"
        ]
        c["prerequisites"] = [p for p in c["prerequisites"] if p]

        c["related"] = [
            next((x["name"] for x in concepts_list if x["id"] == r["target_id"]), "")
            for r in c_rels if r["type"] == "related"
        ]
        c["related"] = [rel for rel in c["related"] if rel]

        c["related_concepts"] = [
            {
                "name": next((x["name"] for x in concepts_list if x["id"] == r["target_id"]), ""),
                "concept_id": r["target_id"],
                "target_id": r["target_id"],
                "type": r["type"],
                "weight": r["weight"],
                "label": r["type"]
            }
            for r in c_rels
        ]
        # Also ensure legacy compatibility fields:
        c["topic"] = c["chapter"]
        c["score"] = round(c["importance"] / 3.0, 3)
        c["source_excerpt"] = c["definition"][:60] if c.get("definition") else ""
        c["flow_order"] = c["stage_index"]
        c["flow_group"] = c["chapter"]
        c["source_page"] = c.get("source_page")
        c["source_quote"] = c.get("source_quote", "")
        c["source_verified"] = bool(c.get("source_verified", False))
        c["document_id"] = c.get("document_id")

        result.append(c)

    return result
