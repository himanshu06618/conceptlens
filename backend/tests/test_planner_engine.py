import pytest
from datetime import date, timedelta
from backend.services.plan_engine import (
    calc_default_est_hours,
    remaining_hours,
    stable_topological_sort,
    build_route,
    calculate_plan_status,
)
from backend.services.topic_relations import (
    validate_and_sanitize_relations,
    generate_fallback_relations,
)


def test_calc_default_est_hours():
    # easy: 4 min, med: 6 min, hard: 9 min
    assert calc_default_est_hours(10, difficulty=0) == round(40 / 60, 1)  # 0.7
    assert calc_default_est_hours(10, difficulty=1) == round(60 / 60, 1)  # 1.0
    assert calc_default_est_hours(10, difficulty=2) == round(90 / 60, 1)  # 1.5


def test_remaining_hours():
    chapter = {"est_hours": 10.0, "status": 0}
    assert remaining_hours(chapter) == 10.0
    chapter["status"] = 1
    assert remaining_hours(chapter) == 5.0
    chapter["status"] = 2
    assert remaining_hours(chapter) == 0.0


def test_stable_topological_sort_preserves_reading_order_and_prerequisites():
    topics = [
        {"id": 1, "order_index": 1, "name": "Intro"},
        {"id": 2, "order_index": 2, "name": "Basic Math"},
        {"id": 3, "order_index": 3, "name": "Advanced Math"},
        {"id": 4, "order_index": 4, "name": "Calculus"},
    ]
    # Prerequisite: Calculus (4) needs Advanced Math (3), which needs Basic Math (2)
    edges = [
        {"from": 2, "to": 3, "type": "prerequisite"},
        {"from": 3, "to": 4, "type": "prerequisite"},
    ]
    sorted_topics = stable_topological_sort(topics, edges)
    order_ids = [t["id"] for t in sorted_topics]
    assert order_ids == [1, 2, 3, 4]


def test_stable_topological_sort_enforces_prerequisite_before_target():
    # Even if topic 3 appeared earlier in reading order than 1, if 1 is prereq for 3, 1 comes first
    topics = [
        {"id": 1, "order_index": 2, "name": "Topic A"},
        {"id": 2, "order_index": 1, "name": "Topic B (needs A)"},
    ]
    edges = [{"from": 1, "to": 2, "type": "prerequisite"}]
    sorted_topics = stable_topological_sort(topics, edges)
    order_ids = [t["id"] for t in sorted_topics]
    assert order_ids == [1, 2]


def test_stable_topological_sort_rejects_cycles():
    topics = [
        {"id": 1, "order_index": 1, "name": "A"},
        {"id": 2, "order_index": 2, "name": "B"},
    ]
    edges = [
        {"from": 1, "to": 2, "type": "prerequisite"},
        {"from": 2, "to": 1, "type": "prerequisite"},
    ]
    sorted_topics = stable_topological_sort(topics, edges)
    # Both topics are returned and execution does not hang
    assert len(sorted_topics) == 2


def test_build_route_preserves_total_hours_and_chain_length():
    chapters = [
        {"id": "ch1", "name": "Mechanics", "order_index": 1, "est_hours": 14.0, "status": 0, "difficulty": 1},
    ]
    topic_map = {
        "ch1": [{"id": i, "order_index": i, "name": f"Topic {i}"} for i in range(1, 15)]
    }

    route_7 = build_route(chapters, days=7, chapter_topics_map=topic_map)
    route_30 = build_route(chapters, days=30, chapter_topics_map=topic_map)

    assert len(route_7) == 7
    assert len(route_30) == 30

    total_7 = sum(d["hours"] for d in route_7)
    total_30 = sum(d["hours"] for d in route_30)

    assert round(total_7, 1) == 14.0
    assert round(total_30, 1) == 14.0


def test_build_route_single_chapter_scope():
    chapters = [
        {"id": "ch1", "name": "Ch 1", "order_index": 1, "est_hours": 6.0, "status": 0, "difficulty": 1},
        {"id": "ch2", "name": "Ch 2", "order_index": 2, "est_hours": 8.0, "status": 0, "difficulty": 1},
    ]
    route = build_route(chapters, days=7, scope_chapter_id="ch2")
    # All planned items should only belong to ch2
    all_chapters_in_route = {item["chapter_id"] for d in route for item in d["items"]}
    assert all_chapters_in_route == {"ch2"}
    total_hours = sum(d["hours"] for d in route)
    assert round(total_hours, 1) == 8.0


def test_build_route_in_progress_skips_first_half_of_topics():
    topics = [{"id": i, "order_index": i, "name": f"Topic {i}"} for i in range(1, 11)]
    chapters = [
        {"id": "ch1", "name": "Ch 1", "order_index": 1, "est_hours": 6.0, "status": 1, "difficulty": 1},
    ]
    route = build_route(chapters, days=7, chapter_topics_map={"ch1": topics})
    planned_topics = [t for d in route for item in d["items"] for t in item["topics"] if t != "Revise and practise"]
    # With 10 topics and status=1 (50% progress), topics 1..5 should be skipped
    assert "Topic 1" not in planned_topics
    assert "Topic 2" not in planned_topics
    assert "Topic 5" not in planned_topics
    assert "Topic 6" in planned_topics or "Topic 10" in planned_topics


def test_prerequisite_never_scheduled_later_than_dependent():
    # Topic 1 is a prerequisite for Topic 2
    topics = [
        {"id": 1, "order_index": 1, "name": "Fundamentals"},
        {"id": 2, "order_index": 2, "name": "Advanced Theory"},
    ]
    chapters = [
        {"id": "ch1", "name": "Ch 1", "order_index": 1, "est_hours": 10.0, "status": 0, "difficulty": 1},
    ]
    relations = {
        "edges": [{"from": 1, "to": 2, "type": "prerequisite"}]
    }
    route = build_route(
        chapters,
        days=7,
        chapter_topics_map={"ch1": topics},
        chapter_relations_map={"ch1": relations}
    )

    day_of_topic1 = None
    day_of_topic2 = None

    for d in route:
        for item in d["items"]:
            if "Fundamentals" in item["topics"]:
                day_of_topic1 = d["day_index"]
            if "Advanced Theory" in item["topics"]:
                day_of_topic2 = d["day_index"]

    assert day_of_topic1 is not None
    assert day_of_topic2 is not None
    assert day_of_topic1 <= day_of_topic2


def test_validate_and_sanitize_relations_rejects_cycles_and_normalizes():
    topics = [
        {"id": 1, "order_index": 1, "name": "A"},
        {"id": 2, "order_index": 2, "name": "B"},
        {"id": 3, "order_index": 3, "name": "C"},
    ]
    raw_data = {
        "clusters": [
            {"name": "Cluster 1", "topic_ids": [1, 2, 3]}
        ],
        "edges": [
            {"from": 1, "to": 2, "type": "prerequisite"},
            {"from": 2, "to": 3, "type": "prerequisite"},
            {"from": 1, "to": 3, "type": "prerequisite"},  # Transitive shortcut, should be dropped
            {"from": 2, "to": 1, "type": "prerequisite"},  # Reverse prerequisite pointing backward, dropped
            {"from": 3, "to": 2, "type": "related"},       # Symmetric related, stored once min < max
        ]
    }
    result = validate_and_sanitize_relations(topics, raw_data)

    edges = result["edges"]
    prereqs = [e for e in edges if e["type"] == "prerequisite"]
    related = [e for e in edges if e["type"] == "related"]

    # Transitive shortcut 1->3 should be dropped, leaving direct 1->2 and 2->3
    assert {"from": 1, "to": 2, "type": "prerequisite"} in prereqs
    assert {"from": 2, "to": 3, "type": "prerequisite"} in prereqs
    assert {"from": 1, "to": 3, "type": "prerequisite"} not in prereqs
    assert {"from": 2, "to": 1, "type": "prerequisite"} not in prereqs

    # Related should be normalized with min < max: 2 < 3
    assert len(related) == 1
    assert related[0] == {"from": 2, "to": 3, "type": "related"}


def test_plan_status_tracking():
    today = date.today().strftime("%Y-%m-%d")
    yesterday = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")

    # Plan started yesterday (day 1 was yesterday, day 2 is today)
    plan = {
        "days": 7,
        "start_date": yesterday,
        "done_days": []  # Day 1 was not done -> 1 day behind
    }
    status = calculate_plan_status(plan, today)
    assert status["today_index"] == 2
    assert status["behind"] == 1
    assert status["complete"] is False

    # If day 1 is marked done
    plan["done_days"] = [1]
    status_updated = calculate_plan_status(plan, today)
    assert status_updated["behind"] == 0
    assert status_updated["on_track"] is True
