# Stream Health Issues - Quick Summary

**Date:** October 23, 2025  
**Period:** Last 24 hours  
**Total Restarts:** 47

---

## 🔴 Critical Issues

### Issue #1: Jingle Spam
**What:** LibreTime schedules jingles instead of actual shows  
**When:** When episode files missing from working directory  
**Impact:** Stream plays jingles in loop, restarts every 2-3 minutes  
**Example:**
```
Expected: Ceyda Yagiz - Live from Kar Kar
Got:      DIA!_radio_jingle_2.wav (repeated)
```

**Root Cause:** File not available when scheduled → autoplaylist fills with jingles

---

### Issue #2: Hourly Transition Bug
**What:** LibreTime doesn't recognize current show at hourly boundaries  
**When:** Every :00:00 transition (08:00, 09:00, 10:00, etc.)  
**Impact:** 2-3 minute delay switching to next show  
**Example:**
```
10:00:00 - Gros Volume should start
10:00:02 - Still playing Usopop #05 
10:02:01 - Still playing Usopop #05 (2 minutes late!)
10:03:02 - Finally switches to Gros Volume
```

**Root Cause:** LibreTime playout timing detection bug
```
LibreTime log: "waiting 3599s until next scheduled item"
Translation: Waiting 1 hour instead of playing current show!
```

---

### Issue #3: Character Encoding False Positives
**What:** Health check detects false desyncs due to encoding  
**When:** Shows with special characters (é, è, à, ä, etc.)  
**Impact:** 20+ unnecessary restarts during single 2-hour show  
**Example:**
```
Icecast:   'Croisi&#xE8;res Parall&#xE8;les...'
Expected:  'Croisières Parallèles...'
Result:    FALSE POSITIVE (same show, different encoding)
```

**Root Cause:** HTML entities vs UTF-8 comparison mismatch

---

## 📊 Impact Analysis

| Issue | Restart Count | % of Total | User Impact |
|-------|--------------|-----------|-------------|
| Encoding False Positives | ~30 | 64% | Brief interruptions |
| Hourly Transition Bug | 0 | 0% | 2-3 min delays |
| Jingle Spam | ~2 | 4% | Major disruption |
| Other | ~15 | 32% | Various |

**Total:** 47 restarts in 24 hours

---

## ✅ Quick Fixes

### 1. Fix Encoding (Highest Impact)
- Decode HTML entities before comparison
- Reduce false positives by 60-70%
- Implementation time: 30 minutes

### 2. Reduce Threshold (Fix Timing Bug Impact)
- Lower from 120s → 60s
- Faster recovery from hourly delays (1min vs 2-3min)
- Implementation time: 5 minutes

### 3. Fix Rehydration (Prevent Jingle Spam)
- Make `rehydrateEpisode()` actually verify files
- Run before scheduling operations
- Implementation time: 2-3 hours

---

## 🔧 Commands for Investigation

```bash
# Watch health check in real-time
tail -f /var/log/dia-cron/stream-health.log

# Count today's restarts
grep "RESTARTING" /var/log/dia-cron/stream-health.log | grep "$(date +%Y-%m-%d)" | wc -l

# Check for jingles in schedule
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c "SELECT COUNT(*) FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id WHERE f.track_title LIKE '%jingle%' AND s.starts > NOW();"

# Check LibreTime timing bug
docker logs libretime-playout-1 --tail 50 | grep "waiting.*until next"

# View encoding mismatches
grep "&#x" /var/log/dia-cron/stream-health.log | tail -5
```

---

## 📋 Next Steps with Chad

1. **Review LibreTime configuration** - Check autoplaylist and timing settings
2. **Investigate timing bug** - Check if LibreTime has patches/updates
3. **Test file rehydration** - Verify Cron A actually copies files
4. **Consider threshold tuning** - Balance between false positives and quick recovery

---

## 📁 Related Files

- **Full Report:** `/srv/payload/docs/STREAM_HEALTH_ISSUES_REPORT.md`
- **Health Check Script:** `/srv/payload/scripts/stream-health-check.sh`
- **Health Check Logs:** `/var/log/dia-cron/stream-health.log`
- **Monitoring Docs:** `/srv/payload/docs/STREAM_HEALTH_MONITORING.md`

---

**For Chad:** Check full report (`STREAM_HEALTH_ISSUES_REPORT.md`) for detailed analysis, evidence, and recommendations.

