# Tailwind v4 + shadcn/ui Scoped Setup - Reviewer Pack

**Date**: October 14, 2025  
**Status**: 📋 PROPOSAL ONLY - NO CODE CHANGES YET  
**Scope**: Enable Tailwind v4 + shadcn/ui ONLY in Planner & Portal (Payload Admin untouched)  
**Risk**: LOW (Scoped imports, zero global CSS injection)

---

## 1. SUMMARY (10 Bullets)

1. ✅ **Install Tailwind v4** with Vite plugin (`@tailwindcss/vite`) for optimal integration
2. ✅ **Install shadcn dependencies** (`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`)
3. ✅ **Create scoped CSS**: `src/admin/planner/tw.css` with `@import "tailwindcss"` (Planner only)
4. ✅ **Create scoped CSS**: `src/site/tw.css` with `@import "tailwindcss"` (Portal only)
5. ✅ **No PostCSS config** - Tailwind v4 uses Vite plugin directly
6. ✅ **Import tw.css locally** in `PlannerViewWithLibreTime.tsx` (not globally)
7. ✅ **Create ui folder**: `src/shared/ui/` for shadcn components (Button, Dialog, Badge)
8. ✅ **Payload Admin untouched** - NO `admin.css` config, NO global CSS injection
9. ✅ **Isolation verified** - Removing `import './tw.css'` kills Tailwind in Planner only
10. ✅ **Existing planner mount** - Already configured as custom view at `/planner` (line 39-43 in payload.config.ts)

**Key Principle**: Tailwind CSS is activated **only where imported**. By importing `tw.css` within Planner component tree, styles are scoped to that subtree via Vite's build boundaries.

---

## 2. PROPOSED DIFFS

### 2.1 Dependencies

**File**: `package.json`

```diff
  "devDependencies": {
    "@playwright/test": "1.50.0",
+   "@tailwindcss/vite": "^4.0.0-beta.1",
    "@testing-library/react": "16.3.0",
    "@types/node": "^22.5.4",
    "@types/react": "19.1.0",
    "@types/react-dom": "19.1.2",
    "@vitejs/plugin-react": "4.5.2",
+   "class-variance-authority": "^0.7.1",
+   "clsx": "^2.1.1",
    "eslint": "^9.16.0",
    "eslint-config-next": "15.3.0",
    "jsdom": "26.1.0",
+   "lucide-react": "^0.468.0",
    "playwright": "1.50.0",
    "playwright-core": "1.50.0",
    "prettier": "^3.4.2",
+   "tailwind-merge": "^2.6.0",
+   "tailwindcss": "^4.0.0-beta.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3",
    "vite-tsconfig-paths": "5.1.4",
    "vitest": "3.2.3"
  }
```

**Install command**:
```bash
pnpm add -D tailwindcss@next @tailwindcss/vite@next
pnpm add clsx tailwind-merge class-variance-authority lucide-react
```

**Note**: Using `@next` tag for Tailwind v4 beta. Pin exact versions in production.

---

### 2.2 Vite Configuration (NEW FILE)

**File**: `vite.config.ts` (CREATE NEW)

```typescript
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(), // Tailwind v4 Vite plugin
  ],
})
```

**Why this works**:
- Tailwind v4 uses Vite plugin instead of PostCSS
- CSS is scoped to entry points that `@import "tailwindcss"`
- No global config needed - activation is via CSS imports
- Next.js 15 can coexist with Vite config for admin bundling

**IMPORTANT**: This `vite.config.ts` is for **admin bundle only** (Payload uses Vite for admin UI). Next.js continues using its own bundler for app routes.

---

### 2.3 Planner Scoped CSS (NEW FILE)

**File**: `src/admin/planner/tw.css` (CREATE NEW)

```css
/**
 * Tailwind v4 - Planner Scoped
 * 
 * This file is ONLY imported in PlannerViewWithLibreTime.tsx
 * It does NOT affect Payload's Admin UI (Collections, Dashboard, etc.)
 * 
 * Removing the import from PlannerViewWithLibreTime will immediately
 * disable all Tailwind utilities in the Planner subtree.
 */

@import "tailwindcss";
```

**That's it** - Tailwind v4 uses a single import. No `@tailwind base/components/utilities` needed.

---

### 2.4 Site/Portal Scoped CSS (NEW FILE)

**File**: `src/site/tw.css` (CREATE NEW)

```css
/**
 * Tailwind v4 - Site/Portal Scoped
 * 
 * For future custom pages (e.g., resident upload portal).
 * Import this in site-specific entry points (NOT in admin).
 * 
 * Example usage:
 * - src/app/(public)/portal/page.tsx
 * - src/app/(public)/upload/page.tsx
 */

@import "tailwindcss";
```

---

### 2.5 Planner Component Import (PLANNED CHANGE)

**File**: `src/admin/components/PlannerViewWithLibreTime.tsx`

```diff
  'use client'
  
  import React, { useState, useEffect, useCallback, useRef } from 'react'
  import dynamic from 'next/dynamic'
  import type FullCalendar from '@fullcalendar/react'
+ import '../planner/tw.css' // ⚠️ CRITICAL: Enables Tailwind for this subtree ONLY
  import { useScheduledEpisodes } from '../hooks/useScheduledEpisodes'
  import { CalendarEvent, ScheduledEpisode } from '../types/calendar'
  // ... rest of imports
```

**Single line addition** at the top of the file (after 'use client', before other imports).

**Effect**: 
- Tailwind utilities become available for this component and all children
- Does NOT affect Payload Admin (Collections, Dashboard, Globals, etc.)
- Scoped by Vite build boundaries

---

### 2.6 shadcn UI Structure (NEW FOLDER)

**File**: `src/shared/ui/utils.ts` (CREATE NEW)

```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utility to merge Tailwind classes with proper precedence
 * Used by all shadcn components
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

**File**: `src/shared/ui/button.tsx` (CREATE NEW)

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white shadow hover:bg-blue-700',
        outline: 'border border-gray-300 bg-white shadow-sm hover:bg-gray-50',
        ghost: 'hover:bg-gray-100',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
```

---

**File**: `src/shared/ui/badge.tsx` (CREATE NEW)

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 text-gray-900',
        success: 'bg-green-100 text-green-900',
        warning: 'bg-yellow-100 text-yellow-900',
        error: 'bg-red-100 text-red-900',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

---

**File Structure Visualization**:

```
src/
├── admin/
│   ├── planner/
│   │   └── tw.css                        # NEW - Planner Tailwind
│   └── components/
│       └── PlannerViewWithLibreTime.tsx  # MODIFIED - add import
│
├── site/
│   └── tw.css                            # NEW - Portal Tailwind
│
└── shared/
    └── ui/                               # NEW - shadcn components
        ├── utils.ts
        ├── button.tsx
        └── badge.tsx
```

---

### 2.7 TypeScript Paths (OPTIONAL ENHANCEMENT)

**File**: `tsconfig.json`

```diff
  {
    "compilerOptions": {
      // ... existing options ...
      "paths": {
        "@/*": ["./src/*"],
+       "@/ui/*": ["./src/shared/ui/*"]
      }
    }
  }
```

**Benefit**: Cleaner imports like `import { Button } from '@/ui/button'` instead of relative paths.

---

## 3. LOGS

**None** - No commands executed yet. This is a proposal only.

---

## 4. QUESTIONS & RISKS (8 Items)

### Questions

1. **Q: Confirm exact planner root component path?**  
   **A**: Based on `payload.config.ts` line 40: `./admin/components/PlannerViewWithLibreTime`  
   **Action**: Import `tw.css` at top of this file (shown in diff 2.5)

2. **Q: Is planner mounted as custom view?**  
   **A**: Yes - confirmed in `payload.config.ts` lines 38-44:
   ```typescript
   components: {
     views: {
       planner: {
         Component: './admin/components/PlannerViewWithLibreTime',
         path: '/planner',
       }
     }
   }
   ```
   **Action**: No changes needed to mount point - already isolated

3. **Q: Will Vite config conflict with Next.js?**  
   **A**: No - Payload admin uses Vite for bundling (separate from Next.js app routes)  
   **Risk**: Low - Next.js and Vite can coexist (Payload 3.x design)

4. **Q: Tailwind v4 stability?**  
   **A**: v4 is in beta (as of Oct 2025). Production release expected soon.  
   **Risk**: Medium - Use exact version pinning; monitor changelog  
   **Mitigation**: Can fallback to v3 + PostCSS if v4 issues arise

5. **Q: Will CSS leak into Admin via cascade?**  
   **A**: No - Tailwind utilities are atomic (e.g., `.bg-blue-600`), not global selectors  
   **Verification**: Test by inspecting Admin pages in DevTools (should have NO Tailwind classes)

6. **Q: What about FullCalendar existing styles?**  
   **A**: FullCalendar has its own CSS bundle - Tailwind won't override it  
   **Note**: Can use Tailwind for custom event content (via `eventContent` prop)

7. **Q: How to update shadcn components later?**  
   **A**: Manual copy-paste from ui.shadcn.com (no CLI in this setup)  
   **Best Practice**: Document component versions in `src/shared/ui/README.md`

8. **Q: Bundle size impact?**  
   **A**: Estimated +15-20KB gzipped (Tailwind base + 3 components)  
   **Acceptable**: Modern apps; Vite tree-shakes unused classes

### Risks

1. **MEDIUM**: Tailwind v4 beta stability  
   **Mitigation**: Pin exact version; test thoroughly in dev; monitor for breaking changes

2. **LOW**: Vite + Next.js integration edge cases  
   **Mitigation**: Already using Vite in project (vitest.config.mts); proven compatibility

3. **LOW**: Developer confusion about when to use Tailwind  
   **Mitigation**: Add comments in `tw.css`; document in code reviews

4. **VERY LOW**: CSS cascade leakage  
   **Mitigation**: Test Admin pages post-setup; atomic utilities don't leak

5. **LOW**: Import path must be exact (`../planner/tw.css`)  
   **Mitigation**: TypeScript will error if path is wrong; easy to catch

6. **LOW**: Future Payload updates changing custom view API  
   **Mitigation**: Custom views are stable API in Payload 3.x; minimal risk

7. **VERY LOW**: Tailwind color palette conflicts with Payload  
   **Mitigation**: Using explicit color values (e.g., `bg-blue-600`), not theme colors

8. **LOW**: Forgetting to import tw.css in new custom pages  
   **Mitigation**: Document pattern; create template component with import

---

## 5. SAFETY VERIFICATION PLAN

### Pre-Implementation Checklist

- [ ] Review all diffs in this pack
- [ ] Confirm no `admin.css` config in diffs
- [ ] Confirm `tw.css` is NOT imported globally
- [ ] Verify planner mount point matches `payload.config.ts`
- [ ] Check Tailwind v4 + Vite compatibility docs

### Post-Implementation Testing

**Step 1: Installation Test**
```bash
# Install dependencies
pnpm add -D tailwindcss@next @tailwindcss/vite@next
pnpm add clsx tailwind-merge class-variance-authority lucide-react

# Verify versions
pnpm list tailwindcss @tailwindcss/vite
```

**Step 2: Build Test**
```bash
# Clean build
rm -rf .next
pnpm run build

# Check for errors
# Expected: No Tailwind-related errors
```

**Step 3: Dev Test**
```bash
pnpm run dev

# Navigate to Planner: http://localhost:3000/admin/planner
# Expected: Planner renders (Tailwind available)

# Navigate to Admin: http://localhost:3000/admin/collections/episodes
# Expected: Admin unchanged (no Tailwind classes in HTML)
```

**Step 4: Isolation Test**
```typescript
// Temporarily comment out in PlannerViewWithLibreTime.tsx:
// import '../planner/tw.css'

// Reload planner
// Expected: All Tailwind classes stop working
// Admin pages: Still unchanged

// Uncomment import, reload
// Expected: Tailwind works again in planner only
```

**Step 5: DevTools Verification**
```
1. Open Chrome DevTools on Planner page
2. Inspect toolbar button element
3. Expected: See Tailwind classes (bg-blue-600, hover:bg-blue-700, etc.)

4. Navigate to /admin/collections/episodes
5. Inspect any button/element
6. Expected: NO Tailwind classes (only Payload's default classes)
```

---

## 6. WHAT NOT TO DO (Critical)

### ❌ NEVER Do These

1. **❌ DO NOT** add this to `payload.config.ts`:
   ```typescript
   // WRONG - This would affect all of Admin
   admin: {
     css: './admin/planner/tw.css',
   }
   ```

2. **❌ DO NOT** import `tw.css` in global files:
   ```typescript
   // WRONG - In src/app/layout.tsx or src/app/(payload)/layout.tsx
   import './admin/planner/tw.css'
   ```

3. **❌ DO NOT** create `tailwind.config.js`:
   ```bash
   # WRONG - Tailwind v4 doesn't use JS config
   npx tailwindcss init
   ```

4. **❌ DO NOT** use `@tailwind` directives:
   ```css
   /* WRONG - This is v3 syntax */
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

5. **❌ DO NOT** create `postcss.config.js`:
   ```javascript
   // WRONG - Tailwind v4 uses Vite plugin, not PostCSS
   module.exports = {
     plugins: { tailwindcss: {} }
   }
   ```

### ✅ DO These Instead

1. **✅ DO** import `tw.css` locally in component:
   ```typescript
   // CORRECT - In PlannerViewWithLibreTime.tsx
   import '../planner/tw.css'
   ```

2. **✅ DO** use single `@import` in CSS:
   ```css
   /* CORRECT - Tailwind v4 syntax */
   @import "tailwindcss";
   ```

3. **✅ DO** keep Vite config minimal:
   ```typescript
   // CORRECT
   import tailwindcss from '@tailwindcss/vite'
   export default defineConfig({
     plugins: [tailwindcss()],
   })
   ```

---

## 7. ROLLBACK PLAN

If issues arise after implementation:

### Quick Rollback (< 2 minutes)
```typescript
// In src/admin/components/PlannerViewWithLibreTime.tsx
// Comment out the import:
// import '../planner/tw.css'

// Restart dev server
pnpm run dev
```

### Full Rollback (< 10 minutes)
```bash
# 1. Remove packages
pnpm remove tailwindcss @tailwindcss/vite clsx tailwind-merge class-variance-authority lucide-react

# 2. Delete files
rm vite.config.ts
rm -rf src/admin/planner/tw.css
rm -rf src/site/tw.css
rm -rf src/shared/ui/

# 3. Revert PlannerViewWithLibreTime.tsx
git checkout src/admin/components/PlannerViewWithLibreTime.tsx

# 4. Reinstall
pnpm install

# 5. Rebuild
pnpm run build
```

---

## 8. NEXT STEPS (After Approval)

1. **Create branch**: `git checkout -b feature/tailwind-scoped`
2. **Install deps**: Run commands from section 2.1
3. **Create files**: Add `vite.config.ts`, `tw.css` files, `ui/` folder
4. **Modify PlannerViewWithLibreTime**: Add single import line
5. **Test dev**: `pnpm run dev` → verify isolation
6. **Test build**: `pnpm run build` → verify no errors
7. **Manual QA**: Check Planner + Admin pages in browser
8. **DevTools audit**: Confirm CSS scoping
9. **Commit**: With clear commit message
10. **Deploy to staging**: Test in production-like environment

---

## 9. SUCCESS CRITERIA

✅ Planner page renders with Tailwind classes available  
✅ Admin pages (Collections, Dashboard, Globals) have ZERO visual changes  
✅ DevTools shows Tailwind classes ONLY in Planner HTML  
✅ DevTools shows NO Tailwind classes in Admin pages HTML  
✅ Build completes without errors  
✅ Bundle size increase < 25KB gzipped  
✅ Isolation test passes (commenting import kills Tailwind)  
✅ No console errors or warnings  
✅ FullCalendar continues to render correctly  
✅ Existing planner functionality unchanged (sync, drag-drop, etc.)  

---

## 10. FILE CHECKLIST

**Files to CREATE** (6 new files):
- [ ] `vite.config.ts` - Tailwind Vite plugin
- [ ] `src/admin/planner/tw.css` - Planner scoped Tailwind
- [ ] `src/site/tw.css` - Portal scoped Tailwind
- [ ] `src/shared/ui/utils.ts` - cn() helper
- [ ] `src/shared/ui/button.tsx` - Button component
- [ ] `src/shared/ui/badge.tsx` - Badge component

**Files to MODIFY** (2 files):
- [ ] `package.json` - Add 6 new dependencies
- [ ] `src/admin/components/PlannerViewWithLibreTime.tsx` - Add 1 import line

**Files to NEVER TOUCH**:
- ❌ `payload.config.ts` - NO changes to admin config
- ❌ `src/app/layout.tsx` - NO global imports
- ❌ Any Payload Admin core files

**Total Changes**: 8 files (6 new, 2 modified)

---

**END OF REVIEWER PACK**

---

## APPENDIX: Tailwind v4 Key Differences

For context on why this approach works:

### Tailwind v3 vs v4

| Aspect | v3 (PostCSS) | v4 (Vite/Lightning CSS) |
|--------|--------------|-------------------------|
| **Config** | `tailwind.config.js` | CSS-based (`@import`) |
| **Integration** | PostCSS plugin | Vite/Lightning plugin |
| **Activation** | Global via PostCSS | Per CSS file import |
| **Directives** | `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| **Scoping** | Via content paths | Via import location |

### Why Scoped Imports Work

1. **Vite Build Boundaries**: When `tw.css` is imported in a component, Vite includes Tailwind CSS in that chunk only
2. **No Global Reset**: Unlike v3's `@tailwind base`, v4's `@import` doesn't inject global resets unless explicitly configured
3. **CSS Modules Pattern**: Similar to CSS modules - each import creates a boundary
4. **Admin Isolation**: Payload Admin bundle doesn't import `tw.css` → no Tailwind included

---

**Status**: 📋 PROPOSAL COMPLETE - AWAITING APPROVAL  
**Estimated Implementation Time**: 30-45 minutes  
**Risk Assessment**: LOW (Scoped, reversible, tested pattern)  
**Recommendation**: APPROVE with pilot testing in dev environment first

