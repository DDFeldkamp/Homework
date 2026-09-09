# Deadline Dashboard

A GitHub Pages dashboard for Fall 2026 Gradescope deadlines plus manual and recurring assignments.

The visual design is independently implemented but inspired by the course-by-course weekly timeline in [tanjeffreyz/planit](https://github.com/tanjeffreyz/planit): minimal chrome, one section per course, pastel horizontal deadline bars, and a date axis.

## Current architecture

This version intentionally publishes **Gradescope assignment metadata** on GitHub Pages. It does **not** publish your Gradescope login credentials.

```text
GRADESCOPE_EMAIL + GRADESCOPE_PASSWORD
        (GitHub Actions secrets only)
                    |
                    v
             GitHub Action
                    |
     Fall 2026 STUDENT courses only
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

- Fall 2026 Gradescope deadlines only
- only courses under Gradescope's **Student Courses** section
- automatic submitted/graded detection
- course-by-course seven-day timeline
- straight-edged pastel bars showing time from now until the normal due date
- dashed extension showing the late-submission window
- explicit normal and late deadline text
- current date/time centered in the top banner
- light and dark themes
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

### 2. Enable GitHub Pages

Go to:

**Settings → Pages → Source → GitHub Actions**

### 3. Run the first sync

Go to:

**Actions → Sync Gradescope → Run workflow**

The workflow will:

1. log into Gradescope using GitHub secrets
2. enter the **Student Courses** section
3. track the semester headings on the account page
4. collect only course cards beneath **Fall 2026**
5. write `data/gradescope.json`
6. commit the public metadata to the repository
7. deploy the dashboard and JSON to GitHub Pages

It also runs every two hours.

## Fall 2026 filtering

Gradescope places `Fall 2026` above the group of course cards rather than necessarily including it in each course name. The scraper therefore walks the account page in display order and only saves `/courses/<id>` links while both of these are true:

```text
section = Student Courses
term    = Fall 2026
```

It will not fall back to instructor courses or other semesters if the target section cannot be identified.

## Timeline behavior

Each course has its own seven-day axis beginning today. The solid colored portion runs from the current time to the standard due date. If a late deadline exists, a dashed extension continues from the regular deadline to the late deadline. Assignments beyond the visible seven-day window are capped at the right side but still show their full due date in text.

## Manual assignments

Manual assignments are stored in your browser's `localStorage`, not in `data/gradescope.json`. Recurring manual assignments are generated locally up to six months ahead.

## Security / privacy

Your Gradescope email and password remain in GitHub Actions secrets and are never copied into the website files.

However, `data/gradescope.json` is intentionally public in this version. Do not use this version if course names, assignment names, deadlines, completion state, or Gradescope links need to remain private.
