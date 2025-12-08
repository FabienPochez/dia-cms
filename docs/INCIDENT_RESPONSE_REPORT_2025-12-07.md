# 🚨 INCIDENT RESPONSE REPORT
**Date:** December 7, 2025, 19:40 UTC  
**Incident Type:** Active Malware Persistence & Container Compromise  
**Severity:** CRITICAL

---

## 📋 EXECUTIVE SUMMARY

Multiple cryptocurrency mining malware instances have been detected and removed from the production server. The attack vector involved MongoDB exposure, remote code execution via Payload API endpoints, and container escape through the `dev-scripts` container with dangerous permissions.

**Status:** Immediate containment actions completed. Active investigation ongoing.

---

## 🎯 IMMEDIATE ACTIONS TAKEN

### ✅ Containment Actions
1. **Stopped compromised container:**
   - `payload-dev-scripts-1` container stopped (Exit code 137)

2. **Blocked outbound traffic to mining pools:**
   - `auto.c3pool.org` - BLOCKED
   - `c3pool.com` - BLOCKED  
   - `172.67.135.0/24` - BLOCKED

3. **Blocked all Docker container outbound traffic:**
   - Added `DROP` rule to `DOCKER-USER` chain
   - Prevents further malware downloads from containers

---

## 🦠 MALWARE DETECTED

### 1. `javs` Malware
- **Type:** Cryptocurrency miner
- **Location:** `/root/.javs/javs/javs`
- **Detected:** 18:18 UTC
- **Killed:** 19:17 UTC
- **Resource Usage:** 109% CPU, 2.3GB RAM
- **Status:** ✅ Removed

### 2. `hash` Malware  
- **Type:** Cryptocurrency miner (RandomX/XMRig variant)
- **Location:** `/srv/payload/hash`
- **Detected:** 19:31 UTC
- **Killed:** 19:32 UTC
- **Resource Usage:** 81.6% CPU, 2.4GB RAM
- **Mining Pool:** `auto.c3pool.org:13333`
- **Wallet:** `45vWwParN9pJSmRVEd57jH5my5N7Py6Lsi3GqTg3wm8XReVLEietnSLWUSXayo5LdAW2objP4ubjiWTM7vk4JiYm4j3Aozd`
- **Status:** ✅ Removed

### 3. Previous Malware (Earlier Incidents)
- `sex.sh` - Monero miner (xmrig)
- `dockerd` / `docker-daemon` - Malicious binaries disguised as Docker components

---

## 🔍 ATTACK VECTOR ANALYSIS

### Attack Chain Identified:

```
1. Initial Access
   └─ MongoDB exposed publicly (0.0.0.0:27017)
      └─ No authentication required
      └─ Attacker gained database access

2. Remote Code Execution
   └─ Payload API endpoints vulnerable
      └─ /api/lifecycle/preair-rehydrate (unauthenticated)
      └─ /api/lifecycle/postair-archive (unauthenticated)
      └─ Attacker executed arbitrary commands

3. Container Escape
   └─ dev-scripts container with dangerous permissions:
      ├─ docker.sock mounted (can control Docker)
      ├─ Bind mount to /srv/payload (can write to host)
      └─ Runs as root (uid=0)
      └─ Attacker gained host-level access

4. Persistence
   └─ Malware keeps reappearing after deletion
      └─ Persistence mechanism: UNKNOWN (still investigating)
```

### Timeline:
- **15:06-15:07 UTC:** Initial malware (`dockerd`, `docker-daemon`) appeared
- **16:00 UTC:** MongoDB secured (localhost only)
- **18:18 UTC:** `javs` process started
- **19:17 UTC:** `javs` killed and removed
- **19:30:01 UTC:** Cron jobs executed (preair/postair)
- **19:31:35 UTC:** `hash` file created on host
- **19:31:41 UTC:** `hash` process started
- **19:32 UTC:** `hash` killed and removed
- **19:39 UTC:** `dev-scripts` container stopped

---

## ⚠️ CRITICAL SECURITY ISSUES

### 1. Container Security
**`payload-dev-scripts-1` Container:**
- ❌ **docker.sock mounted** - Can control Docker daemon
- ❌ **Bind mount to /srv/payload** - Can write to host filesystem
- ❌ **Runs as root** - Full privileges
- ❌ **Restart policy: unless-stopped** - Auto-restarts if killed

**Impact:**
- Attacker can create new containers
- Attacker can run host-level commands
- Attacker can manipulate Docker volumes
- Attacker can create persistence inside Docker metadata
- Attacker can spawn processes directly on host

### 2. Persistence Mechanism
**Status:** ⚠️ UNKNOWN

Malware keeps reappearing despite:
- ✅ MongoDB secured (localhost only)
- ✅ Secrets rotated
- ✅ Processes killed
- ✅ Files deleted
- ✅ Monitoring installed

**Possible sources:**
- Hidden cron job (not found in standard locations)
- Malicious systemd service (not found)
- Compromised container (investigation ongoing)
- Reverse shell or active session (not found)
- MongoDB stored script with delayed execution
- Docker metadata persistence

---

## 🔒 SECURITY MEASURES IMPLEMENTED

### Previously Implemented:
1. ✅ MongoDB bound to localhost only
2. ✅ API endpoints secured with authentication
3. ✅ Rate limiting implemented
4. ✅ Path sanitization added
5. ✅ Secrets rotated (PAYLOAD_SECRET, PAYLOAD_API_KEY, LIBRETIME_API_KEY)
6. ✅ SSH restricted to user IP
7. ✅ Fail2ban configured (6 IPs banned)
8. ✅ Enhanced malware monitoring active

### Just Implemented:
1. ✅ Stopped `dev-scripts` container
2. ✅ Blocked mining pool domains
3. ✅ Blocked all Docker container outbound traffic

---

## 📊 CONTAINER INVESTIGATION RESULTS

### `payload-dev-scripts-1` Container:
**Status:** ✅ Container appears clean

**Findings:**
- No suspicious processes found
- No reverse shells or suspicious network connections
- No hidden scripts found
- All scripts legitimate (MD5 checksums verified)
- No malware files inside container
- Environment variables clean

**However:**
- Dangerous permissions enabled the attack
- Container can write to host via bind mount
- Container can control Docker via docker.sock

---

## 🎯 NEXT STEPS REQUIRED

### Immediate (Priority 1):
1. **Investigate persistence mechanism**
   - Check for hidden cron jobs in all locations
   - Check for malicious systemd services/timers
   - Check Docker metadata for persistence
   - Check for reverse shells or active sessions
   - Monitor for malware reappearance

2. **Secure dev-scripts container**
   - Remove docker.sock mount (or restrict access)
   - Run container as non-root user
   - Review bind mount necessity
   - Implement least-privilege access

3. **Audit all containers**
   - Check other containers for compromise
   - Review all container permissions
   - Check for suspicious network activity

### Short-term (Priority 2):
4. **Implement container security hardening**
   - Remove unnecessary capabilities
   - Use read-only root filesystems where possible
   - Implement network policies
   - Enable Docker security scanning

5. **Enhanced monitoring**
   - File integrity monitoring
   - Process monitoring
   - Network traffic analysis
   - Container behavior analysis

### Long-term (Priority 3):
6. **Consider full system rebuild**
   - If malware continues to reappear
   - If persistence mechanism cannot be identified
   - To ensure complete removal of compromise

---

## 📈 FIREWALL RULES ADDED

```bash
# Mining pool blocks
iptables -A OUTPUT -d auto.c3pool.org -j DROP
iptables -A OUTPUT -d c3pool.com -j DROP
iptables -A OUTPUT -d 172.67.135.0/24 -j DROP

# Docker container outbound traffic block
iptables -I DOCKER-USER -j DROP
```

**Note:** Docker container outbound traffic is currently blocked. This may affect legitimate container operations. Review and selectively allow required traffic.

---

## 🔍 ONGOING INVESTIGATION

### Areas Under Investigation:
1. Persistence mechanism identification
2. Full container audit
3. Network traffic analysis
4. Docker metadata inspection
5. System log analysis

### Monitoring Active:
- ✅ Enhanced malware file monitoring
- ✅ Process monitoring
- ✅ Network connection monitoring

---

## 📝 RECOMMENDATIONS

### Critical:
1. **Do NOT restart `dev-scripts` container** until it's secured
2. **Continue monitoring** for malware reappearance
3. **Document all changes** made during incident response

### High Priority:
1. Remove docker.sock access from dev-scripts container
2. Run containers as non-root users
3. Implement container security policies
4. Review all bind mounts and volume permissions

### Medium Priority:
1. Implement comprehensive logging
2. Set up automated security scanning
3. Regular security audits
4. Incident response playbook

---

## 📞 CONTACTS & ESCALATION

**Incident Response Team:** Active  
**Status:** Containment phase complete, investigation ongoing  
**Next Review:** Monitor for 24 hours for malware reappearance

---

## 📎 APPENDICES

### A. Container Configuration (dev-scripts)
```yaml
volumes:
  - /root/.ssh:/root/.ssh:ro
  - /var/run/docker.sock:/var/run/docker.sock:rw  # ⚠️ DANGEROUS
  - /srv/payload:/app:rw                          # ⚠️ DANGEROUS
  - /srv/media:/srv/media:rw
```

### B. Malware Details
- **hash binary:** 6.8MB, created 2025-12-07 19:31:35
- **javs binary:** Location `/root/.javs/javs/javs`, started 18:18 UTC

### C. Affected Systems
- Production server: `dia-prod-01-cpx31-hel1`
- MongoDB: Secured (localhost only)
- Payload CMS: API endpoints secured
- LibreTime: No compromise detected

---

**Report Generated:** 2025-12-07 19:40 UTC  
**Next Update:** When persistence mechanism identified or malware reappears

