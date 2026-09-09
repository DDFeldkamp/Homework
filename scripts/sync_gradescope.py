"""Scrape deadlines from Gradescope student courses into public dashboard JSON.

Credentials still come only from GitHub Actions secrets; the generated assignment
metadata is intentionally committed and published by GitHub Pages.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://www.gradescope.com"
EMAIL = os.environ.get("GRADESCOPE_EMAIL", "")
PASSWORD = os.environ.get("GRADESCOPE_PASSWORD", "")


def fail(msg: str):
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def login(session: requests.Session):
    page = session.get(f"{BASE}/login", timeout=30)
    page.raise_for_status()
    soup = BeautifulSoup(page.text, "html.parser")
    token = soup.select_one('input[name="authenticity_token"]')
    payload = {
        "session[email]": EMAIL,
        "session[password]": PASSWORD,
        "commit": "Log In",
    }
    if token and token.get("value"):
        payload["authenticity_token"] = token["value"]

    resp = session.post(f"{BASE}/login", data=payload, timeout=30, allow_redirects=True)
    resp.raise_for_status()
    if "/login" in resp.url or 'name="session[email]"' in resp.text:
        fail("Gradescope login failed. Check credentials or whether the account requires SSO.")


def student_courses(session: requests.Session):
    """Return only Fall 2026 courses from Gradescope's Student Courses section.

    Gradescope displays semester headings (for example ``Fall 2026``) above the
    course cards, so filtering by course name is not reliable. We walk the
    account page in DOM order, enter the Student Courses section, track the
    current semester heading, and only collect exact /courses/<id> links while
    the active semester is Fall 2026.
    """
    target_term = "fall 2026"
    term_re = re.compile(r"^(spring|summer|fall|winter)\s+\d{4}$", re.I)

    resp = session.get(f"{BASE}/account", timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    account = soup.select_one("div#account-show")
    if account is None:
        fail("Could not find the Gradescope account course list.")

    # If there is no instructor/staff UI at all, the account page may omit a
    # separate Student Courses heading. In that case it is safe to begin in the
    # student section. If staff UI exists, we require the explicit heading so
    # instructor courses cannot be collected accidentally.
    is_staff_somewhere = soup.select_one("button.js-createNewCourse") is not None
    in_student_section = not is_staff_somewhere
    saw_student_heading = False
    current_term = None
    found: dict[str, str] = {}

    for element in account.find_all(True):
        text = clean(element.get_text(" ", strip=True))
        lower = text.lower()

        # Section boundaries. Only headings with short exact text are treated
        # as boundaries so wrapper elements do not accidentally match.
        if element.name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            if lower == "student courses":
                in_student_section = True
                saw_student_heading = True
                current_term = None
                continue
            if lower in {"instructor courses", "courses as instructor"}:
                in_student_section = False
                current_term = None
                continue

        if not in_student_section:
            continue

        # Semester headings can be h-tags or small dedicated div/span labels.
        # Requiring the entire element text to match prevents a course-list
        # wrapper containing many cards from being mistaken for a term heading.
        if term_re.fullmatch(lower):
            current_term = lower
            continue

        if current_term != target_term:
            continue

        if element.name != "a":
            continue

        href = element.get("href", "").rstrip("/")
        match = re.fullmatch(r"/courses/(\d+)", href)
        if not match:
            continue

        cid = match.group(1)
        short = element.select_one("h3.courseBox--shortname")
        full = element.select_one("div.courseBox--name")
        short_name = clean(short.get_text(" ", strip=True) if short else "")
        full_name = clean(full.get_text(" ", strip=True) if full else "")
        found[cid] = short_name or full_name or f"Course {cid}"

    if not found:
        heading_note = " Student Courses heading was found." if saw_student_heading else ""
        fail(
            "No Fall 2026 student courses were found." + heading_note +
            " The scraper will not fall back to instructor or older-semester courses."
        )

    return [{"id": cid, "name": name} for cid, name in found.items()]


def parse_student_assignments(html: str, course_id: str, course_name: str):
    soup = BeautifulSoup(html, "html.parser")
    assignments = []

    rows = soup.find_all("tr", role="row")
    if rows:
        rows = rows[1:-1] if len(rows) > 2 else rows[1:]

    for row in rows:
        cells = [*row.find_all("th", recursive=False), *row.find_all("td", recursive=False)]
        if len(cells) < 2:
            # Some layouts wrap cells one level deeper.
            cells = [*row.find_all("th"), *row.find_all("td")]
        if len(cells) < 2:
            continue

        title = clean(cells[0].get_text(" ", strip=True))
        if not title:
            continue

        link = cells[0].find("a", href=True)
        button = cells[0].find("button", class_="js-submitAssignment")
        assignment_id = None
        href = None
        if link:
            href = link.get("href")
            match = re.search(r"/assignments/(\d+)", href or "")
            assignment_id = match.group(1) if match else None
        elif button and button.get("data-assignment-id"):
            assignment_id = str(button["data-assignment-id"])
            href = f"/courses/{course_id}/assignments/{assignment_id}"

        status_text = clean(cells[1].get_text(" ", strip=True))
        status_lower = status_text.lower()
        completed = (
            "submitted" in status_lower
            or "graded" in status_lower
            or bool(re.match(r"^\s*-?\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?\s*$", status_text))
        )

        date_cell = cells[2] if len(cells) > 2 else row
        release_obj = date_cell.find(class_="submissionTimeChart--releaseDate")
        due_objs = date_cell.find_all(class_="submissionTimeChart--dueDate")
        due = due_objs[0].get("datetime") if due_objs else None
        late_due = due_objs[1].get("datetime") if len(due_objs) > 1 else None
        release = release_obj.get("datetime") if release_obj else None

        # Generic time-tag fallback if Gradescope changes only the wrapper classes.
        if not due:
            time_tags = date_cell.find_all("time")
            for tag in time_tags:
                val = tag.get("datetime")
                context = clean((tag.parent or tag).get_text(" ", strip=True)).lower()
                if not val:
                    continue
                if "late" in context and not late_due:
                    late_due = val
                elif not due:
                    due = val

        assignments.append({
            "id": f"gradescope:{course_id}:{assignment_id or title}",
            "source": "gradescope",
            "course": course_name,
            "title": title,
            "release": release,
            "due": due,
            "late_due": late_due,
            "completed": completed,
            "url": urljoin(BASE, href) if href else f"{BASE}/courses/{course_id}",
        })

    return assignments


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/gradescope.json")
    args = parser.parse_args()

    if not EMAIL or not PASSWORD:
        fail("Set GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD.")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 deadline-dashboard/2.0",
        "Accept-Language": "en-US,en;q=0.9",
    })
    login(session)
    courses = student_courses(session)

    assignments = []
    for course in courses:
        resp = session.get(f"{BASE}/courses/{course['id']}", timeout=30)
        resp.raise_for_status()
        assignments.extend(parse_student_assignments(resp.text, course["id"], course["name"]))

    payload = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "term": "Fall 2026",
        "course_count": len(courses),
        "assignments": assignments,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(assignments)} assignments from {len(courses)} Fall 2026 STUDENT courses to {output}")


if __name__ == "__main__":
    main()
