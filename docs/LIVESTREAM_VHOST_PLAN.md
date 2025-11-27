# NGINX LIVESTREAM VHOST — REVIEWER PACK

**Date:** 2025-11-19  
**Status:** Planning/Audit Only — No Changes Applied

---

## SUMMARY

- Current stream vhost: `/etc/nginx/sites-available/schedule.diaradio.live` serves `/main` → `http://localhost:8000/main` with optimized streaming settings
- New vhost needed: `/etc/nginx/sites-available/livestream.diaradio.live` for dedicated stream subdomain
- SSL certificate: `livestream.diaradio.live` not in existing certs; requires new cert via `certbot --nginx`
- Current certs: `content.diaradio.live` covers `content.diaradio.live` + `schedule.diaradio.live`; separate cert for `upload.content.diaradio.live`
- Stream config: Current `/main` location has all required optimizations (buffering off, 3600s timeouts, CORS, chunked transfer)
- Other locations: `schedule.diaradio.live` also serves `/` (LibreTime admin), `/8001/`, `/8002/` (source inputs) — these remain unchanged
- Logging: New vhost will use separate access/error logs: `/var/log/nginx/livestream.access.log` and `livestream.error.log`
- DNS: `livestream.diaradio.live` → `46.62.141.69` (DNS-only, no Cloudflare proxy) — already configured
- Activation: Requires symlink creation, nginx config test, certbot cert generation, and nginx reload
- Safety: Both `schedule.diaradio.live/main` and `livestream.diaradio.live/main` will work simultaneously during transition

---

## DIFFS

### Proposed New File: `/etc/nginx/sites-available/livestream.diaradio.live`

```diff
+server {
+    listen 80;
+    server_name livestream.diaradio.live;
+    return 301 https://$server_name$request_uri;
+}
+
+server {
+    listen 443 ssl http2;
+    server_name livestream.diaradio.live;
+    
+    # SSL Configuration (will be managed by certbot)
+    ssl_certificate /etc/letsencrypt/live/livestream.diaradio.live/fullchain.pem;
+    ssl_certificate_key /etc/letsencrypt/live/livestream.diaradio.live/privkey.pem;
+    include /etc/letsencrypt/options-ssl-nginx.conf;
+    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
+    
+    # Separate logging for stream monitoring
+    access_log /var/log/nginx/livestream.access.log combined;
+    error_log /var/log/nginx/livestream.error.log warn;
+    
+    # Stream mount - optimized for 24/7 MP3 streaming
+    location /main {
+        proxy_pass http://127.0.0.1:8000/main;
+        proxy_http_version 1.1;
+        
+        # Headers
+        proxy_set_header Host $host;
+        proxy_set_header X-Real-IP $remote_addr;
+        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
+        proxy_set_header X-Forwarded-Proto $scheme;
+        proxy_set_header Connection "";
+        
+        # Streaming optimizations
+        proxy_read_timeout 3600s;
+        proxy_send_timeout 3600s;
+        proxy_connect_timeout 75s;
+        
+        # Disable buffering for real-time streaming
+        proxy_buffering off;
+        proxy_request_buffering off;
+        proxy_cache off;
+        proxy_max_temp_file_size 0;
+        
+        # TCP optimizations
+        sendfile on;
+        tcp_nopush on;
+        tcp_nodelay on;
+        
+        # Chunked transfer encoding
+        chunked_transfer_encoding on;
+        
+        # Content type and CORS
+        add_header Content-Type "audio/mpeg" always;
+        add_header Access-Control-Allow-Origin "*" always;
+        add_header Access-Control-Allow-Headers "Range,Accept,Origin,Content-Type" always;
+        add_header Access-Control-Expose-Headers "Content-Length,Content-Range,Content-Type" always;
+    }
+    
+    # Block all other paths (stream-only subdomain)
+    location / {
+        return 404;
+    }
+}
```

**Note:** The SSL certificate paths will be created by `certbot --nginx` when the vhost is activated.

---

## LOGS

No commands were executed that produced logs. All information gathered via read-only inspection:

- Read `/etc/nginx/sites-available/schedule.diaradio.live` (current stream config)
- Listed `/etc/letsencrypt/live/` (certificate directories)
- Checked certbot certificates (existing cert coverage)
- Inspected SSL certificate SANs (confirmed `livestream.diaradio.live` not covered)

---

## QUESTIONS & RISKS

### Questions

1. **Keepalive settings**: Should we add explicit `keepalive_timeout` and `keepalive_requests` to the `/main` location? Current config doesn't have them explicitly set (uses nginx defaults: 65s timeout, 100 requests).

2. **Admin access**: Should `livestream.diaradio.live` have any admin endpoints (e.g., `/admin` for Icecast stats), or keep it stream-only with 404 for all other paths?

3. **Log rotation**: Should we create a logrotate config for `livestream.*.log` now, or handle it later? Stream logs can grow large with continuous traffic.

4. **Rate limiting**: Do we want to add rate limiting to prevent abuse, or rely on Cloudflare (though DNS-only means no Cloudflare protection)?

### Risks

1. **SSL certificate generation**: `certbot --nginx` must be run after creating the vhost file and symlink, but before nginx reload. If certbot fails, nginx config test will fail due to missing cert files.

2. **DNS propagation**: Although DNS is already configured, verify `livestream.diaradio.live` resolves correctly before running certbot (certbot needs DNS to validate).

3. **Port 80 requirement**: Certbot needs port 80 accessible for HTTP-01 challenge. Ensure firewall allows this temporarily if needed.

4. **Nginx reload timing**: If nginx reload happens before certbot completes, the vhost will fail to start due to missing SSL certificates. Sequence: create file → symlink → `nginx -t` (will fail) → `certbot --nginx` → `nginx -t` (should pass) → `systemctl reload nginx`.

5. **Existing stream**: The current `schedule.diaradio.live/main` will continue working, but we should verify both endpoints work simultaneously after activation.

6. **App migration**: The app currently uses `schedule.diaradio.live/main`. After this vhost is live, app code needs to be updated to use `livestream.diaradio.live/main` in a separate step.

---

## ACTIVATION PLAN (DO NOT EXECUTE YET)

### Step 1: Create Vhost File
```bash
sudo nano /etc/nginx/sites-available/livestream.diaradio.live
# Paste the proposed configuration above
```

### Step 2: Create Symlink
```bash
sudo ln -s /etc/nginx/sites-available/livestream.diaradio.live /etc/nginx/sites-enabled/livestream.diaradio.live
```

### Step 3: Test Nginx Config (Will Fail Initially)
```bash
sudo nginx -t
# Expected: Will fail due to missing SSL certificate files
```

### Step 4: Generate SSL Certificate
```bash
sudo certbot --nginx -d livestream.diaradio.live
# This will:
# - Verify DNS resolution
# - Perform HTTP-01 challenge
# - Create certificate files
# - Update the vhost file with correct cert paths
```

### Step 5: Test Nginx Config Again (Should Pass)
```bash
sudo nginx -t
# Expected: Should pass now that certs exist
```

### Step 6: Reload Nginx
```bash
sudo systemctl reload nginx
```

### Step 7: Verify Both Endpoints Work
```bash
# Test new endpoint
curl -I https://livestream.diaradio.live/main
# Expected: HTTP/2 200, Content-Type: audio/mpeg

# Test existing endpoint (should still work)
curl -I https://schedule.diaradio.live/main
# Expected: HTTP/2 200, Content-Type: audio/mpeg
```

### Step 8: Monitor Logs
```bash
# Watch new stream logs
sudo tail -f /var/log/nginx/livestream.access.log

# Check for errors
sudo tail -f /var/log/nginx/livestream.error.log
```

---

## SAFETY CHECKS (Post-Activation Verification)

### Immediate Verification
```bash
# 1. Test new livestream endpoint
curl -I https://livestream.diaradio.live/main
# Expected: HTTP/2 200, Content-Type: audio/mpeg, CORS headers present

# 2. Test existing schedule endpoint (should still work)
curl -I https://schedule.diaradio.live/main
# Expected: HTTP/2 200, Content-Type: audio/mpeg

# 3. Verify SSL certificate
openssl s_client -connect livestream.diaradio.live:443 -servername livestream.diaradio.live < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
# Expected: Subject includes livestream.diaradio.live, valid dates

# 4. Check nginx status
sudo systemctl status nginx
# Expected: active (running)

# 5. Verify port binding
ss -tlnp | grep :8000
# Expected: 127.0.0.1:8000 (Icecast bound to localhost)
```

### Ongoing Monitoring
```bash
# Monitor stream access logs
sudo tail -f /var/log/nginx/livestream.access.log | grep "/main"

# Check for connection errors
sudo grep -i error /var/log/nginx/livestream.error.log

# Verify Icecast is receiving connections
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://127.0.0.1:8000/admin/stats.xml | grep -E "listeners|clients"
```

### Rollback Plan
If issues occur:
```bash
# 1. Remove symlink
sudo rm /etc/nginx/sites-enabled/livestream.diaradio.live

# 2. Reload nginx
sudo systemctl reload nginx

# 3. Verify schedule.diaradio.live/main still works
curl -I https://schedule.diaradio.live/main
```

---

## CURRENT CONFIGURATION ANALYSIS

### Existing `/main` Location (schedule.diaradio.live)

**Proxy Settings:**
- `proxy_pass http://localhost:8000/main` (will need to change to `127.0.0.1:8000/main` for consistency, but both work)
- `proxy_http_version 1.1`
- `proxy_set_header Connection ""` (enables keepalive)

**Streaming Optimizations:**
- `proxy_read_timeout 3600s` ✅
- `proxy_send_timeout 3600s` ✅
- `proxy_connect_timeout 75s` ✅
- `proxy_buffering off` ✅
- `proxy_request_buffering off` ✅
- `proxy_cache off` ✅
- `proxy_max_temp_file_size 0` ✅

**Content & CORS:**
- `add_header Content-Type "audio/mpeg" always` ✅
- `add_header Access-Control-Allow-Origin "*" always` ✅
- `add_header Access-Control-Allow-Headers` ✅
- `add_header Access-Control-Expose-Headers` ✅

**Missing (to add in new vhost):**
- `sendfile on` (not explicitly set)
- `tcp_nopush on` (not explicitly set)
- `tcp_nodelay on` (not explicitly set)
- `chunked_transfer_encoding on` (not explicitly set, but nginx handles automatically)
- `keepalive_timeout` (uses default 65s)
- `keepalive_requests` (uses default 100)

### Other Locations in schedule.diaradio.live

- `/` → `http://localhost:8080` (LibreTime admin interface) — **MUST NOT BREAK**
- `/8001/` → `http://localhost:8001/` (Master source input) — **MUST NOT BREAK**
- `/8002/` → `http://localhost:8002/` (Show source input) — **MUST NOT BREAK**

These locations are not affected by the new `livestream.diaradio.live` vhost.

---

**End of Reviewer Pack**

