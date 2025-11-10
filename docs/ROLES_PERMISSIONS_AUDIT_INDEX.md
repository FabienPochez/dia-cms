# PAYLOAD ROLES & PERMISSIONS AUDIT — Navigation Index

**Audit Date**: 2025-10-27  
**Status**: ✅ **AUDIT COMPLETE** — Awaiting Review & Decision  
**Objective**: Identify why recent admin gating for Hosts impacted frontend API reads

---

## 📋 QUICK START (2 minutes)

**Read This First**: [ROLES_PERMISSIONS_AUDIT_SUMMARY.md](ROLES_PERMISSIONS_AUDIT_SUMMARY.md)
- 3-sentence problem statement
- Timeline of what broke (Oct 23-25)
- Current security gaps
- Recommended solution in 1 code block

**Decision Needed**: Should we apply the proposed `access.admin` changes?

---

## 📚 DOCUMENT STRUCTURE

### 1. Executive Summary (5 min read)
**File**: `ROLES_PERMISSIONS_AUDIT_SUMMARY.md`

**Contents**:
- The Problem (3 sentences)
- Timeline (Oct 23-25 changes)
- Current State (security assessment)
- Root Cause (why Payload's access model conflicts)
- Recommended Solution (use `access.admin`)
- Risk Assessment
- Success Criteria

**Audience**: Product owners, tech leads, anyone who needs to understand the issue without deep technical details.

---

### 2. Full Reviewer Pack (30 min read)
**File**: `ROLES_PERMISSIONS_AUDIT_REVIEWER_PACK.md`

**Contents** (13 sections):
1. Executive Summary (10 bullets)
2. Timeline (detailed Oct 23-25 changes with CHANGELOG excerpts)
3. Current Access Control State (collection matrix, field-level patterns)
4. Frontend Breakpoints & API Usage (all API calls audited)
5. Roles & JWT Configuration (saveToJWT verification)
6. Design Conflict Analysis (why access.read can't serve both needs)
7. Field-Level Access Issues (Oct 25 query error incident)
8. Risk Checks (access function validation, data integrity)
9. Proposed Minimal Changes (config-only, reversible)
10. Questions & Risks (open items for decision)
11. Logs (no failing requests provided)
12. Implementation Checklist
13. Reference Links

**Audience**: Developers, security reviewers, anyone implementing the changes.

---

### 3. Proposed Diffs (15 min read + implementation)
**File**: `ROLES_PERMISSIONS_PROPOSED_DIFFS.md`

**Contents**:
- DIFF 1: Create reusable role helpers (`/src/access/roleHelpers.ts`)
- DIFF 2-7: Add `access.admin` to Episodes, Shows, Hosts, Users, Genres, Media
- Verification steps (4 scenarios to test)
- Rollback plan (git revert or surgical removal)
- Migration considerations (database queries, staging tests)
- Alternative approaches (if custom views break)

**Audience**: Developers implementing the changes.

---

## 🎯 KEY FINDINGS (TL;DR)

### The Problem
Recent attempts to restrict admin panel access for Hosts broke the frontend API because Payload's `access.read` applies to **ALL** API requests with no distinction between "admin panel" and "public API".

### Current Security Gaps
1. ❌ NO `access.admin` in use (only visual hiding via `admin.hidden`)
2. ❌ Hosts can access admin routes directly (navigate to `/admin/collections/episodes`)
3. ❌ No separation of admin vs API access
4. ❌ Field hiding is visual only (doesn't prevent API reads)

### The Solution
Add `access.admin: adminPanelOnly` to 6 collections (Episodes, Shows, Hosts, Users, Genres, Media).

**Impact**:
- ✅ Hosts **cannot** access admin panel routes
- ✅ Frontend API (`/api/episodes`) remains **public**
- ✅ Upload form (custom view) still **accessible** for hosts
- ✅ **Minimal change**: ~7 lines added per collection

---

## 🔍 WHAT TO REVIEW

### For Product Owners / Tech Leads
1. Read: **AUDIT_SUMMARY.md** (5 min)
2. Review: "Current Security Gaps" section
3. Decide: Should we apply the proposed changes?
4. Consider: Impact on host users (how many? what do they use?)

### For Security Reviewers
1. Read: **REVIEWER_PACK.md** sections 3-8 (access state, breakpoints, risks)
2. Review: "Risk Checks" section (section 8)
3. Verify: JWT configuration (section 5)
4. Check: Proposed changes address security gaps (section 9)

### For Developers Implementing
1. Read: **PROPOSED_DIFFS.md** (all diffs)
2. Review: Verification steps
3. Test: On staging first (migration considerations)
4. Monitor: Logs after deployment (watch for 403 errors)

---

## 📊 AUDIT SCOPE

### What Was Audited ✅
- [x] All collection configs (Episodes, Shows, Hosts, Users, Genres, Media)
- [x] All access control functions (`src/access/hostAccess.ts`)
- [x] Field-level access patterns (~90 fields across Episodes + Shows)
- [x] Frontend API calls (admin panel components)
- [x] JWT configuration (`saveToJWT` on role field)
- [x] overrideAccess usage (only 1 legitimate use found)
- [x] CHANGELOG (Oct 23-25 changes)
- [x] README (deployment, roles, admin URL)

### What Was NOT Audited ⚠️
- [ ] MediaImages and MediaTracks collections (assumed same as Media)
- [ ] GraphQL API queries (REST API only)
- [ ] Custom middleware (if any)
- [ ] External app API calls (only admin panel audited)
- [ ] Payload version (v2 vs v3 compatibility)
- [ ] Production logs (no failing requests provided)

---

## 🚦 DECISION MATRIX

### Option 1: Apply Proposed Changes ✅ RECOMMENDED
**Pros**:
- ✅ Closes security gap (hosts can't access admin routes)
- ✅ Minimal changes (~7 lines per collection)
- ✅ Reversible (git revert or surgical removal)
- ✅ Separates admin access from API access

**Cons**:
- ⚠️ Need to verify custom views aren't blocked
- ⚠️ Need to test with actual host users
- ⚠️ May require staging deployment first

**Risk**: Medium (need testing), High impact if successful

---

### Option 2: Status Quo (Keep Visual Hiding Only) ❌ NOT RECOMMENDED
**Pros**:
- ✅ No code changes needed
- ✅ Frontend app already working

**Cons**:
- ❌ Security gap remains (hosts can access admin routes)
- ❌ No real access control (only visual hiding)
- ❌ Field hiding is not enforced

**Risk**: Low implementation risk, High security risk

---

### Option 3: Middleware Approach (Block Admin Routes) 🔄 ALTERNATIVE
**Pros**:
- ✅ More flexible (can customize per route)
- ✅ Doesn't affect custom views
- ✅ Can add logging/monitoring

**Cons**:
- ⚠️ More complex to implement
- ⚠️ Requires Next.js middleware or custom hook
- ⚠️ Not using Payload's built-in access control

**Risk**: Medium implementation risk, Medium security risk

---

## ✅ NEXT STEPS

### 1. Decision (Who: Product Owner / Tech Lead)
- [ ] Review AUDIT_SUMMARY.md
- [ ] Decide on implementation approach (Option 1, 2, or 3)
- [ ] Approve staging deployment for testing

### 2. Pre-Implementation (Who: Developer)
- [ ] Verify Payload version (v2 vs v3)
- [ ] Query database for orphaned host users (`role: 'host'` without `host` field)
- [ ] Count host users (impact assessment)
- [ ] Check if custom views rely on collection `access.admin`

### 3. Implementation (Who: Developer)
- [ ] Create `/src/access/roleHelpers.ts`
- [ ] Add `access.admin: adminPanelOnly` to 6 collections
- [ ] Add `user.host` validation hook to Users collection
- [ ] Test on staging (all 4 verification scenarios)
- [ ] Monitor logs for access denied errors

### 4. Deployment (Who: DevOps / Developer)
- [ ] Deploy to staging
- [ ] Run verification tests (see PROPOSED_DIFFS.md)
- [ ] Monitor logs for 24 hours
- [ ] Deploy to production (if staging successful)
- [ ] Update CHANGELOG with changes

### 5. Post-Deployment (Who: Developer + Product Owner)
- [ ] Verify hosts can't access admin panel routes
- [ ] Verify hosts CAN access custom views
- [ ] Verify frontend app works for all user types
- [ ] Monitor logs for 1 week
- [ ] Close security gap ticket

---

## 📞 SUPPORT & QUESTIONS

### Open Questions (Require Decision)
1. **Custom Views**: Do they respect collection-level `access.admin`? (Test needed)
2. **Payload Version**: V2 or V3? (Function-based `admin.hidden` may not work in V3)
3. **Published-Only Read**: Should frontend API only show published episodes? (Currently shows all)
4. **Host Count**: How many host users exist? (Migration impact assessment)
5. **Orphaned Hosts**: Any users with `role: 'host'` but no `host` field? (Database query needed)

### Contacts
- **Security Questions**: See "Risk Checks" section in REVIEWER_PACK.md
- **Implementation Questions**: See "Verification Steps" in PROPOSED_DIFFS.md
- **Design Questions**: See "Design Conflict Analysis" in REVIEWER_PACK.md

### Related Documentation
- Payload Access Control: https://payloadcms.com/docs/access-control/overview
- Payload Admin Panel Gating: https://payloadcms.com/docs/admin/overview
- CHANGELOG.md (lines 20-59: Oct 25 fixes, lines 129-192: Oct 23 implementation)

---

## 📝 DOCUMENT CHANGELOG

### 2025-10-27: Initial Audit
- Created AUDIT_SUMMARY.md (executive summary)
- Created REVIEWER_PACK.md (full technical audit)
- Created PROPOSED_DIFFS.md (implementation guide)
- Created AUDIT_INDEX.md (navigation index)

**Status**: ✅ Audit complete, awaiting review and decision.

---

**END OF INDEX**













