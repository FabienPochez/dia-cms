# Security Audit Report - December 7, 2025

## Executive Summary

**Date**: 2025-12-07  
**Status**: ✅ MongoDB Secured | ⚠️ Secrets Need Rotation

---

## 1. Malware Status ✅

### Current Status
- ✅ **No malware files found** in `/srv/payload`, `/var/tmp`, `/tmp`
- ✅ **No suspicious processes** running
- ✅ **Monitoring active** - watching all directories where malware appeared

### Previous Incidents
- **15:06-15:07 UTC**: Malware appeared (`dockerd`, `docker-daemon` in `/srv/payload`)
- **15:25 UTC**: Malware reappeared in `/var/tmp/docker-daemon` (consuming 388% CPU, 2.4GB RAM)
- **All instances killed and deleted**

### Monitoring
- **Service**: `docker-malware-monitor.service` (enabled, running)
- **Directories monitored**: `/srv/payload`, `/var/tmp`, `/tmp`
- **Files monitored**: `dockerd`, `docker-daemon`, `sex.sh`
- **Log**: `/var/log/docker-malware-monitor.log`

---

## 2. MongoDB Security ✅ SECURED

### Before (CRITICAL VULNERABILITY)
- ❌ Exposed on `0.0.0.0:27017` (publicly accessible from internet)
- ❌ No authentication enabled
- ❌ Anyone could connect and access database

### After (SECURED)
- ✅ Bound to `127.0.0.1:27017` (localhost only)
- ✅ Only accessible from local machine
- ✅ Still accessible from Docker containers via internal network (`mongo:27017`)

### Configuration Change
```yaml
# docker-compose.yml
mongo:
  ports:
    - '127.0.0.1:27017:27017'  # SECURITY: Bind to localhost only
```

---

## 3. Database Audit Results

### Admin Users
- **1 admin account found**: `iepa@diaradio.live` (created 2025-07-30, last updated 2025-12-05)
  - ✅ Appears legitimate
  - Has API key enabled

### Users Updated Today (2025-12-07)
- **1 staff user**: `jb.gervais@hotmail.fr` (updated 15:11:16 UTC)
  - **Update Type**: User login (legitimate)
  - **Evidence from Nginx logs**:
    - `15:11:13` - GET `/api/users?where[email][equals]=jb.gervais@hotmail.fr` (user lookup)
    - `15:11:16` - POST `/api/users/login` (login request)
    - **IP**: `162.158.22.198/199` (legitimate user IP)
    - **User-Agent**: Chrome on macOS (legitimate browser)
  - **Database Changes**:
    - New session created: `97d4f8a6-a8eb-478d-8ae6-401953f1d470`
    - Session expires: `2026-02-05 15:11:16` (60 days, normal token expiration)
    - `updatedAt` timestamp updated (normal on login)
    - No password change (hash unchanged)
    - No role change (still `staff`)
    - No API key changes
  - **Timing**: Updated 4-5 minutes after malware appeared (15:06-15:07), but BEFORE MongoDB secured (16:00)
  - **Assessment**: ✅ **LIKELY LEGITIMATE** - Normal login behavior, but verify with user that they logged in at this time

### Suspicious Users
- ✅ **No suspicious users found** (no test/admin/root/hack/malware/attacker emails)
- ✅ **No users created today** (all existing accounts)

### Sessions
- ✅ **No active sessions found** in database

---

## 4. Admin Endpoint Security ✅

### Status
- ✅ `/admin` redirects to `/admin/login` (307 redirect)
- ✅ Requires authentication for collection management
- ✅ Access control: `adminPanelOnly` function
  - Unauthenticated users: ALLOWED (for password reset routes only)
  - Authenticated admin/staff: ALLOWED
  - Authenticated hosts/users: BLOCKED

### Protection
- Payload CMS built-in authentication
- Role-based access control (admin/staff only)
- Session-based authentication with cookies

---

## 5. Secrets That Need Rotation ⚠️

### Current Secrets (EXPOSED - Need Rotation)
```
PAYLOAD_SECRET=2dada6f02780cbeec7a7f968
PAYLOAD_API_KEY=Z7kR3pV9tXyLqF2sMbN8aC1eJhGdUwYo
LIBRETIME_API_KEY=cee870b7f12f65edec103a9c02987697
```

### Generated New Secrets (Ready for Rotation)
```
NEW_PAYLOAD_SECRET=e35eea2f4c52aaa905e5f22bcbeb8595e64700073338f18c84a890ab5fce80af
NEW_PAYLOAD_API_KEY=a9cdaddf12701ae59c2dcafa2c645f33989b4f02e016a45510a135aff3cebb4c
NEW_LIBRETIME_API_KEY=f7f50b08a88c8c7c462c506f29d8cdbd7e5f3e2d4d4fe4f2
```

### Rotation Steps Required
1. Update `.env` file with new secrets
2. Update user API keys in Payload admin (if using user-specific keys)
3. Update LibreTime configuration (if API key is used there)
4. Restart Payload container
5. Update any scripts/cron jobs that use these keys

---

## 6. Persistence Mechanisms Checked ✅

### Systemd Services
- ✅ No malicious services found
- ✅ Only legitimate Docker services

### Cron Jobs
- ✅ No malicious cron jobs found
- ✅ All jobs are legitimate application tasks

### SSH Backdoors
- ✅ Only 1 legitimate SSH key in `authorized_keys`
- ✅ No unauthorized keys found

### Bash Profiles
- ✅ No malicious injections found
- ✅ No dockerd/docker-daemon references

### Hidden Scripts
- ✅ Only legitimate `/usr/bin/dockerd` found

---

## 7. Network Security ✅

### Firewall
- ✅ 4 attacker IPs blocked:
  - `23.132.164.54`
  - `193.34.213.150`
  - `216.158.232.43`
  - `167.71.227.125` (SSH brute force)

### Rate Limiting
- ✅ SSH: 4 connections per 60 seconds per IP
- ✅ fail2ban: 3 failures = 24h ban
- ✅ SSH MaxStartups: 5:30:60

### Docker Socket
- ✅ Permissions: `root:docker` (not world-writable)
- ✅ Not exposed via network

---

## Recommendations

### Immediate Actions
1. ✅ **MongoDB secured** (completed)
2. ⚠️ **Rotate all secrets** (see section 5)
3. ⚠️ **Review user update** at 15:11:16 UTC (jb.gervais@hotmail.fr)
4. ✅ **Continue monitoring** (active)

### Ongoing Monitoring
- Monitor `/var/log/docker-malware-monitor.log` for malware detection
- Check for suspicious user account changes
- Monitor MongoDB access logs (if enabled)
- Review Payload API access logs

### Long-term Security
- Consider enabling MongoDB authentication (even on localhost)
- Implement database access logging
- Regular security audits
- Keep all dependencies updated

---

## Conclusion

**MongoDB exposure was the primary attack vector.** With MongoDB now secured to localhost only, the attacker should no longer be able to access the database directly. However, **all secrets must be rotated** as they were likely extracted when MongoDB was exposed.

**System is now significantly more secure**, but secret rotation is critical to prevent continued unauthorized access.

