"""
Plan Engine for ConceptLens Study Planner.
Pure algorithmic functions for:
- Calculating estimated hours and remaining hours.
- Stable topological sort of topics respecting reading order and prerequisites.
- build_route: Sequential day filling with daily cap, chapter overflow splitting, topic-to-day assignment.
- Plan status calculation (behind, today_index, complete).
"""

from datetime import datetime, date, timedelta
import heapq
from typing import Any, Dict, List, Optional, Set, Tuple


def calc_default_est_hours(concept_count: int, difficulty: int = 1) -> float:
    """
    est_hours default = concept_count x minutes per concept (easy 4, medium 6, hard 9) / 60
    Difficulty: 0 = easy (4 min), 1 = medium (6 min), 2 = hard (9 min).
    """
    minutes_map = {0: 4, 1: 6, 2: 9}
    mins_per_concept = minutes_map.get(difficulty, 6)
    hours = (max(1, concept_count) * mins_per_concept) / 60.0
    return round(max(0.5, hours), 1)


def remaining_hours(chapter: Dict[str, Any], status: Optional[int] = None) -> float:
    """
    remaining_hours(chapter) = est_hours x (1 - [0, 0.5, 1][status])
    status: 0 (not started) -> 1.0 x est_hours
            1 (in progress) -> 0.5 x est_hours
            2 (done)        -> 0.0 x est_hours
    """
    st = status if status is not None else chapter.get("status", 0)
    mult_map = {0: 1.0, 1: 0.5, 2: 0.0}
    multiplier = mult_map.get(st, 1.0)
    est = float(chapter.get("est_hours") or 1.0)
    return round(max(0.0, est * multiplier), 2)


def stable_topological_sort(
    topics: List[Dict[str, Any]],
    prereq_edges: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Sorts topics so that every prerequisite comes before the topics that need it.
    Ties are broken by reading order (order_index ascending).
    Rejects cycles gracefully.
    """
    if not topics:
        return []

    # Map topics by id
    topic_map = {t["id"]: t for t in topics}
    order_map = {t["id"]: t.get("order_index", idx) for idx, t in enumerate(topics)}

    # Build directed graph and in-degrees
    adj: Dict[Any, List[Any]] = {t["id"]: [] for t in topics}
    in_degree: Dict[Any, int] = {t["id"]: 0 for t in topics}

    for edge in prereq_edges:
        u = edge.get("from")
        v = edge.get("to")
        if u in topic_map and v in topic_map and u != v:
            # Check for cycle before adding: u must not be reachable from v
            adj[u].append(v)
            in_degree[v] += 1

    # Min-heap ordered by order_index
    # heap items: (order_index, topic_id)
    heap: List[Tuple[int, Any]] = []
    for tid, deg in in_degree.items():
        if deg == 0:
            heapq.heappush(heap, (order_map[tid], tid))

    sorted_tids: List[Any] = []
    while heap:
        _, curr_id = heapq.heappop(heap)
        sorted_tids.append(curr_id)

        for nxt in adj[curr_id]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                heapq.heappush(heap, (order_map[nxt], nxt))

    # If any nodes were involved in cycles and not visited, append them in order_index order
    visited_set = set(sorted_tids)
    for t in sorted(topics, key=lambda x: order_map[x["id"]]):
        if t["id"] not in visited_set:
            sorted_tids.append(t["id"])

    return [topic_map[tid] for tid in sorted_tids]


def build_route(
    chapters: List[Dict[str, Any]],
    days: int,
    order_mode: str = "syllabus",
    scope_chapter_id: Optional[str] = None,
    chapter_topics_map: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    chapter_relations_map: Optional[Dict[str, Dict[str, Any]]] = None,
    start_date: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Builds the daily study route according to specifications:
    1. Keep chapters with remaining hours > 0 (only scoped chapter if scope is set).
       Sort by syllabus order / difficulty ascending / difficulty descending.
    2. cap = total remaining / days. Fill day 1..N sequentially; split a chapter across days when it overflows.
       The last day absorbs any remainder.
    3. For each chapter, order its topics with a stable topological sort so every prerequisite
       comes before the topics that need it (ties keep reading order).
       Skip topics already covered: topics[round(n x progress):].
       Assign topics to (chapter, day) slices by the cumulative fraction of the chapter's hours.
       If a slice gets no topics, use "Revise and practise".
    4. Return days: [{day_index, date, hours, items:[{chapter, hours, topics[], prerequisites_for_first_topic[], next_topic, cluster_name}]}].
    """
    days = 7 if days not in (7, 15, 30) else days
    chapter_topics_map = chapter_topics_map or {}
    chapter_relations_map = chapter_relations_map or {}

    # Parse start_date
    if start_date:
        try:
            start_dt = datetime.strptime(start_date[:10], "%Y-%m-%d").date()
        except Exception:
            start_dt = date.today()
    else:
        start_dt = date.today()

    # Step 1: Filter and sort chapters
    active_chapters = []
    for ch in chapters:
        if scope_chapter_id and ch["id"] != scope_chapter_id:
            continue
        rem_h = remaining_hours(ch)
        if rem_h > 0:
            ch_copy = dict(ch)
            ch_copy["remaining_hours"] = rem_h
            active_chapters.append(ch_copy)

    # Topological chapter sort respecting prerequisite relations (prerequisite before dependent, easier first)
    if active_chapters:
        ch_id_set = {c["id"] for c in active_chapters}
        ch_adj = {c["id"]: [] for c in active_chapters}
        ch_in_deg = {c["id"]: 0 for c in active_chapters}

        # Check for cross-chapter prerequisite relations from relations map
        for rel_info in chapter_relations_map.values():
            if not isinstance(rel_info, dict):
                continue
            for edge in rel_info.get("edges", []):
                if edge.get("type") == "prerequisite":
                    u_ch = edge.get("from_chapter_id")
                    v_ch = edge.get("to_chapter_id")
                    if u_ch in ch_id_set and v_ch in ch_id_set and u_ch != v_ch:
                        if v_ch not in ch_adj[u_ch]:
                            ch_adj[u_ch].append(v_ch)
                            ch_in_deg[v_ch] += 1

        def get_ch_sort_tuple(c):
            diff = c.get("difficulty", 1)
            ord_idx = c.get("order_index", 0)
            if order_mode == "hard":
                return (-diff, ord_idx)
            # Easy & syllabus default: prerequisite before dependent, easier first
            return (diff, ord_idx)

        heap = []
        ch_map = {c["id"]: c for c in active_chapters}
        for cid, deg in ch_in_deg.items():
            if deg == 0:
                heapq.heappush(heap, (get_ch_sort_tuple(ch_map[cid]), cid))

        sorted_chapters = []
        while heap:
            _, cid = heapq.heappop(heap)
            sorted_chapters.append(ch_map[cid])
            for nxt_cid in ch_adj[cid]:
                ch_in_deg[nxt_cid] -= 1
                if ch_in_deg[nxt_cid] == 0:
                    heapq.heappush(heap, (get_ch_sort_tuple(ch_map[nxt_cid]), nxt_cid))

        visited_cids = {c["id"] for c in sorted_chapters}
        unvisited = [c for c in active_chapters if c["id"] not in visited_cids]
        unvisited.sort(key=get_ch_sort_tuple)
        sorted_chapters.extend(unvisited)
        active_chapters = sorted_chapters

    total_remaining = sum(c["remaining_hours"] for c in active_chapters)

    # Empty plan handling
    if total_remaining <= 0 or not active_chapters:
        empty_days = []
        for d in range(1, days + 1):
            curr_date = start_dt + timedelta(days=d - 1)
            empty_days.append({
                "day_index": d,
                "date": curr_date.strftime("%Y-%m-%d"),
                "hours": 0.0,
                "items": []
            })
        return empty_days

    # Step 2: Slicing chapters across days with daily capacity
    # Precompute discrete daily capacities so rounding preserves total_remaining exactly
    day_capacities = []
    cum_target = 0.0
    for d in range(1, days + 1):
        target = round(total_remaining * (d / float(days)), 1)
        d_cap = round(target - cum_target, 1)
        cum_target = round(cum_target + d_cap, 1)
        day_capacities.append(max(0.0, d_cap))

    # Pre-process ordered remaining topics for each chapter
    chapter_processed_topics: Dict[str, List[Dict[str, Any]]] = {}
    chapter_prereqs_lookup: Dict[str, Dict[str, List[str]]] = {}
    topic_name_to_cluster: Dict[str, str] = {}

    for ch in active_chapters:
        ch_id = ch["id"]
        raw_topics = chapter_topics_map.get(ch_id, [])
        relations_info = chapter_relations_map.get(ch_id, {})
        edges = relations_info.get("edges", [])
        prereq_edges = [e for e in edges if e.get("type") == "prerequisite"]

        # Build topic_id -> topic_name and prereqs lookup
        topic_id_to_name = {t["id"]: t["name"] for t in raw_topics}
        prereqs_map: Dict[str, List[str]] = {}
        for e in prereq_edges:
            u_name = topic_id_to_name.get(e.get("from"))
            v_name = topic_id_to_name.get(e.get("to"))
            if u_name and v_name:
                prereqs_map.setdefault(v_name, []).append(u_name)
        chapter_prereqs_lookup[ch_id] = prereqs_map

        for t in raw_topics:
            if t.get("cluster_name"):
                topic_name_to_cluster[t["name"]] = t["cluster_name"]

        # 3. Stable topological sort
        sorted_topics = stable_topological_sort(raw_topics, prereq_edges)

        # Skip topics already covered: topics[round(n x progress):]
        n = len(sorted_topics)
        status = ch.get("status", 0)
        progress = [0.0, 0.5, 1.0][status if status in (0, 1, 2) else 0]
        start_idx = min(n, round(n * progress))
        chapter_processed_topics[ch_id] = sorted_topics[start_idx:]

    # Carve out chapter slices
    day_slices: List[List[Dict[str, Any]]] = [[] for _ in range(days)]
    current_day_idx = 0
    current_day_budget = day_capacities[0]

    for ch in active_chapters:
        ch_id = ch["id"]
        ch_rem = ch["remaining_hours"]
        ch_cum_used = 0.0

        while ch_rem > 1e-4:
            if current_day_idx >= days - 1:
                # Last day absorbs all remaining
                start_frac = ch_cum_used / ch["remaining_hours"]
                day_slices[days - 1].append({
                    "chapter_id": ch_id,
                    "chapter_name": ch["name"],
                    "difficulty": ch.get("difficulty", 1),
                    "slice_hours": round(ch_rem, 1),
                    "start_frac": start_frac,
                    "end_frac": 1.0
                })
                ch_cum_used += ch_rem
                ch_rem = 0.0
                break

            available_room = max(0.0, current_day_budget)
            if available_room < 1e-4:
                current_day_idx += 1
                current_day_budget = day_capacities[current_day_idx]
                continue

            if ch_rem <= available_room + 1e-4:
                # Chapter remainder fits in today
                slice_h = ch_rem
                start_frac = ch_cum_used / ch["remaining_hours"]
                end_frac = min(1.0, (ch_cum_used + slice_h) / ch["remaining_hours"])
                day_slices[current_day_idx].append({
                    "chapter_id": ch_id,
                    "chapter_name": ch["name"],
                    "difficulty": ch.get("difficulty", 1),
                    "slice_hours": round(slice_h, 1),
                    "start_frac": start_frac,
                    "end_frac": end_frac
                })
                ch_cum_used += slice_h
                ch_rem = 0.0
                current_day_budget -= slice_h
                if current_day_budget < 1e-4 and current_day_idx < days - 1:
                    current_day_idx += 1
                    current_day_budget = day_capacities[current_day_idx]
            else:
                # Slice overflows today: fill remainder of day and move to next
                slice_h = available_room
                start_frac = ch_cum_used / ch["remaining_hours"]
                end_frac = min(1.0, (ch_cum_used + slice_h) / ch["remaining_hours"])
                day_slices[current_day_idx].append({
                    "chapter_id": ch_id,
                    "chapter_name": ch["name"],
                    "difficulty": ch.get("difficulty", 1),
                    "slice_hours": round(slice_h, 1),
                    "start_frac": start_frac,
                    "end_frac": end_frac
                })
                ch_cum_used += slice_h
                ch_rem -= slice_h
                current_day_idx += 1
                current_day_budget = day_capacities[current_day_idx]

    # Step 3 & 4: Convert slices into final day response structure
    route_days = []
    for d_idx, slices in enumerate(day_slices):
        day_number = d_idx + 1
        curr_date = start_dt + timedelta(days=d_idx)
        day_total_hours = sum(s["slice_hours"] for s in slices)

        day_items = []
        for s in slices:
            ch_id = s["chapter_id"]
            ch_name = s["chapter_name"]
            topics_pool = chapter_processed_topics.get(ch_id, [])
            total_t = len(topics_pool)

            t_start = round(total_t * s["start_frac"])
            t_end = round(total_t * s["end_frac"])

            slice_topic_objs = topics_pool[t_start:t_end] if total_t > 0 else []
            slice_topic_names = [t["name"] for t in slice_topic_objs]

            if not slice_topic_names:
                slice_topic_names = ["Revise and practise"]
                prereqs_for_first = []
                next_topic_name = None
                cluster_name = None
            else:
                first_topic_name = slice_topic_names[0]
                prereqs_for_first = chapter_prereqs_lookup.get(ch_id, {}).get(first_topic_name, [])
                # Determine next topic to start
                if t_end < total_t:
                    next_topic_name = topics_pool[t_end]["name"]
                else:
                    next_topic_name = None
                cluster_name = topic_name_to_cluster.get(first_topic_name, slice_topic_objs[0].get("cluster_name"))

            day_items.append({
                "chapter_id": ch_id,
                "chapter": ch_name,
                "hours": round(s["slice_hours"], 1),
                "topics": slice_topic_names,
                "prerequisites_for_first_topic": prereqs_for_first,
                "next_topic": next_topic_name,
                "cluster_name": cluster_name
            })

        route_days.append({
            "day_index": day_number,
            "date": curr_date.strftime("%Y-%m-%d"),
            "hours": round(day_total_hours, 1),
            "items": day_items
        })

    return route_days


def calculate_plan_status(
    plan: Dict[str, Any],
    today_date_str: Optional[str] = None
) -> Dict[str, Any]:
    """
    Computes real-time plan status:
    - today_index: days elapsed since start_date (1-indexed).
    - behind: count of days strictly before today that are not marked done.
    - complete: true when all planned days are in done_days.
    - on_track: true when behind == 0 and not complete.
    """
    days = int(plan.get("days", 7))
    start_str = plan.get("start_date", "")[:10]
    done_days = set(plan.get("done_days", []))

    if today_date_str:
        try:
            today_dt = datetime.strptime(today_date_str[:10], "%Y-%m-%d").date()
        except Exception:
            today_dt = date.today()
    else:
        today_dt = date.today()

    try:
        start_dt = datetime.strptime(start_str, "%Y-%m-%d").date()
    except Exception:
        start_dt = today_dt

    elapsed_days = (today_dt - start_dt).days
    today_index = max(1, min(days, elapsed_days + 1))

    # Days before today that are not done:
    behind_count = 0
    for d in range(1, today_index):
        if d not in done_days:
            behind_count += 1

    is_complete = all(d in done_days for d in range(1, days + 1))
    on_track = (behind_count == 0) and not is_complete

    return {
        "today_index": today_index,
        "behind": behind_count,
        "complete": is_complete,
        "on_track": on_track,
        "total_days": days,
        "done_count": len(done_days)
    }
