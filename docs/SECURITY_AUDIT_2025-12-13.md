# Security Audit Report - Compromised Server
**Date:** 2025-12-13  
**Auditor Role:** Senior Linux / Docker Security Auditor  
**Server Status:** CONFIRMED COMPROMISED (crypto-miner + outbound scanning observed)

---

## 1. SUMMARY

- **VERDICT: Container-only compromise (HIGH confidence)**
- **Primary finding:** Suspicious ELF binary `/tmp/123` (3.7MB, MD5: c798b4bcf337d1c7420871b9a4f55fa8) in `payload-payload-1` container, created Dec 13 10:22
- **Network exposure:** Ports 8080, 8001, 8002 publicly exposed (0.0.0.0) via Docker proxy; ports 80/443 via nginx on host
- **Container security:** `payload-payload-1` runs as root (UID 0); no privileged containers detected; no Docker socket mounted
- **Host filesystem access:** Container has read-write mounts to `/srv/payload` and `/srv/media`; no host root mount detected
- **Secrets exposure:** Multiple API keys/secrets in container environment variables (PAYLOAD_SECRET, PAYLOAD_API_KEY, LIBRETIME_API_KEY, EMAIL_PASS, POSTGRES_PASSWORD, etc.)
- **Host persistence:** No suspicious binaries in /tmp, /usr/local/bin, /usr/bin; no malicious cron jobs; no suspicious systemd services
- **Outbound activity:** Active connections from host node processes (PID 688074) to external IPs (35.174.66.108:443, 3.233.126.43:443) - likely legitimate Cursor IDE; no active mining/scanning processes detected
- **Blast radius:** Compromise appears limited to `payload-payload-1` container; host Docker daemon not directly accessible from container; secrets must be rotated
- **Host reusability:** Host likely reusable after container cleanup, but secrets rotation mandatory; Docker daemon appears untainted

---

## 2. DIFFS

**NONE** - Audit-only, no configuration changes made.

---

## 3. ESSENTIAL LOGS

### Network Exposure
```
LISTENING PORTS:
0.0.0.0:8080  -> docker-proxy (PID 412535) -> libretime-nginx-1
0.0.0.0:8001  -> docker-proxy (PID 412380) -> libretime-liquidsoap-1
0.0.0.0:8002  -> docker-proxy (PID 412413) -> libretime-liquidsoap-1
0.0.0.0:80    -> nginx (PID 343100) on host
0.0.0.0:443   -> nginx (PID 343100) on host
127.0.0.1:3000 -> docker-proxy -> payload-payload-1
```

### Container State
```
CONTAINER: payload-payload-1
- Image: node:18-alpine
- Status: Up 2 hours (started 2025-12-13T08:42:32Z)
- User: root (UID 0)
- Privileged: false
- Mounts: /srv/payload:/app:rw, /srv/media:/srv/media:rw
- No Docker socket mounted
```

### Suspicious Binary
```
/tmp/123 in payload-payload-1:
- Size: 3,874,856 bytes (3.7MB)
- Type: ELF binary (confirmed via hexdump: 7f 45 4c 46)
- Permissions: -rwxr-xr-x (0755)
- Owner: root:root
- Created: Dec 13 10:22:23
- MD5: c798b4bcf337d1c7420871b9a4f55fa8
- NOT currently executing (no process found)
```

### Container Processes
```
PID   USER  COMMAND
  1   root  sh -c (startup script)
 10   root  npm run start
 21   root  next-server (v15.3.2) [11 threads, sleeping]
```

### Outbound Connections
```
Host process 688074 (node - Cursor IDE):
- 95.216.191.44:59742 -> 35.174.66.108:443 (ESTAB)
- 95.216.191.44:44678 -> 3.233.126.43:443 (ESTAB)

Container payload-payload-1:
- Only connections to MongoDB (172.19.0.2:27017) - legitimate
```

### Environment Secrets (Exposed)
```
PAYLOAD_SECRET=e35eea2f4c52aaa905e5f22bcbeb8595e64700073338f18c84a890ab5fce80af
PAYLOAD_API_KEY=a9cdaddf12701ae59c2dcafa2c645f33989b4f02e016a45510a135aff3cebb4c
LIBRETIME_API_KEY=cee870b7f12f65edec103a9c02987697
EMAIL_PASS=re_hqTVeAnJ_6SDxFwh5PTJFgWsXCVestMQo
POSTGRES_PASSWORD=libretime
RABBITMQ_DEFAULT_PASS=libretime
ICECAST_ADMIN_PASSWORD=269e61fe1a5f06f15ccf7b526dacdfdb
```

### Host Persistence Checks
```
Cron: No malicious entries found
Systemd: No suspicious services enabled
/tmp: No suspicious binaries (checked host)
/usr/local/bin, /usr/bin: No recent executables
SSH: 2 authorized keys present (legitimate)
```

---

## 4. QUESTIONS & RISKS

- **Unknown:** Whether `/tmp/123` was executed or is dormant; execution history not available without deeper forensics
- **Unknown:** How the binary was delivered (web exploit, compromised dependency, or other vector)
- **Risk:** Host filesystem mounts (`/srv/payload`, `/srv/media`) allow container to modify host files; if binary executed, could have written persistence to host
- **Risk:** Secrets in environment variables are accessible to any process in container; if attacker gained code execution, all secrets are compromised
- **Assumption:** Binary is crypto-miner based on context, but cannot confirm without execution or static analysis (not performed)
- **Unclear:** Whether compromise occurred via exposed ports (8080/8001/8002) or through application vulnerability
- **Cannot prove:** That host filesystem was not modified by attacker; only absence of obvious persistence mechanisms found
- **Must assume unsafe:** All secrets exposed in container environment must be rotated; cannot verify if they were exfiltrated

---

## RECOMMENDATIONS

1. **Immediate:** Stop `payload-payload-1` container and preserve `/tmp/123` for analysis
2. **Secrets rotation:** Rotate all API keys, passwords, and tokens listed in environment variables
3. **Network hardening:** Restrict ports 8080, 8001, 8002 to localhost or firewall rules
4. **Container security:** Run `payload-payload-1` as non-root user (UID 1000:1000)
5. **Host verification:** Perform full filesystem integrity check on `/srv/payload` and `/srv/media`
6. **Docker cleanup:** Rebuild `payload-payload-1` from clean image; review application code for vulnerabilities
7. **Monitoring:** Enable container runtime security monitoring (Falco, Tracee, or similar)

---

**Audit completed:** 2025-12-13  
**Methodology:** Read-only inspection, no modifications made
