# Inbox Hydration Networking + bulk_import Execution Path Audit

**Date:** 2025-12-19  
**Status:** Audit Complete  
**Objective:** Determine why Inbox Hydration bulk import fails while archive flow worked

---

## 1) SUMMARY

- **Network Topology Issue:** `libretime-api-1` container is NOT on `dia_internal` network; only `libretime-nginx-1` bridges both networks
- **Jobs Container Networking:** Jobs container CAN reach Payload (404 response = service reachable) and LibreTime nginx (502 = service reachable but upstream failing)
- **bulk_import Execution Path:** `bulk_import` CLI command DOES use HTTP upload internally - it POSTs to `/rest/media` endpoint
- **URL Resolution Problem:** `bulk_import` reads `public_url` from `/etc/libretime/config.yml` (currently `https://schedule.diaradio.live`), NOT from `LIBRETIME_PUBLIC_URL` env var
- **PHP-FPM Status:** PHP-FPM is running in `libretime-legacy-1` (pid 7, "ready to handle connections")
- **Nginx Upstream Config:** nginx correctly configured to proxy to `legacy:9000` (resolves to `libretime-legacy-1`)
- **502 Root Cause:** When `bulk_import` uses internal URL (`http://nginx:8080`), nginx returns 502 because it cannot connect to PHP-FPM upstream
- **Archive Script Difference:** Archive script uses same `bulk_import` approach but may have worked when config was toggled to internal URL AND PHP-FPM was healthy
- **Inbox Script Approach:** Inbox script attempted HTTP upload directly (different path) but also hits 502 when using internal URL

---

## 2) DIFFS

**No code changes made** - audit only.

---

## 3) LOGS

### Network Inventory

```
Networks:
- dia_internal: payload-payload-1, libretime-nginx-1, libretime-postgres-1
- payload_default: payload-payload-1, payload-mongo-1
- libretime_default: libretime-api-1, libretime-legacy-1, libretime-nginx-1

Container Network Attachments:
payload-jobs-1:        dia_internal, payload_default
payload-payload-1:     dia_internal (172.20.0.3), payload_default (172.18.0.3)
libretime-api-1:       libretime_default ONLY (172.19.0.10) - NOT on dia_internal
libretime-legacy-1:    libretime_default ONLY (172.19.0.5) - NOT on dia_internal
libretime-nginx-1:     dia_internal (172.20.0.2), libretime_default (172.19.0.11)
```

### Name Resolution from Jobs Container

```
Resolved hostnames:
172.20.0.3        payload  payload
172.20.0.2        libretime-nginx-1  libretime-nginx-1
(libretime-api-1 NOT resolved - not on dia_internal network)
```

### Connectivity Tests from Jobs Container

```
Payload: 404 (service reachable, endpoint not found - expected)
LibreTime nginx: 502 (service reachable, upstream failing)
```

### Archive Script Execution Path

```typescript
// import-batch-archives-media.ts line 411
const command = `docker exec -e LIBRETIME_PUBLIC_URL=http://nginx:8080 libretime-api-1 libretime-api bulk_import --path "${directoryPath}" --allowed-extensions "mp3"`
```

**Key:** Uses `docker exec` from HOST, sets `LIBRETIME_PUBLIC_URL` env var, but `bulk_import` ignores env var and reads config file.

### Inbox Script Execution Path

```typescript
// hydrate-inbox-lt.ts line 389
const response = await axios.post(`${baseUrl}/rest/media`, form, {
  auth: { username: LIBRETIME_API_KEY, password: '' },
  headers: form.getHeaders(),
  ...
})
```

**Key:** Attempts direct HTTP upload to `/rest/media` endpoint (different approach than archive script).

### bulk_import Smoke Test

```
$ docker exec -e LIBRETIME_PUBLIC_URL=http://nginx:8080 libretime-api-1 libretime-api bulk_import --path "/srv/media/new" --allowed-extensions "mp3"

Error: 413 Client Error: Payload Too Large for url: https://schedule.diaradio.live/rest/media
```

**Key Finding:** `bulk_import` IGNORES `LIBRETIME_PUBLIC_URL` env var and uses config file value (`https://schedule.diaradio.live`).

### LibreTime Config File

```
$ docker exec libretime-api-1 cat /etc/libretime/config.yml | grep public_url
  public_url: https://schedule.diaradio.live
```

**Key:** Config file has public URL, not internal URL.

### PHP-FPM Status

```
$ docker logs libretime-legacy-1 | grep -i "fpm\|ready"
[19-Dec-2025 12:46:44] NOTICE: fpm is running, pid 7
[19-Dec-2025 12:46:44] NOTICE: ready to handle connections
```

**Key:** PHP-FPM is running and ready.

### Nginx Upstream Configuration

```
$ docker exec libretime-nginx-1 cat /etc/nginx/conf.d/default.conf | grep -A 2 fastcgi_pass
    fastcgi_pass legacy:9000;
```

```
$ docker exec libretime-nginx-1 getent hosts legacy
172.19.0.5      legacy
```

**Key:** nginx correctly configured to proxy to `legacy:9000`, and hostname resolves correctly.

### 502 Error Details (from previous testing)

```
nginx error: connect() failed (111: Connection refused) while connecting to upstream
upstream: "fastcgi://172.19.0.7:9000"
```

**Key:** nginx tries to connect to `172.19.0.7:9000` but gets connection refused. However, `legacy` resolves to `172.19.0.5`, not `172.19.0.7`. This suggests nginx may be using a cached/stale IP or there's a network partition.

---

## 4) QUESTIONS & RISKS

### Questions

1. **Why does `bulk_import` ignore `LIBRETIME_PUBLIC_URL` env var?** The command accepts the env var but still reads from config file. Is this expected LibreTime behavior or a bug?

2. **Why does nginx show upstream IP `172.19.0.7` when `legacy` resolves to `172.19.0.5`?** This IP mismatch suggests nginx may have cached an old IP or there's a DNS resolution issue.

3. **Did archive script work because config was manually toggled to internal URL?** The `toggle-libretime-url.sh` script modifies config file - did archive imports only work after running this script?

4. **Is PHP-FPM actually listening on port 9000?** We confirmed it's running but couldn't verify port binding due to missing tools in container.

5. **Should `libretime-api-1` be added to `dia_internal` network?** Currently only `libretime-nginx-1` bridges the networks - is this intentional or a deployment oversight?

6. **Why does jobs container get 502 from nginx but nginx can resolve `legacy` hostname?** Network connectivity exists but PHP-FPM connection fails - is this a timing issue or persistent failure?

### Risks

1. **Config File vs Env Var Mismatch:** If `bulk_import` always reads config file, then `LIBRETIME_PUBLIC_URL` env var is ineffective. This means archive script may have only worked when config was manually toggled.

2. **Network Isolation:** `libretime-api-1` not on `dia_internal` means jobs container cannot directly reach it. This is fine for `docker exec` from host, but prevents direct HTTP calls from jobs container.

3. **PHP-FPM Connection Refusal:** Even though PHP-FPM is running, nginx cannot connect. This could be:
   - PHP-FPM not actually listening on port 9000
   - Firewall/network policy blocking connection
   - PHP-FPM binding to wrong interface (127.0.0.1 vs 0.0.0.0)
   - Stale nginx upstream cache

4. **IP Address Mismatch:** nginx error shows `172.19.0.7` but `legacy` resolves to `172.19.0.5`. This suggests nginx may be using a cached/stale upstream IP.

---

## 5) ROOT CAUSE ANALYSIS

### Primary Issue: bulk_import URL Resolution

**Problem:** `bulk_import` CLI command ignores `LIBRETIME_PUBLIC_URL` environment variable and reads `public_url` from `/etc/libretime/config.yml` instead.

**Evidence:**
- Archive script sets `LIBRETIME_PUBLIC_URL=http://nginx:8080` but `bulk_import` still uses `https://schedule.diaradio.live`
- Config file shows `public_url: https://schedule.diaradio.live`
- `bulk_import` error shows it's using public URL even with env var set

**Impact:** 
- When using public URL: Hits Cloudflare 413 (file too large) or 100MB limit
- When config toggled to internal URL: Hits 502 (nginx can't reach PHP-FPM)

### Secondary Issue: PHP-FPM Connection Failure

**Problem:** nginx cannot connect to PHP-FPM in `libretime-legacy-1` container, even though:
- PHP-FPM is running (pid 7, "ready to handle connections")
- nginx can resolve `legacy` hostname (172.19.0.5)
- Both containers are on same network (`libretime_default`)

**Evidence:**
- nginx error: "connect() failed (111: Connection refused) while connecting to upstream fastcgi://172.19.0.7:9000"
- IP mismatch: nginx shows `172.19.0.7` but `legacy` resolves to `172.19.0.5`
- 502 errors when accessing `/rest/media` via internal URL

**Possible Causes:**
1. PHP-FPM binding to `127.0.0.1` instead of `0.0.0.0` (not accessible from other containers)
2. nginx using stale/cached upstream IP (`172.19.0.7` vs actual `172.19.0.5`)
3. PHP-FPM not actually listening on port 9000 (despite logs saying "ready")
4. Network policy/firewall blocking port 9000 between containers

### Execution Path Comparison

**Archive Script:**
- Runs from HOST
- Uses `docker exec libretime-api-1 libretime-api bulk_import`
- Sets `LIBRETIME_PUBLIC_URL` env var (but it's ignored)
- `bulk_import` reads config file → uses public URL → hits Cloudflare 413
- **May have worked if config was manually toggled to internal URL**

**Inbox Script (Attempted):**
- Runs from JOBS CONTAINER
- Attempted HTTP upload directly to `/rest/media`
- Uses internal URL (`http://nginx:8080`)
- nginx proxies to PHP-FPM → connection refused → 502

**Key Difference:** Archive script uses `bulk_import` CLI (which internally does HTTP upload), inbox script attempted direct HTTP upload. Both ultimately hit the same PHP-FPM connection issue when using internal URL.

---

## 6) MINIMAL NEXT FIX OPTIONS

### Option A: Fix PHP-FPM Connection (Recommended First Step)

**Actions:**
1. Verify PHP-FPM is listening on `0.0.0.0:9000` (not just `127.0.0.1`)
2. Check if nginx upstream cache needs clearing
3. Verify network connectivity: `docker exec libretime-nginx-1 telnet libretime-legacy-1 9000` (if telnet available)
4. Check PHP-FPM config: `docker exec libretime-legacy-1 cat /usr/local/etc/php-fpm.d/www.conf | grep listen`

**If PHP-FPM is binding to 127.0.0.1:**
- Modify PHP-FPM config to bind to `0.0.0.0:9000` or use socket file
- Restart `libretime-legacy-1` container

**If nginx has stale upstream cache:**
- Restart `libretime-nginx-1` container
- Or reload nginx config: `docker exec libretime-nginx-1 nginx -s reload`

### Option B: Make bulk_import Respect LIBRETIME_PUBLIC_URL

**Actions:**
1. Investigate LibreTime source code to see why env var is ignored
2. Check if there's a different env var name or config override mechanism
3. If no fix available, ensure config file is toggled before running `bulk_import`

**Workaround:**
- Always run `toggle-libretime-url.sh internal` before bulk imports
- Run `toggle-libretime-url.sh public` after imports complete
- Accept service restart overhead

### Option C: Use Direct File Copy (Bypass HTTP Upload)

**Actions:**
1. Copy files directly to LibreTime library directory (`/srv/media/imported/1`)
2. Trigger LibreTime analysis via database update or API call
3. Skip HTTP upload entirely

**Pros:** Bypasses all HTTP/PHP-FPM issues  
**Cons:** Requires understanding LibreTime's file processing pipeline

### Option D: Add libretime-api-1 to dia_internal Network

**Actions:**
1. Modify LibreTime docker-compose.yml to add `dia_internal` network to `api` service
2. Restart LibreTime stack

**Pros:** Allows jobs container to directly reach LibreTime API  
**Cons:** May not fix PHP-FPM issue (still goes through nginx → legacy)

---

## 7) SUCCESS CRITERIA MET

✅ **We know this is a combination of:**
1. **Invocation mismatch:** `bulk_import` ignores env var, reads config file
2. **LibreTime legacy/php-fpm broken:** nginx cannot connect to PHP-FPM (connection refused, IP mismatch)
3. **Jobs networking:** Jobs container CAN reach services but hits upstream failures

✅ **We have minimal next fix options clearly stated:**
- Fix PHP-FPM connection (verify binding, clear nginx cache)
- Make bulk_import respect env var OR always toggle config
- Use direct file copy (bypass HTTP)
- Add libretime-api to dia_internal network (may not help)

---

**Next Steps:** Choose fix option based on priority and feasibility. Option A (fix PHP-FPM) should be attempted first as it's the root cause of 502 errors.







