# Deadline Dashboard

A Planit-inspired GitHub Pages assignment dashboard for **Fall 2026**.

It supports:

- Gradescope student courses and deadlines
- optional bCourses/Canvas deadlines
- automatic completion detection when the source exposes submission state
- late/final deadlines
- manual and recurring assignments
- light and dark themes
- a seven-day timeline
- a persistent course registry with per-session visibility and configurable defaults

## Course visibility and defaults

The dashboard stores the names of courses it has seen in browser `localStorage`.
That includes courses discovered from Gradescope, bCourses, and courses entered on
manual assignments.

Click **Courses** in the top-right banner to manage them.

- **Show** controls the courses visible in the current browser session.
- **Default** controls which courses are selected when a new browser session is opened.
- **Show all**, **Hide all**, and **Use defaults** provide quick switching.

The course list is retained even if a course temporarily has no upcoming assignments.
The selected courses for the current session are stored in `sessionStorage`; default
course choices and the registry are stored in `localStorage`.

## Gradescope

The Gradescope scraper intentionally collects only courses under:

```text
Student Courses
└── Fall 2026
```

It does not fall back to instructor courses or older semesters.

Add these GitHub Actions repository secrets:

```text
GRADESCOPE_EMAIL
GRADESCOPE_PASSWORD
```

Gradescope does not have a public student API, so this source still relies on the
Gradescope website. Accounts that require SSO-only login may need a different login
strategy.

## Optional bCourses integration

bCourses is based on Canvas and exposes Canvas REST API endpoints for a user's
student courses and assignments. This repo includes `scripts/sync_bcourses.py`.

If you have a bCourses/Canvas access token, add it as a GitHub Actions repository secret:

```text
BCOURSES_TOKEN
```

If `BCOURSES_TOKEN` is absent, the bCourses step exits successfully and the dashboard
continues to work with Gradescope/manual assignments only.

The bCourses sync:

1. requests only active **student** enrollments,
2. keeps only courses whose Canvas term is **Fall 2026**,
3. retrieves assignments with the current user's submission information,
4. uses `due_at` as the due date,
5. uses `lock_at` as the final/late cutoff when it is later than `due_at`, and
6. marks an assignment complete when Canvas reports a submitted/graded submission.

Because the dashboard is intentionally public, bCourses assignment metadata is also
published in `data/bcourses.json`. The access token itself remains a GitHub secret.

## Deploy

1. Copy the repo to GitHub.
2. Add `GRADESCOPE_EMAIL` and `GRADESCOPE_PASSWORD` under **Settings → Secrets and variables → Actions**.
3. Optionally add `BCOURSES_TOKEN`.
4. Under **Settings → Pages**, use **GitHub Actions** as the deployment source.
5. Open **Actions → Sync deadlines → Run workflow**.

The workflow also runs every two hours.

## Public data

The GitHub Pages site publishes:

```text
data/gradescope.json
data/bcourses.json
```

These files can contain course names, assignment names, due dates, late/final
cutoffs, completion state, and assignment links. Credentials/tokens are not written
to these files.
