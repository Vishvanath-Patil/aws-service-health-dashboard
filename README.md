# AWS Service Health Dashboard

A static dashboard showing the current status of AWS services for your organization, built from AWS's **public** Service Health feed. No backend, no AWS credentials, no build step.

- **Data source:** [AWS public health feed](https://health.aws.amazon.com/public/currentevents) (the successor to the old `status.aws.amazon.com/data.json` endpoint)
- **Refresh:** GitHub Actions fetches the feed every 30 minutes and commits a snapshot
- **Hosting:** GitHub Pages

## How it works

```
Browser ──▶ GitHub Pages (index.html / app.js / styles.css)
                ▲
                │ data/health-snapshot.json (clean UTF-8 JSON)
GitHub Actions (every 30 min)
   └─ curl health.aws.amazon.com/public/currentevents   (server-to-server, no CORS)
       └─ python3 scripts/process_feed.py               (decode UTF-16 → UTF-8)
           └─ commit data/health-snapshot.json
```

The current feed only reports **active health events** (each with a message timeline, impacted services, and severity). When there are none, the dashboard shows *"All AWS services are operating normally"*.

### Severity legend

| Status | Meaning | Color |
|--------|---------|-------|
| 0 | Normal | Green |
| 1 | Informational | Blue |
| 2 | Degraded | Amber |
| 3 | Disruption | Red |

> These map to the 0–3 severity values present in the feed's `impacted_services` and status-change history.

## Set up on your own repository

1. Push this directory to a GitHub repository (default branch `master`).
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Trigger the first snapshot manually: **Actions → "Sync AWS health snapshot" → Run workflow** (or just wait up to 30 min for the schedule).
4. The **pages.yml** workflow deploys the site on every push — you'll get a URL like `https://<you>.github.io/<repo>/`.

Optional: in **Settings → Pages**, set a custom domain or a specific branch/`/docs` source if you prefer not to expose the whole repo root.

## Files

| File | Purpose |
|------|---------|
| `index.html`, `styles.css`, `app.js` | The static dashboard (no build) |
| `scripts/process_feed.py` | Decodes the UTF-16 feed and writes a clean UTF-8 snapshot |
| `data/health-snapshot.json` | The committed snapshot the site renders |
| `.github/workflows/sync-health.yml` | Scheduled fetch + commit (every 30 min) |
| `.github/workflows/pages.yml` | GitHub Pages deployment on push |

## Notes / limitations

- The feed is **current-events only**. History (past incidents) is not returned, so the dashboard shows the live picture, not trends. If you want trend history later, the sync action could start appending snapshots to a `history/` directory.
- If the snapshot is more than 2 hours old, the dashboard shows a warning — that means the scheduled action didn't run (e.g., the workflow was disabled or the repo went dormant).
- GitHub Pages is **public** by default unless your plan supports private Pages. If the report must stay internal, you'll need private Pages or another host (any static host works).
- Changing the cadence: edit `cron` in `sync-health.yml`, then push.

## Local preview

Serve the directory and open it:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```
