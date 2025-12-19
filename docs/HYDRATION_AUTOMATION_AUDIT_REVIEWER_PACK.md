# Archive Hydration Automation Audit — Reviewer Pack

**Date**: 2025-01-XX  
**Auditor**: AI Assistant  
**Scope**: Audit existing archive hydration tooling for ongoing automation support

---

## 1. SUMMARY

- **Archive pipeline uses 4 scripts**: `import-batch-archives-media.ts` (import + hydrate), `batch_rsync_hydrate.sh` (transfer), `hydrate-archive-paths.ts` (archive paths), `cleanup-imported-files.ts` (cleanup)
- **Current workflow is manual**: Step 2 triggers import, Step 2-bis re-runs to poll/hydrate after LibreTime finishes (~10-20 min wait)
- **`import-batch-archives-media.ts` has two modes**: (1) bulk import trigger (if files missing in LT), (2) hydration-only (single API call, no polling)
- **No polling in batch mode**: `hydrateAllEpisodes()` uses `findLibreTimeFileByPrefix()` (single API call); `pollLibreTimeFiles()` exists but unused
- **Script is NOT fully idempotent**: Hardcoded `/srv/media/tracks` directory; no graceful exit if LT still analyzing; no skip logic for already-processed files
- **Episode matching uses filename prefix**: Extracts `episodeId` from `{episodeId}__*.mp3` pattern; matches LT files via API search
- **Data model**: `import-batch-archives-media.ts` sets `libretimeTrackId` + `libretimeFilepathRelative`; `hydrate-archive-paths.ts` sets `hasArchiveFile` + `archiveFilePath`
- **Reuse opportunity**: Scripts already support multiple directories via CLI args; minimal change to accept `/srv/media/new` and `/srv/media/live-inbox`
- **Cron readiness gaps**: No graceful timeout handling; no state tracking for "in progress" items; no skip logic for already-processed files
- **Recommendation**: Option B (wrapper script) - keeps archive script stable, clear separation, easier testing

---

## 2. DIFFS

**No code changes proposed in audit phase.**

Implementation diffs will be provided after option selection. See Section 7 (Implementation Options) in `HYDRATION_AUTOMATION_AUDIT.md` for proposed changes.

---

## 3. LOGS

**No logs generated in audit phase.**

---

## 4. QUESTIONS & RISKS

### Questions

1. **LibreTime file organization**: After importing from `/srv/media/new`, where does LibreTime place files? Same as `/srv/media/tracks` → `/srv/media/imported/1/`? Or different location?

2. **Cleanup target**: For new automation, should cleanup delete from `/srv/media/new` (original location) or `/srv/media/imported/1/` (LibreTime-organized location)?

3. **Archive bucket strategy**: Should `/srv/media/new` and `/srv/media/live-inbox` use same monthly bucket strategy (`YYYY-MM/`) or separate buckets?

4. **Cron frequency**: User mentioned "1-2x/day" - should script process all files in directory each run, or only new files since last run?

5. **Concurrent execution**: Can script run while archive pipeline is running? Lockfile prevents concurrent bulk imports, but hydration could conflict.

6. **Error handling**: If archive transfer fails for some files, should script continue to hydration step or exit?

7. **Monitoring**: How should "pending" episodes (LT still analyzing) be tracked? Log file? Payload field?

8. **Backward compatibility**: Will adding `--directory` arg break any existing cron jobs or scripts that call `import-batch-archives-media.ts`?

### Risks

1. **Medium**: Modifying `import-batch-archives-media.ts` could break existing archive workflow if not careful with backward compatibility
2. **Low**: Adding polling/timeout logic increases script complexity and potential failure modes
3. **Low**: Subprocess orchestration in wrapper script adds execution overhead and error handling complexity
4. **Low**: Directory flexibility may expose bugs if LibreTime handles `/srv/media/new` differently than `/srv/media/tracks`

---

## Detailed Audit Report

See `HYDRATION_AUTOMATION_AUDIT.md` for complete analysis including:
- Full script inventory with entrypoints and args
- Deep dive on `import-batch-archives-media.ts` modes and matching logic
- Data model touch points and field dependencies
- Cron readiness analysis
- Two implementation options with risk assessment

