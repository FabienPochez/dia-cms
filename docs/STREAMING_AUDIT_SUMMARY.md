# STREAMING INFRASTRUCTURE AUDIT — EXECUTIVE SUMMARY

**Date:** 2025-11-19  
**Status:** ✅ Configuration is good, but **CRITICAL security fix needed**

---

## 🔴 CRITICAL: Security Issue

**Icecast is exposed on all interfaces** (`0.0.0.0:8000`)

**Fix Required:**
```yaml
# /srv/libretime/docker-compose.yml
icecast:
  ports:
    - "127.0.0.1:8000:8000"  # Change from: 8000:8000
```

**Apply:**
```bash
cd /srv/libretime
# Edit docker-compose.yml (change ports line)
docker compose up -d icecast
```

---

## ✅ Current Configuration Status

### Nginx Vhost: `/etc/nginx/sites-available/schedule.diaradio.live`

**Stream Location:** `/main` → `http://localhost:8000/main`

**Good Settings:**
- ✅ `proxy_buffering off` (critical for live streams)
- ✅ `proxy_read_timeout 3600s` (1 hour, good for long connections)
- ✅ CORS headers configured
- ✅ Modern TLS (TLSv1.2/TLSv1.3)

**Missing/Optional:**
- ⚠️ No explicit `keepalive_requests` (defaults to 100, could be 1000)
- ⚠️ No explicit `chunked_transfer_encoding on`
- ⚠️ No separate access log for stream monitoring

### Icecast Container: `libretime-icecast-1`

**Current Limits:**
- Max clients: 100
- Max sources: 2
- Queue size: 512KB
- Burst size: 64KB

**Status:** ✅ Running, 1 current listener, peak 3

---

## 📋 Recommended Changes

### Priority 1: Security (CRITICAL)

**File:** `/srv/libretime/docker-compose.yml`

```diff
 icecast:
   image: ghcr.io/libretime/icecast:2.4.4
   ports:
-    - 8000:8000
+    - "127.0.0.1:8000:8000"
   environment:
```

### Priority 2: Nginx Optimizations (IMPORTANT)

**File:** `/etc/nginx/sites-available/schedule.diaradio.live`

```diff
     location /main {
         proxy_pass http://localhost:8000/main;
         proxy_http_version 1.1;
         proxy_set_header Connection "";
+        keepalive_timeout 65;
+        keepalive_requests 1000;
+        chunked_transfer_encoding on;
         
         # ... existing config ...
+        
+        access_log /var/log/nginx/stream.access.log combined;
+        error_log /var/log/nginx/stream.error.log warn;
     }
```

### Priority 3: Dedicated Stream Subdomain (OPTIONAL)

**Benefits:**
- Separate from admin interface
- DNS-only (no Cloudflare proxy = lower latency)
- Better monitoring

**See full audit report for implementation steps.**

---

## 📊 Configuration Comparison

| Setting | Current | Recommended | Priority |
|---------|---------|-------------|----------|
| Icecast binding | `0.0.0.0:8000` | `127.0.0.1:8000` | 🔴 CRITICAL |
| `keepalive_requests` | 100 (default) | 1000 | 🟡 Important |
| `chunked_transfer_encoding` | Auto | Explicit `on` | 🟡 Important |
| Separate access log | No | Yes | 🟡 Important |
| Stream subdomain | No | `stream.diaradio.live` | 🟢 Optional |

---

## 🚀 Quick Start: Apply Critical Fix

```bash
# 1. Edit docker-compose.yml
cd /srv/libretime
sudo nano docker-compose.yml
# Change: ports: - 8000:8000
# To:     ports: - "127.0.0.1:8000:8000"

# 2. Restart Icecast
docker compose up -d icecast

# 3. Verify
ss -tlnp | grep :8000
# Should show: 127.0.0.1:8000 (not 0.0.0.0:8000)

# 4. Test stream still works
curl -I https://schedule.diaradio.live/main
```

---

## 📖 Full Report

See `/srv/payload/docs/STREAMING_INFRA_AUDIT.md` for:
- Complete configuration analysis
- Detailed recommendations
- Implementation steps
- Testing procedures
- Monitoring commands

---

**Next Steps:**
1. ✅ Apply critical security fix (Icecast binding)
2. ⚠️ Consider nginx optimizations
3. 💡 Plan dedicated stream subdomain (optional)

