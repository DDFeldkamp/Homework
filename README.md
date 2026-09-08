# Deadline Dashboard

A GitHub Pages dashboard for:

- upcoming Gradescope deadlines
- late deadlines
- automatic completion detection from Gradescope submission state
- time-remaining progress bars
- manual assignments
- daily / weekly / biweekly / monthly recurring assignments

## Security model

**Do not place your Gradescope username or password in `index.html`, JavaScript, JSON, or any committed file.**

GitHub Pages is static: every file it serves is downloadable by the browser. This project stores the credentials only as GitHub Actions repository secrets. The scheduled Action logs into Gradescope, extracts non-secret assignment metadata, and writes that metadata to `data/gradescope.json`.

> If this repository / Pages site is public, the generated `data/gradescope.json` is public too. It contains assignment names, course names, deadlines, completion state, and Gradescope URLs. Use a private repository with Pages availability on your plan/account if you want that metadata private.

## Setup

1. Create a GitHub repository and copy these files into it.
2. Make the default branch `main`.
3. In the repository, open **Settings → Secrets and variables → Actions**.
4. Add two repository secrets:
   - `GRADESCOPE_EMAIL`
   - `GRADESCOPE_PASSWORD`
5. Open **Actions → Sync Gradescope → Run workflow** once.
6. Open **Settings → Pages** and choose **GitHub Actions** as the source.
7. Push to `main` (or manually run the Pages workflow).

The Gradescope sync then runs every two hours.

## Important Gradescope limitation

Gradescope currently has no public API. The sync script uses the Gradescope website and therefore may need selector updates if Gradescope changes its HTML. Standard Gradescope email/password login is expected. If your account can only log in through school/Google SSO, this simple GitHub Action login may not work.

## Manual assignments

Manual assignments are saved to `localStorage`, so they stay on the browser/device where you added them. Recurring assignments are expanded in the UI up to six months ahead.

For Gradescope assignments, the Gradescope sync is authoritative: the checkbox is read-only and completion is automatically inferred from submission/graded state. Manual assignments can be checked off directly.

## Privacy note

Even though credentials are protected by repository secrets, **deadline data itself is intentionally published to the static site**. Do not publish this dashboard publicly if course/assignment names or completion state are sensitive to you.
