# MOBILE STREAM FIX — APPLIED

**Date:** 2025-11-19  
**Issue:** Mobile browsers trying to download stream instead of playing it  
**Status:** ✅ Configuration Updated

---

## PROBLEM

Mobile browsers (and mobile apps) were trying to download the stream file (`main.mp3`) instead of streaming it. Desktop browsers worked fine.

## ROOT CAUSE

Mobile browsers require:
1. **Range request support** - Proper HTTP Range header handling
2. **Accept-Ranges header** - To know the server supports seeking/streaming
3. **Content-Disposition removal** - Icecast might send this, triggering downloads
4. **Proper Content-Type** - Must be set correctly and not overridden

## SOLUTION APPLIED

Updated `/etc/nginx/sites-available/livestream.diaradio.live`:

### Changes Made

1. **Added Range request forwarding:**
   ```nginx
   proxy_set_header Range $http_range;
   proxy_set_header If-Range $http_if_range;
   ```

2. **Hide Content-Disposition header:**
   ```nginx
   proxy_hide_header Content-Disposition;
   ```

3. **Override Content-Type properly:**
   ```nginx
   proxy_hide_header Content-Type;
   add_header Content-Type "audio/mpeg" always;
   ```

4. **Added Accept-Ranges header:**
   ```nginx
   add_header Accept-Ranges "bytes" always;
   ```

5. **Updated CORS headers:**
   ```nginx
   add_header Access-Control-Expose-Headers "Content-Length,Content-Range,Content-Type,Accept-Ranges" always;
   ```

---

## VERIFICATION

### Headers Now Present
```
Content-Type: audio/mpeg
Accept-Ranges: bytes
Access-Control-Allow-Origin: *
```

### Test Commands
```bash
# Test stream endpoint
curl -I https://livestream.diaradio.live/main

# Test with range request
curl -I -H "Range: bytes=0-1023" https://livestream.diaradio.live/main
```

---

## IF STILL NOT WORKING

If mobile browsers still try to download, try these additional solutions:

### Option 1: Add .mp3 Alias

Add to nginx config:
```nginx
location ~ ^/main\.mp3$ {
    return 301 /main;
}
```

Then use URL: `https://livestream.diaradio.live/main.mp3`

### Option 2: Create M3U Playlist

Create a playlist file that mobile browsers can use:
```
#EXTM3U
#EXTINF:-1,LibreTime Live Stream
https://livestream.diaradio.live/main
```

### Option 3: Mobile App Specific

If using a mobile app, ensure it's using:
- HTML5 Audio API (for web apps)
- AVPlayer (iOS) or MediaPlayer (Android) with proper stream URL
- Not treating it as a file download

---

## NEXT STEPS

1. **Test on mobile device** - Try accessing the stream URL in mobile browser
2. **Test in mobile app** - Verify the app can now stream properly
3. **Check logs** - Monitor `/var/log/nginx/livestream.access.log` for mobile user agents
4. **If still failing** - Consider adding `.mp3` alias or M3U playlist

---

**End of Document**



