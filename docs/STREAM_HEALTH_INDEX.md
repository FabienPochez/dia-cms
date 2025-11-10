# Stream Health Investigation Pack

**Created:** October 23, 2025  
**Purpose:** Documentation for investigating LibreTime stream issues with Chad  
**Analysis Period:** Last 24 hours (Oct 22-23, 2025)

---

## 📋 Quick Start

**Start here:** [`STREAM_HEALTH_SUMMARY.md`](./STREAM_HEALTH_SUMMARY.md) - 2-minute read

**Then review:**
1. [`STREAM_HEALTH_TIMELINE.txt`](./STREAM_HEALTH_TIMELINE.txt) - Visual timeline
2. [`STREAM_HEALTH_ISSUES_REPORT.md`](./STREAM_HEALTH_ISSUES_REPORT.md) - Full analysis
3. [`STREAM_HEALTH_MONITORING.md`](./STREAM_HEALTH_MONITORING.md) - Original monitoring docs

---

## 🎯 Key Findings

### Three Critical Issues Identified:

1. **Jingle Spam** (4% of issues)
   - LibreTime schedules jingles instead of shows
   - Caused by missing files in working directory
   - Autoplaylist fills gaps with jingles

2. **Hourly Timing Bug** (Every :00:00 transition)
   - LibreTime doesn't recognize current show at hourly boundaries
   - 2-3 minute delays at every hour transition
   - Self-recovers without restart

3. **Character Encoding False Positives** (64% of issues!)
   - Health check compares HTML entities vs UTF-8
   - Triggers 25+ restarts for 2-hour show with accents
   - "Croisières Parallèles" example

---

## 📊 By the Numbers

- **Total Restarts:** 47 in 24 hours
- **Worst Period:** 06:00-08:00 (25+ restarts)
- **Best Period:** 01:00-05:00 (4 hours stable)
- **False Positives:** ~64% (encoding issue)
- **Hourly Delays:** 100% consistent (every :00:00)

---

## 🔧 Investigation Checklist for Chad

### LibreTime Configuration
- [ ] Check autoplaylist settings (currently enabled with playlist ID 1)
- [ ] Review timing detection logic at hourly boundaries
- [ ] Verify file_exists status for recent episodes
- [ ] Check LibreTime version and available updates

### Jingle Spam
- [ ] Test Cron A (pre-air rehydrate) - does it actually copy files?
- [ ] Review `rehydrateEpisode()` implementation
- [ ] Check timing: Cron A runs every 15min, shows schedule on :00
- [ ] Consider running rehydration before every schedule operation

### Timing Bug
- [ ] Search LibreTime GitHub for similar issues
- [ ] Check if newer versions have fix
- [ ] Review playout logs for pattern at hourly boundaries
- [ ] Test if reducing health check threshold helps (120s → 60s)

### Health Check Improvements
- [ ] Add HTML entity decoding before title comparison
- [ ] Implement restart loop detection
- [ ] Add jingle-specific alerts
- [ ] Consider separating monitoring from auto-restart

---

## 📁 Document Guide

### [`STREAM_HEALTH_SUMMARY.md`](./STREAM_HEALTH_SUMMARY.md)
**Purpose:** Executive summary for quick reference  
**Length:** ~250 lines  
**Contains:**
- Issue descriptions with examples
- Impact analysis table
- Quick fix recommendations
- Investigation commands

### [`STREAM_HEALTH_ISSUES_REPORT.md`](./STREAM_HEALTH_ISSUES_REPORT.md)
**Purpose:** Comprehensive technical analysis  
**Length:** ~550 lines  
**Contains:**
- Detailed evidence from logs
- Pattern analysis for each issue
- Root cause hypotheses
- Short/medium/long-term recommendations
- Testing procedures
- Raw data samples

### [`STREAM_HEALTH_TIMELINE.txt`](./STREAM_HEALTH_TIMELINE.txt)
**Purpose:** Visual representation of 24h period  
**Length:** ~90 lines  
**Contains:**
- Hour-by-hour timeline
- Issue markers (restarts, jingles, timing bugs)
- Critical periods highlighted
- Next transitions to watch

### [`STREAM_HEALTH_MONITORING.md`](./STREAM_HEALTH_MONITORING.md)
**Purpose:** Original monitoring system documentation  
**Length:** ~190 lines  
**Contains:**
- Problem summary from previous investigation
- Root cause analysis of LibreTime bug
- Health check implementation details
- Configuration audit results
- Monitoring commands

---

## 🚀 Immediate Actions (Priority Order)

1. **Fix character encoding** (~30 min)
   - Add HTML entity decoding to health check script
   - Expected impact: -60% false positive restarts

2. **Test file rehydration** (~2-3 hours)
   - Verify `rehydrateEpisode()` actually copies files
   - Add physical file existence check
   - Expected impact: Eliminate jingle spam

3. **Reduce restart threshold** (~5 min)
   - Change from 120s to 60s
   - Expected impact: Faster recovery from timing bug (1min vs 2-3min)

---

## 📞 Commands for Live Debugging

```bash
# Monitor health check in real-time
tail -f /var/log/dia-cron/stream-health.log

# Check current stream vs schedule
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://localhost:8000/admin/stats.xml | grep title

# Check LibreTime timing bug
docker logs libretime-playout-1 --tail 50 | grep "waiting.*until next"

# Count jingles in schedule
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT COUNT(*) FROM cc_schedule s JOIN cc_files f ON s.file_id = f.id 
   WHERE f.track_title LIKE '%jingle%' AND s.starts > NOW();"

# View recent restarts
grep "RESTARTING" /var/log/dia-cron/stream-health.log | tail -5
```

---

## 📝 Notes for Investigation

### Timing Bug Evidence
```
LibreTime Log: "waiting 3599.991837s until next scheduled item"
Translation: Waiting ~1 hour instead of playing current show
Pattern: Happens at every :00:00 boundary
Recovery: Self-recovers after 2-3 minutes
```

### Jingle Spam Evidence
```
Expected: Ceyda Yagiz - Live from Kar Kar - (20.03.25)
Got:      DIA!_radio_jingle_2.wav
Cause:    file_exists=false in LibreTime
```

### Encoding Bug Evidence
```
Icecast:   'Croisi&#xE8;res Parall&#xE8;les - Rochel invite BASSIN&#xC4;'
Expected:  'Croisières Parallèles - Rochel invite BASSINÄ'
Issue:     HTML entities vs UTF-8 comparison fails
```

---

## 🔗 Related Resources

- **LibreTime GitHub:** https://github.com/libretime/libretime
- **LibreTime Forum:** https://discourse.libretime.org/
- **Health Check Script:** `/srv/payload/scripts/stream-health-check.sh`
- **Health Check Logs:** `/var/log/dia-cron/stream-health.log`
- **Cron A Script:** `/srv/payload/scripts/cron/preair_rehydrate.ts`

---

## ✅ Next Steps

1. **Review with Chad** - Go through summary and timeline
2. **Prioritize fixes** - Start with encoding (biggest impact)
3. **Test solutions** - Monitor next 24h after each fix
4. **Document results** - Update this pack with findings
5. **Consider upstream** - Report LibreTime bug if confirmed

---

**Status:** Ready for investigation  
**Last Updated:** October 23, 2025, 10:10 Paris Time  
**Prepared by:** AI Assistant + User analysis  
**Next Review:** After implementing fixes and monitoring

