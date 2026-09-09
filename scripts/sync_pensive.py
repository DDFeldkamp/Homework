"""Sync Fall 2026 Pensive assignment deadlines.

Pensive's web app authenticates these endpoints with a Bearer token. Put the
token in the PENSIVE_TOKEN GitHub Actions secret. If the token is absent or
rejected, this script writes a disabled/error payload and exits successfully so
Gradescope and bCourses syncing can continue.

Observed endpoints:
  GET https://api.pensieve.co/api/v1/dashboards/teacher
  GET https://api.pensieve.co/api/b2s/v1/assignment/heads?clazz_id=<clazzId>
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "https://api.pensieve.co"
TEACHER_PATH = "/api/v1/dashboards/teacher"
HEADS_PATH = "/api/b2s/v1/assignment/heads"
TARGET_TERM = "Fall 2026"
TARGET_SEASON = "fall"
TARGET_YEAR = 2026
TOKEN = os.environ.get("PENSIVE_TOKEN", "").strip()


def iso_from_millis(value):
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def write_payload(output: Path, **payload):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def disabled_payload(output: Path, error: str | None = None):
    write_payload(
        output,
        enabled=False,
        error=error,
        synced_at=None,
        term=TARGET_TERM,
        course_count=0,
        assignments=[],
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/pensive.json")
    args = parser.parse_args()
    output = Path(args.output)

    if not TOKEN:
        disabled_payload(output, "not_configured")
        print("PENSIVE_TOKEN is not configured; wrote disabled Pensive payload.")
        return

    session = requests.Session()
    session.headers.update({
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "User-Agent": "deadline-dashboard/4.0",
    })

    try:
        teacher_response = session.get(f"{BASE}{TEACHER_PATH}", timeout=30)
        if teacher_response.status_code == 401:
            disabled_payload(output, "authentication_failed")
            print("PENSIVE_TOKEN was rejected (401); wrote disabled Pensive payload.")
            return
        teacher_response.raise_for_status()
        teacher = teacher_response.json()
    except (requests.RequestException, ValueError) as exc:
        disabled_payload(output, "request_failed")
        print(f"Pensive teacher request failed: {exc}")
        return

    classes = teacher.get("classes") if isinstance(teacher, dict) else None
    if not isinstance(classes, list):
        disabled_payload(output, "unexpected_teacher_response")
        print("Pensive teacher response did not contain a classes list.")
        return

    fall_courses = [
        clazz for clazz in classes
        if str(clazz.get("season") or "").lower() == TARGET_SEASON
        and int(clazz.get("year") or 0) == TARGET_YEAR
        and clazz.get("clazzId")
    ]

    assignments = []
    failed_courses = []

    for clazz in fall_courses:
        clazz_id = str(clazz["clazzId"])
        course_name = (
            str(clazz.get("courseName") or "").strip()
            or str(clazz.get("courseId") or "").strip()
            or clazz_id
        )

        try:
            response = session.get(
                f"{BASE}{HEADS_PATH}",
                params={"clazz_id": clazz_id},
                timeout=30,
            )
            if response.status_code == 401:
                disabled_payload(output, "authentication_failed")
                print("PENSIVE_TOKEN was rejected while fetching assignments (401).")
                return
            response.raise_for_status()
            heads = response.json()
        except (requests.RequestException, ValueError) as exc:
            failed_courses.append({"clazz_id": clazz_id, "error": str(exc)})
            continue

        if not isinstance(heads, dict):
            failed_courses.append({"clazz_id": clazz_id, "error": "unexpected_response"})
            continue

        for assignment_id, item in heads.items():
            if not isinstance(item, dict):
                continue
            due = iso_from_millis(item.get("due_time"))
            if not due:
                continue

            assignments.append({
                "id": f"pensive:{clazz_id}:{assignment_id}",
                "source": "pensive",
                "course": course_name,
                "title": item.get("name") or f"Assignment {assignment_id}",
                "release": iso_from_millis(item.get("release_time")),
                "due": due,
                "late_due": None,
                # The heads endpoint supplies deadline metadata but not the
                # current user's submission/completion state.
                "completed": False,
                "completion_mode": "manual",
                "url": "https://www.pensive.com/teacher",
                "clazz_id": clazz_id,
            })

    write_payload(
        output,
        enabled=True,
        error=None,
        synced_at=datetime.now(timezone.utc).isoformat(),
        term=TARGET_TERM,
        course_count=len(fall_courses),
        failed_course_count=len(failed_courses),
        failed_courses=failed_courses,
        assignments=assignments,
    )
    print(
        f"Wrote {len(assignments)} Pensive assignments from "
        f"{len(fall_courses)} Fall 2026 classes to {output}"
    )


if __name__ == "__main__":
    main()
