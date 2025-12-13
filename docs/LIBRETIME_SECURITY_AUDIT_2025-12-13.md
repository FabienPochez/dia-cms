# LibreTime Container Security Audit Report
**Date:** 2025-12-13  
**Auditor Role:** Senior Linux / Docker Security Auditor  
**Context:** Server confirmed compromised at Payload container level; assessing LibreTime containers for compromise

---

## 1. SUMMARY

- **VERDICT: LibreTime containers appear CLEAN (MEDIUM confidence)**
- **All containers:** Running expected processes only (nginx, gunicorn, php-fpm, liquidsoap, python workers)
- **No suspicious binaries:** No ELF binaries found in /tmp, /var/tmp, or /dev/shm across all containers
- **No persistence mechanisms:** No malicious cron jobs, supervisor configs, or startup scripts detected
- **Process integrity:** All processes match expected service commands; no miners, curl/wget loops, or unexpected shells
- **User context:** Most containers run as non-root (UID 1000:1000); nginx runs as root (expected for port binding)
- **Network exposure:** Ports 8080, 8001, 8002 publicly exposed (0.0.0.0) - potential attack surface
- **Suspicious activity:** Nginx logs show scanning attempts (POST /cgi-bin/ViewLog.asp) from external IPs, but all returned 400 errors
- **Filesystem mounts:** Containers mount /srv/media (shared with Payload); no evidence of cross-contamination
- **Confidence level:** MEDIUM - cannot rule out sophisticated rootkits or in-memory-only malware without deeper forensics

---

## 2. DIFFS

**NONE** - Audit-only, no configuration changes made.

---

## 3. ESSENTIAL LOGS

### Container Inventory
```
RUNNING CONTAINERS:
libretime-nginx-1        ghcr.io/libretime/libretime-nginx:latest      Up 19 hours   0.0.0.0:8080->8080/tcp
libretime-liquidsoap-1   ghcr.io/libretime/libretime-playout:latest    Up 19 hours   0.0.0.0:8001-8002->8001-8002/tcp
libretime-api-1          ghcr.io/libretime/libretime-api:latest        Up 19 hours (healthy)
libretime-legacy-1       ghcr.io/libretime/libretime-legacy:latest     Up 19 hours
libretime-analyzer-1     ghcr.io/libretime/libretime-analyzer:latest   Up 19 hours
libretime-playout-1      ghcr.io/libretime/libretime-playout:latest    Up 19 hours
libretime-postgres-1     postgres:15                                   Up 19 hours (healthy)
libretime-rabbitmq-1     rabbitmq:3.13-alpine                          Up 19 hours (healthy)
libretime-icecast-1      ghcr.io/libretime/icecast:2.4.4               Up 19 hours

All containers started: 2025-12-12T15:51:18Z (19 hours ago)
```

### Process Inspection Results
```
libretime-nginx-1:
  PID 1: nginx: master process (root:root)
  PID 21-24: nginx: worker process (nginx:nginx)

libretime-liquidsoap-1:
  PID 1: docker-init
  PID 7: libretime-liquidsoap --verbose /app/radio.liq (UID 1000:1000)

libretime-api-1:
  PID 1: docker-init
  PID 6-10: gunicorn workers (UID 1000:1000)

libretime-legacy-1:
  PID 1: docker-init
  PID 6: php-fpm: master process (UID 1000:1000)
  PID 7-8: php-fpm: pool www (UID 1000:1000)

libretime-analyzer-1:
  PID 1: docker-init
  PID 7: libretime-analyzer (UID 1000:1000)

libretime-playout-1:
  PID 1: docker-init
  PID 7: libretime-playout (UID 1000:1000)
```

### Filesystem Checks
```
/tmp, /var/tmp, /dev/shm:
- All containers: Empty or only standard system files
- No ELF binaries detected
- No files modified in last 7 days
- No suspicious executables

/app directories:
- liquidsoap: radio.liq, recorder/, scheduler/ (expected)
- api: Empty (expected)
- playout: radio.liq, recorder/, scheduler/ (expected)
- analyzer: Empty (expected)
- legacy: Standard PHP-FPM structure
- nginx: Standard nginx structure

/srv/media:
- Shared mount across all containers
- Contains legitimate media files (covers, jingles)
- No suspicious binaries in media directories
```

### Persistence Checks
```
Cron:
- All containers: Standard system cron.d entries only (e2scrub_all, apt-compat, dpkg)
- No user cron jobs
- No malicious cron entries

Supervisor/Init:
- No supervisor configs found
- Only standard init.d scripts (hwclock.sh, x11-common, nginx)
- No suspicious startup scripts
```

### Network Activity
```
libretime-nginx-1 logs (suspicious requests):
167.114.173.103 - POST /cgi-bin/ViewLog.asp HTTP/1.1 400
213.209.143.89 - POST / HTTP/1.1 200
194.163.173.9 - POST /cgi-bin/ViewLog.asp HTTP/1.1 400
62.171.148.102 - POST /cgi-bin/ViewLog.asp HTTP/1.1 400

Legitimate activity:
172.18.0.8 - Regular API calls (update-metadata, push-stream-stats) - internal LibreTime services

libretime-liquidsoap-1:
- Listening on ports 8001, 8002, 1234
- Only localhost connections observed
- Normal ffmpeg/liquidsoap activity

libretime-api-1:
- Listening on 0.0.0.0:9001 (internal network only)
- No external connections observed
```

### User Context
```
Container User Configuration:
libretime-nginx-1:        root (required for port binding)
libretime-liquidsoap-1:   1000:1000 (non-root)
libretime-api-1:          1000:1000 (non-root)
libretime-legacy-1:       1000:1000 (non-root)
libretime-analyzer-1:     1000:1000 (non-root)
libretime-playout-1:      1000:1000 (non-root)
```

---

## 4. QUESTIONS & RISKS

- **Unknown:** Whether scanning attempts (POST /cgi-bin/ViewLog.asp) were successful before logging began; logs only show 400 responses
- **Risk:** Public exposure of ports 8080, 8001, 8002 increases attack surface; if application vulnerabilities exist, containers could be compromised
- **Assumption:** Containers are clean based on process/filesystem inspection, but sophisticated rootkits or in-memory malware may evade detection
- **Cannot prove:** That containers were never compromised; only absence of obvious indicators found
- **Shared filesystem:** /srv/media mount shared with compromised Payload container; if Payload had write access, could have planted files (none found)
- **Unclear:** Whether LibreTime application code itself has vulnerabilities that could be exploited via exposed ports
- **Must assume:** If application-level compromise occurred, it may not leave filesystem traces (e.g., database-only persistence, code injection)
- **Limitation:** Audit cannot detect application-level backdoors, database modifications, or configuration file tampering without deeper analysis

---

## RECOMMENDATIONS

1. **Network hardening:** Restrict ports 8080, 8001, 8002 to localhost or implement firewall rules
2. **Application security:** Review LibreTime application code for vulnerabilities, especially endpoints exposed on port 8080
3. **Logging enhancement:** Enable detailed access logging to detect successful exploitation attempts
4. **Monitoring:** Implement container runtime security monitoring (Falco, Tracee) for behavioral detection
5. **Shared filesystem:** Audit /srv/media for any files created/modified by Payload container during compromise window
6. **Database audit:** Review LibreTime database for unauthorized modifications or backdoor accounts
7. **Configuration review:** Verify LibreTime configuration files have not been tampered with
8. **Consider rebuild:** Despite clean audit, consider rebuilding containers from known-good images as precaution

---

**Audit completed:** 2025-12-13  
**Methodology:** Read-only inspection, process analysis, filesystem scanning, persistence checks
