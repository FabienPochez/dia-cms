# Search Index Planning - Navigation & Quick Start

**Phase:** Planning Complete ✅  
**Date:** 2025-10-27  
**Status:** Ready for Implementation Approval

---

## 📚 Document Index

### Start Here
1. **[SEARCH_INDEX_PLAN_SUMMARY.md](SEARCH_INDEX_PLAN_SUMMARY.md)** (5-min read)
   - Executive summary with key stats
   - What we found, what we'll create
   - Quick risk assessment

2. **[SEARCH_INDEX_PLAN_MVP.md](SEARCH_INDEX_PLAN_MVP.md)** (20-min read)
   - Full technical planning document (12 sections)
   - Schema audit results
   - Detailed index specifications
   - Query patterns and performance expectations
   - Validation steps and rollback procedures

### Reference Files
3. **[SEARCH_INDEX_BASELINE.txt](SEARCH_INDEX_BASELINE.txt)** (raw data)
   - Current index state snapshot
   - JSON output from inspection script
   - Captured: 2025-10-27

4. **[HOST_UPLOAD_FUNNEL_IMPLEMENTATION.md](HOST_UPLOAD_FUNNEL_IMPLEMENTATION.md)** (context)
   - Related feature documentation
   - May influence search requirements

---

## 🚀 Quick Start for Implementation

### Prerequisites
- Docker environment running
- Access to `/srv/payload` directory
- MongoDB accessible via `docker compose exec payload`

### Step 1: Review Planning Docs
```bash
# Read executive summary
cat docs/SEARCH_INDEX_PLAN_SUMMARY.md

# Review full plan (optional)
cat docs/SEARCH_INDEX_PLAN_MVP.md
```

### Step 2: Verify Current State
```bash
# Re-run inspection to confirm baseline hasn't changed
docker compose exec payload node scripts/db/inspect-search-indexes.js
```

### Step 3: Execute Index Creation
```bash
# Test with dry-run first (no changes)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js --dry-run

# Execute for real (creates 3 indexes)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js
```

### Step 4: Verify Creation
```bash
# Capture post-creation state
docker compose exec payload node scripts/db/inspect-search-indexes.js > docs/SEARCH_INDEX_AFTER_MVP.txt

# Compare before/after
diff docs/SEARCH_INDEX_BASELINE.txt docs/SEARCH_INDEX_AFTER_MVP.txt
```

### Step 5: Smoke Test (Optional)
```bash
# Connect to MongoDB shell
docker compose exec mongo mongosh dia-cms

# Test index usage (example)
db.episodes.find({ genres: ObjectId("...") }).explain("executionStats")
# Should show: "stage": "IXSCAN", "indexName": "genres_1"
```

---

## 📊 What's Being Created

**3 New Indexes:**

| Collection | Index Name | Keys | Type | Purpose |
|------------|------------|------|------|---------|
| episodes | `genres_1` | `{ genres: 1 }` | Multikey | Genre filtering |
| shows | `title_1_subtitle_1_description_1` | `{ title: 1, subtitle: 1, description: 1 }` | Compound | Text search |
| hosts | `name_1` | `{ name: 1 }` | Single | Name search |

**What's Already There (No Action Needed):**
- `episodes.show_1` - Already created by Payload

---

## ⚠️ Key Decisions & Trade-offs

### ✅ Approved for MVP
- Simple regex queries with compound/multikey indexes
- No text indexes (deferred to Phase 2)
- Background index builds (non-blocking)
- Minimal index bloat (+3 indexes only)

### ❌ Deferred to Phase 2
- Full-text search with `$text` operator
- Relevance ranking with `$meta: "textScore"`
- Language-specific stemming
- Better wildcard query performance

### 🟡 Acceptable Limitations
- Regex leading wildcard queries won't use indexes efficiently
  - Example: `db.shows.find({ title: /.*music/i })` (contains, leading wildcard)
  - Still faster than collection scan, but not optimal
- Compound index on shows won't optimize `subtitle`-only or `description`-only queries
  - Only leftmost field (`title`) benefits from index prefix usage
  - Mixed queries (`title OR subtitle OR description`) use full compound index

---

## 🛠️ Scripts Created

### Inspection Script
**File:** `scripts/db/inspect-search-indexes.js`

**Purpose:** Audit existing indexes and output JSON snapshot

**Usage:**
```bash
docker compose exec payload node scripts/db/inspect-search-indexes.js
```

**Output Example:**
```
📋 Collection: episodes
Found 10 indexes:
1. _id_
2. show_1 ✅ (already exists for search MVP)
3. scheduledAt_1
...

📊 Relevant Fields Check:
   show: ✅ Indexed
   genres: ❌ Not indexed
```

### Creation Script
**File:** `scripts/db/create-search-indexes-mvp.js`

**Purpose:** Create the 3 missing indexes

**Usage:**
```bash
# Dry-run (simulate, no changes)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js --dry-run

# Execute (creates indexes)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js
```

**Features:**
- Auto-detects existing indexes (skips if already present)
- Background index builds (non-blocking)
- Descriptive index names for easy identification
- Verification step after creation
- Summary output with created/skipped/errors

---

## 📝 Checklist Before Implementation

**Planning Phase (Complete):**
- [x] Schema audit for shows, episodes, hosts
- [x] Baseline index capture
- [x] Script creation and dry-run testing
- [x] Documentation (planning doc, summary, baseline)
- [x] CHANGELOG entry
- [x] Risk assessment

**Implementation Phase (Awaiting Approval):**
- [ ] Team review of planning docs
- [ ] Approval to proceed
- [ ] Execute index creation script
- [ ] Verify with inspection script
- [ ] Smoke test representative queries
- [ ] Update CHANGELOG with results
- [ ] Archive planning docs for reference

---

## 🔄 Rollback Procedure

If indexes cause issues, rollback is simple:

### Identify Problem Indexes
```bash
docker compose exec payload node scripts/db/inspect-search-indexes.js
```

### Drop Specific Indexes
```bash
# Connect to MongoDB shell
docker compose exec mongo mongosh dia-cms

# Drop indexes one by one
db.episodes.dropIndex('genres_1');
db.shows.dropIndex('title_1_subtitle_1_description_1');
db.hosts.dropIndex('name_1');
```

### Verify Rollback
```bash
docker compose exec payload node scripts/db/inspect-search-indexes.js
# Should show baseline state (18 total indexes)
```

---

## 🎯 Success Criteria

**Implementation is successful when:**

1. ✅ All 3 new indexes created without errors
2. ✅ No duplicate indexes (creation script skips existing)
3. ✅ Index builds complete within 5 minutes (small dataset)
4. ✅ Write throughput unchanged (<5% impact)
5. ✅ Query `explain()` shows `IXSCAN` usage for targeted queries
6. ✅ Post-creation inspection shows 21 total indexes (18 + 3)

**Query Performance Expectations:**
- Episode genre filter: 5-50x faster
- Show text search (starts-with): 5-20x faster
- Host name search: 3-10x faster
- Informal timing: <50ms for typical searches

---

## 📞 Support & Questions

**Planning Documents:**
- Full plan: `docs/SEARCH_INDEX_PLAN_MVP.md`
- Summary: `docs/SEARCH_INDEX_PLAN_SUMMARY.md`
- Baseline: `docs/SEARCH_INDEX_BASELINE.txt`

**Scripts:**
- Inspection: `scripts/db/inspect-search-indexes.js`
- Creation: `scripts/db/create-search-indexes-mvp.js`

**Related Work:**
- CHANGELOG entry: Line 18-58 (Planning section)
- Oct 21, 2025: Database indexing optimization (scheduling indexes)

**MongoDB Resources:**
- [Index Strategies](https://www.mongodb.com/docs/manual/applications/indexes/)
- [Multikey Indexes](https://www.mongodb.com/docs/manual/core/index-multikey/)
- [Compound Indexes](https://www.mongodb.com/docs/manual/core/index-compound/)

---

**Status:** ✅ Planning complete, ready for approval and implementation  
**Risk Level:** 🟢 Low (small dataset, background builds, simple rollback)  
**Impact:** Performance improvement for search queries, no breaking changes




