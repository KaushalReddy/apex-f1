# OpenF1 sync worker

Keeps the deployed website's race data current without a code change or redeploy. It downloads **historical** OpenF1 data (no account
needed) into `DATA_DIR`, a persistent directory the website reads first (falling back to the snapshot bundled with its build), then asks
the website to refresh the affected pages. Live timing is separate: see `apps/web/src/lib/openf1/` and `docs/DATA_PIPELINE.md`.

```
node tools/openf1-sync/sync.mjs --once     # one run: for cron / a scheduled job
node tools/openf1-sync/sync.mjs --watch    # long-running: a run every OPENF1_SYNC_INTERVAL_MIN, backing off after failures
node --test "tools/**/*.test.mjs"          # deterministic tests (no network)
```

## What it does each run
1. Takes an exclusive lock (`DATA_DIR/.sync.lock`); a second run exits. A lock left by a crash is reclaimed after 3 h.
2. Reads `/sessions?year=…` (fresh, not cached) for `OPENF1_SYNC_YEARS`.
3. Plans (`plan.mjs`, pure and tested):
   - a **Race** is exported 90 min after it ends (OpenF1 publishes results minutes after the official ones), then **finalised** once,
     bypassing the response cache, 26 h after it ends (late corrections, penalties), then never again;
   - **Qualifying and Race** telemetry follows the same rules; **season results** are rebuilt whenever a race is added or finalised,
     or when a stored race is newer than the stored results (an interrupted run never leaves standings behind);
   - races already **bundled** with the site's build are skipped; practice sessions are never synced.
4. Runs the existing exporters (`tools/openf1-replay`, `-telemetry`, `-results`) as child processes into `DATA_DIR`, one at a time,
   with a 2 h limit each. Every file is written atomically (temporary file + rename), so the website never reads half a file.
5. Validates each output before recording it in `DATA_DIR/sync-state.json` (saved after every job: an interruption never repeats
   finished work). A race OpenF1 lists without lap data (e.g. a cancelled event) is recorded as `noData`, not as a failure.
6. Stops at the first failure (never hammers a failing or rate-limiting provider) and records a sanitised category: `rate-limit`,
   `unavailable`, `auth`, `request`, `invalid-output`, `exporter`. Watch mode doubles its interval after each failed run (up to 8x).
7. If anything changed and `WEB_URL` + `SYNC_SECRET` are set, `POST WEB_URL/api/revalidate` refreshes the affected pages at once.
   Otherwise pages refresh on their own within 15 minutes.

Logs are one JSON object per line on stdout (`sync.plan`, `sync.job.done`, `sync.job.failed`, `openf1.retry`, `sync.run.done` with
request, cache-hit, retry and rate-limit counts). They never contain credentials or response bodies.

## Rate limits
OpenF1 documents that authenticated access has higher limits but publishes no numbers. The worker is unauthenticated and keeps the
export tools' pace: one request at a time, at least `OPENF1_MIN_INTERVAL_MS` (2100 ms) apart, with a timeout, bounded retries with
exponential backoff and jitter, and `Retry-After` honoured on 429. A cold first run of a season takes several minutes; later runs make
one request (the session list) unless something new finished. Responses are cached in `DATA_DIR/.cache` so an interrupted run resumes.

## Configuration
| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | (required) | Persistent directory shared with the website |
| `OPENF1_SYNC_YEARS` | current year | Seasons to keep in sync, comma-separated |
| `OPENF1_SYNC_INTERVAL_MIN` | 30 | Minutes between runs in `--watch` (set the website's to the same value: it judges staleness by it) |
| `OPENF1_MIN_INTERVAL_MS` | 2100 | Minimum spacing between OpenF1 requests |
| `WEB_URL`, `SYNC_SECRET` | unset | Website to notify after a change, and the shared secret it expects |
| `APEX_BUNDLED_REPLAY_DIR`, `APEX_BUNDLED_TELEMETRY_DIR` | repo copies | Indexes of the data bundled with the site's build |

## Deployment shapes
- **A host with a persistent volume** (Docker Compose, a VM, Fly/Railway/Render with a disk): run the `sync` service
  (`infra/docker/sync.Dockerfile`, `--watch`) next to `web`, both mounting the same volume at `/data`. Single writer: run one worker.
- **A scheduler instead of a long-running process**: run `--once` on a schedule (e.g. every 30 min) against the same volume.
- **Serverless hosting without a shared disk** cannot use this as is: `DATA_DIR` must be a filesystem both processes see. Moving the
  store to object storage or Postgres is the change needed there (the website's reads go through `apps/web/src/lib/data/store.ts`).
