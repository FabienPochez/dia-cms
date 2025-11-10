# Search Index Planning - Executive Summary

**Phase:** Planning Only (Not Yet Implemented)  
**Date:** 2025-10-27  
**Status:** ✅ Ready for Implementation

---

## Quick Stats

**Collections Audited:** 3 (shows, episodes, hosts)  
**Indexes Found:** 18 total (4 shows, 10 episodes, 4 hosts)  
**Indexes to Create:** 3 (already have 1 of the 4 planned)  
**Text Indexes:** 0 (deferred to Phase 2)

---

## What We Found

### Current State (Baseline)

**✅ Good News:**
- `episodes.show_1` already exists! Payload auto-created it from the relationship field.
- All collections have standard indexes (_id, slug, createdAt, updatedAt)
- Episodes collection has comprehensive scheduling indexes (from Oct 21, 2025 work)

**❌ Missing for Search MVP:**
- `episodes.genres` - No index for genre filtering
- `shows.title/subtitle/description` - No compound index for text search
- `hosts.name` - No index for name search

### What We'll Create

**3 New Indexes:**

1. **episodes.genres_1** (multikey)
   - Purpose: Filter episodes by genre (array field)
   - Type: Multikey index (auto-detected by MongoDB)
   - Query: `db.episodes.find({ genres: { $in: [...] } })`

2. **shows.title_1_subtitle_1_description_1** (compound)
   - Purpose: Text search on show metadata
   - Type: Compound index (3 fields)
   - Query: `db.shows.find({ title: /^search/i })`

3. **hosts.name_1** (single-field)
   - Purpose: Search hosts by name
   - Type: Simple ascending index
   - Query: `db.hosts.find({ name: /^search/i })`

---

## Scripts Created

### 1. Inspection Script ✅
**File:** `scripts/db/inspect-search-indexes.js`  
**Purpose:** Audit existing indexes and output JSON snapshot  
**Usage:**
```bash
docker compose exec payload node scripts/db/inspect-search-indexes.js
```

### 2. Creation Script ✅
**File:** `scripts/db/create-search-indexes-mvp.js`  
**Purpose:** Create the 3 missing indexes  
**Usage:**
```bash
# Dry-run (test without executing)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js --dry-run

# Execute (creates indexes)
docker compose exec payload node scripts/db/create-search-indexes-mvp.js
```

---

## Implementation Checklist

### Planning Phase ✅
- [x] Schema audit (shows, episodes, hosts)
- [x] Baseline capture (`docs/SEARCH_INDEX_BASELINE.txt`)
- [x] Script creation (`create-search-indexes-mvp.js`)
- [x] Dry-run testing (successful)
- [x] Documentation (`SEARCH_INDEX_PLAN_MVP.md`)

### Implementation Phase ⏸️ (Awaiting Approval)
- [ ] Review planning docs with team
- [ ] Execute index creation script (production)
- [ ] Capture post-creation state (`docs/SEARCH_INDEX_AFTER_MVP.txt`)
- [ ] Run smoke tests with `explain()` analysis
- [ ] Update CHANGELOG.md with results
- [ ] Document query performance improvements

---

## Key Decisions

### ✅ Why No Text Indexes?
- **MVP Strategy:** Use simple regex queries with compound indexes
- **Simplicity:** No language analyzers, scoring, or stemming complexity
- **Performance:** Compound indexes support efficient starts-with queries
- **Phase 2:** Add full-text search when relevance ranking is needed

### ✅ Why Compound Index on Shows?
- **Efficiency:** One index covers `title OR subtitle OR description` queries
- **Storage:** Reduces index overhead (1 index vs 3)
- **Trade-off:** `subtitle`-only queries won't use index (acceptable for MVP)

### ✅ Why Skip episodes.show_1?
- **Already Exists:** Payload automatically created it
- **Verification:** Confirmed present in baseline inspection
- **Action:** Creation script detects and skips existing indexes

---

## Risk Assessment

**Low Risk:**
- Online index builds (background: true) - non-blocking
- Small collection sizes (~1000 episodes, ~40 shows, ~50 hosts)
- Minimal impact on write throughput (<5% increase expected)
- Rollback available (simple dropIndex commands)

**Regex Limitations (Expected):**
- Leading wildcard queries (`/.*search/i`) won't use indexes efficiently
- Acceptable for MVP, documented for Phase 2 upgrade

---

## Next Steps

1. **Review** this summary and planning doc
2. **Approve** for implementation (or request changes)
3. **Execute** `create-search-indexes-mvp.js` (no --dry-run flag)
4. **Verify** with `inspect-search-indexes.js`
5. **Test** representative queries with `explain()`
6. **Document** results in CHANGELOG.md

---

## Files Created

- ✅ `scripts/db/inspect-search-indexes.js` - Audit script
- ✅ `scripts/db/create-search-indexes-mvp.js` - Creation script
- ✅ `docs/SEARCH_INDEX_PLAN_MVP.md` - Full planning document (12 sections)
- ✅ `docs/SEARCH_INDEX_BASELINE.txt` - Current index state snapshot
- ✅ `docs/SEARCH_INDEX_PLAN_SUMMARY.md` - This executive summary
- ⏸️ `docs/SEARCH_INDEX_AFTER_MVP.txt` - Post-creation snapshot (not yet created)

---

**Planning Complete:** ✅ Ready for implementation approval  
**Scripts Tested:** ✅ Dry-run successful (3 indexes would be created)  
**Risk Level:** 🟢 Low (small dataset, background builds, rollback available)




