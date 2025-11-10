# Deterministic Schedule Feed Specification

## Purpose

Provide LibreTime with a deterministic, UTC-normalised schedule feed so the playout queue never contains past events and hour-boundary transitions occur on time.

## Transport

- **Endpoint**: authenticated HTTPS GET (e.g., `/api/schedule/deterministic`)
- **Format**: JSON, gzip-compressed by default
- **Headers**:
  - Requires bearer/API token (same as existing Payload integrations)
  - Supports `ETag` on responses and honours `If-None-Match`
  - Responses should include `Cache-Control: no-store`
- **Limits**:
  - Includes current event and enough upcoming content to cover at least **lookahead_min** (minimum 20 minutes, typically 6 hours max)
  - Response size capped (`maxItems`) to avoid excessive payloads
- **Timeouts**: client should use 1s connect / 3s read timeouts to avoid blocking around boundaries

## Top-Level Payload

```json
{
  "scheduleVersion": 1730985600123,
  "generatedAt_utc": "2025-11-07T12:20:08",
  "validFrom_utc": "2025-11-07T12:00:00",
  "validTo_utc": "2025-11-07T18:00:00",
  "lookahead_min": 360,
  "items": [ ... ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `scheduleVersion` | int | Strictly increasing epoch millis; never re-used (feed `ETag` should hash `scheduleVersion` + canonical items) |
| `generatedAt_utc` | string | Naïve UTC (`YYYY-MM-DDTHH:mm:ss`) |
| `validFrom_utc` | string | Earliest timestamp covered by the feed |
| `validTo_utc` | string | Latest timestamp covered; consumer can detect stale loads |
| `lookahead_min` | int | Minutes of future schedule covered |
| `items` | array | Ordered by `start_utc` |

## Item Schema

Each entry supplies the metadata needed for playout and verification.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | LibreTime track/file identifier (numeric string) |
| `row_id` | number | LibreTime schedule row ID (playout) |
| `start_utc` | string | **Naïve UTC** timestamp (`YYYY-MM-DDTHH:mm:ss`) |
| `end_utc` | string | **Naïve UTC** timestamp |
| `duration_sec` | number | Derived duration in seconds |
| `uri` | string | Path/URI LibreTime uses to load media |
| `filesize_bytes` | number | File size (bytes) |
| `last_modified_utc` | string | File mtime in naïve UTC (paired with size for quick validation) |
| `checksum` | string | MD5 or SHA1 of the file contents (used only when size/mtime mismatch) |
| `codec` | string | Codec description (e.g. `mp3`) |
| `sample_rate` | number | Sample rate in Hz |
| `mime` | string | MIME type for playback |
| `replay_gain` | number | Replay gain value (null to disable) |
| `fade_in_ms` | number | Fade-in duration in milliseconds |
| `fade_out_ms` | number | Fade-out duration in milliseconds |
| `cue_in_sec` | number | Cue-in offset in seconds |
| `cue_out_sec` | number | Cue-out offset in seconds |
| `track_title` | string | Track title metadata |
| `artist_name` | string | Artist metadata (optional) |
| `show_name` | string | Display name of the show |
| `show_slug` | string | Human-readable slug for audits |
| `libretime_track_id` | string | Optional track ID already known to LibreTime |
| `priority` | number | Future use / tie-breakers |

### Guarantees

- All items are strictly future or currently playing (`start_utc <= now < end_utc` for first item; others in future).
- Timestamps are **naïve UTC** (no `Z` suffix or offsets). Consumer must assert `tzinfo is None` and fail fast on aware values.
- Feed always contains **current item** plus at least one upcoming item with `start_utc - now >= 15 minutes`.
- Files referenced by `uri` exist and metadata (`filesize_bytes`, `last_modified_utc`, `codec`, `sample_rate`) matches reality. Full checksum should only be recomputed when size/mtime mismatches are detected.

## Versioning & Idempotence

- Payload increments `scheduleVersion` atomically per generation.
- Playout applies update only if `scheduleVersion` **strictly greater** than last applied version.
- Client keeps last 5 versions cached for diagnostics/rollback.
- Response includes `ETag` (hash of `scheduleVersion` + canonical items). Clients should send `If-None-Match` to skip unchanged responses (expect 304). Responses should set `Cache-Control: no-store` to prevent intermediary caching.

## Consumer Requirements (LibreTime)

1. Fetch feed with short timeouts, honouring `ETag` (allow up to two quick retries with jitter before failing).
2. Validate:
   - All datetimes have `tzinfo is None` (reject feed immediately otherwise)
   - Quick file metadata check (`filesize_bytes` + `last_modified_utc`); recompute checksum only when a mismatch appears
3. Build new queue off-thread. If any validation fails, abandon update and retain current queue.
4. Atomically replace queue when validation succeeds and version is newer (optionally defer if within ±2s of first start).
5. Log each fetch: `scheduleVersion`, ETag result, reason (`applied`, `etag-304`, `older-version`, `validation-failed`, `boundary-deferral`), `now_utc`, `first.start_utc`, `abs(delta_sec)` (alert if > 2 seconds).

## Fallback Behaviour

- On fetch failure or stale versions, keep current queue and log warning (`remaining version`, `last successful version`, `error`).
- Health monitor remains in alert-only mode for first grace period (e.g. 5 minutes) before escalating, and raises `feed_stale` if `scheduleVersion` is unchanged beyond configured window.

## Boot-Time Checks

- Playout logs machine timezone, Python `datetime.now().tzinfo`, Liquidsoap timezone, and NTP sync status upon startup.

## Validation Plan

- Deploy feed and updated consumer, observe hour boundaries (including long/2-hour shows).
- Success criteria: no `waiting 3599/7199s`, health monitor logs no restarts, and `abs(delta_sec)` remains ≤ 2 seconds.

