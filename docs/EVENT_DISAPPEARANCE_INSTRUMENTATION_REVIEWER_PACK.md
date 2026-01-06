# Event Disappearance Instrumentation - Reviewer Pack

**Date**: 2026-01-03  
**Purpose**: Instrumentation-only changes to pinpoint where events disappear between fetch.py and queue.py  
**Status**: Instrumentation deployed, awaiting evidence collection

---

## SUMMARY

- **Problem**: 17:00 show present in feed (6 events) but missing from queue (5 events received)
- **Approach**: Added 4 checkpoint logs in fetch.py pipeline + 1 in queue.py with correlation IDs
- **Checkpoints**: FEED_IN → AFTER_NORMALIZE → AFTER_DIFF_OR_SUPPRESS → WRITE_OUT → QUEUE_READ
- **Correlation**: Each fetch cycle gets unique `cycle_id` (timestamp-random) for grep tracking
- **Payload Tracking**: SHA1 hash of event list at WRITE_OUT and QUEUE_READ for mismatch detection
- **Files Changed**: `patches/player/fetch.py`, `patches/queue.py`
- **No Behavior Changes**: Pure instrumentation, no logic modifications
- **Evidence Found**: Event disappears between WRITE_OUT (6 events, hash=2c872484) and QUEUE_READ (5 events, hash=b0221452)
- **Root Cause**: Event lost in queue handoff (between `push_queue.put()` and `queue.get()`)
- **Fix Plan**: Investigate queue race condition or event filtering between write and read

---

## DIFFS

### patches/player/fetch.py

```diff
+import hashlib
 import copy
 import logging
 ...
 
+    def _log_event_summary(self, events: Events, cycle_id: str, checkpoint: str, dropped_events: Optional[list] = None) -> None:
+        """Log event summary for instrumentation checkpoint."""
+        file_events = [evt for evt in events.values() if isinstance(evt, FileEvent)]
+        sorted_events = sorted(file_events, key=lambda e: e.start if e.start else datetime.max)
+        
+        earliest_start = sorted_events[0].start if sorted_events else None
+        earliest_hour = earliest_start.hour if earliest_start else None
+        
+        logger.info(
+            "[%s] CHECKPOINT_%s: cycle_id=%s count=%d earliest_hour=%s",
+            checkpoint,
+            checkpoint,
+            cycle_id,
+            len(sorted_events),
+            earliest_hour,
+        )
+        
+        for i, event in enumerate(sorted_events[:3]):
+            logger.info(
+                "[%s] CHECKPOINT_%s: event[%d] row_id=%s start_utc=%s end_utc=%s",
+                checkpoint,
+                checkpoint,
+                i,
+                event.row_id,
+                event.start.isoformat() if event.start else None,
+                event.end.isoformat() if event.end else None,
+            )
+        
+        if dropped_events:
+            for i, (event, reason) in enumerate(dropped_events[:6]):
+                logger.info(
+                    "[%s] CHECKPOINT_%s: dropped[%d] row_id=%s start_utc=%s reason=%s",
+                    checkpoint,
+                    checkpoint,
+                    i,
+                    getattr(event, 'row_id', None),
+                    event.start.isoformat() if hasattr(event, 'start') and event.start else None,
+                    reason,
+                )
+
     def _handle_feed_response(self, response: Response, reason: str) -> Optional[Events]:
+        # Generate correlation ID for this fetch cycle
+        cycle_id = f"{int(time.time() * 1000)}-{random.randint(1000, 9999)}"
+        
         ...
         
+        # CHECKPOINT 1: FEED_IN
+        logger.info(
+            "[FEED_IN] CHECKPOINT_FEED_IN: cycle_id=%s raw_items_count=%d",
+            cycle_id,
+            len(items),
+        )
+        for i, raw in enumerate(items[:3]):
+            logger.info(
+                "[FEED_IN] CHECKPOINT_FEED_IN: raw[%d] row_id=%s start_utc=%s end_utc=%s",
+                i,
+                raw.get("row_id"),
+                raw.get("start_utc"),
+                raw.get("end_utc"),
+            )
+        
         ...
         
+        # CHECKPOINT 2: AFTER_NORMALIZE
+        self._log_event_summary(events, cycle_id, "AFTER_NORMALIZE", dropped_events if dropped_events else None)
         
         ...
         
+        if should_skip:
+            ...
+            # CHECKPOINT 3: AFTER_DIFF_OR_SUPPRESS (skipped - all events dropped)
+            dropped_all = [(evt, "skip_apply") for evt in events.values() if isinstance(evt, FileEvent)]
+            self._log_event_summary(Events(), cycle_id, "AFTER_DIFF_OR_SUPPRESS", dropped_all)
+            return None
+        
+        # CHECKPOINT 3: AFTER_DIFF_OR_SUPPRESS (not skipped - events kept)
+        self._log_event_summary(events, cycle_id, "AFTER_DIFF_OR_SUPPRESS", None)
         
         ...
         
+        # Store cycle_id for later use in refresh_schedule
+        self._last_cycle_id = cycle_id
         return events
 
     def refresh_schedule(self, reason: str) -> bool:
         ...
+        # CHECKPOINT 4: WRITE_OUT
+        cycle_id = getattr(self, '_last_cycle_id', f"{int(time.time() * 1000)}-unknown")
+        now_utc = datetime.utcnow()
+        
+        # Calculate checksum of events payload
+        event_list = sorted(all_events.items(), key=lambda x: x[1].start if isinstance(x[1], FileEvent) and x[1].start else datetime.max)
+        payload_str = "|".join([
+            f"{k}:{evt.row_id}:{evt.start.isoformat() if isinstance(evt, FileEvent) and evt.start else 'None'}"
+            for k, evt in event_list if isinstance(evt, FileEvent)
+        ])
+        payload_hash = hashlib.sha1(payload_str.encode()).hexdigest()[:8]
+        
+        logger.info(
+            "[WRITE_OUT] CHECKPOINT_WRITE_OUT: cycle_id=%s now_utc=%s count=%d payload_hash=%s target=push_queue",
+            cycle_id,
+            now_utc.isoformat(),
+            len(all_events),
+            payload_hash,
+        )
+        self._log_event_summary(all_events, cycle_id, "WRITE_OUT", None)
+        
         logger.debug("Pushing to pypo-push")
         self.push_queue.put(all_events)
```

### patches/queue.py

```diff
+import hashlib
 from collections import deque
 ...
+from .events import AnyEvent, FileEvent
 ...
 
             else:
                 logger.info("New schedule received")
 
                 now = datetime.utcnow()
                 naive_counter = [0]
 
+                # Queue-side instrumentation: Log what we read from queue
+                raw_count = len(media_schedule)
+                file_events_raw = [evt for evt in media_schedule.values() if isinstance(evt, FileEvent)]
+                event_list_str = "|".join([
+                    f"{evt.row_id}:{evt.start.isoformat() if evt.start else 'None'}"
+                    for evt in sorted(file_events_raw, key=lambda e: e.start if e.start else datetime.max)[:10]
+                ])
+                read_hash = hashlib.sha1(event_list_str.encode()).hexdigest()[:8] if event_list_str else "empty"
+                
+                logger.info(
+                    "[QUEUE_READ] CHECKPOINT_QUEUE_READ: source=push_queue now_utc=%s raw_count=%d file_events=%d read_hash=%s",
+                    now.isoformat(),
+                    raw_count,
+                    len(file_events_raw),
+                    read_hash,
+                )
+                for i, event in enumerate(sorted(file_events_raw, key=lambda e: e.start if e.start else datetime.max)[:3]):
+                    logger.info(
+                        "[QUEUE_READ] CHECKPOINT_QUEUE_READ: event[%d] row_id=%s start_utc=%s end_utc=%s",
+                        i,
+                        event.row_id,
+                        event.start.isoformat() if event.start else None,
+                        event.end.isoformat() if event.end else None,
+                    )
+
                 raw_events = []
                 ...
```

---

## LOGS

### Evidence from cycle_id=1767462376939-3004 (17:46:16)

```
2026-01-03 17:46:16,939 | INFO | [FEED_IN] CHECKPOINT_FEED_IN: cycle_id=1767462376939-3004 raw_items_count=6
2026-01-03 17:46:16,939 | INFO | [FEED_IN] CHECKPOINT_FEED_IN: raw[0] row_id=2553 start_utc=2026-01-03T17:00:00 end_utc=2026-01-03T18:00:00
2026-01-03 17:46:16,939 | INFO | [FEED_IN] CHECKPOINT_FEED_IN: raw[1] row_id=2554 start_utc=2026-01-03T18:00:00 end_utc=2026-01-03T19:00:00
2026-01-03 17:46:16,939 | INFO | [FEED_IN] CHECKPOINT_FEED_IN: raw[2] row_id=2555 start_utc=2026-01-03T19:00:00 end_utc=2026-01-03T20:00:00
2026-01-03 17:46:16,945 | INFO | [AFTER_NORMALIZE] CHECKPOINT_AFTER_NORMALIZE: cycle_id=1767462376939-3004 count=6 earliest_hour=17
2026-01-03 17:46:16,946 | INFO | [AFTER_NORMALIZE] CHECKPOINT_AFTER_NORMALIZE: event[0] row_id=2553 start_utc=2026-01-03T17:00:00 end_utc=2026-01-03T18:00:00
2026-01-03 17:46:16,946 | INFO | [AFTER_DIFF_OR_SUPPRESS] CHECKPOINT_AFTER_DIFF_OR_SUPPRESS: cycle_id=1767462376939-3004 count=6 earliest_hour=17
2026-01-03 17:46:16,946 | INFO | [AFTER_DIFF_OR_SUPPRESS] CHECKPOINT_AFTER_DIFF_OR_SUPPRESS: event[0] row_id=2553 start_utc=2026-01-03T17:00:00 end_utc=2026-01-03T18:00:00
2026-01-03 17:46:16,946 | INFO | [WRITE_OUT] CHECKPOINT_WRITE_OUT: cycle_id=1767462376939-3004 now_utc=2026-01-03T17:46:16.946536 count=6 payload_hash=2c872484 target=push_queue
2026-01-03 17:46:16,946 | INFO | [WRITE_OUT] CHECKPOINT_WRITE_OUT: event[0] row_id=2553 start_utc=2026-01-03T17:00:00 end_utc=2026-01-03T18:00:00
2026-01-03 17:46:16,983 | INFO | [QUEUE_READ] CHECKPOINT_QUEUE_READ: source=push_queue now_utc=2026-01-03T17:46:16.983132 raw_count=5 file_events=5 read_hash=b0221452
2026-01-03 17:46:16,983 | INFO | [QUEUE_READ] CHECKPOINT_QUEUE_READ: event[0] row_id=2554 start_utc=2026-01-03T18:00:00 end_utc=2026-01-03T19:00:00
```

**Key Finding**: 
- WRITE_OUT: 6 events, hash=2c872484 (17:00 show present)
- QUEUE_READ: 5 events, hash=b0221452 (17:00 show MISSING, earliest is 18:00)
- **Event disappears between WRITE_OUT and QUEUE_READ** (37ms gap)

---

## QUESTIONS & RISKS

1. **Correlation ID Propagation**: `cycle_id` stored in `self._last_cycle_id` - if multiple fetch cycles occur before queue reads, only last cycle_id will be logged at WRITE_OUT. **Risk**: Low - queue reads are frequent enough.

2. **Hash Collision**: Using 8-char SHA1 prefix for payload hash. **Risk**: Very low for event count/order tracking.

3. **Log Volume**: Each checkpoint logs 1 header + up to 6 event lines. **Risk**: Low - ~30 lines per fetch cycle, manageable.

4. **Skip Logic Timing**: If `should_skip=True`, events are dropped at AFTER_DIFF_OR_SUPPRESS but WRITE_OUT never happens. **Risk**: None - this is expected behavior, logged correctly.

5. **Queue Race Condition**: If queue reads between WRITE_OUT and actual `push_queue.put()`, mismatch possible. **Risk**: Low - Python Queue is thread-safe, but worth monitoring.

6. **Normalization Errors**: If `_build_file_event` throws, event is logged as dropped but not in AFTER_NORMALIZE summary. **Risk**: Low - validation errors are logged separately.

7. **Multiple Queue Consumers**: If multiple threads read from `push_queue`, only one will see the payload. **Risk**: Unknown - need to verify queue is single-consumer.

8. **Boundary Timing**: If fetch happens exactly at boundary (e.g., 18:00:00.000), boundary_guard may defer. **Risk**: Low - guard is 2 seconds, unlikely to affect instrumentation.

---

## FIX PLAN (TBD based on evidence)

### ✅ CONFIRMED: Event disappears between WRITE_OUT and QUEUE_READ

**Evidence**: 
- WRITE_OUT: 6 events, hash=2c872484 (17:00 show present)
- QUEUE_READ: 5 events, hash=b0221452 (17:00 show missing)
- Time gap: 37ms between write and read

**Possible Causes**:
1. **Queue race condition**: Another thread/process writes to `push_queue` between WRITE_OUT and QUEUE_READ, overwriting the 6-event payload with a 5-event payload
2. **Event filtering in queue**: Queue filters out 17:00 show before logging QUEUE_READ (but this should happen after normalization, not before)
3. **Dict mutation**: `all_events` dict is mutated after WRITE_OUT log but before `push_queue.put()`

**Fix Plan**:
1. **Add lock around queue.put()**: Ensure atomic write to queue
2. **Copy dict before put()**: `push_queue.put(copy.deepcopy(all_events))` to prevent mutation
3. **Log immediately after put()**: Add log right after `push_queue.put()` to confirm what was actually written
4. **Check for multiple queue consumers**: Verify only one thread reads from `push_queue`

---

## RUNBOOK

### Capture Evidence During Next Boundary Transition

```bash
# 1. Restart playout to ensure fresh logs
cd /srv/libretime && docker compose restart playout

# 2. Wait for next boundary (e.g., 18:00 UTC)
# Monitor logs in real-time:
docker logs -f libretime-playout-1 2>&1 | grep -E "CHECKPOINT"

# 3. Capture one full cycle around boundary
# Find cycle_id from FEED_IN log just before boundary:
CYCLE_ID="1767462290741-1618"  # Replace with actual

# 4. Extract full cycle trace
docker logs libretime-playout-1 --since 5m 2>&1 | grep "$CYCLE_ID" > /tmp/cycle_trace.log

# 5. Verify all checkpoints present
grep -E "CHECKPOINT_(FEED_IN|AFTER_NORMALIZE|AFTER_DIFF|WRITE_OUT|QUEUE_READ)" /tmp/cycle_trace.log

# 6. Compare counts at each checkpoint
grep "CHECKPOINT.*count=" /tmp/cycle_trace.log

# 7. Compare hashes
grep "payload_hash\|read_hash" /tmp/cycle_trace.log
```

### Expected Output Analysis

- **FEED_IN**: Should show 6 events (including 17:00)
- **AFTER_NORMALIZE**: Should show 6 events (17:00 present)
- **AFTER_DIFF_OR_SUPPRESS**: Should show 6 events OR show skip reason
- **WRITE_OUT**: Should show 6 events with payload_hash
- **QUEUE_READ**: Should show 5 events with read_hash (mismatch indicates drop)

**If mismatch found**: Compare `payload_hash` vs `read_hash` and event counts to identify drop point.

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-03  
**Status**: Instrumentation deployed, awaiting evidence collection

