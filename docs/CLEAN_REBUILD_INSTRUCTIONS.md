# Clean Rebuild Instructions
**Date:** 2025-12-16  
**Context:** Version upgrade + clean rebuild after security incident

---

## Updated Versions

- **Next.js:** `15.3.2` → `15.3.6`
- **React:** `19.1.0` → `19.1.2`
- **React DOM:** `19.1.0` → `19.1.2`

---

## Clean Rebuild Process

### 1. Updated Files

✅ **package.json** - Updated with new versions  
✅ **docker-compose.yml** - Updated build service to:
   - Use `pnpm` (matching package.json packageManager)
   - Clean `.next` and `node_modules` before build
   - Use `--frozen-lockfile` for reproducible builds

### 2. Rebuild Command

```bash
cd /srv/payload

# Clean rebuild (removes .next, node_modules, then installs and builds)
docker compose --profile build run --rm payload-build
```

### 3. What the Build Does

1. **Cleans artifacts:**
   - Removes `.next/` (Next.js build output)
   - Removes `node_modules/` (dependencies)
   - Removes `pnpm-lock.yaml.lock` (if exists)

2. **Installs dependencies:**
   - Enables pnpm via corepack
   - Runs `pnpm install --frozen-lockfile` (uses existing pnpm-lock.yaml)

3. **Builds application:**
   - Runs `pnpm run build` (Next.js production build)

### 4. After Build

```bash
# Restart the payload service to use new build
docker compose restart payload

# Verify it's running
docker compose ps

# Check logs
docker compose logs payload | tail -50
```

---

## Verification Steps

After rebuild and restart:

- [ ] Container starts without errors
- [ ] No build errors in logs
- [ ] Admin panel loads
- [ ] API endpoints respond
- [ ] No console errors
- [ ] Application functions normally

---

## Rollback

If issues occur:

```bash
cd /srv/payload

# Restore package.json
git checkout package.json

# Restore docker-compose.yml
git checkout docker-compose.yml

# Rebuild with old versions
docker compose --profile build run --rm payload-build

# Restart
docker compose restart payload
```

---

## Notes

- **Clean rebuild:** Ensures no cached artifacts from old versions
- **Frozen lockfile:** Uses exact versions from pnpm-lock.yaml for reproducibility
- **pnpm:** Matches package.json packageManager specification
- **Build time:** May take 5-10 minutes depending on dependencies

---

**END OF INSTRUCTIONS**

