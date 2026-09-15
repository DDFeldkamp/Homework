"""Sync published Fall 2026 EECS 151/251A deadlines from eecs151.org.

Dashboard rules:
* Homework is included ONLY when the course calendar explicitly lists a due date.
* For a lab, the normal deadline is 11:59 PM Pacific on Friday of the FINAL
  calendar week in which that lab is listed.
* A lab's late deadline is 11:59 PM Pacific on the following Friday.
* Final-project checkpoints are included only if the calendar explicitly lists
  a due date; otherwise they stay hidden until one is published.
"""
from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

URL = "https://eecs151.org/"
COURSE = "EECS 151/251A"
TERM = "Fall 2026"
YEAR = 2026
PACIFIC = ZoneInfo("America/Los_Angeles")
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_month_day(text: str) -> date | None:
    m = re.search(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b",
        text, re.I,
    )
    if not m:
        return None
    return date(YEAR, MONTHS[m.group(1).lower()[:3]], int(m.group(2)))


def explicit_due(text: str) -> date | None:
    m = re.search(
        r"\bdue\b.*?\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b",
        text, re.I,
    )
    if not m:
        return None
    return date(YEAR, MONTHS[m.group(1).lower()[:3]], int(m.group(2)))


def friday_of_week(d: date) -> date:
    return d + timedelta(days=(4 - d.weekday()) % 7)


def deadline_iso(d: date) -> str:
    return datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=PACIFIC).isoformat()


def normalize_title(text: str) -> tuple[str, str] | None:
    lab = re.search(r"\bLab\s+(\d+)\b", text, re.I)
    if lab:
        return "lab", f"Lab {lab.group(1)}"

    hw = re.search(r"\bHW\s*(\d+)\b", text, re.I)
    if hw:
        return "homework", f"HW{hw.group(1)}"

    cp = re.search(r"Final\s+Project\s*:\s*Checkpoint\s+(\d+)", text, re.I)
    if cp:
        return "checkpoint", f"Final Project: Checkpoint {cp.group(1)}"

    return None


def find_calendar(soup: BeautifulSoup):
    for table in soup.find_all("table"):
        text = " ".join(th.get_text(" ", strip=True) for th in table.find_all("th")).lower()
        if "wk." in text and "date" in text and "hw" in text and "asic" in text and "fpga" in text:
            return table
    raise RuntimeError("Could not locate the EECS 151 calendar table")


def parse_calendar(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = find_calendar(soup)

    occurrences: dict[tuple[str, str], list[dict]] = {}
    current_week = None
    current_week_date = None

    for row in table.find_all("tr"):
        cells = row.find_all(["td", "th"])
        if not cells or cells[0].name == "th":
            continue

        texts = [" ".join(c.get_text(" ", strip=True).split()) for c in cells]

        # New week rows begin with the week number.
        if texts and re.fullmatch(r"\d+", texts[0]):
            current_week = int(texts[0])
            if len(texts) > 1:
                parsed = parse_month_day(texts[1])
                if parsed:
                    current_week_date = parsed

        if current_week is None or current_week_date is None:
            continue

        # Published calendar columns: Wk, Date, Lecture, Discussion, HW, ASIC, FPGA.
        for idx in (4, 5, 6):
            if idx >= len(cells):
                continue

            cell = cells[idx]
            text = texts[idx]
            parsed_title = normalize_title(text)
            if not parsed_title:
                continue

            kind, title = parsed_title
            due = explicit_due(text)

            # User rule: do not show unpublished homework/checkpoint deadlines.
            if kind in {"homework", "checkpoint"} and due is None:
                continue

            link = cell.find("a", href=True)
            occurrence = {
                "week": current_week,
                "week_date": current_week_date,
                "explicit_due": due,
                "url": urljoin(URL, link["href"]) if link else URL,
            }
            occurrences.setdefault((kind, title), []).append(occurrence)

    assignments = []
    for (kind, title), items in occurrences.items():
        if kind == "lab":
            # ASIC and FPGA can list the same lab in the same week. Taking the
            # maximum date also correctly handles a lab that spans several weeks.
            final_week_item = max(items, key=lambda x: x["week_date"])
            due_day = friday_of_week(final_week_item["week_date"])
            late_day = due_day + timedelta(days=7)
            url = final_week_item["url"]
            final_week = final_week_item["week"]
        else:
            item = max(items, key=lambda x: x["explicit_due"])
            due_day = item["explicit_due"]
            late_day = None
            url = item["url"]
            final_week = item["week"]

        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        assignments.append({
            "id": f"eecs151:{YEAR}:{slug}",
            "source": "eecs151",
            "course": COURSE,
            "title": title,
            "release": None,
            "due": deadline_iso(due_day),
            "late_due": deadline_iso(late_day) if late_day else None,
            "completed": False,
            "completion_mode": "manual",
            "url": url,
            "calendar_week": final_week,
        })

    assignments.sort(key=lambda a: a["due"])
    return assignments


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/eecs151.json")
    args = parser.parse_args()

    r = requests.get(URL, timeout=30, headers={"User-Agent": "deadline-dashboard/5.0"})
    r.raise_for_status()
    assignments = parse_calendar(r.text)

    payload = {
        "enabled": True,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "term": TERM,
        "course_count": 1,
        "assignments": assignments,
    }

    path = Path(args.output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(assignments)} EECS 151 assignments to {path}")


if __name__ == "__main__":
    main()
