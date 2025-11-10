# Transactional Email - Quick Start

Quick reference for enabling transactional emails in Payload CMS.

## ✅ What's Been Configured

1. **Package Added**: `@payloadcms/email-nodemailer@3.48.0` in `package.json`
2. **Email Adapter**: Configured in `src/payload.config.ts` with Nodemailer SMTP
3. **Auth Emails Enabled**: Forgot password + email verification in `src/collections/Users.ts`
4. **Mock Mode**: Enabled for development (no actual sends, logs preview URLs)

## 🚀 Quick Setup (3 Steps)

### 1. Add Environment Variables

Add to your `.env` file:

```bash
# Required
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-smtp-username
EMAIL_PASS=your-smtp-password
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"

# Optional (defaults shown)
EMAIL_SECURE=false
EMAIL_TLS_REJECT_UNAUTHORIZED=true
```

### 2. Install Dependencies & Restart

```bash
# Install new package
docker compose exec payload npm install

# Restart container
docker compose restart payload
```

### 3. Test Forgot Password Flow

1. Go to: `https://content.diaradio.live/admin`
2. Click "Forgot password?"
3. Enter your email
4. Check server logs:
   ```bash
   docker logs payload-payload-1 --tail 50 | grep -A 10 "Email sent"
   ```
5. Should see preview URL (mock mode in dev)

## 📋 Environment Variable Reference

| Variable | Required | Default | Example |
|----------|----------|---------|---------|
| `EMAIL_HOST` | ✅ Yes | - | `smtp.sendgrid.net` |
| `EMAIL_PORT` | ✅ Yes | - | `587` |
| `EMAIL_USER` | ✅ Yes | - | `apikey` |
| `EMAIL_PASS` | ✅ Yes | - | `SG.xxxx` |
| `EMAIL_FROM` | ✅ Yes | - | `DIA! Radio <no-reply@diaradio.live>` |
| `EMAIL_REPLY_TO` | ⚠️ Recommended | - | `contact@diaradio.live` |
| `EMAIL_SECURE` | ❌ Optional | `false` | `true` (port 465) |
| `EMAIL_TLS_REJECT_UNAUTHORIZED` | ❌ Optional | `true` | `false` (dev only) |

## 📧 Popular SMTP Providers

<details>
<summary><strong>SendGrid</strong> (Recommended)</summary>

```bash
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Features**: 100 emails/day free, good deliverability, easy setup  
**DNS Required**: DKIM + SPF
</details>

<details>
<summary><strong>Mailgun</strong></summary>

```bash
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=587
EMAIL_USER=postmaster@mg.diaradio.live
EMAIL_PASS=your-mailgun-smtp-password
```

**Features**: 5,000 emails/month free, EU datacenter available  
**DNS Required**: DKIM + SPF
</details>

<details>
<summary><strong>AWS SES</strong></summary>

```bash
EMAIL_HOST=email-smtp.eu-west-1.amazonaws.com
EMAIL_PORT=587
EMAIL_USER=AKIAIOSFODNN7EXAMPLE
EMAIL_PASS=your-ses-smtp-password
```

**Features**: $0.10 per 1,000 emails, requires AWS account  
**DNS Required**: DKIM + SPF + DMARC
</details>

<details>
<summary><strong>Postmark</strong></summary>

```bash
EMAIL_HOST=smtp.postmarkapp.com
EMAIL_PORT=587
EMAIL_USER=your-postmark-server-api-token
EMAIL_PASS=your-postmark-server-api-token
```

**Features**: 100 emails/month free, excellent deliverability  
**DNS Required**: DKIM + SPF
</details>

## 🔧 Production DNS Setup (Cloudflare)

### 1. SPF Record (Update Existing)

**Current**:
```
v=spf1 include:_spf.google.com ~all
```

**Updated** (example with SendGrid):
```
v=spf1 include:_spf.google.com include:sendgrid.net ~all
```

### 2. DKIM Records (Add New)

Provider will give you specific records. Example format:
```
Type: CNAME
Name: s1._domainkey.diaradio.live
Content: s1.domainkey.u12345678.wl.sendgrid.net
```

⚠️ Set proxy to **DNS only** (grey cloud)

### 3. DMARC Record (Add New)

```
Type: TXT
Name: _dmarc.diaradio.live
Content: v=DMARC1; p=none; rua=mailto:postmaster@diaradio.live; pct=100
```

Start with `p=none` (monitor mode), upgrade to `p=quarantine` later.

### 4. Verify Production Email

After DNS propagation (~30 min):

1. Send real reset email from admin panel
2. Check Gmail "Show original" for:
   ```
   spf=pass
   dkim=pass
   dmarc=pass
   ```

## 🐛 Troubleshooting

### No Email in Logs (Dev)

**Check**: `NODE_ENV` should NOT be `production`
```bash
docker exec payload-payload-1 sh -c 'echo $NODE_ENV'
```

### SMTP Connection Error

**Check**: Test connection manually
```bash
docker exec payload-payload-1 sh -c "
  npm install -g nodemailer
  node -e \"
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    transport.verify().then(console.log).catch(console.error);
  \"
"
```

### Emails Go to Spam

**Fix**: Configure SPF + DKIM + DMARC (see production DNS setup)

## 📚 Full Documentation

See `docs/EMAIL_TRANSACTIONAL_SETUP.md` for:
- Complete DNS setup guide
- Email template customization
- DMARC monitoring
- Future features (magic links, invites)
- Error logging reference

## 📝 Files Modified

1. ✅ `package.json` - Added `@payloadcms/email-nodemailer`
2. ✅ `src/payload.config.ts` - Configured email adapter
3. ✅ `src/collections/Users.ts` - Enabled forgot password + verification
4. ✅ `docker-compose.yml` - Already has `env_file: .env` (no changes needed)

## ⚠️ Important Notes

- **No emails sent on boot** - Only triggered by user actions
- **Mock mode in dev** - Set `NODE_ENV=production` to send real emails
- **Provider rate limits** - Check free tier limits (varies by provider)
- **DNS propagation** - Allow 30 min - 2 hours after DNS changes
- **Security** - Never commit `.env` file with real credentials

## 🎯 Next Steps

1. [ ] Choose SMTP provider (SendGrid recommended)
2. [ ] Add credentials to `.env`
3. [ ] Restart Payload container
4. [ ] Test forgot password flow
5. [ ] Configure DNS records (SPF + DKIM + DMARC)
6. [ ] Send production test email
7. [ ] Monitor DMARC reports for 1-2 weeks

---

**Quick Links**:
- [Full Setup Guide](./EMAIL_TRANSACTIONAL_SETUP.md)
- [Payload Email Docs](https://payloadcms.com/docs/email/overview)
- [Nodemailer Docs](https://nodemailer.com/)

