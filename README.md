# Payload Blank Template

This template comes configured with the bare minimum to get started on anything you need.

## Quick start

This template can be deployed directly from our Cloud hosting and it will setup MongoDB and cloud S3 object storage for media.

## Quick Start - local setup

To spin up this template locally, follow these steps:

### Clone

After you click the `Deploy` button above, you'll want to have standalone copy of this repo on your machine. If you've already cloned this repo, skip to [Development](#development).

### Development

1. First [clone the repo](#clone) if you have not done so already
2. `cd my-project && cp .env.example .env` to copy the example environment variables. You'll need to add the `MONGODB_URI` from your Cloud project to your `.env` if you want to use S3 storage and the MongoDB database that was created for you.

### Environment Variables

#### Required
- `LIBRETIME_API_KEY`: Your LibreTime API key
- `PAYLOAD_ADMIN_TOKEN`: Admin token for Payload CMS authentication

#### Payload Authentication (API Key preferred)
- `PAYLOAD_API_KEY`: API Key for Payload REST calls (preferred over JWT)
- `PAYLOAD_AUTH_SLUG`: Authentication slug (default: `users`)

**Hydration auth**: Uses API Key format `"<slug> API-Key <key>"` when available, falls back to JWT Bearer token. Either `PAYLOAD_API_KEY` or `PAYLOAD_ADMIN_TOKEN` is required.

#### Email / SMTP (Required for transactional emails)
- `EMAIL_HOST`: SMTP server hostname (e.g., `smtp.sendgrid.net`)
- `EMAIL_PORT`: SMTP port, typically `587` for TLS or `465` for SSL
- `EMAIL_USER`: SMTP username or API key
- `EMAIL_PASS`: SMTP password
- `EMAIL_FROM`: Sender address with display name (e.g., `"DIA! Radio <no-reply@diaradio.live>"`)
- `EMAIL_REPLY_TO`: Reply-to address for user responses (e.g., `contact@diaradio.live`)
- `EMAIL_SECURE`: (Optional) Use SSL/TLS, `true` for port 465, `false` for 587 (default: `false`)
- `EMAIL_TLS_REJECT_UNAUTHORIZED`: (Optional) Reject invalid TLS certificates (default: `true`)

**Email Features**:
- Password reset emails (forgot password flow)
- Email verification for new users
- Mock mode in development (logs preview URLs, no actual sends)
- Production DNS setup required (SPF, DKIM, DMARC)

**Supported Providers**: SendGrid, Mailgun, AWS SES, Postmark, any standard SMTP server

See [Email Setup Guide](./docs/EMAIL_TRANSACTIONAL_QUICKSTART.md) for configuration details.

### Import Script Usage

```bash
# Auto-detect episode ID from staging directory (recommended)
npm run import:one -- --ingest=cli

# Explicitly specify episode ID (optional)
npm run import:one -- --episodeId=686d115dd9c5ee507e7c9355 --ingest=cli
```

The script automatically detects MP3 files in `/srv/media/staging` and extracts episode IDs from filenames using the pattern `<episodeId>__<rest>.mp3`.

3. `pnpm install && pnpm dev` to install dependencies and start the dev server
4. open `http://localhost:3000` to open the app in your browser

That's it! Changes made in `./src` will be reflected in your app. Follow the on-screen instructions to login and create your first admin user. Then check out [Production](#production) once you're ready to build and serve your app, and [Deployment](#deployment) when you're ready to go live.

#### Docker (Optional)

If you prefer to use Docker for local development instead of a local MongoDB instance, the provided docker-compose.yml file can be used.

To do so, follow these steps:

- Modify the `MONGODB_URI` in your `.env` file to `mongodb://127.0.0.1/<dbname>`
- Modify the `docker-compose.yml` file's `MONGODB_URI` to match the above `<dbname>`
- Run `docker-compose up` to start the database, optionally pass `-d` to run in the background.

## How it works

The Payload config is tailored specifically to the needs of most websites. It is pre-configured in the following ways:

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- #### Users (Authentication)

  Users are auth-enabled collections that have access to the admin panel.

  For additional help, see the official [Auth Example](https://github.com/payloadcms/payload/tree/main/examples/auth) or the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.

- #### Media

  This is the uploads enabled collection. It features pre-configured sizes, focal point and manual resizing to help you manage your pictures.

### Docker

Alternatively, you can use [Docker](https://www.docker.com) to spin up this template locally. To do so, follow these steps:

1. Follow [steps 1 and 2 from above](#development), the docker-compose file will automatically use the `.env` file in your project root
1. Next run `docker-compose up`
1. Follow [steps 4 and 5 from above](#development) to login and create your first admin user

That's it! The Docker instance will help you get up and running quickly while also standardizing the development environment across your teams.

## Transactional Email Configuration

Payload is configured with Nodemailer SMTP adapter for transactional emails (password reset, email verification).

### Quick Setup

1. **Add SMTP credentials** to `.env`:
   ```bash
   EMAIL_HOST=smtp.sendgrid.net          # Your SMTP provider
   EMAIL_PORT=587
   EMAIL_USER=apikey                      # Provider-specific username
   EMAIL_PASS=SG.xxxxxxxxxxxxxxxxxxxxx   # Provider password/API key
   EMAIL_FROM="DIA! Radio <no-reply@diaradio.live>"
   EMAIL_REPLY_TO="contact@diaradio.live"
   ```

2. **Install and restart**:
   ```bash
   docker compose exec payload npm install
   docker compose restart payload
   ```

3. **Test in development**:
   - Go to admin panel → "Forgot password?"
   - Enter your email
   - Check logs for preview URL (mock mode):
     ```bash
     docker logs payload-payload-1 --tail 50 | grep "Email sent"
     ```

### Features Enabled

- ✅ **Password Reset**: Custom email with reset token (1 hour expiry)
- ✅ **Email Verification**: Automatic on user registration (7 day expiry)
- ✅ **Mock Mode**: Development preview URLs (no actual sends)
- 🚧 **Future**: Magic links, user invites, upload notifications

### Supported Providers

- **SendGrid** (recommended): 100 emails/day free
- **Mailgun**: 5,000 emails/month free, EU datacenter
- **AWS SES**: $0.10 per 1,000 emails
- **Postmark**: 100 emails/month free, excellent deliverability

### Production DNS Setup

Required DNS records for email authentication:

1. **SPF**: Update existing record to include provider
   ```
   v=spf1 include:_spf.google.com include:sendgrid.net ~all
   ```

2. **DKIM**: Add provider-specific records (get from provider dashboard)

3. **DMARC**: Start with monitoring mode
   ```
   _dmarc.diaradio.live → v=DMARC1; p=none; rua=mailto:postmaster@diaradio.live
   ```

4. **Verify**: Send test email, check Gmail "Show original" for:
   - `spf=pass`
   - `dkim=pass`
   - `dmarc=pass`

### Documentation

- **Quick Start**: [Email Setup Quickstart](./docs/EMAIL_TRANSACTIONAL_QUICKSTART.md)
- **Full Guide**: [Email Setup Complete](./docs/EMAIL_TRANSACTIONAL_SETUP.md)
- **Admin Button**: [Send Reset Email Button](./docs/ADMIN_SEND_RESET_BUTTON.md)
- **Changelog**: See [2025-10-28 entry](./CHANGELOG.md)

---

## Custom UI Components (Payload v3)

This project uses Payload v3's custom component system to extend the admin UI. Here's how to add custom components to collection fields.

### Creating a Custom UI Field Component

**1. Create the Component** (`src/admin/components/YourComponent.tsx`):

```tsx
'use client'

import React from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'

const YourComponent: React.FC = () => {
  const { user } = useAuth()              // Get authenticated user
  const { id: documentId } = useDocumentInfo()  // Get current document ID
  
  // Only render for admin users on edit view
  if (!user || user.role !== 'admin') return null
  if (!documentId) return null  // Hide on create view
  
  return (
    <div>
      <button onClick={() => console.log('Document ID:', documentId)}>
        Custom Action
      </button>
    </div>
  )
}

export default YourComponent
```

**2. Register in Collection Config** (`src/collections/YourCollection.ts`):

```typescript
import type { CollectionConfig } from 'payload'

export const YourCollection: CollectionConfig = {
  slug: 'your-collection',
  fields: [
    // ... other fields
    {
      name: 'customActions',
      type: 'ui',
      admin: {
        position: 'sidebar',  // or omit for main content area
        components: {
          Field: './admin/components/YourComponent',  // ← relative path from src/
        },
      },
    },
  ],
}
```

**3. Generate Import Map**:

```bash
npm run generate:importmap
```

This updates `src/app/(payload)/admin/importMap.js` to register your component.

**4. Build & Restart (no stream downtime)**:

```bash
# Build Next.js artifacts while production keeps running
docker compose --profile build run --rm payload-build

# Fast restart (uses the freshly built .next directory)
docker compose up -d payload
```

> ⚠️ If the restart command complains about missing `.next`, it means the build step failed—check the logs from the `payload-build` run, fix the issue, then rerun the build.

### Local dev access (`payload-dev`)

The hot-reload `payload-dev` service listens on port `3300` and shares the same volume as production. Forward the ports through SSH before opening a browser tab:

```bash
ssh diaradio-prod
```

With the SSH config entry:

```ssh-config
Host diaradio-prod
    HostName 46.62.141.69
    User root
    LocalForward 3000 localhost:3000
    LocalForward 3300 localhost:3000
```

Once the tunnel is active:
- `http://localhost:3000` → production Payload
- `http://localhost:3300` → dev Payload (hot reload, use your admin credentials)

Start/stop the dev container as needed:

```bash
docker compose --profile dev up -d payload-dev   # start
docker compose --profile dev stop payload-dev    # stop
```

### Key Payload v3 Hooks

- **`useDocumentInfo()`**: Get current document's `id`, `collectionSlug`, `globalSlug`
- **`useAuth()`**: Get authenticated user (email, role, permissions)
- **`useFormFields()`**: Access form field values
- **`useForm()`**: Access form methods (`getData`, `setModified`, etc.)

### Important Notes

- **Import Path**: Use relative path `'./admin/components/ComponentName'` (from `src/`)
- **'use client'**: All custom UI components must be client components
- **Import Map**: Run `npm run generate:importmap` after adding/removing components
- **Type Safety**: Import types from `@payloadcms/ui` and `payload`
- **Document ID**: Use `useDocumentInfo()` not `useParams()` for document context

### Example: Admin-Only Button

See `src/admin/components/SendResetButton.tsx` for a complete example of:
- Role-based rendering (admin/staff only)
- Document context access
- API endpoint integration
- Loading states and error handling

### Troubleshooting

- **Component not showing**: Check browser console for errors
- **"Module not found"**: Run `npm run generate:importmap` and restart
- **`documentId` is undefined**: You're on create view (new document), check `if (!documentId) return null`
- **Cached old code / missing chunks**: Regenerate artifacts via:
  ```bash
  docker compose --profile build run --rm payload-build
  docker compose up -d payload
  ```

### Configuration Files

- **Email adapter**: `src/payload.config.ts` (Nodemailer configuration)
- **Auth features**: `src/collections/Users.ts` (forgot password, verification)
- **Package**: `@payloadcms/email-nodemailer@3.48.0`

---

## Media Archive Management

This section covers the ingestion and preparation of archived media files for the Payload + LibreTime workflow.

### Rename Media In-Place

The `rename-media-in-place.ts` script normalizes archived media files to canonical naming format and sanitizes ID3 metadata, preparing them for LibreTime import.

**Purpose:**
- Rename files in-place to canonical format: `{episodeId}__{showSlug}__{titleSlug}__{episodeNumber}.mp3`
- Sanitize ID3 tags: set title, explicitly clear artist/album fields (prevents LibreTime misinterpretation)
- Look up episode data from Payload using `track_id` extracted from filename

**Usage:**

```bash
# Inside the dev-scripts container
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks'

# Dry-run (preview changes without applying)
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks --dry-run'

# With limit (process only first N files)
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks --limit 5'

# With mapping file (for files without track_id pattern)
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks --map /path/to/mapping.json'
```

**Parameters:**
- `--root /path/to/scan` (required) - Directory containing audio files to process
- `--dry-run` (optional) - Preview changes without applying them
- `--limit N` (optional) - Process only first N files
- `--map /path/to/file.{json|csv}` (optional) - Mapping file for files without `track-{id}_*` pattern

**Workflow:**
1. Scans directory for audio files (`.mp3`, `.wav`, `.aiff`)
2. Extracts `track_id` from filename pattern: `track-{id}_*.{ext}`
3. Looks up episode in Payload using `track_id`
4. Retrieves show information from episode relationship
5. Generates canonical filename using `generateEpisodeFilename()` utility
6. Writes ID3 tags: `title` (from episode), `artist` = `''`, `album` = `''`
7. Renames file to canonical format
8. Logs all operations to `/var/log/dia-import/rename-media-in-place.jsonl`

**ID3 Metadata Written:**
- ✅ **title**: Episode title from Payload
- ✅ **artist**: Explicitly cleared (empty string)
- ✅ **album**: Explicitly cleared (empty string)
- ✅ **genre**: Optional (currently not set)
- ❌ **Cover art**: Not embedded

**Quarantine System:**
- Files that cannot be processed are moved to `{root}/../_conflicts/`
- Reasons include: no episode found, target file exists, ID3 write failure
- Check JSONL logs for quarantine details

**Example:**
```bash
# Before:  track-864749443_diaradiotragol-fitness-club-12-070720.mp3
# After:   685e6a57b3ef76e0e25c2557__tragol-fitness-club__tragol-fitness-club-w-tunder-12__012.mp3
```

**Next Steps:**
After renaming, files are ready for LibreTime import via `import-batch-archives-media.ts`.

### Import Batch Archives to LibreTime

The `import-batch-archives-media.ts` script uploads pre-sanitized archive media files to LibreTime and hydrates Payload episodes with LibreTime track IDs.

**Purpose:**
- Bulk import MP3 files from `/srv/media/tracks` to LibreTime
- Skip metadata stripping (files already sanitized by `rename-media-in-place.ts`)
- Poll LibreTime API to retrieve track IDs for imported files
- Update Payload episodes with `libretimeTrackId` and `libretimeFilepathRelative`

**Usage:**

```bash
# Inside the dev-scripts container
docker compose run --rm jobs sh -lc 'npx tsx scripts/import-batch-archives-media.ts'

# Dry-run (preview without making changes)
docker compose run --rm jobs sh -lc 'npx tsx scripts/import-batch-archives-media.ts --dry-run'

# With custom LibreTime URL
docker compose run --rm jobs sh -lc 'npx tsx scripts/import-batch-archives-media.ts --libretime-url http://localhost:8080'
```

**Parameters:**
- `--dry-run` (optional) - Preview actions without making changes
- `--libretime-url <url>` (optional) - Override LibreTime API URL
- `--ingest cli|http` (optional) - Ingest mode (default: `cli`)

**Workflow:**
1. Scans `/srv/media/tracks` for MP3 files with canonical naming
2. Extracts episode IDs from filenames: `{episodeId}__{show}__{title}__{number}.mp3`
3. Checks LibreTime for existing files (skips if already imported)
4. Performs CLI bulk import: `docker exec libretime_api_1 libretime-api bulk_import`
5. Polls LibreTime API with exponential backoff to retrieve track IDs
6. Updates Payload episodes with LibreTime metadata
7. Logs success/failure for each episode

**Requirements:**
- Files must be in canonical format (from `rename-media-in-place.ts`)
- Files must be MP3 format
- ID3 metadata must be pre-sanitized (artist/album cleared)
- LibreTime API key required (`LIBRETIME_API_KEY`)
- Payload API key or admin token required

**Concurrency Safety:**
- Uses lockfile (`/tmp/lt-bulk-import-archives.lock`) to prevent concurrent imports
- Only one instance can run at a time
- Lockfile automatically released on completion or error

**Example Output:**
```
🎧 LibreTime Batch Archive Media Import Script
==============================================
🌐 Resolved LibreTime URL: http://libretime-nginx-1:8080
✅ Using LibreTime v2 API endpoint
📁 Processing directory: /srv/media/tracks
📋 Found 3 episodes to process: 685e6a57b3ef76e0e25c2557, 685e6a57b3ef76e0e25c2552, 685e6a57b3ef76e0e25c254d
📁 Some files not found in LibreTime library, proceeding with import...
🚀 ARCHIVE_IMPORT: Files pre-sanitized, proceeding to bulk import
✅ BULK_IMPORT_DONE: LibreTime bulk import completed
🔄 HYDRATE_ALL: Starting hydration of all episodes...
✅ Episode 685e6a57b3ef76e0e25c2557 hydrated successfully
   LibreTime track ID: 1234
   LibreTime filepath: tracks/685e6a57b3ef76e0e25c2557__tragol-fitness-club__...mp3

🎉 Batch archive import completed successfully!
   Processed directory: /srv/media/tracks
   Episodes processed: 3
```

**Troubleshooting:**
- **Lockfile exists**: Another import may be running. Wait or remove `/tmp/lt-bulk-import-archives.lock`
- **Episode not found in Payload**: Ensure episode exists with correct ID
- **Timeout polling LibreTime**: Increase timeout or check LibreTime API connectivity
- **Multiple files for same episode**: Ensure only one file per episode in directory

---

## Archiving: Production Operations

This section covers production-ready file archiving to Hetzner Storage Box with optimized defaults and resilience features.

### Production Defaults

- **Cipher**: `aes128-gcm@openssh.com` (fastest supported)
- **Compression**: `no` (disabled for better CPU efficiency)
- **Concurrency**: `2` (optimal for Hetzner Storage Box)
- **Remote base**: `/home/archive` (absolute path)
- **Retries**: `2` with exponential backoff (2s, 5s)
- **ControlPersist**: `60s` (SSH connection reuse)

### Single File Operations

```bash
# Dry-run (default)
scripts/sh/archive/rsync_one.sh /srv/media/staging/foo.mp3 staging/2024-01-15

# Apply transfer
scripts/sh/archive/rsync_one.sh --apply /srv/media/staging/foo.mp3 staging/2024-01-15

# With bandwidth limit and retries
scripts/sh/archive/rsync_one.sh --apply --bwlimit 8M --retries 3 /srv/media/staging/foo.mp3 production
```

### Batch Operations

```bash
# Default: 2 workers, dry-run
scripts/sh/archive/batch_rsync.sh /srv/media/staging staging/2024-01-15

# Apply with verification sampling
scripts/sh/archive/batch_rsync.sh /srv/media/staging staging/2024-01-15 --apply --verify-rate 10

# High concurrency with bandwidth limits
scripts/sh/archive/batch_rsync.sh /srv/media/staging/*.mp3 production --apply --concurrency 4 --bwlimit 8M
```

### Verification

```bash
# Verify single file
scripts/sh/archive/rsync_verify.sh /srv/media/staging/foo.mp3 staging/2024-01-15

# Check if remote directory exists
scripts/sh/archive/ls_remote.sh --exists staging/2024-01-15
```

### SSH Configuration

Add the following to your `~/.ssh/config`:

```
Host bx-archive
    HostName u476522.your-storagebox.de
    User u476522
    Port 23
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no
    Ciphers aes128-gcm@openssh.com,aes256-gcm@openssh.com,aes256-ctr,aes128-ctr
    Compression no
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 60
```

### Archive Layout & Path Policy

**Root:** `/home/archive`

**Folder strategy**
- **New archives:** monthly buckets → `/home/archive/YYYY-MM/`  
  - `archivePath = YYYY-MM/<filename>`  
  - Month = `firstAirDate` if available, else `createdAt`
- **Legacy set (~1,700 files):** keep flat under `/home/archive/legacy/`  
  - `archivePath = legacy/<filename>`  
  - (Optional later: re-bucket if needed)

**Filenames**
- Prefix with `episodeId` for fast lookups:
```
<episodeId>__<showSlug>__<titleSlug>__<episodeNumber>.mp3
```
Example: `685e6a58__xingar-morning__xingar-morning-w-myako__001.mp3`

**Why monthly buckets**
- Faster directory ops (SSH/SFTP/rsync)
- Simple retention and partial syncs per month
- Deterministic, human-readable paths

**Examples**
- New file (Sept 2025):  
  - `archivePath: 2025-09/685e6a58__xingar-morning__...__001.mp3`  
  - Remote target: `/home/archive/2025-09/<filename>`
- Legacy import:  
  - `archivePath: legacy/685e6a58__xingar-morning__...__001.mp3`  
  - Remote target: `/home/archive/legacy/<filename>`

**Scripts usage**
- Single:  
  `scripts/sh/archive/rsync_one.sh --apply /srv/media/staging/foo.mp3 2025-09`
- Batch (prod defaults, verify every 10th):  
  `scripts/sh/archive/batch_rsync.sh /srv/media/staging 2025-09 --apply --verify-rate 10`
- Legacy batch:  
  `scripts/sh/archive/batch_rsync.sh /srv/media/staging legacy --apply --concurrency 2`

### Legacy Testing (Deprecated)

This section covers testing file archiving to Hetzner Storage Box using rsync over SSH.

### SSH Configuration

Add the following to your `~/.ssh/config`:

```
Host bx-archive
    HostName u476522.your-storagebox.de
    User u476522
    Port 23
    IdentityFile ~/.ssh/id_rsa
    StrictHostKeyChecking no
```

Add the host to known_hosts:
```bash
ssh-keyscan -p 23 u476522.your-storagebox.de >> ~/.ssh/known_hosts
```

### Step-by-Step Testing

1. **Pick a test file:**
   ```bash
   FILE=/srv/media/staging/your-test-file.mp3
   ```

2. **Dry-run copy (no changes):**
   ```bash
   scripts/sh/archive/rsync_one.sh "$FILE"
   ```

3. **Apply copy:**
   ```bash
   scripts/sh/archive/rsync_one.sh --apply "$FILE"
   ```

4. **Verify integrity:**
   ```bash
   scripts/sh/archive/rsync_verify.sh "$FILE" staging-test
   ```

5. **List remote files:**
   ```bash
   scripts/sh/archive/ls_remote.sh staging-test --du
   ```

### Notes

- No `chown` operations possible on Hetzner Storage Box
- Keep relative layout structure for consistency with LibreTime
- Use Port 23 for SSH connections
- Add known_hosts entry with `ssh-keyscan` to avoid host key prompts
- All scripts default to dry-run mode for safety

## Throughput Bench

This section covers rsync performance benchmarking to optimize transfer speeds.

### Single-File Cipher Testing

Compare AES-GCM vs CHACHA20 cipher performance:
```bash
scripts/sh/archive/bench/bench_cipher_single.sh /srv/media/staging/test.mp3
```

### Parallel Throughput Testing

Test total throughput with multiple concurrent transfers:
```bash
# Default: 4 files, 4 concurrent, CHACHA20 cipher
scripts/sh/archive/bench/bench_parallel.sh

# Custom configuration
scripts/sh/archive/bench/bench_parallel.sh --cipher aes --concurrency 2 --count 3
```

### SSH Optimization

For optimal performance, add these settings to your `~/.ssh/config`:
```
Host bx-archive
  Port 23
  Ciphers chacha20-poly1305@openssh.com,aes128-gcm@openssh.com
  Compression no
```

### Benchmark Results

Results are logged to `scripts/sh/archive/bench/logs/` with timestamps:
- `bench-aes-YYYYMMDD_HHMMSS.log` - AES-GCM cipher results
- `bench-chacha-YYYYMMDD_HHMMSS.log` - CHACHA20 cipher results  
- `bench-parallel-YYYYMMDD_HHMMSS-*.log` - Parallel transfer results

## Archive Hydration Workflow

### Overview

Complete workflow for archiving media files to Hetzner Storage Box and hydrating Payload with archive paths.

### Workflow Steps

1. **Prepare Files** (Batch of ~100)
   ```bash
   # Normalize filenames and sanitize ID3 tags
   docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks --dry-run'
   docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks'
   ```

2. **Import to LibreTime**
   ```bash
   # Upload to LibreTime via bulk import (run from HOST - requires docker command)
   npx tsx scripts/import-batch-archives-media.ts
   ```
   
   **⏳ WAIT FOR LIBRETIME TO FINISH IMPORTING** (~10-20 minutes for 100 files)
   
   LibreTime processes files in the background. The bulk import command returns immediately,
   but files take time to be analyzed and added to the library. You can monitor progress:
   ```bash
   # Check how many files have been imported
   curl -s "http://localhost:8080/api/v2/files" | jq 'length'
   ```

2-bis. **Hydrate Payload with LibreTime Data**
   ```bash
   # Re-run import script to poll LibreTime and hydrate Payload
   docker compose run --rm jobs sh -lc 'npx tsx scripts/import-batch-archives-media.ts'
   ```
   
   This step:
   - Polls LibreTime API for imported files
   - Retrieves track IDs and file paths
   - Updates Payload episodes with `libretimeTrackId` and `libretimeFilepathRelative`
   - Should show: "✅ Successfully hydrated: 100 episodes"

3. **Archive to Hetzner** (Shell Script)
   ```bash
   # Check directory structure first (LibreTime may create Artist/Album subfolders)
   ls -la /srv/media/imported/1/
   find /srv/media/imported/1 -type d
   find /srv/media/imported/1 -type f -name "*.mp3" | wc -l
   
   # Run batch archive transfer (scans all subdirectories, archives with flat structure)
   scripts/sh/archive/batch_rsync_hydrate.sh /srv/media/imported/1 legacy --dry-run
   scripts/sh/archive/batch_rsync_hydrate.sh /srv/media/imported/1 legacy --apply
   ```
   
   **⏱️  TRANSFER TIME**: ~15 minutes for 100 files (depends on file sizes and connection speed)
   
   **📁 DIRECTORY STRUCTURE NOTES**:
   - **LibreTime** organizes files in subdirectories: `imported/1/Artist/Album/track.mp3`
   - **Archive** uses flat structure: `legacy/track.mp3` (just filename)
   - Both paths are recorded in Payload:
     - `libretimeFilepathRelative`: LibreTime's organized structure
     - `archiveFilePath`: Archive's flat backup structure
   - The batch script recursively finds all files in subdirectories and transfers them

4. **Hydrate Payload with Archive Paths** (TypeScript)
   ```bash
   # Update Payload episodes with archive file paths + LibreTime safety check
   docker compose run --rm jobs sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run'
   docker compose run --rm jobs sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl'
   ```
   
   **🛡️  SAFETY FEATURE**: This step includes automatic LibreTime field verification:
   - Checks if `libretimeTrackId` and `libretimeFilepathRelative` exist
   - If missing, queries LibreTime API to find and hydrate them
   - Acts as a safety net in case Step 2-bis failed or was incomplete
   - With `--check-libretime` (default: enabled), ensures data consistency

5. **Cleanup Local Files** (TypeScript)
   ```bash
   # Remove successfully transferred files from local storage (recursively searches subdirectories)
   docker compose run --rm jobs sh -lc 'npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run'
   docker compose run --rm jobs sh -lc 'npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl'
   ```

### Script Details

#### `batch_rsync_hydrate.sh`
- **Purpose**: Transfer files to Hetzner Storage Box with JSONL logging
- **Usage**: `scripts/sh/archive/batch_rsync_hydrate.sh <local_dir> <remote_bucket> [options]`
- **Options**:
  - `--apply`: Perform actual transfers (default: dry-run)
  - `--concurrency N`: Parallel transfers (default: 2)
  - `--log-file FILE`: Custom log file path
  - `--verify-rate M`: Verify every M-th file
- **Output**: JSONL log file at `/var/log/dia-import/rsync-archive-success.jsonl`

#### `hydrate-archive-paths.ts`
- **Purpose**: Update Payload episodes with archive file paths from JSONL log
- **Usage**: `npx tsx scripts/hydrate-archive-paths.ts --log <logfile> [options]`
- **Options**:
  - `--dry-run`: Show what would be updated without making changes
  - `--force`: Override existing archive paths
  - `--verify`: Verify files exist on remote storage before updating
  - `--check-libretime`: Check & hydrate LibreTime fields if missing (default: enabled)
  - `--no-check-libretime`: Skip LibreTime field checking
- **Updates**: Sets `hasArchiveFile: true` and `archiveFilePath` in Payload
- **Safety Feature**: Automatically checks if `libretimeTrackId` and `libretimeFilepathRelative` are missing, queries LibreTime API to find the track, and hydrates both archive and LibreTime fields in one update. This provides a safety net if Step 2 was skipped or failed for some episodes.

#### `cleanup-imported-files.ts`
- **Purpose**: Remove successfully transferred files from `/srv/media/imported/1` after archive transfer and Payload hydration
- **Usage**: `npx tsx scripts/cleanup-imported-files.ts --log <logfile> [options]`
- **Options**:
  - `--dry-run`: Show what would be deleted without making changes
  - `--verify-payload`: Verify Payload hydration before deletion (default: enabled)
  - `--no-verify-payload`: Skip Payload verification
- **Recursive Search**: Automatically searches all subdirectories (e.g., `imported/1/Artist/Album/`) to find files, as LibreTime may organize files into nested folders
- **Safety**: Only deletes files that were successfully transferred (based on JSONL log) and optionally verifies Payload hydration (`hasArchiveFile: true` and `archiveFilePath` set)
- **Cleanup**: Removes files from `/srv/media/imported/1` and all subdirectories to free up local storage space after successful archive transfer

### JSONL Log Format

```jsonl
{"episodeId":"685e6a57b3ef76e0e25c2557","archivePath":"legacy/685e6a57__tragol-fitness-club__episode-12__012.mp3","bucket":"legacy","filename":"685e6a57__tragol-fitness-club__episode-12__012.mp3","size":86149711,"ts":"2025-10-15T14:30:45.123Z","rsyncExitCode":0}
```

### Verification Steps (Required Between Stages)

#### Before Starting: Calculate Expected Totals
```bash
# Count files waiting to be processed
BATCH_SIZE=$(find /srv/media/tracks -type f -name "*.mp3" | wc -l)
echo "New batch size: $BATCH_SIZE files"

# Get current LibreTime total (requires API key from .env)
LT_CURRENT=$(curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length')
echo "Current LibreTime total: $LT_CURRENT"
echo "Expected after Step 2: $((LT_CURRENT + BATCH_SIZE))"

# Archive count via JSONL log
ARCHIVE_CURRENT=$(wc -l < /srv/media/logs/rsync-archive-success.jsonl 2>/dev/null || echo "0")
echo "Current archive total: $ARCHIVE_CURRENT"
echo "Expected after Step 3: $((ARCHIVE_CURRENT + BATCH_SIZE))"
verify by checking the actual archive server directly
```

#### After Step 2: Verify LibreTime Import Complete
```bash
# Check total files in LibreTime (should equal EXPECTED_TOTAL)
curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length'

# View recent LibreTime import logs
docker logs libretime_analyzer_1 --tail 50
```

#### After Step 2-bis: Verify Payload LibreTime Hydration
```bash
# Check random episodes (replace IDs with actual episode IDs from batch)
curl -s "https://content.diaradio.live/api/episodes/EPISODE_ID?depth=0" \
  -H "Authorization: users API-Key $PAYLOAD_API_KEY" | \
  jq '{id, title, libretimeTrackId, libretimeFilepathRelative, hasArchiveFile, archiveFilePath}'

# Should show:
#   libretimeTrackId: "123" (present)
#   libretimeFilepathRelative: "imported/1/..." (present)
#   hasArchiveFile: false (not archived yet)
#   archiveFilePath: null (not archived yet)
```

#### After Step 3: Verify Archive Transfer
```bash
# Check JSONL log entry count (should equal batch size)
wc -l /srv/media/logs/rsync-archive-success.jsonl

# Verify archive paths are flat structure
head -5 /srv/media/logs/rsync-archive-success.jsonl | jq -r '.archivePath'
# Should show: legacy/filename.mp3 (flat, no subdirectories)

# ⭐ ESSENTIAL: Verify actual file count on archive server
ARCHIVE_COUNT=$(ssh bx-archive "ls /home/archive/legacy/*.mp3" | wc -l)
echo "Archive server file count: $ARCHIVE_COUNT"
# Should match: PREVIOUS_TOTAL + BATCH_SIZE
```

#### After Step 4: Verify Payload Archive Hydration
```bash
# Check same random episodes as Step 2-bis
curl -s "https://content.diaradio.live/api/episodes/EPISODE_ID?depth=0" \
  -H "Authorization: users API-Key $PAYLOAD_API_KEY" | \
  jq '{id, title, libretimeTrackId, libretimeFilepathRelative, hasArchiveFile, archiveFilePath}'

# Should show ALL fields populated:
#   libretimeTrackId: "123" (present)
#   libretimeFilepathRelative: "imported/1/..." (present)
#   hasArchiveFile: true (NOW true)
#   archiveFilePath: "legacy/..." (NOW present)
```

#### After Step 5: Verify Cleanup
```bash
# Should show 0 files remaining
find /srv/media/imported/1 -type f -name "*.mp3" | wc -l
```

### Monitoring & Troubleshooting

#### Check LibreTime Import Progress (During Step 2 Wait)
```bash
# Check total files in LibreTime with API key
curl -s "https://schedule.diaradio.live/api/v2/files?limit=2000" \
  -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length'

# View LibreTime import logs
docker logs libretime_analyzer_1 --tail 50
```

#### Check /srv/media/imported/1 Structure
```bash
# List directory structure
ls -la /srv/media/imported/1/

# Show all subdirectories (LibreTime may create Artist/Album folders)
find /srv/media/imported/1 -type d

# Count files directly in imported/1
find /srv/media/imported/1 -maxdepth 1 -type f -name "*.mp3" | wc -l

# Count ALL files including subfolders (total to be archived)
find /srv/media/imported/1 -type f -name "*.mp3" | wc -l

# Show directory tree structure
tree -L 3 /srv/media/imported/1/
```

**📁 STRUCTURE NOTE**: LibreTime organizes files into Artist/Album subfolders in `/srv/media/imported/1`.
The archive transfer script automatically finds all files recursively and transfers them to a flat
archive structure (just filenames). Both the LibreTime path (with subdirectories) and the archive
path (flat) are recorded in Payload for reference.

#### Handling Large File Errors (413 Request Entity Too Large)

**Problem**: LibreTime bulk import fails with `413 Client Error: Request Entity Too Large` when encountering files larger than the nginx upload limit (default: 512MB).

**Symptoms**:
```bash
RuntimeError: could not upload /srv/media/tracks/<filename>.mp3
requests.exceptions.HTTPError: 413 Client Error: Request Entity Too Large
```

**Impact**: The bulk import stops completely, preventing remaining files from being imported.

**Manual Recovery Steps**:

1. **Identify the problematic file** (shown in error message):
   ```bash
   # Check file size
   ls -lh /srv/media/tracks/<problematic-file>.mp3
   ```

2. **Move large file to quarantine**:
   ```bash
   mkdir -p /srv/media/quarantine
   mv /srv/media/tracks/<problematic-file>.mp3 /srv/media/quarantine/
   ```

3. **Verify remaining files**:
   ```bash
   find /srv/media/tracks -maxdepth 1 -type f -name "*.mp3" | wc -l
   ```

4. **Re-run Step 2** (import remaining files):
   ```bash
   npx tsx scripts/import-batch-archives-media.ts
   ```

5. **Continue workflow** from Step 2-bis onwards as normal

**Long-term Solution**:

To increase the upload limit in LibreTime nginx (if you regularly have files > 512MB):

```bash
# Option 1: Temporary fix (lost on container restart)
docker exec libretime_nginx_1 sed -i 's/client_max_body_size 512M;/client_max_body_size 2G;/g' /etc/nginx/conf.d/default.conf
docker exec libretime_nginx_1 nginx -s reload

# Option 2: Permanent fix via docker-compose volume mount
# Create custom nginx config and mount it in docker-compose.yml
```

**Note**: Files larger than 1GB are typically 10+ hours of audio. Consider whether such files:
- Are actually needed in LibreTime (vs. just archiving them)
- Should be split into smaller segments
- Indicate a data quality issue (corrupted/concatenated files)

### Manual Steps

- **Between Steps 1 & 2**: Manually add batches of ~100 tracks to `/srv/media/tracks`
- **After Step 2-bis**: Verify all episodes hydrated successfully (check for "✅ Successfully hydrated: 100 episodes")
- **Before Step 3**: Check that files exist in `/srv/media/imported/1` (may be in subdirectories - this is normal)
- **After Step 5**: Manually empty `/srv/media/tracks` if needed for next batch
- **Repeat**: Process next batch of tracks

### Autonomous Agent Operation

For AI agents to run the complete workflow autonomously, follow this pattern:

**Key Decision Points:**
1. **After Step 2**: Poll LibreTime API with authentication until `COUNT >= EXPECTED_TOTAL`
2. **Always run dry-run first**: Verify operation before applying
3. **Verify after each step**: Use the verification commands below to ensure success
4. **Extract episode IDs**: From the first renamed file in Step 1 to use for verification

**Polling Strategy for Step 2:**
```bash
# Wait for LibreTime import to complete (check every 60 seconds)
while true; do 
  COUNT=$(curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" \
    -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length')
  echo "LibreTime progress: $COUNT / $EXPECTED_TOTAL"
  [ "$COUNT" -ge "$EXPECTED_TOTAL" ] && break
  sleep 60
done
```

**Sample Episode ID Extraction:**
```bash
# Get first episode ID from renamed files (for verification)
FIRST_EPISODE=$(ls /srv/media/tracks/*.mp3 | head -1 | xargs basename | grep -oP '^[a-f0-9]{24}')
LAST_EPISODE=$(ls /srv/media/tracks/*.mp3 | tail -1 | xargs basename | grep -oP '^[a-f0-9]{24}')
```

### Quick Reference: Complete Workflow Commands

```bash
# STEP 0: Pre-flight Check (Calculate Expected Totals)
BATCH_SIZE=$(find /srv/media/tracks -type f -name "*.mp3" | wc -l)
LT_CURRENT=$(curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length')
ARCHIVE_CURRENT=$(wc -l < /srv/media/logs/rsync-archive-success.jsonl 2>/dev/null || echo "0")
echo "Batch: $BATCH_SIZE | LibreTime: $LT_CURRENT → $((LT_CURRENT + BATCH_SIZE)) | Archive: $ARCHIVE_CURRENT → $((ARCHIVE_CURRENT + BATCH_SIZE))"

# STEP 1: Prepare Files (dry-run first, then apply)
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks --dry-run'
docker compose run --rm jobs sh -lc 'npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks'

# STEP 2: Import to LibreTime (run from HOST - requires docker command)
npx tsx scripts/import-batch-archives-media.ts

# WAIT & VERIFY: Check LibreTime import progress (poll until LT_CURRENT + BATCH_SIZE)
while true; do 
  COUNT=$(curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length')
  echo "LibreTime files: $COUNT / $((LT_CURRENT + BATCH_SIZE))"
  [ "$COUNT" -ge "$((LT_CURRENT + BATCH_SIZE))" ] && break
  sleep 60
done

# STEP 2-bis: Hydrate Payload with LibreTime Data
docker compose run --rm jobs sh -lc 'npx tsx scripts/import-batch-archives-media.ts'

# VERIFY Step 2-bis: Check random episodes for LibreTime fields
curl -s "https://content.diaradio.live/api/episodes/FIRST_EPISODE_ID?depth=0" -H "Authorization: users API-Key $PAYLOAD_API_KEY" | jq '{libretimeTrackId, libretimeFilepathRelative}'

# STEP 3: Archive to Hetzner (dry-run first, then apply) (~15-27 min for 100 files)
bash scripts/sh/archive/batch_rsync_hydrate.sh /srv/media/imported/1 legacy --dry-run
bash scripts/sh/archive/batch_rsync_hydrate.sh /srv/media/imported/1 legacy --apply

# VERIFY Step 3: Check JSONL log count AND archive server
wc -l /srv/media/logs/rsync-archive-success.jsonl
ARCHIVE_COUNT=$(ssh bx-archive "ls /home/archive/legacy/*.mp3" | wc -l)
echo "Archive server total: $ARCHIVE_COUNT (should be $((ARCHIVE_CURRENT + BATCH_SIZE)))"

# STEP 4: Hydrate Payload with Archive Paths (dry-run first, then apply)
docker compose run --rm jobs sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run'
docker compose run --rm jobs sh -lc 'npx tsx scripts/hydrate-archive-paths.ts --log /srv/media/logs/rsync-archive-success.jsonl'

# VERIFY Step 4: Check random episodes for ALL fields
curl -s "https://content.diaradio.live/api/episodes/FIRST_EPISODE_ID?depth=0" -H "Authorization: users API-Key $PAYLOAD_API_KEY" | jq '{libretimeTrackId, libretimeFilepathRelative, hasArchiveFile, archiveFilePath}'

# STEP 5: Cleanup Local Files (dry-run first, then apply)
docker compose run --rm jobs sh -lc 'npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl --dry-run'
docker compose run --rm jobs sh -lc 'npx tsx scripts/cleanup-imported-files.ts --log /srv/media/logs/rsync-archive-success.jsonl'

# VERIFY Step 5: Should show 0 files
find /srv/media/imported/1 -type f -name "*.mp3" | wc -l

# STEP 6: Archive JSONL log and create fresh one for next batch
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /srv/media/logs/archive
mv /srv/media/logs/rsync-archive-success.jsonl /srv/media/logs/archive/rsync-archive-success-batch-${TIMESTAMP}.jsonl
touch /srv/media/logs/rsync-archive-success.jsonl
echo "✅ JSONL archived and reset for next batch"
```

## Media Lifecycle Workflow

### Overview

The Media Lifecycle Workflow manages the complete lifecycle of media files from ingestion to archival and rehydration. This workflow ensures files are properly processed, stored, and can be restored when needed.

### Workflow Components

#### 1. **Archive Hydration Workflow** (Production)
The complete 6-step process for archiving new media files:
- **Step 1**: Prepare files (rename, sanitize metadata)
- **Step 2**: Import to LibreTime
- **Step 2-bis**: Hydrate Payload with LibreTime data
- **Step 3**: Archive to Hetzner Storage Box
- **Step 4**: Hydrate Payload with archive paths
- **Step 5**: Cleanup local files
- **Step 6**: Archive JSONL log and reset for next batch

See [Archive Hydration Workflow](#archive-hydration-workflow) for detailed documentation.

#### 2. **Rehydrate Episode** (Recovery)
Restore working files from archive when needed for playback or processing.

**Purpose:**
- Restore missing working files from Hetzner archive
- Idempotent operation (safe to retry)
- Automatic LibreTime track ID resolution
- Comprehensive error handling and logging

**Usage:**

```bash
# CLI Usage
pnpm rehydrate --id <episodeId>
npx tsx scripts/lifecycle/rehydrateEpisode.ts --id <episodeId>

# Dry-run mode
pnpm rehydrate --id <episodeId> --dry-run

# API Usage (POST endpoint)
curl -X POST /api/lifecycle/rehydrate \
  -H "Content-Type: application/json" \
  -d '{"episodeId": "685e6a54b3ef76e0e25c1921"}'
```

**Preconditions:**
- Episode must have `libretimeFilepathRelative` (plannable episodes only)
- Working file missing from `/srv/media/<libretimeFilepathRelative>`

**Behavior:**
1. **File exists** → Return `{action: 'exists'}` (no copy needed)
2. **Archive available** → Copy from archive to working directory
3. **No archive** → Return `E_WORKING_MISSING` error

**Error Codes:**
- `E_EPISODE_NOT_FOUND` - Episode not found in Payload
- `E_NOT_PLANNABLE` - Missing `libretimeFilepathRelative`
- `E_WORKING_MISSING` - No working file and no archive
- `E_ARCHIVE_MISSING` - Archive file not found
- `E_COPY_FAILED` - Rsync transfer failed
- `E_PERMISSION` - File system permission error

**Response Format:**
```json
{
  "episodeId": "685e6a54b3ef76e0e25c1921",
  "status": "ok|copied|error",
  "action": "exists|copied_from_archive|error",
  "workingPath": "imported/1/Artist/Album/file.mp3",
  "archivePath": "legacy/file.mp3",
  "bytes": 141234567,
  "duration_ms": 83000,
  "ltTrackId": "1234",
  "error": {
    "code": "E_ARCHIVE_MISSING",
    "message": "Archive file not found"
  }
}
```

### Scripts Reference

#### Core Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/lifecycle/rehydrateEpisode.ts` | Rehydrate single episode | `pnpm rehydrate --id <episodeId>` |
| `src/server/api/lifecycle/rehydrate.ts` | API endpoint | `POST /api/lifecycle/rehydrate` |
| `src/server/lib/rsyncPull.ts` | Archive → Working copy | Internal utility |
| `src/server/lib/logLifecycle.ts` | JSONL logging | Internal utility |

#### Archive Hydration Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/rename-media-in-place.ts` | Normalize filenames | `npx tsx scripts/rename-media-in-place.ts --root /srv/media/tracks` |
| `scripts/import-batch-archives-media.ts` | Import to LibreTime | `npx tsx scripts/import-batch-archives-media.ts` |
| `scripts/hydrate-archive-paths.ts` | Update Payload with archive paths | `npx tsx scripts/hydrate-archive-paths.ts --log <logfile>` |
| `scripts/cleanup-imported-files.ts` | Remove local files | `npx tsx scripts/cleanup-imported-files.ts --log <logfile>` |
| `scripts/sh/archive/batch_rsync_hydrate.sh` | Transfer to Hetzner | `bash scripts/sh/archive/batch_rsync_hydrate.sh <dir> <bucket>` |

### File Paths & Structure

#### Working Directory (`/srv/media/`)
```
/srv/media/
├── tracks/                    # Source files (canonical naming)
├── imported/1/               # LibreTime working directory
│   └── Artist/Album/         # LibreTime organized structure
├── staging/                  # Temporary staging area
└── logs/                     # Operation logs
    ├── rsync-archive-success.jsonl
    └── rehydrate-operations.jsonl
```

#### Archive Directory (`/home/archive/`)
```
/home/archive/
├── legacy/                   # Legacy files (flat structure)
│   └── <episodeId>__<show>__<title>__<number>.mp3
└── YYYY-MM/                  # Monthly buckets (new files)
    └── <episodeId>__<show>__<title>__<number>.mp3
```

### Environment Variables

#### Required
```bash
# LibreTime API
LIBRETIME_API_URL=https://schedule.diaradio.live
LIBRETIME_API_KEY=your_api_key
LIBRETIME_LIBRARY_ROOT=/srv/media

# Payload CMS
PAYLOAD_API_URL=https://content.diaradio.live
PAYLOAD_API_KEY=your_api_key

# Hetzner Storage Box (SSH)
# Configure in ~/.ssh/config for 'bx-archive' host
```

### Logging

#### JSONL Log Format
All operations are logged to structured JSONL files:

**Archive Operations** (`/srv/media/logs/rsync-archive-success.jsonl`):
```jsonl
{"episodeId":"685e6a57b3ef76e0e25c2557","archivePath":"legacy/file.mp3","bucket":"legacy","filename":"file.mp3","size":86149711,"ts":"2025-10-15T14:30:45.123Z","rsyncExitCode":0}
```

**Rehydrate Operations** (`/srv/media/logs/rehydrate-operations.jsonl`):
```jsonl
{"operation":"rehydrate","event":"start","episodeId":"685e6a54b3ef76e0e25c1921","ts":"2025-10-15T14:30:45.123Z"}
{"operation":"rehydrate","event":"copied","episodeId":"685e6a54b3ef76e0e25c1921","workingPath":"imported/1/file.mp3","archivePath":"legacy/file.mp3","bytes":141234567,"duration_ms":83000,"ts":"2025-10-15T14:30:45.123Z"}
```

### Automated Cron Jobs

The media lifecycle and stream monitoring are fully automated with cron jobs that run on the host.

#### Production Cron Setup

**Installation**: The crontab is installed on the host (runs as root) and uses `docker compose exec` to run scripts inside the container.

```bash
# View installed crontab
sudo crontab -l

# Edit crontab (if needed)
sudo crontab -e
```

**Crontab Configuration** (`/etc/crontab` or `sudo crontab -l`):
```bash
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TZ=Europe/Paris

# Pre-air (every 15m, offset) — prevent overlap with flock
# Note: Runs script directly (not via HTTP API) - no authentication needed
*/15 * * * * /usr/bin/flock -n /tmp/dia-preair.lock docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts' >> /var/log/dia-cron/preair-rehydrate.log 2>&1

# Post-air (every 10m, offset) — prevent overlap with flock
# Note: Runs script directly (not via HTTP API) - no authentication needed
*/10 * * * * /usr/bin/flock -n /tmp/dia-postair.lock docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/postair_archive_cleanup.ts' >> /var/log/dia-cron/postair-archive.log 2>&1

# File exists check (daily at 3 AM) — prevent playout errors from missing files
0 3 * * * /usr/bin/flock -n /tmp/dia-filecheck.lock /srv/payload/scripts/fix-libretime-file-exists.sh >> /var/log/dia-cron/file-exists-check.log 2>&1

# Stream health check (every minute) — detect and fix playout desync
* * * * * /usr/bin/flock -n /tmp/dia-health.lock /srv/payload/scripts/stream-health-check.sh

# System guard (every 5m) — watch for run queue / swap / OOM spikes
*/5 * * * * /usr/bin/flock -n /tmp/dia-system-watch.lock /srv/payload/scripts/cron/system_health_guard.sh

# Noon canary (daily 12:05 CET) — verify Payload endpoints
5 12 * * * /usr/bin/flock -n /tmp/dia-noon-canary.lock /srv/payload/scripts/cron/noon_canary.sh
```

**Key Features**:
- ✅ Uses `docker compose run --rm jobs` (ephemeral containers, auto-cleanup)
- ✅ `flock` prevents overlapping runs if a job takes longer than the interval
- ✅ Timezone set to `Europe/Paris` for proper scheduling
- ✅ Separate logs for each cron job
- ✅ Both stdout and stderr captured

#### Cron A: Pre-air Rehydrate Sweep
Automatically ensures working files are available for scheduled episodes.

**Schedule**: Every 15 minutes  
**Purpose**: Rehydrate missing working files for episodes scheduled in the next 24 hours  
**Script**: `scripts/cron/preair_rehydrate.ts`

```bash
# Manual HTTP trigger (requires admin/staff authentication)
# Using API Key:
curl -X POST https://content.diaradio.live/api/lifecycle/preair-rehydrate \
  -H "Authorization: users API-Key YOUR_API_KEY"

# Using JWT Bearer token:
curl -X POST https://content.diaradio.live/api/lifecycle/preair-rehydrate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or run script directly (no auth needed):
docker compose -f /srv/payload/docker-compose.yml exec -T dev-scripts sh -lc 'npx tsx scripts/cron/preair_rehydrate.ts'
```

**Process**:
1. Query episodes scheduled in next 24h with `libretimeFilepathRelative`
2. Check if working file exists at `/srv/media/<libretimeFilepathRelative>`
3. If missing: restore from archive using `rsyncPull()` (calls `scripts/sh/archive/rsync_pull.sh`)
4. Log operations to `/srv/media/logs/cron-preair-rehydrate.jsonl` (JSONL)
5. Execution logs to `/var/log/dia-cron/preair-rehydrate.log` (text)

**Features**:
- Direct function calls (no CLI spawning)
- Per-episode locking to prevent concurrent operations
- Automatic retry on failure (3 attempts with exponential backoff)
- Proper exit on completion (no hanging)

#### Cron B: Post-air Archive & Cleanup
Automatically updates airing metrics and cleans up working files after episodes air.

**Schedule**: Every 10 minutes  
**Purpose**: Update metrics and cleanup for episodes aired in last 48h (excluding last 10m)  
**Script**: `scripts/cron/postair_archive_cleanup.ts`

```bash
# Manual HTTP trigger (requires admin/staff authentication)
# Using API Key:
curl -X POST https://content.diaradio.live/api/lifecycle/postair-archive \
  -H "Authorization: users API-Key YOUR_API_KEY"

# Using JWT Bearer token:
curl -X POST https://content.diaradio.live/api/lifecycle/postair-archive \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or run script directly (no auth needed):
docker compose -f /srv/payload/docker-compose.yml run --rm jobs sh -lc 'npx tsx scripts/cron/postair_archive_cleanup.ts'
```

**Process**:
1. Query episodes with `scheduledEnd` in last 48h (excluding last 10m)
2. Update airing metrics:
   - Set `firstAiredAt` if null (to `scheduledAt`)
   - Update `lastAiredAt` (to `scheduledEnd`)
   - Increment `plays` counter
   - Set `airTimingIsEstimated=true`
3. If working file missing and episode has archive: rehydrate first
4. If already archived (`hasArchiveFile=true`): cleanup working file
5. If not archived: archive to legacy, then cleanup
6. Log operations to `/srv/media/logs/cron-postair-archive.jsonl` (JSONL)
7. Execution logs to `/var/log/dia-cron/postair-archive.log` (text)

#### Cron C: System Health Guard
Lightweight watchdog that records system pressure signals (run queue, swap usage, kernel OOM events) every five minutes and mirrors warnings into syslog.

```bash
# Manual execution
/srv/payload/scripts/cron/system_health_guard.sh
```

**Thresholds**:
- Warn when `procs_running` exceeds 16
- Warn when swap usage exceeds 512 MB
- Log any kernel OOM kills detected in the last 5 minutes

#### Cron D: Noon Canary Probe
Daily smoke test that hits key Payload endpoints shortly after noon to confirm the stack responds before the busy scheduling window.

```bash
# Manual execution (inside server tunnel)
/srv/payload/scripts/cron/noon_canary.sh
```

**Checks**:
- `GET /api/schedule/deterministic`
- `GET /admin`
- `POST /api/lifecycle/preair-rehydrate`

**Features**:
- Direct function calls (no CLI spawning)
- Per-episode locking to prevent concurrent operations
- Automatic rehydration if working file missing before archiving
- Proper exit on completion (no hanging)

#### Cron C: Stream Health Check
Automatically monitors stream status and restarts playout if desync is detected.

**Schedule**: Every 60 seconds  
**Purpose**: Detect LibreTime playout timing bugs and auto-restart when stream goes silent  
**Script**: `scripts/stream-health-check.sh`

```bash
# Manual execution
/srv/payload/scripts/stream-health-check.sh

# View health check logs
tail -f /var/log/dia-cron/stream-health.log

# Check health check state
cat /tmp/stream-health-state.json | jq
```

**Process**:
1. Query Icecast for current stream title and bytes transferred
2. Query LibreTime database for expected show (what should be playing now)
3. Compare titles (fuzzy match on first 20 characters)
4. Check if stream bytes are increasing (detect frozen stream)
5. If mismatch OR frozen for ≥120 seconds: restart playout and liquidsoap
6. Log all checks and restarts to `/var/log/dia-cron/stream-health.log`
7. Track state in `/tmp/stream-health-state.json` to prevent false positives

**Features**:
- Detects LibreTime timing bug at hourly boundaries (playout stuck waiting for next hour)
- Auto-recovery within 2 minutes of desync
- Prevents false positives with sustained threshold
- Full audit trail of all checks and restarts
- Lock file prevents overlapping runs

**Context**: LibreTime playout service has a timing detection bug where it fails to recognize that "now" falls within a scheduled show window, particularly for long-running shows (>55 minutes). This causes the stream to go silent despite the UI showing "ON AIR". 

**Mitigation**: The deterministic feed now calculates `cue_in_sec` for currently playing shows, providing playout with the correct playback position. This helps playout correctly identify that a show is currently active rather than waiting for the next scheduled item. However, the underlying LibreTime bug may still cause issues in edge cases.

**Recovery**: The health check detects this stuck state and automatically restarts the services. See `/srv/payload/docs/STREAM_HEALTH_MONITORING.md` for detailed analysis.

#### Weekly Archive Structure
Episodes are archived to weekly buckets based on their air date in Europe/Paris timezone:

```
/home/archive/
├── legacy/                    # Legacy files (existing)
└── archive/                   # New weekly structure
    ├── 2025/
    │   ├── week-01/          # ISO week 1
    │   ├── week-02/          # ISO week 2
    │   └── ...
    └── 2026/
        └── ...
```

#### Log Management

**Two-Layer Logging System:**

1. **Execution Logs** (stdout/stderr from cron runs)
   - Location: `/var/log/dia-cron/`
   - Files: `preair-rehydrate.log`, `postair-archive.log`
   - Rotation: Weekly, keeps 8 weeks, compressed after rotation
   - Max size: 100MB per file (rotates when exceeded)

2. **Application Logs** (structured JSONL data)
   - Location: `/srv/media/logs/`
   - Files: `cron-preair-rehydrate.jsonl`, `cron-postair-archive.jsonl`
   - Rotation: Manual (not auto-rotated currently)

**Logrotate Configuration** (`/etc/logrotate.d/dia-cron`):
```bash
/var/log/dia-cron/*.log {
  weekly
  rotate 8
  missingok
  notifempty
  compress
  copytruncate
  maxsize 100M
}
```

### Monitoring & Troubleshooting

#### Check System Status
```bash
# LibreTime file count
curl -s "https://schedule.diaradio.live/api/v2/files?limit=1000" \
  -H "Authorization: Api-Key $LIBRETIME_API_KEY" | jq 'length'

# Archive file count
ssh bx-archive "ls /home/archive/legacy/*.mp3" | wc -l
ssh bx-archive "find /home/archive/archive -name '*.mp3' | wc -l"

# Working directory usage
du -sh /srv/media/imported/1/
find /srv/media/imported/1 -type f -name "*.mp3" | wc -l

# Cron execution logs (text, human-readable)
tail -f /var/log/dia-cron/preair-rehydrate.log
tail -f /var/log/dia-cron/postair-archive.log

# Recent cron runs with summary
tail -50 /var/log/dia-cron/preair-rehydrate.log | grep -E "(Found|Results|✅|❌)"
tail -50 /var/log/dia-cron/postair-archive.log | grep -E "(Found|Results|✅|❌)"

# Application logs (JSONL, structured data)
tail -f /srv/media/logs/cron-preair-rehydrate.jsonl
tail -f /srv/media/logs/cron-postair-archive.jsonl

# Parse JSONL logs for specific episode
jq 'select(.episodeId == "685e6a56b3ef76e0e25c1e76")' /srv/media/logs/cron-preair-rehydrate.jsonl
jq 'select(.action == "error")' /srv/media/logs/cron-postair-archive.jsonl

# Check cron daemon status
sudo systemctl status cron
grep CRON /var/log/syslog | tail -20
```

#### Common Issues

**Rehydrate Fails with `E_ARCHIVE_MISSING`:**
- Check if file exists: `ssh bx-archive "ls /home/archive/legacy/<filename>"`
- Verify `archiveFilePath` in Payload episode
- Check Hetzner Storage Box connectivity

**LibreTime Import Stuck:**
- Monitor LibreTime logs: `docker logs libretime_analyzer_1 --tail 50`
- Check file permissions in `/srv/media/imported/1`
- Verify LibreTime API connectivity

**Archive Transfer Slow:**
- Check network connectivity to Hetzner
- Verify SSH configuration in `~/.ssh/config`
- Monitor bandwidth usage during transfer

**LibreTime Stream Not Playing Scheduled Content:**
- Check playout logs: `docker logs libretime-playout-1 --tail 50`
- Verify files are being cached: `docker exec libretime-playout-1 ls -lah /app/scheduler/`
- Check for 404/403 errors in playout logs
- See LibreTime Configuration section below

### LibreTime Configuration

#### Required Settings for Archive Hydration Workflow

**1. Internal API Communication** (`/srv/libretime/docker-compose.yml`):
```yaml
playout:
  environment:
    LIBRETIME_GENERAL_PUBLIC_URL: http://nginx:8080  # Use internal URL
    LIBRETIME_GENERAL_API_KEY: <your-api-key>        # Match config.yml

liquidsoap:
  environment:
    LIBRETIME_GENERAL_PUBLIC_URL: http://nginx:8080
    LIBRETIME_GENERAL_API_KEY: <your-api-key>

analyzer:
  environment:
    LIBRETIME_GENERAL_PUBLIC_URL: http://nginx:8080
    LIBRETIME_GENERAL_API_KEY: <your-api-key>

worker:
  environment:
    LIBRETIME_GENERAL_PUBLIC_URL: http://nginx:8080
    LIBRETIME_GENERAL_API_KEY: <your-api-key>
```

**Why**: Services need internal Docker network URL for API calls. Using external HTTPS URL causes authentication failures and prevents file downloads.

**2. Storage Path Configuration** (LibreTime internal nginx):
```bash
# Update /api/_media alias to match your storage path
docker exec libretime-nginx-1 sed -i 's|alias /srv/libretime;|alias /srv/media;|g' /etc/nginx/conf.d/default.conf
docker exec libretime-nginx-1 nginx -s reload
```

**Why**: LibreTime API uses `X-Accel-Redirect` to serve media files through nginx. The alias must match `storage.path` in `config.yml`.

**3. Public URL Configuration** (`/srv/libretime/config.yml`):
```yaml
general:
  public_url: https://schedule.diaradio.live  # External URL for web UI
  api_key: <your-api-key>                     # Same as LIBRETIME_GENERAL_API_KEY
  
storage:
  path: /srv/media                            # Must match nginx alias
```

**4. Database Utility Configuration**:
The cron scripts use `/srv/payload/src/server/lib/libretimeDb.ts` to update LibreTime's `file_exists` flag. This utility:
- Auto-detects if running inside container or on host
- Uses `docker exec` from host, `psql` TCP connection from container
- Requires `docker.io` and `postgresql-client` packages in dev-scripts container

**5. Fade Values Fix**:
LibreTime requires `fade_in` and `fade_out` values in schedule. If NULL, playout fails with TypeError. Fix:
```sql
UPDATE cc_schedule SET fade_in = '00:00:00', fade_out = '00:00:00' WHERE fade_in IS NULL OR fade_out IS NULL;
```

**6. File Exists Check**:
Missing files marked as `file_exists = true` cause playout errors (404 downloads) which trigger schedule reloads and **double streams**. Run daily check:
```bash
# Manual execution
/srv/payload/scripts/fix-libretime-file-exists.sh

# Automated (cron runs daily at 3 AM)
# Already configured in crontab
```

#### Troubleshooting LibreTime Playback

**Symptom**: Stream plays "LibreTime - offline" or silence
```bash
# 1. Check if files are being cached
docker exec libretime-playout-1 ls -lah /app/scheduler/

# 2. Check for download errors
docker logs libretime-playout-1 --tail 50 | grep -E "ERROR|403|404|download"

# 3. Verify files exist and have correct status
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT filepath, file_exists FROM cc_files WHERE filepath LIKE 'imported/1/%' LIMIT 5;"

# 4. Check fade values
docker exec -i libretime-postgres-1 psql -U libretime -d libretime -c \
  "SELECT id, fade_in, fade_out FROM cc_schedule WHERE fade_in IS NULL OR fade_out IS NULL;"
```

**Common Fixes**:
- If 403/404 errors: Check `LIBRETIME_GENERAL_PUBLIC_URL` is internal (`http://nginx:8080`)
- If nginx 404 errors: Verify `/api/_media` alias points to correct storage path
- If fade errors: Run SQL update to set default fade values
- If `file_exists = false`: Run Cron A to update database

### Security Considerations

- **SSH Keys**: Use dedicated SSH keys for Hetzner Storage Box
- **API Keys**: Store securely, rotate regularly
- **File Permissions**: Ensure proper ownership of media files
- **Network**: Use secure connections for all API calls

### Performance Optimization

- **Concurrency**: Archive transfers use 2 parallel workers by default
- **Cipher**: Uses `aes128-gcm@openssh.com` for optimal speed
- **Compression**: Disabled for better CPU efficiency
- **Retries**: 2 retries with exponential backoff
- **Connection Reuse**: SSH ControlMaster for persistent connections

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
