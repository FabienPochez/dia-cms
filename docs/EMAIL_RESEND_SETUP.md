# Resend Email Configuration - DIA! Radio

**Status**: ✅ Configured  
**Date**: 2025-10-28  
**Provider**: Resend  
**Sender Domain**: `notify.diaradio.live`

---

## Current Configuration

### SMTP Credentials (in `.env`)

```bash
EMAIL_HOST=smtp.resend.com
EMAIL_PORT=587
EMAIL_USER=resend
EMAIL_PASS=re_hqTVeAnJ_6SDxFwh5PTJFgWsXCVestMQo
EMAIL_FROM="DIA! Radio <no-reply@notify.diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"
EMAIL_SECURE=false
EMAIL_TLS_REJECT_UNAUTHORIZED=true
```

### Features Enabled

- ✅ **Forgot Password**: Reset email with token (1 hour expiry)
- ✅ **Email Verification**: Verify email on user registration (7 day expiry)
- ✅ **Mock Mode**: Development preview URLs (when `NODE_ENV !== 'production'`)

### Container Status

- **Payload Container**: `payload-payload-1` (running)
- **Dependencies**: Installed (`@payloadcms/email-nodemailer@3.48.0`)
- **Configuration**: Loaded from `.env`

---

## Testing Checklist

### Development Testing (Mock Mode)

1. **Trigger Forgot Password Flow**:
   ```bash
   # 1. Go to admin panel
   open https://content.diaradio.live/admin
   
   # 2. Click "Forgot password?"
   # 3. Enter your email address
   # 4. Click "Submit"
   ```

2. **Check Logs for Preview URL**:
   ```bash
   docker logs payload-payload-1 --tail 50 | grep -A 10 "Email sent"
   ```

3. **Expected Output** (Mock Mode):
   ```
   ✅ Email sent (mock mode)
   From: DIA! Radio <no-reply@notify.diaradio.live>
   To: your-email@example.com
   Subject: Reset your DIA! Radio password
   Preview URL: https://ethereal.email/message/xxxxxxxx
   ```

4. **Open Preview URL**: Click the ethereal.email link to view email content

5. **Verify Reset Link Format**:
   ```
   https://content.diaradio.live/admin/reset-password?token=xxxxxxxxxxxxx
   ```

### Production Testing (Real Emails)

> ⚠️ **Important**: To send real emails, ensure `NODE_ENV=production` is set in `.env`

1. **Send Real Reset Email**:
   - Admin panel → "Forgot password?"
   - Enter your email (use Gmail/Outlook for testing)
   - Submit

2. **Check Inbox** (should arrive within 1-2 minutes)

3. **Verify Email Authentication** (Gmail):
   - Open email
   - Click "⋮" menu → "Show original"
   - Check headers:
     ```
     spf=pass (google.com: domain of no-reply@notify.diaradio.live designates ...)
     dkim=pass header.i=@notify.diaradio.live
     dmarc=pass (p=NONE sp=NONE dis=NONE)
     ```

4. **Test Reset Link**: Click link in email, verify it loads reset password page

---

## DNS Configuration Requirements

### Current Status: ⚠️ **PENDING CONFIGURATION**

Resend requires DNS records to be configured for email authentication. Until these are set up, emails may go to spam or be rejected.

### Required DNS Records (Cloudflare)

#### 1. SPF Record (Update Existing)

**Current SPF** (for `diaradio.live`):
```
Type: TXT
Name: @
Content: v=spf1 include:_spf.google.com ~all
```

**Updated SPF** (add Resend):
```
Type: TXT
Name: @
Content: v=spf1 include:_spf.google.com include:amazonses.com ~all
```

> 📝 **Note**: Resend uses Amazon SES infrastructure, so include `amazonses.com` in SPF

#### 2. DKIM Records (Subdomain)

**For subdomain `notify.diaradio.live`**:

Resend Dashboard → Domains → notify.diaradio.live → DNS Records

You'll get 3 CNAME records like:

```
Type: CNAME
Name: resend._domainkey.notify.diaradio.live
Content: resend._domainkey.yourdomain.resend.com
Proxy: DNS only (grey cloud)

Type: CNAME
Name: resend2._domainkey.notify.diaradio.live
Content: resend2._domainkey.yourdomain.resend.com
Proxy: DNS only (grey cloud)

Type: CNAME
Name: resend3._domainkey.notify.diaradio.live
Content: resend3._domainkey.yourdomain.resend.com
Proxy: DNS only (grey cloud)
```

⚠️ **Important**: Set all DKIM records to **DNS only** (grey cloud), not proxied

#### 3. DMARC Record (Root Domain)

**For root domain `diaradio.live`**:

```
Type: TXT
Name: _dmarc.diaradio.live
Content: v=DMARC1; p=none; rua=mailto:postmaster@diaradio.live; pct=100; adkim=r; aspf=r
```

**Policy Progression**:
1. Start: `p=none` (monitor only, 1-2 weeks)
2. Review DMARC reports for issues
3. Upgrade: `p=quarantine` (flag suspicious)
4. Final: `p=reject` (reject failed emails)

### Verification Steps

After DNS propagation (~30 min - 2 hours):

```bash
# 1. Check SPF
dig +short TXT diaradio.live | grep spf
# Should show: "v=spf1 include:_spf.google.com include:amazonses.com ~all"

# 2. Check DKIM
dig +short CNAME resend._domainkey.notify.diaradio.live
# Should return Resend DKIM host

# 3. Check DMARC
dig +short TXT _dmarc.diaradio.live
# Should show: "v=DMARC1; p=none; rua=..."

# 4. Send test email and check headers (see Production Testing above)
```

---

## Resend Dashboard Access

### Domain Management

1. **Login**: https://resend.com/login
2. **Domains**: https://resend.com/domains
3. **Domain Status**: Check `notify.diaradio.live` verification status
4. **DNS Records**: Copy DKIM records from dashboard

### Email Logs

View sent emails and delivery status:
- **Logs**: https://resend.com/emails
- **Filters**: By date, status, recipient
- **Details**: Click email to view headers, body, delivery status

### API Keys

- **Current Key**: `re_hqTVeAnJ_6SDxFwh5PTJFgWsXCVestMQo`
- **Manage Keys**: https://resend.com/api-keys
- **Rotate Key**: Generate new → Update `.env` → Restart container

⚠️ **Security**: API keys are secrets, never commit to git

### Rate Limits

**Free Tier** (verify current plan in dashboard):
- 100 emails/day
- 3,000 emails/month
- Unlimited API keys

**Upgrade Triggers**:
- Need >100 emails/day
- Need dedicated IP
- Need higher deliverability

---

## Monitoring & Maintenance

### Check Email Logs

```bash
# View recent Payload logs
docker logs payload-payload-1 --tail 100 | grep -i "email"

# Watch logs in real-time
docker logs -f payload-payload-1 | grep -i "email"

# Filter by error
docker logs payload-payload-1 | grep -i "email.*error"
```

### Common Issues

#### 1. SMTP Connection Failed

**Error**: `Connection timeout` or `ECONNREFUSED`

**Fix**:
```bash
# Test SMTP connection manually
docker exec -it payload-payload-1 sh -c "
  npm install -g smtp-tester
  smtp-tester --host=smtp.resend.com --port=587 --user=resend --pass=re_hqTVeAnJ_6SDxFwh5PTJFgWsXCVestMQo
"
```

#### 2. Authentication Failed

**Error**: `Invalid login: 535 Authentication failed`

**Fix**: Verify API key in Resend dashboard, regenerate if needed

#### 3. Domain Not Verified

**Error**: `Domain not verified` or `550 Sender verification failed`

**Fix**: Complete DNS setup in Resend dashboard (add DKIM records)

#### 4. Emails Go to Spam

**Symptoms**: Emails delivered but in spam folder

**Fix**:
1. Verify DNS records (SPF + DKIM + DMARC)
2. Check email authentication headers (should be `pass`)
3. Warm up sender reputation (send gradually)
4. Use spam checker: https://www.mail-tester.com

#### 5. Rate Limit Exceeded

**Error**: `429 Too Many Requests` or `Rate limit exceeded`

**Fix**:
- Check Resend dashboard for current usage
- Upgrade plan if needed
- Implement retry logic with exponential backoff

### Health Check Script

Create a simple health check:

```bash
#!/bin/bash
# scripts/check-email-health.sh

echo "=== Email Configuration Health Check ==="

# 1. Check .env has email vars
echo -n "✓ EMAIL_HOST: "
grep EMAIL_HOST /srv/payload/.env | cut -d= -f2

# 2. Check container running
echo -n "✓ Payload container: "
docker ps --filter name=payload-payload-1 --format "{{.Status}}" | head -1

# 3. Check DNS records
echo -n "✓ SPF record: "
dig +short TXT diaradio.live | grep spf || echo "NOT CONFIGURED"

# 4. Check Resend dashboard (manual)
echo "⚠ Check Resend dashboard: https://resend.com/domains"
echo "  - Domain verified?"
echo "  - DKIM records added?"
echo "  - Recent emails sent?"

echo "=== Health Check Complete ==="
```

Usage:
```bash
bash scripts/check-email-health.sh
```

---

## Future Enhancements

### Phase 1 (Current)
- ✅ Forgot password emails
- ✅ Email verification
- ✅ Mock mode for development

### Phase 2 (Planned)
- 🚧 **Magic Link Login**: Passwordless authentication
- 🚧 **User Invites**: Admin-triggered invite emails
- 🚧 **Episode Upload Notifications**: Notify staff when hosts upload episodes

### Phase 3 (Future)
- 🚧 **Newsletter Integration**: Bulk email campaigns
- 🚧 **Multi-language Templates**: i18n support for emails
- 🚧 **Custom Templates**: Branded HTML templates with React Email
- 🚧 **Email Analytics**: Open rates, click rates, delivery metrics

### Sender Addresses Strategy

| Stream | Sender | Purpose | Status |
|--------|--------|---------|--------|
| Auth emails | `no-reply@notify.diaradio.live` | Password reset, verification | ✅ Current |
| Notifications | `notify@diaradio.live` | Upload alerts, admin notifications | 🚧 Future |
| Magic links | `login@diaradio.live` | Passwordless login | 🚧 Future |
| Newsletter | `newsletter@diaradio.live` | Marketing emails | 🚧 Future |

**Rationale**:
- Separate subdomain for transactional emails (`notify.diaradio.live`)
- Main domain for marketing/newsletters (`diaradio.live`)
- Different DKIM/SPF per stream for better deliverability tracking

---

## Troubleshooting Contact

**Documentation**:
- Quick Start: `docs/EMAIL_TRANSACTIONAL_QUICKSTART.md`
- Full Guide: `docs/EMAIL_TRANSACTIONAL_SETUP.md`

**External Resources**:
- Resend Docs: https://resend.com/docs
- Resend SMTP Guide: https://resend.com/docs/send-with-smtp
- Resend Domain Setup: https://resend.com/docs/dashboard/domains/introduction

**Support**:
- Resend Support: support@resend.com
- DIA! Radio Dev Team: contact@diaradio.live

---

**Last Updated**: 2025-10-28  
**Status**: ✅ Configured, ⚠️ DNS Pending  
**Next Steps**: Configure DNS records in Cloudflare, send production test email

