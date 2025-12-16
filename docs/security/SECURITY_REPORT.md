# Dependency Security Audit Report
**Date:** 2025-12-16  
**Auditor:** Security Maintainer  
**Scope:** Runtime dependencies (prod deps) prioritized, then devDeps

---

## Executive Summary

- **Total vulnerabilities:** 17
- **Severity breakdown:** 5 high | 8 moderate | 4 low
- **Direct dependencies affected:** 2 (glob, next)
- **Transitive dependencies affected:** Multiple (nodemailer, tar-fs, vite, esbuild, js-yaml, @eslint/plugin-kit)

---

## Top 10 Vulnerabilities by Severity & Exploitability

### 1. **glob** (HIGH - Command Injection) — **Fixed**
- **Package:** `glob` (direct dependency)
- **Installed version:** `11.1.0` (patched)
- **Vulnerable versions:** `>=11.0.0 <11.1.0`
- **Patched versions:** `>=11.1.0`
- **Severity:** HIGH
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-5j98-mcp5-4vw2
- **Description:** Command injection via `-c/--cmd` executes matches with `shell:true`
- **Status:** Fixed by upgrading to 11.1.0

### 2. **next** (HIGH - Denial of Service)
- **Package:** `next` (direct dependency)
- **Installed version:** `15.3.6`
- **Vulnerable versions:** `>=15.3.0-canary.0 <15.3.7`
- **Patched versions:** `>=15.3.7`
- **Severity:** HIGH
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-mwv6-3258-q52c
- **Description:** Vulnerable to Denial of Service with Server Components
- **Fix version:** `15.3.7` (patch bump) or `15.4.7` (covers all Next.js vulnerabilities)
- **Source:** https://github.com/advisories/GHSA-mwv6-3258-q52c

### 3. **next** (MODERATE - SSRF)
- **Package:** `next` (direct dependency)
- **Installed version:** `15.3.6`
- **Vulnerable versions:** `>=15.0.0-canary.0 <15.4.7`
- **Patched versions:** `>=15.4.7`
- **Severity:** MODERATE
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-4342-x723-ch2f
- **Description:** Improper Middleware Redirect Handling Leads to SSRF
- **Fix version:** `15.4.7` (minor bump)
- **Source:** https://github.com/advisories/GHSA-4342-x723-ch2f

### 4. **next** (MODERATE - Source Code Exposure)
- **Package:** `next` (direct dependency)
- **Installed version:** `15.3.6`
- **Vulnerable versions:** `>=15.3.0-canary.0 <15.3.7`
- **Patched versions:** `>=15.3.7`
- **Severity:** MODERATE
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-w37m-7fhw-fmv9
- **Description:** Next Server Actions Source Code Exposure
- **Fix version:** `15.3.7` (patch bump) or `15.4.7` (covers all)
- **Source:** https://github.com/advisories/GHSA-w37m-7fhw-fmv9

### 5. **next** (MODERATE - Cache Key Confusion)
- **Package:** `next` (direct dependency)
- **Installed version:** `15.3.6`
- **Vulnerable versions:** `>=15.0.0 <=15.4.4`
- **Patched versions:** `>=15.4.5`
- **Severity:** MODERATE
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-g5qg-72qw-gw5v
- **Description:** Cache Key Confusion for Image Optimization API Routes
- **Fix version:** `15.4.5` (minor bump) or `15.4.7` (covers all)
- **Source:** https://github.com/advisories/GHSA-g5qg-72qw-gw5v

### 6. **next** (MODERATE - Content Injection)
- **Package:** `next` (direct dependency)
- **Installed version:** `15.3.6`
- **Vulnerable versions:** `>=15.0.0 <=15.4.4`
- **Patched versions:** `>=15.4.5`
- **Severity:** MODERATE
- **Type:** Direct dependency
- **CVE/GHSA:** GHSA-xv57-4mr9-wg8v
- **Description:** Content Injection Vulnerability for Image Optimization
- **Fix version:** `15.4.5` (minor bump) or `15.4.7` (covers all)
- **Source:** https://github.com/advisories/GHSA-xv57-4mr9-wg8v

### 7. **nodemailer** (MODERATE - Email Domain Interpretation Conflict)
- **Package:** `nodemailer` (transitive via `@payloadcms/email-nodemailer`)
- **Installed version:** Unknown (controlled by Payload)
- **Vulnerable versions:** `<7.0.7`
- **Patched versions:** `>=7.0.7`
- **Severity:** MODERATE
- **Type:** Transitive dependency
- **CVE/GHSA:** GHSA-mm7p-fcc7-pg87
- **Description:** Email to an unintended domain can occur due to Interpretation Conflict
- **Fix version:** Requires `@payloadcms/email-nodemailer` upgrade (currently `3.48.0`, latest `3.68.5`)
- **Source:** https://github.com/advisories/GHSA-mm7p-fcc7-pg87

### 8. **nodemailer** (LOW - DoS)
- **Package:** `nodemailer` (transitive via `@payloadcms/email-nodemailer`)
- **Installed version:** Unknown (controlled by Payload)
- **Vulnerable versions:** `<=7.0.10`
- **Patched versions:** `>=7.0.11`
- **Severity:** LOW
- **Type:** Transitive dependency
- **CVE/GHSA:** GHSA-rcmh-qjqh-p98v
- **Description:** Addressparser is vulnerable to DoS caused by recursive calls
- **Fix version:** Requires `@payloadcms/email-nodemailer` upgrade
- **Source:** https://github.com/advisories/GHSA-rcmh-qjqh-p98v

### 9. **tar-fs** (HIGH - Symlink Validation Bypass)
- **Package:** `tar-fs` (transitive via `sharp`)
- **Installed version:** Unknown (controlled by `sharp`)
- **Vulnerable versions:** `>=3.0.0 <3.1.1`
- **Patched versions:** `>=3.1.1`
- **Severity:** HIGH
- **Type:** Transitive dependency
- **CVE/GHSA:** GHSA-vj76-c3g6-qr5v
- **Description:** Symlink validation bypass if destination directory is predictable
- **Fix version:** Requires `sharp` dependency update (may require `sharp` upgrade)
- **Source:** https://github.com/advisories/GHSA-vj76-c3g6-qr5v

### 10. **playwright** (HIGH - SSL Certificate Verification Bypass)
- **Package:** `playwright` (devDependency)
- **Installed version:** `1.50.0`
- **Vulnerable versions:** `<1.55.1`
- **Patched versions:** `>=1.55.1`
- **Severity:** HIGH
- **Type:** Direct devDependency
- **CVE/GHSA:** GHSA-7mvr-c777-76hp
- **Description:** Downloads and installs browsers without verifying SSL certificate authenticity
- **Fix version:** `1.55.1` (minor bump)
- **Source:** https://github.com/advisories/GHSA-7mvr-c777-76hp
- **Note:** DevDependency only, lower priority for production

---

## Must-Fix-Now List

### Production Dependencies (Network-Exposed, RCE/Auth Bypass/SSRF)

1. **glob** `11.0.3` → `11.1.0`
   - **Reason:** HIGH severity command injection in direct dependency
   - **Risk:** Command injection via CLI
   - **Fix type:** Patch bump (safe)

2. **next** `15.3.6` → `15.4.7`
   - **Reason:** Multiple HIGH/MODERATE vulnerabilities (DoS, SSRF, source code exposure, cache confusion, content injection)
   - **Risk:** Network-exposed framework, multiple attack vectors
   - **Fix type:** Minor bump (15.3.x → 15.4.x)
   - **Note:** Requires verification for breaking changes

3. **nodemailer** (via `@payloadcms/email-nodemailer`)
   - **Reason:** MODERATE severity email domain interpretation conflict
   - **Risk:** Email could be sent to unintended domain
   - **Fix type:** Requires Payload CMS upgrade (`3.48.0` → `3.68.5`)
   - **Note:** Group B (requires Payload version alignment)

4. **tar-fs** (via `sharp`)
   - **Reason:** HIGH severity symlink validation bypass
   - **Risk:** Path traversal during package installation
   - **Fix type:** Requires `sharp` dependency update
   - **Note:** Transitive, may require `sharp` upgrade (Group B)

---

## Nice-to-Fix List

### DevDependencies or Low Severity

1. **playwright** `1.50.0` → `1.55.1` (devDeps, HIGH but not production)
2. **vite** (transitive, LOW/MODERATE - dev tool only)
3. **@eslint/plugin-kit** (transitive, LOW - dev tool only)
4. **js-yaml** (transitive, MODERATE - prototype pollution, dev tool)
5. **esbuild** (transitive, MODERATE - dev server only)

---

## Current Environment

- **Node.js:** `v18.20.8`
- **pnpm:** `10.12.4`
- **Lockfile:** `pnpm-lock.yaml` exists and is committed

---

## Notes

- **OSV-Scanner:** Not available on host (would require installation)
- **Transitive dependencies:** Many vulnerabilities are in transitive deps controlled by Payload CMS or other major dependencies
- **Payload CMS version:** `3.48.0` (latest: `3.68.5`) - significant version gap, may require careful migration
- **Next.js version:** `15.3.6` → `15.4.7` is a minor bump; verify compatibility with Payload CMS `3.48.0`

