# Deadline Dashboard

A GitHub Pages dashboard for upcoming Gradescope deadlines plus manual and recurring assignments.

## Current architecture

This version intentionally publishes **Gradescope assignment metadata** on GitHub Pages. It does **not** publish your Gradescope login credentials.

```text
GRADESCOPE_EMAIL + GRADESCOPE_PASSWORD
        (GitHub Actions secrets only)
                    |
                    v
             GitHub Action
                    |
          scrape STUDENT courses only
                    |
                    v
        data/gradescope.json
                    |
          commit + Pages deploy
                    |
                    v
          public dashboard
```

The published JSON can contain course names, assignment names, release/due/late dates, completion state, and Gradescope assignment links. Anyone who can access the Pages site can access that metadata too.

## Features

- Gradescope deadlines and late deadlines
- automatic submitted/graded detection
- only courses from Gradescope's **Student Courses** section
- compact top banner with current date/time and sync status
- light and dark themes
- straight-edged time-remaining bars
- date-grouped assignment list
- manual assignments
- daily, weekly, biweekly, and monthly recurring assignments
- Upcoming / All / Done filters and search

## Setup

### 1. Add only these GitHub Actions secrets

In the repository, go to:

**Settings → Secrets and variables → Actions → New repository secret**

Add:

```text
GRADESCOPE_EMAIL
GRADESCOPE_PASSWORD
```

You no longer need Cloudflare, `DEADLINE_API_URL`, `DEADLINE_SYNC_TOKEN`, or `DASHBOARD_PASSWORD`.

### 2. Enable GitHub Pages

Go to:

**Settings → Pages → Source → GitHub Actions**

### 3. Run the first sync

Go to:

**Actions → Sync Gradescope → Run workflow**

The workflow will:

1. log into Gradescope using GitHub secrets
2. read only the **Student Courses** section
3. write `data/gradescope.json`
4. commit the public metadata to the repository
5. deploy the current dashboard and JSON to GitHub Pages

It also runs every two hours.

## Student-only filtering

The scraper deliberately reads course links only from Gradescope's **Student Courses** section. It does not fall back to every `/courses/...` link on the account page. If it cannot identify any student courses, the sync fails instead of accidentally including instructor courses.

## Manual assignments

Manual assignments are stored in your browser's `localStorage`, not in `data/gradescope.json`. Recurring manual assignments are generated locally up to six months ahead.

## Security / privacy

Your Gradescope email and password remain in GitHub Actions secrets and are never copied into the website files.

However, `data/gradescope.json` is intentionally public in this version. Do not use this version if course names, assignment names, deadlines, completion state, or Gradescope links need to remain private.
