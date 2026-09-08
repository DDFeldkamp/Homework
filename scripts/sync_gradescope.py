"""
Sync Gradescope deadlines for a STUDENT account.

Credentials come only from environment variables:
  GRADESCOPE_EMAIL
  GRADESCOPE_PASSWORD

Important:
- Gradescope does not provide a public API. This uses its web pages.
- Password-based Gradescope login is required. School/Google SSO-only accounts may not work.
- Web markup can change, so the parser includes multiple selector fallbacks.
"""
from __future__ import annotations

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
OUT = Path(__file__).resolve().parents[1] / "data" / "gradescope.json"

EMAIL = os.environ.get("GRADESCOPE_EMAIL", "")
PASSWORD = os.environ.get("GRADESCOPE_PASSWORD", "")


def fail(msg: str):
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


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

    # A failed login normally leaves us on /login.
    if "/login" in resp.url or "session[email]" in resp.text:
        fail("Gradescope login failed. Check the secrets and whether this account requires SSO.")


def student_courses(session: requests.Session):
    resp = session.get(BASE, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    found = {}
    for a in soup.select('a[href^="/courses/"]'):
        href = a.get("href", "")
        m = re.fullmatch(r"/courses/(\d+)", href.rstrip("/"))
        if not m:
            continue
        cid = m.group(1)
        text = clean(a.get_text(" ", strip=True))
        if text:
            found[cid] = text

    if not found:
        # Dashboard markup fallback: locate course ids anywhere in course links.
        for a in soup.find_all("a", href=True):
            m = re.search(r"/courses/(\d+)(?:$|[/?#])", a["href"])
            if m:
                found.setdefault(m.group(1), clean(a.get_text(" ", strip=True)) or f"Course {m.group(1)}")

    return [{"id": cid, "name": name} for cid, name in found.items()]


def iso_from_time(tag):
    if not tag:
        return None
    value = tag.get("datetime") or tag.get("data-datetime") or tag.get("title")
    if value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
        except ValueError:
            pass
    text = clean(tag.get_text(" ", strip=True))
    # Gradescope often renders machine-readable datetime attributes; text parsing is last-resort.
    for fmt in ("%b %d at %I:%M%p", "%b %d, %Y at %I:%M%p", "%m/%d/%Y %I:%M %p"):
        try:
            dt = datetime.strptime(text, fmt)
            if dt.year == 1900:
                dt = dt.replace(year=datetime.now().year)
            return dt.astimezone().isoformat()
        except ValueError:
            continue
    return None


def parse_assignment_rows(html: str, course_id: str, course_name: str):
    soup = BeautifulSoup(html, "html.parser")
    assignments = []
    seen = set()

    # Assignment links are the most stable anchor across Gradescope layouts.
    links = soup.find_all("a", href=re.compile(rf"^/courses/{course_id}/assignments/\d+"))
    for link in links:
        href = link.get("href")
        m = re.search(r"/assignments/(\d+)", href)
        if not m or m.group(1) in seen:
            continue

        aid = m.group(1)
        seen.add(aid)
        title = clean(link.get_text(" ", strip=True))
        if not title:
            continue

        row = link
        for _ in range(8):
            if row.parent is None:
                break
            row = row.parent
            txt = clean(row.get_text(" ", strip=True)).lower()
            if ("due" in txt or "submitted" in txt or "late" in txt) and len(txt) < 1800:
                break

        text = clean(row.get_text(" ", strip=True))
        lower = text.lower()

        times = row.find_all("time")
        due = None
        late_due = None

        # Prefer nearby labels where possible.
        for t in times:
            context = clean((t.parent or t).get_text(" ", strip=True)).lower()
            val = iso_from_time(t)
            if not val:
                continue
            if "late" in context and not late_due:
                late_due = val
            elif ("due" in context or not due) and not due:
                due = val

        # data-* fallback.
        for elem in row.find_all(attrs={"data-datetime": True}):
            val = iso_from_time(elem)
            context = clean((elem.parent or elem).get_text(" ", strip=True)).lower()
            if "late" in context and not late_due:
                late_due = val
            elif not due:
                due = val

        completed_markers = (
            "submitted", "graded", "submission received",
            "view submission", "resubmit"
        )
        completed = any(marker in lower for marker in completed_markers)

        assignments.append({
            "id": f"gradescope:{course_id}:{aid}",
            "source": "gradescope",
            "course": course_name,
            "title": title,
            "due": due,
            "late_due": late_due,
            "completed": completed,
            "url": urljoin(BASE, href),
        })

    return assignments


def main():
    if not EMAIL or not PASSWORD:
        fail("Set GRADESCOPE_EMAIL and GRADESCOPE_PASSWORD.")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 deadline-dashboard/1.0",
        "Accept-Language": "en-US,en;q=0.9",
    })
    login(session)

    courses = student_courses(session)
    if not courses:
        fail("Logged in, but no Gradescope courses were found.")

    assignments = []
    for course in courses:
        url = f"{BASE}/courses/{course['id']}"
        resp = session.get(url, timeout=30)
        resp.raise_for_status()
        assignments.extend(parse_assignment_rows(resp.text, course["id"], course["name"]))

    # Keep only records where at least a title was found; the UI can tolerate missing dates.
    payload = {
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "assignments": assignments,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(assignments)} assignments from {len(courses)} courses to {OUT}")


if __name__ == "__main__":
    main()
