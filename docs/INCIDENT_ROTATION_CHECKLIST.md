# Incident Response - Secrets Rotation Checklist
**Date:** 2025-12-16  
**Context:** Security kill-switch implemented, rotation required after incident

---

## Overview

This checklist covers all secrets and credentials that should be rotated after a security incident involving potential command execution compromise.

---

## 1. Payload CMS Secrets

### PAYLOAD_SECRET
- **Location:** `.env` file, `PAYLOAD_SECRET` variable
- **Purpose:** JWT signing, session encryption
- **Rotation Steps:**
  1. Generate new secret: `openssl rand -base64 32`
  2. Update `.env`: `PAYLOAD_SECRET=<new-secret>`
  3. **Impact:** All existing sessions invalidated (users must re-login)
  4. Redeploy container

### Session/JWT Secrets
- **Location:** Payload config (if custom JWT secret configured)
- **Purpose:** Token signing
- **Rotation Steps:**
  1. Check `payload.config.ts` for custom JWT configuration
  2. If present, rotate using same method as PAYLOAD_SECRET
  3. Redeploy

---

## 2. Database Credentials

### MongoDB
- **Location:** `.env` file, `DATABASE_URI` variable
- **Format:** `mongodb://[username:password@]host:port/database`
- **Rotation Steps:**
  1. Connect to MongoDB as admin
  2. Create new user with new password:
     ```javascript
     use admin
     db.createUser({
       user: "payload_new",
       pwd: "<new-password>",
       roles: [{ role: "readWrite", db: "payload" }]
     })
     ```
  3. Update `.env`: `DATABASE_URI=mongodb://payload_new:<new-password>@host:port/payload`
  4. Test connection
  5. **After verification:** Delete old user:
     ```javascript
     db.dropUser("payload_old")
     ```
  6. Redeploy container

### PostgreSQL (LibreTime)
- **Location:** `.env` file, `LIBRETIME_DB_*` variables
- **Variables:**
  - `LIBRETIME_DB_HOST`
  - `LIBRETIME_DB_NAME`
  - `LIBRETIME_DB_USER`
  - `LIBRETIME_DB_PASSWORD`
- **Rotation Steps:**
  1. Connect to PostgreSQL as admin
  2. Create new user:
     ```sql
     CREATE USER libretime_new WITH PASSWORD '<new-password>';
     GRANT ALL PRIVILEGES ON DATABASE libretime TO libretime_new;
     ```
  3. Update `.env` variables
  4. Test connection
  5. **After verification:** Drop old user:
     ```sql
     DROP USER libretime_old;
     ```
  6. Redeploy container

---

## 3. Object Storage Keys

### S3-Compatible Storage (if used)
- **Location:** `.env` file or cloud provider console
- **Variables:**
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
  - `S3_BUCKET`
  - `S3_ENDPOINT` (if custom)
- **Rotation Steps:**
  1. Log into cloud provider console (AWS/Backblaze/R2/etc.)
  2. Create new access key pair
  3. Update `.env` with new keys
  4. Test upload/download
  5. **After verification:** Delete old access key
  6. Redeploy container

---

## 4. Cloudflare API Tokens

### Cloudflare Access (if used)
- **Location:** Cloudflare dashboard, API tokens section
- **Purpose:** Cloudflare Access authentication
- **Rotation Steps:**
  1. Log into Cloudflare dashboard
  2. Navigate to "My Profile" → "API Tokens"
  3. Create new token with same permissions
  4. Update application configuration (if stored in `.env`)
  5. Test authentication
  6. **After verification:** Revoke old token
  7. Redeploy if needed

---

## 5. Email Service Credentials

### SMTP Credentials
- **Location:** `.env` file
- **Variables:**
  - `EMAIL_HOST`
  - `EMAIL_PORT`
  - `EMAIL_USER`
  - `EMAIL_PASS`
  - `EMAIL_SECURE`
- **Rotation Steps:**
  1. Log into email provider (SMTP service)
  2. Generate new password/API key
  3. Update `.env` variables
  4. Test email sending
  5. **After verification:** Revoke old password/key
  6. Redeploy container

---

## 6. Third-Party Webhooks/Tokens

### Webhook Secrets
- **Location:** `.env` file or third-party service configuration
- **Purpose:** Webhook signature verification
- **Rotation Steps:**
  1. Identify all webhook integrations (check codebase for webhook handlers)
  2. For each service:
     - Log into service dashboard
     - Generate new webhook secret
     - Update `.env` or service configuration
     - Test webhook delivery
     - Revoke old secret
  3. Redeploy container

### API Keys
- **Location:** `.env` file
- **Common variables:**
  - `*_API_KEY`
  - `*_TOKEN`
  - `*_SECRET`
- **Rotation Steps:**
  1. Search `.env` for all `*_KEY`, `*_TOKEN`, `*_SECRET` variables
  2. For each:
     - Log into service provider
     - Generate new key/token
     - Update `.env`
     - Test integration
     - Revoke old key/token
  3. Redeploy container

---

## 7. Docker Secrets (if used)

### Docker Registry Credentials
- **Location:** Docker config or `.env`
- **Rotation Steps:**
  1. Log into Docker registry
  2. Generate new access token
  3. Update Docker login credentials
  4. Test image pull
  5. Revoke old token

---

## 8. Deployment Steps After Rotation

### 1. Backup Current State
```bash
# Backup .env
cp .env .env.backup.$(date +%Y%m%d)

# Backup database (if possible)
# MongoDB: mongodump
# PostgreSQL: pg_dump
```

### 2. Update Environment Variables
- Edit `.env` file with new credentials
- Verify all variables are correct

### 3. Rebuild and Redeploy
```bash
cd /srv/payload

# Rebuild container
docker compose --profile build run --rm payload-build

# Restart services
docker compose restart payload

# Verify services are running
docker compose ps

# Check logs for errors
docker compose logs payload | tail -50
```

### 4. Verify Functionality
- [ ] Admin login works
- [ ] Database connections work
- [ ] File uploads work (if using object storage)
- [ ] Email sending works
- [ ] Webhooks receive events
- [ ] API endpoints respond correctly

### 5. Monitor Logs
```bash
# Watch logs for authentication errors
docker compose logs -f payload | grep -i "auth\|error\|fail"
```

---

## 9. Post-Rotation Verification

### Security Checks
- [ ] All old credentials revoked/deleted
- [ ] No hardcoded secrets in codebase (grep for old values)
- [ ] `.env` file permissions: `chmod 600 .env`
- [ ] `.env` not committed to git (check `.gitignore`)
- [ ] Container logs show no authentication errors

### Documentation
- [ ] Update runbook with new credential locations
- [ ] Document rotation date in incident log
- [ ] Update team on credential changes (if shared)

---

## 10. Emergency Rollback

If rotation causes issues:

1. **Immediate:** Restore `.env` from backup
   ```bash
   cp .env.backup.YYYYMMDD .env
   docker compose restart payload
   ```

2. **Investigate:** Check logs for specific error
   ```bash
   docker compose logs payload | tail -100
   ```

3. **Fix:** Correct credential issue and re-rotate

---

## Notes

- **Timing:** Rotate during low-traffic period if possible
- **Communication:** Notify team before rotation (session invalidation)
- **Testing:** Test each service after rotation before proceeding
- **Backup:** Always backup before rotation
- **Documentation:** Document all changes and dates

---

**END OF CHECKLIST**

