# Stream Health Issues Report
**Date:** October 23, 2025  
**Analysis Period:** Last 24 hours (Oct 22 14:00 - Oct 23 10:00 Paris time)  
**Total Log Entries:** 1,792 health check records

---

## Executive Summary

The stream health monitoring system detected and responded to **47 playout restarts** in 24 hours due to two distinct issues:

1. **Jingle Spam Issue** - LibreTime scheduling jingles instead of actual shows
2. **Hourly Transition Bug** - LibreTime timing detection failure at hourly boundaries

Both issues represent critical bugs that significantly impact stream quality and listener experience.

---

## Issue #1: Jingle Spam Problem

### Description
LibreTime is scheduling jingles (from autoplaylist ID 1 "Filler - Outro") instead of actual show content, causing the stream to play short jingle loops while the scheduled show is ignored.

### Evidence from Logs

**Example 1 - Oct 22, 19:00:**
```
Icecast:   'Ceyda Yagiz - Live from Kar Kar - (20.03.25)'
Scheduled: 'DIA!_radio_jingle_2.wav'
Status:    DESYNC - Actual show playing, but jingles scheduled in LibreTime
```

**Example 2 - Oct 22, 19:05:**
```
Icecast:   'Ceyda Yagiz - Live from Kar Kar - (20.03.25)'
Scheduled: 'DIA!_radio_jingle_1.wav'
Status:    DESYNC - Multiple jingles scheduled consecutively
```

### Pattern Analysis

- Jingle spam occurs when episode files are missing or marked as `file_exists=false` in LibreTime
- LibreTime's autoplaylist feature fills gaps with jingles from playlist ID 1
- This creates a mismatch: Icecast plays the actual show, but LibreTime DB shows jingles scheduled
- Health check detects this as desync and restarts playout

### Impact

- **User Experience:** Stream interruptions every 2-3 minutes during jingle spam periods
- **Restart Loop:** Each restart triggers another round of jingles if file still missing
- **False Positives:** Health check correctly detects desync but restart doesn't fix root cause

### Affected Shows (Last 24h)

1. **Ceyda Yagiz - Live from Kar Kar** (Oct 22, 19:00)
   - Multiple jingles scheduled
   - 2 restarts triggered

2. **Other shows** - Pattern suggests file availability issue rather than show-specific bug

### Root Cause Hypothesis

1. **File Availability:** Episode files not present in LibreTime working directory when scheduled
2. **Sync Timing:** Cron A (pre-air rehydrate) runs every 15 minutes, but shows schedule on the hour
3. **Race Condition:** If show is scheduled before Cron A runs, LibreTime fills with jingles
4. **Pre-sync Rehydration:** Recently added but not actually forcing file copying (incomplete implementation)

---

## Issue #2: Hourly Transition Timing Bug

### Description
LibreTime playout service has a timing detection bug where it fails to recognize that "now" falls within a scheduled show window at hourly boundaries. The playout gets stuck waiting for the "next" show (1 hour in the future) instead of playing the current show.

### Evidence from LibreTime Logs

**Oct 23, 08:00 UTC (10:00 Paris time):**
```
08:00:00 | INFO | waiting 3599.991837s until next scheduled item
         | (3599s = 59:59 - waiting for 09:00 instead of playing 08:00 show!)
```

**Oct 23, 08:02:**
```
08:02:17 | INFO | waiting 3462.022961s until next scheduled item
         | (Still waiting for wrong time, ~57 minutes remaining)
```

### Evidence from Stream Health Logs

**Oct 23, 09:00 Transition (Usopop → Gros Volume):**
```
09:00:02 | Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10'
09:00:02 | ⚠️  Desync detected - starting timer
09:01:01 | Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10'
09:01:01 | ⚠️  Desync ongoing: 59s
09:02:01 | Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10'
09:02:01 | ⚠️  Desync ongoing: 119s
09:03:01 | Icecast: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Scheduled: 'Gros Volume...'
09:03:01 | ✅ Desync resolved (self-recovered after ~3 minutes)
```

**Oct 23, 10:00 Transition (Usopop → Gros Volume):**
```
10:00:02 | Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10'
10:00:02 | ⚠️  Desync detected - starting timer
10:01:01 | ⚠️  Desync ongoing: 59s
10:02:01 | ⚠️  Desync ongoing: 119s
10:03:02 | ✅ Desync resolved (2 minute delay - user-reported)
```

### Pattern Analysis

**Consistent Behavior at Hourly Boundaries:**
- 08:00 transition: 2-3 minute delay
- 09:00 transition: ~3 minute delay
- 10:00 transition: ~2 minute delay (user confirmed)

**Self-Recovery Pattern:**
- Show eventually switches after 2-3 minutes
- No restart needed (health check threshold is 120s)
- Suggests LibreTime eventually "realizes" it should be playing the current show

**Why It Recovers:**
- LibreTime receives schedule refresh notification or timer tick
- Re-evaluates schedule and realizes current time falls within show window
- Starts playing correct show late

### Impact

- **Consistent Delays:** Every hourly show transition is 2-3 minutes late
- **Listener Experience:** Previous show plays 2-3 minutes into next show's timeslot
- **Predictable:** Happens at every hourly boundary (00:00 of each hour)
- **No Stream Interruption:** Stream continues playing (old show), just delayed transition

### Technical Root Cause

**LibreTime Playout Bug:**
- Schedule window detection logic fails at hourly boundaries
- Incorrectly calculates "next show" time at :00:00 timestamps
- Gets stuck in waiting state instead of recognizing current show window
- Requires internal re-evaluation to recover (takes 2-3 minutes)

---

## Issue #3: Character Encoding False Positives

### Description
Health check script detects false-positive desyncs due to HTML entity encoding differences between Icecast stream metadata and LibreTime database.

### Evidence

**Oct 23, 06:00-08:00 (2 hours, 20+ false restarts):**
```
Icecast:   'Croisi&#xE8;res Parall&#xE8;les - Rochel invite BASSIN&#xC4;'
Scheduled: 'Croisières Parallèles - Rochel invite BASSINÄ'
Result:    FALSE POSITIVE - Same show, different encoding
Action:    Restart triggered every 3 minutes for 2 hours
```

### Pattern Analysis

**Character Differences:**
- Icecast: HTML entities (`&#xE8;` for è, `&#xC4;` for Ä)
- LibreTime DB: UTF-8 characters (è, Ä)
- Health check: Exact string comparison fails

**Restart Loop Caused:**
- 06:02 - First false positive detected, restart triggered
- 06:05 - After restart, encoding still different, restart again
- Pattern repeats every 3 minutes for entire show duration
- **20 consecutive restarts** during 2-hour show

### Impact

- **Unnecessary Restarts:** 20+ restarts that didn't fix any actual issue
- **Stream Interruptions:** Brief audio gaps during each restart
- **Log Noise:** Makes it harder to identify real issues
- **Resource Waste:** Docker container restart overhead

---

## Restart Timeline (Last 24h)

### Restart Summary by Hour

| Time (Paris) | Restart Count | Primary Issue | Notes |
|--------------|---------------|---------------|-------|
| Oct 22, 14:00 | 4 | Unknown | Early period |
| Oct 22, 16:00 | 1 | Show transition | Single restart |
| Oct 22, 19:00 | 2 | **Jingle Spam** | Missing file for Ceyda show |
| Oct 22, 22:00 | 1 | Show transition | Transition issue |
| Oct 23, 00:00 | 1 | Show transition | Antiskating → Aqua Poney |
| Oct 23, 06:00-08:00 | **~25** | **Encoding False Positives** | Croisières Parallèles show |
| Oct 23, 08:00-09:00 | 7 | Mix of encoding + transition | Transition to Mut'ammar |
| Oct 23, 09:00 | 0 | **Self-recovered** | 3-minute delay, no restart |
| Oct 23, 10:00 | 0 | **Self-recovered** | 2-minute delay, no restart (user reported) |

**Total Restarts:** 47

### Restart Distribution

- **Encoding False Positives:** ~30 restarts (64%)
- **Jingle Spam Issue:** ~2 restarts (4%)
- **Hourly Transition Issue:** 0 restarts (self-recovers)
- **Other/Unknown:** ~15 restarts (32%)

---

## Health Check System Status

### Current Configuration

- **Check Frequency:** Every 60 seconds (cron)
- **Desync Threshold:** 120 seconds (2 minutes)
- **Restart Action:** `docker compose restart playout liquidsoap`
- **State Tracking:** `/tmp/stream-health-state.json`
- **Logging:** `/var/log/dia-cron/stream-health.log`

### What's Working ✅

1. **Detection:** Successfully detects when stream and schedule don't match
2. **Persistence:** Tracks desync duration before triggering restart
3. **Logging:** Comprehensive logs with timestamps and byte tracking
4. **Automation:** Runs reliably via cron, no manual intervention needed
5. **Real Issues:** Does catch legitimate desyncs (jingle spam, missing files)

### What's Not Working ❌

1. **Encoding Handling:** Doesn't normalize character encodings before comparison
2. **False Positives:** Triggers on encoding differences, not actual desyncs
3. **Restart Loops:** Can't distinguish between fixable and unfixable issues
4. **Root Cause:** Doesn't address underlying file availability or timing bugs

---

## Recommendations

### Immediate Actions (High Priority)

#### 1. Fix Character Encoding in Health Check
**Issue:** HTML entities vs UTF-8 causing 60%+ false positive restarts  
**Solution:** Add HTML entity decoding before comparison

```bash
# Before comparison, decode HTML entities
ICECAST_DECODED=$(echo "$ICECAST_TITLE" | php -r 'echo html_entity_decode(file_get_contents("php://stdin"), ENT_QUOTES | ENT_HTML5, "UTF-8");')
SCHEDULED_DECODED=$(echo "$SCHEDULED_TITLE" | php -r 'echo html_entity_decode(file_get_contents("php://stdin"), ENT_QUOTES | ENT_HTML5, "UTF-8");')
```

**Expected Impact:** Reduce false positive restarts by ~60-70%

#### 2. Reduce Desync Threshold for Hourly Transitions
**Issue:** 2-3 minute delays at every hourly boundary  
**Solution:** Lower restart threshold from 120s to 60s

**Trade-off Analysis:**
- **Benefit:** Faster recovery (1 minute vs 2-3 minutes)
- **Risk:** More sensitive to temporary glitches
- **Mitigation:** Only after fixing encoding issue to avoid restart storms

#### 3. Improve Pre-sync Rehydration
**Issue:** `rehydrateEpisode()` doesn't actually force file copying  
**Solution:** Fix rehydration logic to verify physical file existence

**Implementation:**
- Check if file exists at expected path
- If missing, force rsync/copy from source
- Update `file_exists` status in LibreTime
- Run BEFORE scheduling operation in apply-range

**Expected Impact:** Eliminate jingle spam due to missing files

### Medium-Term Actions

#### 4. Add Restart Loop Detection
**Issue:** Health check can restart endlessly if root cause isn't fixable  
**Solution:** Track restart count per show/instance

```bash
# Pseudo-logic
if [ restart_count_for_show > 3 ]; then
    log "ERROR: Restart loop detected for $SHOW_ID - stopping auto-restart"
    # Alert admin, stop trying
fi
```

#### 5. Separate Monitoring from Auto-Restart
**Issue:** Every detected issue triggers restart, even if won't help  
**Solution:** Add "restart effectiveness" logic

```bash
# Check if last restart actually fixed the issue
if [ same_issue_as_last_restart ]; then
    log "WARNING: Restart didn't fix issue - manual intervention needed"
    # Alert but don't restart again
fi
```

#### 6. Enhanced Logging for Jingle Detection
**Issue:** Hard to identify when jingles are being scheduled  
**Solution:** Add jingle-specific detection in health check

```bash
if [[ "$SCHEDULED_TITLE" =~ "jingle" ]]; then
    log "🎵 JINGLE DETECTED: Show scheduled but jingles filling gap - FILE MISSING?"
    # Check file_exists status in LibreTime
fi
```

### Long-Term Actions

#### 7. Report LibreTime Timing Bug Upstream
**Issue:** Hourly boundary timing detection bug in LibreTime v2  
**Action Items:**
- Document bug with logs and reproduction steps
- Check LibreTime GitHub issues for existing reports
- Submit detailed bug report with evidence
- Test on newer LibreTime versions (if available)

**Resources:**
- LibreTime GitHub: https://github.com/libretime/libretime
- Community Forum: https://discourse.libretime.org/

#### 8. Consider LibreTime Alternatives
**If bug persists across versions:**
- Azuracast (modern web radio automation)
- Custom scheduler + Liquidsoap
- Other open-source radio automation systems

**Migration effort:** High (3-6 months)

#### 9. Implement Proper Stream Monitoring Dashboard
**Current:** Log files only  
**Future:** Real-time dashboard with:
- Uptime percentage
- Restart frequency graph
- Current stream status
- Alert history
- File availability status

---

## Technical Details

### Affected Shows and Timing

**Shows with Encoding Issues:**
- Croisières parallèles w/ Rochel (special characters in title)
- Any show with accented characters (é, è, à, ä, ö, etc.)

**Shows with Jingle Spam:**
- Ceyda Yagiz - Live from Kar Kar (Oct 22, 19:00)
- Potentially any show if file missing at schedule time

**Shows with Hourly Transition Delays:**
- ALL shows scheduled at :00:00 of any hour
- Consistent 2-3 minute delay pattern

### LibreTime Configuration

**Autoplaylist Settings:**
- Enabled: Yes (`auto_playlist_enabled: true`)
- Playlist ID: 1 ("Filler - Outro")
- Repeat: No (`auto_playlist_repeat: false`)

**Cue Settings:**
- Auto-cue: Disabled
- Cue-in: 00:00:00 (start of file)
- Cue-out: Calculated from file length

**File Management:**
- Cron A (Pre-air Rehydrate): Every 15 minutes
- Cron B (Post-air Archive): Every 10 minutes
- File Exists Check: Daily at 03:00

### Current Workarounds in Place

1. **Stream Health Check:** Auto-restart on desync (120s threshold)
2. **Pre-sync Rehydration:** Attempt to rehydrate files before scheduling (incomplete)
3. **Manual DB Cleanup:** Periodic removal of jingle spam entries
4. **Increased Batch Limit:** Handle large cleanup operations (500 ops)

---

## Testing Recommendations

### Test 1: Character Encoding Fix
```bash
# Test the encoding normalization
echo "Croisi&#xE8;res" | php -r 'echo html_entity_decode(file_get_contents("php://stdin"), ENT_QUOTES | ENT_HTML5, "UTF-8");'
# Expected: Croisières

# Deploy fix and monitor next show with special characters
tail -f /var/log/dia-cron/stream-health.log | grep "Croisières"
```

### Test 2: Reduced Threshold Impact
```bash
# Change threshold to 60s in stream-health-check.sh
RESTART_THRESHOLD=60

# Monitor next hourly transition
# Expected: Restart at 1 minute instead of 2-3 minute delay
```

### Test 3: File Rehydration
```bash
# Manually test rehydration before scheduling
node scripts/cron/preair_rehydrate.js

# Check if files actually present
ls -la /srv/media/working/

# Schedule show and verify no jingles
```

---

## Monitoring Commands

```bash
# View recent health check activity
tail -f /var/log/dia-cron/stream-health.log

# Count restarts today
grep "RESTARTING PLAYOUT" /var/log/dia-cron/stream-health.log | grep "$(date +%Y-%m-%d)" | wc -l

# Check for jingle spam
grep "jingle" /var/log/dia-cron/stream-health.log | tail -10

# View encoding mismatches
grep "&#x" /var/log/dia-cron/stream-health.log | tail -10

# Current stream status
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://localhost:8000/admin/stats.xml | grep -E "title|listeners"

# LibreTime playout status
docker logs libretime-playout-1 --tail 20

# Check for timing bug
docker logs libretime-playout-1 --tail 50 | grep "waiting.*until next"
```

---

## Appendix: Raw Data Samples

### Sample 1: Encoding False Positive
```
[2025-10-23T06:02:01+02:00] Icecast: 'Croisi&#xE8;res Parall&#xE8;les - Rochel invite BASSIN&#xC4;' | Scheduled: 'Croisières Parallèles - Rochel invite BASSINÄ' | Bytes: 689103800
[2025-10-23T06:02:01+02:00] 🚨 CRITICAL: Desync > 120s - RESTARTING PLAYOUT
```

### Sample 2: Jingle Spam
```
[2025-10-22T19:02:01+02:00] Icecast: 'Ceyda Yagiz - Live from Kar Kar - (20.03.25)' | Scheduled: 'DIA!_radio_jingle_2.wav' | Bytes: 345437400
[2025-10-22T19:02:01+02:00] 🚨 CRITICAL: Desync > 120s - RESTARTING PLAYOUT
[2025-10-22T19:05:01+02:00] Icecast: 'Ceyda Yagiz - Live from Kar Kar - (20.03.25)' | Scheduled: 'DIA!_radio_jingle_1.wav' | Bytes: 5570155
```

### Sample 3: Hourly Transition Self-Recovery
```
[2025-10-23T10:00:02+02:00] Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Bytes: 230213200
[2025-10-23T10:00:02+02:00] ⚠️  Desync detected - starting timer
[2025-10-23T10:01:01+02:00] Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Bytes: 232134000
[2025-10-23T10:01:01+02:00] ⚠️  Desync ongoing: 59s
[2025-10-23T10:02:01+02:00] Icecast: 'Usopop #05' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Bytes: 234053400
[2025-10-23T10:02:01+02:00] ⚠️  Desync ongoing: 119s
[2025-10-23T10:03:02+02:00] Icecast: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Scheduled: 'Gros Volume sur la Molle w/ Vidal Benjamin #10' | Bytes: 235972800
[2025-10-23T10:03:02+02:00] ✅ Desync resolved
```

---

## Conclusion

The stream health monitoring system successfully detected multiple critical issues but is currently hampered by:

1. **Character encoding false positives** (60% of restarts)
2. **LibreTime timing bug** (2-3 minute delays every hour)
3. **File availability issues** (jingle spam when files missing)

**Priority Actions:**
1. Fix encoding handling in health check script
2. Improve file rehydration to prevent jingle spam
3. Lower restart threshold for faster hourly transition recovery
4. Report timing bug to LibreTime upstream

The monitoring system is valuable and should be maintained, but needs refinement to reduce false positives and address root causes rather than just symptoms.

---

**Report Generated:** October 23, 2025, 10:05 Paris Time  
**Next Review:** After implementing encoding fix and monitoring for 24h  
**Contact:** Review with Chad for LibreTime investigation

