"""Sync Fall 2026 bCourses (Canvas) assignment deadlines.

Authentication uses an optional Canvas/bCourses access token from the
BCOURSES_TOKEN environment variable. If the token is not configured, this
script writes an empty disabled payload and exits successfully so Gradescope
syncing continues to work.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests

BASE = "https://bcourses.berkeley.edu"
TARGET_TERM = "Fall 2026"
TOKEN = os.environ.get("BCOURSES_TOKEN", "").strip()


def get_paginated(session: requests.Session, path: str, params: dict | None = None):
    """Fetch all pages from a Canvas list endpoint."""
    url = urljoin(BASE, path)
    first = True
    items = []

    while url:
        response = session.get(url, params=params if first else None, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise RuntimeError(f"Expected list from {path}, got {type(payload).__name__}")
        items.extend(payload)
        url = response.links.get("next", {}).get("url")
        first = False

    return items


def course_display_name(course: dict) -> str:
    # course_code is usually the concise Berkeley class identifier and works
    # better in a compact planner than the full Canvas course name.
    return (
        str(course.get("course_code") or "").strip()
        or str(course.get("name") or "").strip()
        or f"bCourses {course.get('id')}"
    )


def is_completed(submission: dict | None) -> bool:
    if not isinstance(submission, dict):
        return False
    state = str(submission.get("workflow_state") or "").lower()
    return bool(
        submission.get("submitted_at")
        or state in {"submitted", "graded", "pending_review"}
    )


def later_than(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    try:
        ad = datetime.fromisoformat(a.replace("Z", "+00:00"))
        bd = datetime.fromisoformat(b.replace("Z", "+00:00"))
        return ad > bd
    except ValueError:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/bcourses.json")
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    if not TOKEN:
        payload = {
            "enabled": False,
            "synced_at": None,
            "term": TARGET_TERM,
            "course_count": 0,
            "assignments": [],
        }
        output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print("BCOURSES_TOKEN is not configured; wrote disabled bCourses payload.")
        return

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "User-Agent": "deadline-dashboard/3.0",
    })

    # Canvas can filter the current user's courses to student enrollments. The
    # term object lets us keep the exact same Fall 2026 scope as Gradescope.
    courses = get_paginated(
        session,
        "/api/v1/courses",
        params={
            "enrollment_type": "student",
            "enrollment_state": "active",
            "include[]": "term",
            "per_page": 100,
        },
    )

    fall_courses = []
    for course in courses:
        term = course.get("term") or {}
        term_name = str(term.get("name") or "").strip()
        if term_name.lower() == TARGET_TERM.lower():
            fall_courses.append(course)

    assignments = []
    for course in fall_courses:
        cid = course["id"]
        course_name = course_display_name(course)
        course_assignments = get_paginated(
            session,
            f"/api/v1/courses/{cid}/assignments",
            params={
                "include[]": "submission",
                "override_assignment_dates": "true",
                "per_page": 100,
            },
        )

        for assignment in course_assignments:
            due = assignment.get("due_at")
            if not due:
                # The dashboard is deadline-focused; undated Canvas items are
                # omitted instead of filling the planner with non-deadlines.
                continue

            lock_at = assignment.get("lock_at")
            # Canvas's lock_at is the final availability cutoff. If it is after
            # due_at, it is useful as the dashboard's late/final deadline.
            late_due = lock_at if later_than(lock_at, due) else None

            aid = assignment.get("id")
            assignments.append({
                "id": f"bcourses:{cid}:{aid}",
                "source": "bcourses",
                "course": course_name,
                "title": assignment.get("name") or f"Assignment {aid}",
                "due": due,
                "late_due": late_due,
                "completed": is_completed(assignment.get("submission")),
                "url": assignment.get("html_url") or f"{BASE}/courses/{cid}/assignments/{aid}",
            })

    payload = {
        "enabled": True,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "term": TARGET_TERM,
        "course_count": len(fall_courses),
        "assignments": assignments,
    }
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(assignments)} bCourses assignments from "
        f"{len(fall_courses)} Fall 2026 student courses to {output}"
    )


if __name__ == "__main__":
    main()
