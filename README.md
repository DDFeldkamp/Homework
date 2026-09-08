# Deadline Dashboard

A GitHub Pages frontend for upcoming Gradescope deadlines plus manual/recurring assignments.

## What changed in v2

- **Gradescope metadata is no longer committed to the repository or published by GitHub Pages.**
- Gradescope sync writes only to `/tmp` inside the GitHub Actions runner, then POSTs the JSON to a private Cloudflare Worker + KV store.
- The Pages site asks for a dashboard password each browser session before it can read Gradescope metadata.
- Light and dark themes.
- Compact title banner with the current date/time at the top.
- Straight-edged time-remaining bars and date-grouped assignment lists.
- Gradescope scraping is restricted to the **Student Courses** section and intentionally refuses to fall back to all courses.

## Architecture

```text
Gradescope credentials (GitHub Secrets)
        |
        v
GitHub Action scraper
        |
        | POST /sync with private sync token
        v
Cloudflare Worker ----> Workers KV (private deadline JSON)
        ^
        | GET /deadlines with dashboard password
        |
GitHub Pages frontend
```

GitHub Pages publishes only these four files:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`

The scraper, Worker source, and all generated Gradescope JSON are excluded from the Pages deployment artifact.

# 1. Deploy the private Worker backend

You need a free Cloudflare account plus Node/npm locally.

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

The Wrangler config declares a KV binding without an ID, so current Wrangler can automatically provision the KV resource during deployment.

Then set two Worker secrets:

```bash
npx wrangler secret put DASHBOARD_PASSWORD
npx wrangler secret put SYNC_TOKEN
```

Choose:

- `DASHBOARD_PASSWORD`: the password you will type into the web dashboard.
- `SYNC_TOKEN`: a long random token used only by GitHub Actions.

For better CORS restriction, add `ALLOWED_ORIGIN` as a Worker environment variable in Cloudflare, set to your exact Pages origin, for example:

```text
https://YOUR_GITHUB_USERNAME.github.io
```

or, for a project Pages site, the origin is still just the scheme + host (no repo path).

After deployment, Wrangler prints a Worker URL similar to:

```text
https://deadline-dashboard-api.YOUR-SUBDOMAIN.workers.dev
```

# 2. Point the frontend at the Worker

Edit `config.js`:

```js
window.DEADLINE_CONFIG = {
  apiUrl: "https://deadline-dashboard-api.YOUR-SUBDOMAIN.workers.dev"
};
```

The Worker URL is not secret. Never put a password or token in `config.js`.

# 3. Add GitHub Actions secrets

In the GitHub repository:

**Settings → Secrets and variables → Actions → New repository secret**

Add:

```text
GRADESCOPE_EMAIL
GRADESCOPE_PASSWORD
DEADLINE_API_URL
DEADLINE_SYNC_TOKEN
```

Values:

- `GRADESCOPE_EMAIL`: Gradescope login email
- `GRADESCOPE_PASSWORD`: Gradescope password
- `DEADLINE_API_URL`: the Worker URL
- `DEADLINE_SYNC_TOKEN`: exactly the same random value as the Worker's `SYNC_TOKEN`

# 4. Run the Gradescope sync

Go to:

**Actions → Sync Gradescope → Run workflow**

The workflow now:

1. logs into Gradescope
2. selects only Student Courses
3. writes temporary JSON under `/tmp`
4. POSTs it to the private Worker
5. exits without committing any assignment data

It also runs automatically every two hours.

# 5. Enable GitHub Pages

Go to:

**Settings → Pages → Source → GitHub Actions**

Then run the **Deploy GitHub Pages** workflow or push to `main`.

When you open the site, enter `DASHBOARD_PASSWORD`. The browser keeps it only in `sessionStorage`, so closing that browser tab/window session clears it.

## Manual assignments

Manual assignments are still stored locally in your browser with `localStorage`. They support:

- one-time assignments
- daily recurrence
- weekly recurrence
- every-two-weeks recurrence
- monthly recurrence
- manual completion checkboxes

Gradescope assignment completion remains read-only in the UI and is detected from the student assignment status during sync.

## Student-course filtering

The scraper reads Gradescope's account dashboard and only accepts course links from its `Student Courses` section. If it cannot identify student courses, the sync fails rather than falling back to instructor courses.

## Security notes

- No Gradescope password is shipped to the browser.
- No Gradescope metadata is stored in the Git repository.
- No Gradescope metadata is included in the GitHub Pages artifact.
- The Worker endpoint URL is public, but `/deadlines` requires your dashboard password and `/sync` requires a separate sync token.
- Use a strong unique dashboard password and a long random sync token.
- Standard email/password Gradescope login is expected; SSO-only accounts may require a different login strategy.
