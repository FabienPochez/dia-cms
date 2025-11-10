# Transactional Email Setup (Payload + Nodemailer)

This guide covers the complete setup of transactional emails for DIA! Radio CMS, including auth flows (password reset, email verification) and future notification features.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Development & Testing](#development--testing)
4. [Production DNS Setup](#production-dns-setup)
5. [Email Types](#email-types)
6. [Troubleshooting](#troubleshooting)

---

## Overview

**Email Provider**: Nodemailer SMTP (provider-agnostic)  
**Adapter**: `@payloadcms/email-nodemailer`  
**Auth Flows Enabled**:
- ✅ Forgot Password (reset link email)
- ✅ Email Verification (verify account email)
- 🚧 Magic Link Login (future)
- 🚧 User Invites (future)

**Key Features**:
- Mock mode in development (logs credentials, no actual send)
- Provider-agnostic SMTP configuration
- Custom email subjects and templates
- Error logging with provider responses
- No emails sent on boot (only on user actions)

---

## Configuration

### 1. Environment Variables

Add these variables to your `.env` file (required):

```bash
# Email / SMTP Configuration
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-smtp-username
EMAIL_PASS=your-smtp-password
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"

# Optional Settings (defaults shown)
EMAIL_SECURE=false                      # true for port 465, false for 587
EMAIL_TLS_REJECT_UNAUTHORIZED=true     # reject invalid TLS certificates
```

**Provider Examples**:

<details>
<summary><strong>SendGrid</strong></summary>

```bash
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"
EMAIL_SECURE=false
```
</details>

<details>
<summary><strong>Mailgun</strong></summary>

```bash
EMAIL_HOST=smtp.mailgun.org
EMAIL_PORT=587
EMAIL_USER=postmaster@mg.diaradio.live
EMAIL_PASS=your-mailgun-smtp-password
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"
EMAIL_SECURE=false
```
</details>

<details>
<summary><strong>AWS SES</strong></summary>

```bash
EMAIL_HOST=email-smtp.eu-west-1.amazonaws.com
EMAIL_PORT=587
EMAIL_USER=AKIAIOSFODNN7EXAMPLE
EMAIL_PASS=your-ses-smtp-password
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"
EMAIL_SECURE=false
```
</details>

<details>
<summary><strong>Postmark</strong></summary>

```bash
EMAIL_HOST=smtp.postmarkapp.com
EMAIL_PORT=587
EMAIL_USER=your-postmark-server-api-token
EMAIL_PASS=your-postmark-server-api-token
EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
EMAIL_REPLY_TO="contact@diaradio.live"
EMAIL_SECURE=false
```
</details>

### 2. Docker Environment

The `docker-compose.yml` already includes `env_file: - .env`, so environment variables are automatically passed to containers.

### 3. Payload Configuration

Email adapter configured in `src/payload.config.ts`:

```typescript
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'

export default buildConfig({
  // ... other config
  
  email: nodemailerAdapter({
    defaultFromAddress: process.env.EMAIL_FROM || 'DIA! Radio <no-reply@diaradio.live>',
    defaultFromName: 'DIA! Radio',
    // Log mock credentials in non-production for testing
    logMockCredentials: process.env.NODE_ENV !== 'production',
    // Nodemailer transportOptions
    transportOptions: {
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
    },
  }),
})
```

### 4. Users Collection Configuration

Auth email features enabled in `src/collections/Users.ts`:

```typescript
export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    // ... other auth config
    
    // Forgot password email
    forgotPassword: {
      generateEmailSubject: () => 'Reset your DIA! Radio password',
    },
    
    // Email verification for new users
    verify: true,
  },
  // ...
}
```

---

## Development & Testing

### Mock Mode (Development)

In non-production environments, Payload uses **mock mode**:
- No actual emails sent
- Mock SMTP credentials logged to console
- Email content preview logged
- Test URLs generated (e.g., ethereal.email preview links)

**Enable Mock Mode**: Set `NODE_ENV !== 'production'` (default in development)

### Smoke Test: Forgot Password Flow

1. **Start Development Server**:
   ```bash
   docker compose up payload
   ```

2. **Access Admin Panel**:
   ```
   https://content.diaradio.live/admin
   ```

3. **Trigger Forgot Password**:
   - Click "Forgot password?" on login screen
   - Enter a valid user email (e.g., your admin account)
   - Click "Submit"

4. **Check Server Logs**:
   ```bash
   docker logs payload-payload-1 --tail 50
   ```

5. **Expected Output** (Mock Mode):
   ```
   ✅ Email sent (mock mode)
   From: DIA! Radio <no-reply@diaradio.live>
   To: admin@example.com
   Subject: Reset your DIA! Radio password
   Preview URL: https://ethereal.email/message/xxxxxxxx
   ```

6. **Verify Email Content**:
   - Open the preview URL in browser
   - Confirm reset link is present and properly formatted
   - Link should point to: `https://content.diaradio.live/admin/reset-password?token=xxxxx`

7. **Test Reset Link** (optional):
   - Copy the reset link from preview
   - Open in browser
   - Enter new password
   - Confirm password change successful

### Smoke Test: Email Verification Flow

1. **Create New User** (via admin panel or registration):
   ```bash
   curl -X POST https://content.diaradio.live/api/users \
     -H "Content-Type: application/json" \
     -d '{"email": "test@example.com", "password": "test123"}'
   ```

2. **Check Server Logs** for verification email:
   ```bash
   docker logs payload-payload-1 --tail 50 | grep -A 10 "Email sent"
   ```

3. **Expected Output**:
   ```
   ✅ Email sent (mock mode)
   From: DIA! Radio <no-reply@diaradio.live>
   To: test@example.com
   Subject: Verify your email
   Preview URL: https://ethereal.email/message/xxxxxxxx
   ```

4. **Verify Email Content**:
   - Open preview URL
   - Confirm verification link present
   - Link should point to: `https://content.diaradio.live/admin/verify?token=xxxxx`

---

## Production DNS Setup

### Prerequisites

- Domain: `diaradio.live`
- Sender email: `no-reply@diaradio.live`
- DNS managed via Cloudflare

### 1. SPF (Sender Policy Framework)

**Purpose**: Authorize your SMTP provider to send emails on behalf of `diaradio.live`

**Current SPF Record** (with Google Workspace):
```
Type: TXT
Name: @
Content: v=spf1 include:_spf.google.com ~all
```

**Updated SPF Record** (add provider):

<details>
<summary><strong>SendGrid</strong></summary>

```
v=spf1 include:_spf.google.com include:sendgrid.net ~all
```
</details>

<details>
<summary><strong>Mailgun</strong></summary>

```
v=spf1 include:_spf.google.com include:mailgun.org ~all
```
</details>

<details>
<summary><strong>AWS SES</strong></summary>

```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```
</details>

<details>
<summary><strong>Postmark</strong></summary>

```
v=spf1 include:_spf.google.com include:spf.mtasv.net ~all
```
</details>

**⚠️ Important**: 
- Only ONE `v=spf1` record allowed per domain
- Include multiple providers with separate `include:` statements
- Keep `~all` at the end (softfail for unauthorized senders)

**Add via Cloudflare**:
1. Go to DNS → diaradio.live
2. Edit existing SPF TXT record
3. Add provider `include:` before `~all`
4. Save and verify

**Verification**:
```bash
dig +short TXT diaradio.live | grep spf
# Should show: "v=spf1 include:_spf.google.com include:sendgrid.net ~all"
```

### 2. DKIM (DomainKeys Identified Mail)

**Purpose**: Cryptographic signature to prove email authenticity

**Setup**:
1. Generate DKIM keys in your SMTP provider dashboard
2. Provider will give you DNS records to add

**Example DKIM Record** (provider-specific):

<details>
<summary><strong>SendGrid</strong></summary>

SendGrid provides 3 CNAME records:

```
Type: CNAME
Name: s1._domainkey.diaradio.live
Content: s1.domainkey.u12345678.wl.sendgrid.net

Type: CNAME
Name: s2._domainkey.diaradio.live
Content: s2.domainkey.u12345678.wl.sendgrid.net

Type: CNAME
Name: em1234.diaradio.live
Content: u12345678.wl.sendgrid.net
```
</details>

<details>
<summary><strong>Mailgun</strong></summary>

Mailgun provides 2 TXT records:

```
Type: TXT
Name: k1._domainkey.mg.diaradio.live
Content: k=rsa; p=MIGfMA0GCSqG...

Type: TXT
Name: mg.diaradio.live
Content: v=DKIM1; k=rsa; p=MIGfMA0GCSqG...
```
</details>

**Add via Cloudflare**:
1. Go to DNS → diaradio.live
2. Add each DKIM record as provided by your SMTP provider
3. Proxy status: **DNS only** (grey cloud) for DKIM records
4. Save and wait for propagation (5-30 minutes)

**Verification**:
```bash
dig +short TXT s1._domainkey.diaradio.live
# Should return DKIM key
```

### 3. DMARC (Domain-based Message Authentication)

**Purpose**: Policy for handling failed SPF/DKIM checks + aggregate reporting

**Recommended DMARC Record** (start with `p=none`):
```
Type: TXT
Name: _dmarc.diaradio.live
Content: v=DMARC1; p=none; rua=mailto:postmaster@diaradio.live; pct=100; adkim=r; aspf=r
```

**Field Breakdown**:
- `v=DMARC1` - Version
- `p=none` - Policy (none = monitor only, no enforcement)
- `rua=mailto:postmaster@diaradio.live` - Aggregate reports sent here
- `pct=100` - Apply policy to 100% of emails
- `adkim=r` - Relaxed DKIM alignment
- `aspf=r` - Relaxed SPF alignment

**Add via Cloudflare**:
1. Go to DNS → diaradio.live
2. Add TXT record for `_dmarc.diaradio.live`
3. Content: (see above)
4. Proxy status: **DNS only** (grey cloud)
5. Save

**Verification**:
```bash
dig +short TXT _dmarc.diaradio.live
# Should show: "v=DMARC1; p=none; rua=mailto:postmaster@diaradio.live..."
```

**Policy Evolution** (after monitoring):
1. Start: `p=none` (monitor only, 1-2 weeks)
2. Review DMARC reports for issues
3. Upgrade: `p=quarantine` (flag suspicious emails)
4. Final: `p=reject` (reject failed emails)

### 4. Production Email Test

After DNS propagation (30 min - 2 hours):

1. **Send Real Reset Email**:
   - Go to admin panel: `https://content.diaradio.live/admin`
   - Click "Forgot password?"
   - Enter your Gmail/Outlook email
   - Submit

2. **Check Inbox**:
   - Email should arrive within 1-2 minutes
   - From: `DIA! Radio <no-reply@diaradio.live>`
   - Subject: `Reset your DIA! Radio password`

3. **Verify Email Authentication**:
   - Open email in Gmail
   - Click "⋮" menu → "Show original"
   - Check headers:
     ```
     spf=pass (google.com: domain of no-reply@diaradio.live designates x.x.x.x as permitted sender)
     dkim=pass header.i=@diaradio.live
     dmarc=pass (p=NONE sp=NONE dis=NONE)
     ```

4. **Expected Results**:
   - ✅ `spf=pass` - SPF record valid
   - ✅ `dkim=pass` - DKIM signature valid
   - ✅ `dmarc=pass` - DMARC policy satisfied
   - ✅ Email NOT in spam folder

### 5. Monitor & Adjust

**DMARC Reports**:
- Check `postmaster@diaradio.live` inbox daily
- Reports arrive from `noreply@google.com`, `rua@dmarc.microsoft.com`, etc.
- XML format (use DMARC analyzer tool)

**Common Issues**:
- **SPF fail**: Check provider IP in SPF record
- **DKIM fail**: Verify DKIM DNS records propagated
- **DMARC fail**: Check SPF/DKIM alignment (`adkim=r`, `aspf=r`)

---

## Email Types

### Forgot Password

**Trigger**: User clicks "Forgot password?" and submits email  
**Subject**: `Reset your DIA! Radio password`  
**Template**: Built-in Payload template  
**Link**: `https://content.diaradio.live/admin/reset-password?token=xxxxx`  
**Expiry**: 1 hour (Payload default)

**Customization** (optional):
```typescript
// src/collections/Users.ts
forgotPassword: {
  generateEmailSubject: ({ user }) => `Reset password for ${user.email}`,
  generateEmailHTML: ({ token, user }) => {
    return `<p>Click <a href="https://content.diaradio.live/admin/reset-password?token=${token}">here</a> to reset.</p>`
  },
},
```

### Email Verification

**Trigger**: New user registration  
**Subject**: `Verify your email`  
**Template**: Built-in Payload template  
**Link**: `https://content.diaradio.live/admin/verify?token=xxxxx`  
**Expiry**: 7 days (Payload default)

**Customization** (optional):
```typescript
// src/collections/Users.ts
verify: {
  generateEmailSubject: () => 'Welcome to DIA! Radio - Verify your email',
  generateEmailHTML: ({ token }) => {
    return `<p>Welcome! Click <a href="https://content.diaradio.live/admin/verify?token=${token}">here</a> to verify.</p>`
  },
},
```

### Future Email Types

🚧 **Magic Link Login** (not implemented):
```typescript
auth: {
  magicLink: {
    generateEmailSubject: () => 'Log in to DIA! Radio',
  },
}
```

🚧 **User Invites** (not implemented):
```typescript
// Custom implementation needed (not built-in)
// Use payload.sendEmail() in custom endpoint
```

🚧 **Episode Upload Notifications** (not implemented):
```typescript
// Already has hook in Episodes.ts (afterChange)
// Currently disabled, can re-enable after email setup
```

---

## Troubleshooting

### No Email Sent (Mock Mode)

**Symptom**: No email preview URL in logs  
**Causes**:
- `NODE_ENV=production` set in development
- Email configuration missing from `payload.config.ts`

**Fix**:
```bash
# Check NODE_ENV
echo $NODE_ENV  # Should NOT be 'production' in dev

# Verify config
grep -A 20 "email:" src/payload.config.ts
```

### SMTP Connection Error

**Symptom**: `Error: Connection timeout` or `ECONNREFUSED`  
**Causes**:
- Wrong `EMAIL_HOST` or `EMAIL_PORT`
- Firewall blocking SMTP port
- Invalid credentials

**Fix**:
```bash
# Test SMTP connection manually
docker exec -it payload-payload-1 sh -c "
  npm install -g smtp-tester
  smtp-tester --host=\$EMAIL_HOST --port=\$EMAIL_PORT --user=\$EMAIL_USER --pass=\$EMAIL_PASS
"
```

### Authentication Failed

**Symptom**: `Error: Invalid login: 535 Authentication failed`  
**Causes**:
- Wrong `EMAIL_USER` or `EMAIL_PASS`
- API key format issue (e.g., SendGrid needs `apikey` as username)

**Fix**:
- Verify credentials in provider dashboard
- Check if API key requires special format
- Test with provider's test tool

### Email Goes to Spam

**Symptom**: Email delivered but in spam folder  
**Causes**:
- SPF/DKIM/DMARC not configured
- Sender domain mismatch
- High spam score content

**Fix**:
1. Verify DNS records configured correctly
2. Check "Show original" headers in Gmail
3. Use spam checker tool (mail-tester.com)
4. Warm up sender reputation (send gradually)

### Reset Link Doesn't Work

**Symptom**: Token invalid or expired  
**Causes**:
- Token expired (1 hour default)
- Wrong domain in link
- User already used token

**Fix**:
```typescript
// Extend token expiry (src/collections/Users.ts)
forgotPassword: {
  generateEmailSubject: () => 'Reset your DIA! Radio password',
  expiration: 3600000, // 1 hour in ms (default)
},
```

### Provider Rate Limits

**Symptom**: Emails fail after N sends  
**Causes**:
- Free tier rate limits exceeded
- Sending too fast

**Fix**:
- Check provider dashboard for limits
- Upgrade plan if needed
- Implement queue system for bulk emails

---

## Error Logging

All email send errors are logged with provider responses:

```typescript
// Payload automatically logs errors
try {
  await payload.sendEmail({
    to: user.email,
    subject: 'Test',
    html: '<p>Test</p>',
  })
} catch (error) {
  console.error('Email send failed:', error.message)
  // Provider-specific error details included
}
```

**Common Error Codes**:
- `421` - Service not available
- `450` - Mailbox unavailable
- `535` - Authentication failed
- `550` - Mailbox not found
- `554` - Transaction failed

---

## Sender Address Policy

**Current Sender**: `no-reply@diaradio.live`  
**Reply-To**: `contact@diaradio.live`

**Future Email Streams** (recommendations):

| Stream | Sender | Purpose |
|--------|--------|---------|
| Auth emails | `no-reply@diaradio.live` | Password reset, verification |
| Notifications | `notify@diaradio.live` | Episode uploads, admin alerts |
| Magic links | `login@diaradio.live` | Passwordless login |
| Newsletter | `newsletter@diaradio.live` | Marketing emails |
| Transactional | `no-reply@diaradio.live` | System-generated emails |

**Best Practices**:
- Use subdomain for each stream (`no-reply`, `notify`, etc.)
- Configure separate SPF/DKIM for each subdomain
- Monitor reputation per stream
- Use `no-reply@` only for automated emails
- Provide valid `Reply-To` for user responses

---

## Next Steps

### Immediate (Required for Production)

- [ ] Add `.env` file with SMTP credentials
- [ ] Run dev smoke test (forgot password)
- [ ] Configure SPF DNS record (add provider include)
- [ ] Configure DKIM DNS records (provider-specific)
- [ ] Configure DMARC DNS record (`p=none` initially)
- [ ] Send production test email
- [ ] Verify email authentication (`spf=pass`, `dkim=pass`)

### Short-term (Nice to Have)

- [ ] Customize email templates (branding, styling)
- [ ] Set up `postmaster@diaradio.live` mailbox for DMARC reports
- [ ] Monitor DMARC reports for 1-2 weeks
- [ ] Upgrade DMARC policy to `p=quarantine`

### Long-term (Future Features)

- [ ] Implement magic link login
- [ ] Re-enable episode upload notifications
- [ ] Add user invite system
- [ ] Newsletter integration
- [ ] Multi-language email templates

---

**Last Updated**: 2025-10-28  
**Maintainer**: DIA! Radio Dev Team

