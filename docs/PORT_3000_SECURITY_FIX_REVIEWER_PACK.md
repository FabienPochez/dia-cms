# Port 3000 Security Fix - Reviewer Pack
**Date:** December 12, 2025  
**Auditor:** Senior DevOps / Security Engineer  
**Issue:** Cloudflare bypass - Port 3000 publicly exposed on origin IP  
**Status:** ⚠️ CRITICAL - Fix ready for approval

---

## 1) SUMMARY

- **Verdict: CRITICAL SECURITY ISSUE** - Port 3000 is publicly accessible, bypassing Cloudflare protection
- **Current State:** Docker Compose publishes port 3000 on `0.0.0.0:3000` (all interfaces) and `[::]:3000` (IPv6)
- **Evidence:** `curl -I http://95.216.191.44:3000` returns 200 OK from external network
- **UFW Status:** Port 3000 is DENY IN, but Docker bypasses UFW (uses iptables directly)
- **Nginx Config:** `content.diaradio.live` uses `proxy_pass http://95.216.191.44:3000;` (should be localhost)
- **Fix:** Bind port 3000 to `127.0.0.1:3000:3000` in Docker Compose (localhost only)
- **Secondary Fix:** Update nginx `content.diaradio.live` to use `localhost:3000` instead of IP
- **Impact:** Minimal - nginx already proxies correctly, only binding changes
- **Rollback:** Simple - revert port mapping and restart container

---

## 2) DIFFS

### File: `/srv/payload/docker-compose.yml`

```diff
--- a/docker-compose.yml
+++ b/docker-compose.yml
@@ -3,7 +3,7 @@
 services:
   payload:
     image: node:18-alpine
     ports:
-      - '3000:3000'
+      - '127.0.0.1:3000:3000'  # SECURITY: Bind to localhost only, prevent Cloudflare bypass
     volumes:
       - .:/app
       - ./scripts:/app/scripts
```

### File: `/etc/nginx/sites-available/content.diaradio.live`

```diff
--- a/content.diaradio.live
+++ b/content.diaradio.live
@@ -26,7 +26,7 @@
         add_header Access-Control-Allow-Headers 'Authorization, Content-Type' always;
         add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS, PUT, PATCH, DELETE' always;
 
-        proxy_pass http://95.216.191.44:3000;
+        proxy_pass http://localhost:3000;  # SECURITY: Use localhost instead of public IP
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

---

## 3) LOGS

**Current Port Binding (BEFORE fix):**
```
tcp   LISTEN 0      4096              0.0.0.0:3000       0.0.0.0:*    users:(("docker-proxy",pid=378786,fd=7))
tcp   LISTEN 0      4096                 [::]:3000          [::]:*    users:(("docker-proxy",pid=378794,fd=7))
```

**External Access Test (BEFORE fix):**
```
$ curl -I http://95.216.191.44:3000
HTTP/1.1 200 OK
Accept-CH: Sec-CH-Prefers-Color-Scheme
X-Powered-By: Next.js, Payload
```
**Result:** ✅ CONFIRMED - Port 3000 is publicly accessible

**UFW Status:**
```
Status: active
3000/tcp                   DENY IN     Anywhere
3000/tcp (v6)              DENY IN     Anywhere (v6)
```
**Note:** UFW rules exist but Docker bypasses UFW by default (uses iptables directly)

**Docker Container Status:**
```
payload-payload-1      0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp
```

**Nginx Configuration:**
- `content.diaradio.live`: `proxy_pass http://95.216.191.44:3000;` ❌ (uses public IP)
- `upload.content.diaradio.live`: `proxy_pass http://localhost:3000;` ✅ (correct)

**Cloudflare/nginx Proxy Test:**
```
$ curl -I https://content.diaradio.live
HTTP/2 200
server: cloudflare
```
**Result:** ✅ Working correctly via Cloudflare

---

## 4) QUESTIONS & RISKS

1. **Q: Will IPv6 be affected?**
   - **Risk:** LOW - Docker Compose `127.0.0.1:3000:3000` binds IPv4 only. IPv6 `[::]:3000` will be removed.
   - **Impact:** None - nginx uses IPv4 localhost, Cloudflare uses IPv4
   - **Mitigation:** If IPv6 is needed later, can add `[::1]:3000:3000` separately

2. **Q: Will nginx still work after binding to localhost?**
   - **Risk:** NONE - nginx runs on host and can access `127.0.0.1:3000`
   - **Verification:** `upload.content.diaradio.live` already uses `localhost:3000` successfully
   - **Test:** After fix, verify `curl -I http://127.0.0.1:3000` works from host

3. **Q: What about Docker network access?**
   - **Risk:** NONE - Container-to-container communication uses Docker network (`payload-payload-1:3000`)
   - **Impact:** None - `PAYLOAD_URL=http://payload-payload-1:3000` in `.env` is correct
   - **Note:** MongoDB already uses `127.0.0.1:27017:27017` pattern successfully

4. **Q: Will this break any external services?**
   - **Risk:** NONE - No external services should access port 3000 directly
   - **Expected:** All traffic should go through Cloudflare → nginx → localhost:3000
   - **Verification:** After fix, test `https://content.diaradio.live` still works

5. **Q: What if we need to access port 3000 for debugging?**
   - **Risk:** LOW - Can still access via `ssh` tunnel or from host: `curl http://127.0.0.1:3000`
   - **Mitigation:** If needed, temporarily revert port mapping for debugging
   - **Alternative:** Use `docker exec` to access container directly

6. **Q: Should we add UFW rules as defense-in-depth?**
   - **Risk:** LOW - Docker bypasses UFW, but rules don't hurt
   - **Status:** UFW already has `DENY IN` rules for port 3000 (redundant but harmless)
   - **Recommendation:** Keep UFW rules, but primary fix is Docker port binding

7. **Q: What about Hetzner firewall?**
   - **Risk:** MEDIUM - If Hetzner firewall allows port 3000, it should be blocked
   - **Recommendation:** Check Hetzner firewall panel, block port 3000 inbound (defense-in-depth)
   - **Note:** Not included in this fix (requires Hetzner panel access)

8. **Q: Rollback plan?**
   - **Risk:** LOW - Simple revert
   - **Rollback Steps:**
     1. Revert `docker-compose.yml`: Change `127.0.0.1:3000:3000` back to `3000:3000`
     2. Revert nginx config: Change `localhost:3000` back to `95.216.191.44:3000` (optional, nginx will work either way)
     3. Restart: `cd /srv/payload && docker compose restart payload`
     4. Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`
   - **Time to rollback:** < 2 minutes

---

## VERIFICATION STEPS (After Fix Applied)

1. **Check port binding:**
   ```bash
   ss -tulpen | grep 3000
   ```
   **Expected:** Should show only `127.0.0.1:3000`, no `0.0.0.0:3000` or `[::]:3000`

2. **Test localhost access (from server):**
   ```bash
   curl -I http://127.0.0.1:3000
   ```
   **Expected:** Should return 200 OK

3. **Test external access (from outside server):**
   ```bash
   curl -I http://95.216.191.44:3000
   ```
   **Expected:** Should timeout or connection refused (NOT 200 OK)

4. **Test Cloudflare/nginx proxy:**
   ```bash
   curl -I https://content.diaradio.live
   ```
   **Expected:** Should return 200 OK via Cloudflare

5. **Test upload subdomain:**
   ```bash
   curl -I https://upload.content.diaradio.live
   ```
   **Expected:** Should work (already uses localhost:3000)

---

## ROLLBACK PLAN

**If issues occur after applying fix:**

1. **Revert Docker Compose:**
   ```bash
   cd /srv/payload
   # Edit docker-compose.yml: change '127.0.0.1:3000:3000' back to '3000:3000'
   docker compose restart payload
   ```

2. **Revert Nginx (if needed):**
   ```bash
   sudo nano /etc/nginx/sites-available/content.diaradio.live
   # Change 'proxy_pass http://localhost:3000;' back to 'proxy_pass http://95.216.191.44:3000;'
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **Verify rollback:**
   ```bash
   ss -tulpen | grep 3000  # Should show 0.0.0.0:3000 again
   curl -I http://95.216.191.44:3000  # Should work again
   ```

**Rollback time:** < 2 minutes

---

## OPTIONAL HARDENING (Not Included in This Fix)

1. **Hetzner Firewall:** Block port 3000 inbound in Hetzner firewall panel
2. **Cloudflare WAF:** Configure WAF to block requests not from Cloudflare IPs
3. **Docker Network Isolation:** Consider using Docker networks to isolate containers further

---

**Report Generated:** 2025-12-12  
**Ready for Approval:** YES  
**Risk Level:** LOW (minimal change, easy rollback)

