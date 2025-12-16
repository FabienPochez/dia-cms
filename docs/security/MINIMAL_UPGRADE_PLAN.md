# Minimal Security Upgrade Plan
**Date:** 2025-12-16  
**Strategy:** Surgical, low-risk upgrades only

---

## Upgrade Groups

### Group A: Safe Patch/Minor Upgrades (Apply Now)

These upgrades satisfy ALL criteria:
- ✅ Fix vulnerabilities in production dependencies
- ✅ Patch/minor within same major version
- ✅ No code changes required (or trivial config changes)
- ✅ Low risk of breaking changes

#### 1. **glob** `11.0.3` → `11.1.0`
- **Type:** Patch bump
- **Vulnerability:** HIGH - Command injection (GHSA-5j98-mcp5-4vw2)
- **Risk:** Very low (patch bump, direct dependency)
- **Command:** `pnpm up glob@11.1.0`
- **Verification:** Run `pnpm run build` and `pnpm run lint`

#### 2. **next** `15.3.6` → `15.4.x` (deferred, not applied)
- **Type:** Minor bump (15.3.x → 15.4.x)
- **Vulnerabilities:** 
  - HIGH - DoS (GHSA-mwv6-3258-q52c)
  - MODERATE - SSRF (GHSA-4342-x723-ch2f)
  - MODERATE - Source code exposure (GHSA-w37m-7fhw-fmv9)
  - MODERATE - Cache key confusion (GHSA-g5qg-72qw-gw5v)
  - MODERATE - Content injection (GHSA-xv57-4mr9-wg8v)
- **Risk:** Low-Medium (minor bump, but Next.js 15.4.x should be compatible with Payload 3.48.0)
- **Command:** `pnpm up next@15.4.7`
- **Verification:** 
  - Run `pnpm run build`
  - Run `pnpm run lint`
  - Run `pnpm run test:int` (if available)
  - Manual smoke test of key features
- **Note:** Next.js 15.4.7 is the minimum version that fixes ALL Next.js vulnerabilities

---

### Group B: Requires Verification (Possible Breaking Changes)

These upgrades fix vulnerabilities but may require:
- Code changes
- Configuration updates
- Testing of specific features
- Dependency version alignment

#### 1. **Payload CMS** `3.48.0` → `3.68.5`
- **Type:** Minor bump (3.x.x → 3.x.x, but significant version gap)
- **Vulnerabilities fixed:** 
  - nodemailer MODERATE (GHSA-mm7p-fcc7-pg87)
  - nodemailer LOW (GHSA-rcmh-qjqh-p98v)
- **Risk:** Medium-High (20 minor versions behind, may have breaking changes)
- **Command:** `pnpm up @payloadcms/db-mongodb@3.68.5 @payloadcms/email-nodemailer@3.68.5 @payloadcms/next@3.68.5 @payloadcms/payload-cloud@3.68.5 @payloadcms/richtext-lexical@3.68.5 @payloadcms/ui@3.68.5 payload@3.68.5`
- **Verification required:**
  - Review Payload CMS changelog for breaking changes
  - Test all Payload CMS features
  - Verify database migrations (if any)
  - Test authentication flows
- **Recommendation:** Separate follow-up task after Group A is verified

#### 2. **sharp** (for tar-fs fix)
- **Type:** Unknown (depends on sharp version requirements)
- **Vulnerability:** tar-fs HIGH (GHSA-vj76-c3g6-qr5v)
- **Risk:** Medium (sharp is a native module, may require rebuild)
- **Current version:** `0.32.6`
- **Action:** Check if newer sharp version includes patched tar-fs
- **Recommendation:** Defer until Payload CMS upgrade (may be resolved transitively)

---

### Group C: Defer (Low Priority or DevDependencies)

#### 1. **playwright** `1.50.0` → `1.55.1`
- **Type:** Minor bump
- **Vulnerability:** HIGH - SSL certificate verification bypass (GHSA-7mvr-c777-76hp)
- **Risk:** Low (devDependency only, not in production)
- **Command:** `pnpm up -D playwright@1.55.1 @playwright/test@1.55.1 playwright-core@1.55.1`
- **Recommendation:** Apply after Group A, low priority

#### 2. **Transitive dependencies** (vite, @eslint/plugin-kit, js-yaml, esbuild)
- **Type:** Various
- **Vulnerabilities:** LOW/MODERATE
- **Risk:** Very low (dev tools only, or dev server only)
- **Action:** Will be resolved transitively when parent dependencies are updated
- **Recommendation:** Monitor, no immediate action required

---

## Upgrade Sequence

1. **Apply Group A** (glob, next)
   - Update packages
   - Run `pnpm install`
   - Run `pnpm run build`
   - Run `pnpm run lint`
   - Run `pnpm run test:int` (if available)
   - Manual smoke test

2. **Verify Group A** (wait 24-48 hours in staging/production)

3. **Plan Group B** (Payload CMS upgrade)
   - Review changelog
   - Create migration plan
   - Schedule separate upgrade task

4. **Apply Group C** (playwright, dev tools)
   - Low priority
   - Can be done anytime

---

## Risk Assessment

### Group A Risks
- **glob:** Very low risk (patch bump)
- **next:** Low-Medium risk (minor bump, but Next.js 15.4.x should be stable)

### Group B Risks
- **Payload CMS:** Medium-High risk (significant version gap, may have breaking changes)
- **sharp:** Medium risk (native module, requires rebuild)

### Group C Risks
- **playwright:** Very low risk (devDependency)
- **Transitive:** Very low risk (dev tools only)

---

## Rollback Plan

If Group A upgrades cause issues:

1. **Revert package.json changes:**
   ```bash
   git checkout package.json
   ```

2. **Restore lockfile:**
   ```bash
   git checkout pnpm-lock.yaml
   ```

3. **Reinstall:**
   ```bash
   pnpm install
   ```

4. **Rebuild:**
   ```bash
   pnpm run build
   ```

---

## Success Criteria

- ✅ All Group A vulnerabilities fixed
- ✅ Build succeeds
- ✅ Lint passes
- ✅ Integration tests pass (if available)
- ✅ Manual smoke test passes
- ✅ No breaking changes observed

