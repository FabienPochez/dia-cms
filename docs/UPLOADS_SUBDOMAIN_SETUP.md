# Uploads Subdomain Setup

This document covers the setup of `upload.content.diaradio.live` as a dedicated uploads-only subdomain that bypasses Cloudflare.

## Architecture

### Before
```
Browser → Cloudflare (100MB limit ❌) → Nginx → Payload
```

### After
```
# Main API (proxied through Cloudflare)
Browser → Cloudflare → Nginx → Payload
  └─ GET/POST /api/* (except media uploads)
  └─ Static assets

# Uploads only (DNS-only, bypasses Cloudflare)
Browser → Nginx → Payload
  └─ POST /api/media-tracks (only)
  └─ POST /api/media-images (only)
  └─ POST /api/media (only)
  └─ All other paths return 404
```

## Setup Steps

### 1. DNS Configuration (Fabien)

Add DNS A record in Cloudflare:
```
Type: A
Name: upload.content
Content: 46.62.141.69 (same as content.diaradio.live)
Proxy status: DNS only (grey cloud) ⚠️ IMPORTANT
TTL: Auto
```

**Verify DNS propagation:**
```bash
nslookup upload.content.diaradio.live
# Should show: 46.62.141.69
```

### 2. SSL Certificate

Expand existing Let's Encrypt certificate to include the subdomain:

```bash
# Stop nginx
sudo systemctl stop nginx

# Expand certificate (certbot will detect existing cert and add subdomain)
sudo certbot --nginx -d content.diaradio.live -d upload.content.diaradio.live

# Or if using certbot certonly:
sudo certbot certonly --nginx -d content.diaradio.live -d upload.content.diaradio.live

# Start nginx
sudo systemctl start nginx
```

**Verify certificate:**
```bash
curl -I https://upload.content.diaradio.live
# Should show: Server: nginx/1.24.0 (Ubuntu)
# Should NOT show: cf-* headers
```

### 3. Nginx Configuration

**Already configured:**
- `/etc/nginx/sites-available/upload.content.diaradio.live`
- Symlink: `/etc/nginx/sites-enabled/upload.content.diaradio.live`
- Upload limit: 1GB
- Timeouts: 300s
- Only allows: POST to `/api/media*` endpoints
- All other requests: 404

**Test nginx config:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Environment Variables

**Already added to `.env`:**
```bash
# Upload subdomain configuration (DNS-only, bypasses Cloudflare)
UPLOADS_HOST=https://upload.content.diaradio.live
UPLOADS_MAX_SIZE=1g
NEXT_PUBLIC_UPLOADS_HOST=https://upload.content.diaradio.live
```

### 5. Application Configuration

**Already updated:**
- Upload view uses `NEXT_PUBLIC_UPLOADS_HOST` for media uploads
- Main API stays on `content.diaradio.live`
- Location: `src/admin/components/EpisodeUploadView.tsx` line 154-155

## Testing

### Test 1: Verify Cloudflare Bypass

```bash
# Main domain (should show Cloudflare headers)
curl -I https://content.diaradio.live | grep -i "cf-\|server"

# Uploads subdomain (should NOT show Cloudflare headers)
curl -I https://upload.content.diaradio.live | grep -i "cf-\|server"
```

**Expected:**
- `content.diaradio.live`: Shows `cf-ray`, `cf-cache-status`, etc.
- `upload.content.diaradio.live`: Only shows `Server: nginx`

### Test 2: Verify Endpoint Restrictions

```bash
# Should work (upload endpoint)
curl -X POST https://upload.content.diaradio.live/api/media-tracks \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test.mp3"

# Should return 404 (non-upload endpoint)
curl -I https://upload.content.diaradio.live/api/episodes
# Expected: 404 Not Found

# Should return 404 (root path)
curl -I https://upload.content.diaradio.live/
# Expected: 404 Not Found
```

### Test 3: Large File Upload

Upload a 140MB+ file through the admin panel:
1. Go to `/admin/upload-episode`
2. Upload a 60-180 minute episode
3. Watch progress bar reach 100%
4. Episode should be created successfully

**Check logs:**
```bash
# Should show upload via upload.content.diaradio.live
tail -f /var/log/nginx/upload.access.log

# Should show validation
docker-compose logs payload | grep VALIDATION
```

## Acceptance Criteria

✅ `content.diaradio.live` still proxied by Cloudflare (shows CF headers)  
✅ `upload.content.diaradio.live` shows origin headers only (no CF)  
✅ Upload >100MB succeeds via uploads subdomain  
✅ Non-upload paths on `upload.*` return 404  
✅ Main API endpoints still work on `content.*`  
✅ SSL certificate covers both domains  

## Monitoring

### Nginx Logs

**Upload-specific logs:**
```bash
# Watch uploads in real-time
tail -f /var/log/nginx/upload.access.log

# Check for errors
tail -f /var/log/nginx/upload.error.log

# Upload statistics
grep "POST /api/media" /var/log/nginx/upload.access.log | wc -l
```

### Application Logs

**Payload upload validation:**
```bash
# See ffprobe validation
docker-compose logs payload | grep AUDIO_VALIDATION

# See episode creation
docker-compose logs payload | grep "POST /api/episodes"
```

## Rollback

If needed, to rollback to single-domain setup:

```bash
# 1. Remove uploads subdomain nginx config
sudo rm /etc/nginx/sites-enabled/upload.content.diaradio.live
sudo systemctl reload nginx

# 2. Revert upload view to use main domain
# Edit src/admin/components/EpisodeUploadView.tsx
# Change uploadUrl back to: '/api/media-tracks'

# 3. Remove environment variables
# Remove UPLOADS_HOST and NEXT_PUBLIC_UPLOADS_HOST from .env

# 4. Restart payload
docker-compose restart payload
```

## Security Considerations

### Rate Limiting (Optional)

Add to nginx config if you want to limit upload abuse:

```nginx
# In server block
limit_req_zone $binary_remote_addr zone=uploads:10m rate=10r/m;

location ~ ^/api/(media-tracks|media-images|media) {
    limit_req zone=uploads burst=5;
    # ... rest of config
}
```

### IP Allowlist (Optional)

If uploads should only come from specific IPs:

```nginx
location ~ ^/api/(media-tracks|media-images|media) {
    allow 1.2.3.4;      # Office IP
    allow 5.6.7.8/24;   # VPN range
    deny all;
    # ... rest of config
}
```

## Troubleshooting

### SSL Certificate Error

**Problem:** `SSL: no alternative certificate subject name matches target host name`

**Solution:**
```bash
# Expand certificate to include upload subdomain
sudo certbot --nginx -d content.diaradio.live -d upload.content.diaradio.live
```

### Upload Still Getting 413

**Check nginx limits:**
```bash
grep -r "client_max_body_size" /etc/nginx/
```

**Should show:**
- `/etc/nginx/nginx.conf`: `client_max_body_size 500M;` (global)
- `/etc/nginx/sites-available/content.diaradio.live`: `client_max_body_size 500M;`
- `/etc/nginx/sites-available/upload.content.diaradio.live`: `client_max_body_size 1G;`

### Upload Timing Out

**Increase timeouts in nginx:**
```nginx
client_body_timeout 600s;
proxy_read_timeout 600s;
proxy_connect_timeout 600s;
proxy_send_timeout 600s;
```

### CORS Errors

**Check browser console** - should see:
```
Access-Control-Allow-Origin: https://content.diaradio.live
Access-Control-Allow-Credentials: true
```

If missing, verify nginx CORS headers in upload vhost.

## Future Enhancements

### Chunked Uploads

For files >500MB, implement chunked uploads:
- Split large files into 50MB chunks
- Upload each chunk sequentially
- Reassemble on server
- Provides better progress tracking and resume capability

### Direct S3 Upload

Skip nginx/Payload entirely:
- Generate pre-signed S3 URLs
- Upload directly from browser to S3
- Webhook on completion to create Payload record
- Requires S3/R2/DigitalOcean Spaces setup

