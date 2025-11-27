# STREAMING INFRASTRUCTURE AUDIT — REVIEWER PACK

**Date:** 2025-11-19  
**Auditor:** AI Assistant  
**Scope:** Nginx + Icecast configuration for `/main` mount point

---

## EXECUTIVE SUMMARY

### Current State
- ✅ **Nginx vhost found:** `/etc/nginx/sites-available/schedule.diaradio.live`
- ✅ **Stream location configured:** `/main` → `http://localhost:8000/main`
- ⚠️ **Security issue:** Icecast exposed on all interfaces (`0.0.0.0:8000`)
- ⚠️ **No dedicated stream subdomain:** Using admin domain `schedule.diaradio.live`
- ✅ **Good streaming config:** Buffering disabled, long timeouts, CORS headers

### Key Findings
1. **Nginx config is well-optimized** for streaming (buffering off, 3600s timeouts)
2. **Icecast security risk:** Port 8000 accessible from all interfaces
3. **Icecast limits are conservative:** 100 clients max (may need increase)
4. **No keepalive settings** explicitly configured in nginx
5. **No separate access logs** for stream traffic

---

## 1. NGINX VHOST CONFIGURATION

### Location
- **File:** `/etc/nginx/sites-available/schedule.diaradio.live`
- **Symlink:** `/etc/nginx/sites-enabled/schedule.diaradio.live`
- **Status:** ✅ Active and serving

### Current Configuration Analysis

#### ✅ **GOOD: Streaming Optimizations**
```nginx
location /main {
    proxy_pass http://localhost:8000/main;
    proxy_http_version 1.1;
    
    # ✅ Buffering disabled (critical for live streams)
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_cache off;
    proxy_max_temp_file_size 0;
    
    # ✅ Long timeouts (3600s = 1 hour)
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 75s;
    
    # ✅ Connection keepalive
    proxy_set_header Connection "";
    
    # ✅ CORS headers for web players
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Headers "Range,Accept,Origin,Content-Type" always;
    
    # ✅ Force MP3 content type
    add_header Content-Type "audio/mpeg" always;
}
```

#### ⚠️ **MISSING: Keepalive Settings**
- No explicit `keepalive_timeout` or `keepalive_requests` in location block
- Connection keepalive enabled via `proxy_set_header Connection ""` but no tuning

#### ⚠️ **MISSING: Chunked Transfer**
- No explicit `chunked_transfer_encoding on;` directive
- Nginx handles this automatically, but explicit is better for clarity

#### ⚠️ **MISSING: Separate Access Logs**
- Stream traffic logged to main `/var/log/nginx/access.log` (3.4MB currently)
- No dedicated log for stream monitoring/analysis

#### ✅ **GOOD: TLS Configuration**
- Using Let's Encrypt certificates
- Modern TLS: `TLSv1.2 TLSv1.3`
- Strong ciphers from Mozilla recommendations
- SSL session cache enabled

#### ✅ **GOOD: Client Max Body Size**
- Set to `1G` in server block (appropriate for uploads, not relevant for streams)

---

## 2. ICECAST CONFIGURATION

### Container Status
- **Container:** `libretime-icecast-1`
- **Image:** `ghcr.io/libretime/icecast:2.4.4`
- **Status:** ✅ Running (uptime: 9 days)
- **Config:** `/etc/icecast.xml` (inside container)

### Current Settings

#### ⚠️ **CRITICAL: Security Issue - Port Binding**
```yaml
# docker-compose.yml
ports:
  - 8000:8000  # ❌ Exposed to all interfaces
```

**Current binding:**
- Host: `0.0.0.0:8000` (all interfaces)
- Container: `0.0.0.0:8000` (all interfaces)

**Risk:** Icecast directly accessible from internet, bypassing nginx

**Fix Required:**
```yaml
ports:
  - "127.0.0.1:8000:8000"  # ✅ Only localhost
```

#### ✅ **Connection Limits**
```xml
<limits>
    <clients>100</clients>              <!-- Max concurrent connections -->
    <sources>2</sources>                <!-- Max source connections -->
    <queue-size>524288</queue-size>     <!-- 512KB queue -->
    <client-timeout>30</client-timeout> <!-- 30s client timeout -->
    <header-timeout>15</header-timeout> <!-- 15s header timeout -->
    <source-timeout>10</source-timeout> <!-- 10s source timeout -->
    <burst-on-connect>1</burst-on-connect> <!-- Enable burst -->
    <burst-size>65535</burst-size>      <!-- 64KB burst size -->
</limits>
```

**Analysis:**
- ✅ `clients=100` is reasonable for small-medium stations
- ✅ `burst-on-connect=1` reduces startup latency
- ✅ `burst-size=65535` (64KB) is standard
- ⚠️ `queue-size=524288` (512KB) may be small for high bitrate streams

#### ✅ **Hostname**
```xml
<hostname>localhost</hostname>
```
- Correctly set to localhost (internal use)

#### ✅ **Listen Socket**
```xml
<listen-socket>
    <port>8000</port>
    <!-- <bind-address>127.0.0.1</bind-address> -->  <!-- Commented out -->
</listen-socket>
```

**Issue:** `bind-address` is commented, so Icecast binds to all interfaces inside container. However, Docker port mapping controls external access.

#### ✅ **Mount Point Status**
From stats XML:
- **Mount:** `/main`
- **Format:** MP3, 256 kbps, 44.1kHz, stereo
- **Current listeners:** 1
- **Peak listeners:** 3
- **Status:** ✅ Active and streaming

---

## 3. AUDIT CHECKLIST RESULTS

### Nginx Settings

| Setting | Current | Recommended | Status |
|---------|---------|-------------|--------|
| `proxy_read_timeout` | `3600s` | `3600s` | ✅ Good |
| `proxy_buffering` | `off` | `off` | ✅ Good |
| `proxy_cache` | `off` | `off` | ✅ Good |
| `proxy_request_buffering` | `off` | `off` | ✅ Good |
| `chunked_transfer_encoding` | Auto | `on` (explicit) | ⚠️ Add explicit |
| `keepalive_timeout` | Default (65s) | `65s` (explicit) | ⚠️ Add explicit |
| `keepalive_requests` | Default (100) | `1000` | ⚠️ Increase |
| `client_max_body_size` | `1G` | `1G` | ✅ Good |
| `access_log` | Shared | Separate | ⚠️ Add dedicated log |
| `TLS protocols` | `TLSv1.2 TLSv1.3` | `TLSv1.2 TLSv1.3` | ✅ Good |
| `TLS ciphers` | Modern | Modern | ✅ Good |

### Icecast Settings

| Setting | Current | Recommended | Status |
|---------|---------|-------------|--------|
| `hostname` | `localhost` | `localhost` | ✅ Good |
| `max-listeners` | `unlimited` (per mount) | `unlimited` | ✅ Good |
| `clients` (global) | `100` | `500-1000` | ⚠️ Consider increase |
| `burst-size` | `65535` (64KB) | `65535` | ✅ Good |
| `queue-size` | `524288` (512KB) | `1048576` (1MB) | ⚠️ Consider increase |
| `bind-address` | All interfaces | `127.0.0.1` | ⚠️ **CRITICAL FIX** |
| Port exposure | `0.0.0.0:8000` | `127.0.0.1:8000` | ⚠️ **CRITICAL FIX** |

---

## 4. RECOMMENDATIONS

### 🔴 **CRITICAL: Security Fixes**

#### 1. Bind Icecast to Localhost Only

**File:** `/srv/libretime/docker-compose.yml`

**Change:**
```yaml
# BEFORE
icecast:
  ports:
    - 8000:8000

# AFTER
icecast:
  ports:
    - "127.0.0.1:8000:8000"  # Only accessible from localhost
```

**Apply:**
```bash
cd /srv/libretime
# Edit docker-compose.yml
docker compose up -d icecast
```

#### 2. Uncomment Icecast Bind Address (Defense in Depth)

**File:** `/etc/icecast.xml` (inside container, or via volume mount)

**Change:**
```xml
<!-- BEFORE -->
<listen-socket>
    <port>8000</port>
    <!-- <bind-address>127.0.0.1</bind-address> -->
</listen-socket>

<!-- AFTER -->
<listen-socket>
    <port>8000</port>
    <bind-address>127.0.0.1</bind-address>
</listen-socket>
```

**Note:** This requires mounting the config file or rebuilding the container with custom config.

---

### 🟡 **IMPORTANT: Performance Optimizations**

#### 3. Add Explicit Keepalive Settings

**File:** `/etc/nginx/sites-available/schedule.diaradio.live`

**Add to `/main` location block:**
```nginx
location /main {
    # ... existing config ...
    
    # Keepalive optimization
    keepalive_timeout 65;
    keepalive_requests 1000;  # Increase from default 100
    
    # Explicit chunked transfer
    chunked_transfer_encoding on;
}
```

#### 4. Add Separate Access Log for Stream

**File:** `/etc/nginx/sites-available/schedule.diaradio.live`

**Add to `/main` location block:**
```nginx
location /main {
    # ... existing config ...
    
    # Separate logging for stream monitoring
    access_log /var/log/nginx/stream.access.log combined;
    error_log /var/log/nginx/stream.error.log warn;
}
```

**Create logrotate config:** `/etc/logrotate.d/nginx-stream`
```
/var/log/nginx/stream.*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

#### 5. Consider Increasing Icecast Limits

**For higher capacity, update Icecast config:**
```xml
<limits>
    <clients>500</clients>              <!-- Increase from 100 -->
    <queue-size>1048576</queue-size>    <!-- Increase to 1MB -->
    <!-- ... rest unchanged ... -->
</limits>
```

**Note:** Only if you expect >100 concurrent listeners.

---

### 🟢 **OPTIONAL: Dedicated Stream Subdomain**

#### 6. Create `stream.diaradio.live` Subdomain

**Benefits:**
- Separate from admin interface
- DNS-only (no Cloudflare proxy) for lower latency
- Better monitoring and analytics
- Easier to apply stream-specific optimizations

**Steps:**

1. **DNS (Cloudflare):**
   - Type: A
   - Name: `stream`
   - Content: `46.62.141.69`
   - Proxy: DNS only (grey cloud)

2. **SSL Certificate:**
   ```bash
   sudo certbot --nginx -d stream.diaradio.live
   ```

3. **Create Nginx Vhost:** `/etc/nginx/sites-available/stream.diaradio.live`
   ```nginx
   server {
       listen 443 ssl http2;
       server_name stream.diaradio.live;
       
       # SSL (managed by certbot)
       ssl_certificate /etc/letsencrypt/live/stream.diaradio.live/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/stream.diaradio.live/privkey.pem;
       include /etc/letsencrypt/options-ssl-nginx.conf;
       ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
       
       # Stream mount - optimized for 24/7 MP3 streaming
       location /main {
           proxy_pass http://127.0.0.1:8000/main;
           proxy_http_version 1.1;
           
           # Timeouts
           proxy_read_timeout 3600s;
           proxy_send_timeout 3600s;
           proxy_connect_timeout 75s;
           
           # Buffering
           proxy_request_buffering off;
           proxy_buffering off;
           proxy_cache off;
           proxy_max_temp_file_size 0;
           
           # Keepalive
           proxy_set_header Connection "";
           keepalive_timeout 65;
           keepalive_requests 1000;
           
           # Chunked transfer
           chunked_transfer_encoding on;
           
           # Headers
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           
           # Content type
           add_header Content-Type "audio/mpeg" always;
           
           # CORS
           add_header Access-Control-Allow-Origin "*" always;
           add_header Access-Control-Allow-Headers "Range,Accept,Origin,Content-Type" always;
           add_header Access-Control-Expose-Headers "Content-Length,Content-Range,Content-Type" always;
           
           # Logging
           access_log /var/log/nginx/stream.access.log combined;
           error_log /var/log/nginx/stream.error.log warn;
       }
       
       # Admin (restrict to localhost)
       location /admin {
           allow 127.0.0.1;
           allow ::1;
           deny all;
           
           proxy_pass http://127.0.0.1:8000/admin;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
       }
   }
   
   server {
       listen 80;
       server_name stream.diaradio.live;
       return 301 https://$server_name$request_uri;
   }
   ```

4. **Enable and Test:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/stream.diaradio.live /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

5. **Update LibreTime Config:** `/srv/libretime/config.yml`
   ```yaml
   stream:
     outputs:
       icecast:
         - public_url: https://stream.diaradio.live/main  # Changed
   ```

6. **Restart LibreTime:**
   ```bash
   cd /srv/libretime
   docker compose restart liquidsoap playout
   ```

---

## 5. SIMPLEST & SAFEST CONFIG FOR 24/7 MP3 STREAMING

### Minimal Changes (Security Only)

**Priority 1: Secure Icecast Binding**
```yaml
# /srv/libretime/docker-compose.yml
icecast:
  ports:
    - "127.0.0.1:8000:8000"
```

**Apply:**
```bash
cd /srv/libretime
docker compose up -d icecast
```

**Verify:**
```bash
# Should show 127.0.0.1:8000, not 0.0.0.0:8000
ss -tlnp | grep :8000
```

### Recommended Config (Security + Performance)

**Priority 2: Nginx Optimizations**
- Add explicit `keepalive_requests 1000`
- Add explicit `chunked_transfer_encoding on`
- Add separate access log for stream

**Priority 3: Dedicated Subdomain** (Optional but recommended)
- Create `stream.diaradio.live`
- DNS-only (no Cloudflare proxy)
- Stream-specific optimizations

---

## 6. TESTING & VERIFICATION

### After Applying Changes

```bash
# 1. Verify Icecast binding
ss -tlnp | grep :8000
# Should show: 127.0.0.1:8000

# 2. Test stream access
curl -I https://schedule.diaradio.live/main
# Should return: HTTP/1.1 200 OK, Content-Type: audio/mpeg

# 3. Test from external client
curl -I https://stream.diaradio.live/main  # If subdomain created

# 4. Check nginx config
sudo nginx -t

# 5. Monitor logs
sudo tail -f /var/log/nginx/stream.access.log  # If separate log created
sudo tail -f /var/log/nginx/error.log

# 6. Check Icecast stats
curl -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://localhost:8000/admin/stats.xml | grep -E "listeners|clients"
```

---

## 7. MONITORING COMMANDS

### Stream Health
```bash
# Active connections
ss -tn | grep :8000 | grep ESTAB | wc -l

# Nginx stream access (if separate log)
sudo tail -f /var/log/nginx/stream.access.log | grep "/main"

# Icecast listener count
curl -s -u admin:269e61fe1a5f06f15ccf7b526dacdfdb http://localhost:8000/admin/stats.xml | grep -oP "(?<=<listeners>)[^<]+"

# Bandwidth usage
sudo iftop -i any -f "port 8000"  # If iftop installed
```

---

## 8. SUMMARY

### Current Status: ✅ **GOOD** (with security fix needed)

**Strengths:**
- ✅ Nginx well-configured for streaming
- ✅ Buffering disabled, long timeouts
- ✅ CORS headers present
- ✅ Modern TLS configuration

**Critical Issues:**
- 🔴 Icecast exposed on all interfaces (security risk)

**Improvements:**
- 🟡 Add explicit keepalive settings
- 🟡 Separate access logs for stream
- 🟡 Consider dedicated stream subdomain

### Recommended Action Plan

1. **Immediate (Security):**
   - Bind Icecast to `127.0.0.1:8000` in docker-compose.yml
   - Restart Icecast container

2. **Short-term (Performance):**
   - Add explicit keepalive settings to nginx
   - Add separate access log for stream
   - Configure log rotation

3. **Long-term (Architecture):**
   - Create dedicated `stream.diaradio.live` subdomain
   - Move stream traffic to DNS-only subdomain
   - Update app to use new stream URL

---

## 9. QUESTIONS FOR REVIEW

1. **Expected listener capacity?** (Current limit: 100 clients)
2. **Current peak concurrent listeners?** (Stats show peak: 3)
3. **Do you want separate stream subdomain?** (Recommended for production)
4. **Log retention policy?** (Currently no rotation for stream logs)
5. **Monitoring setup?** (Any existing monitoring for stream health?)

---

**End of Audit Report**

