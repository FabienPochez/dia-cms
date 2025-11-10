# Tailwind v4 + shadcn/ui Setup - Reviewer Pack (Proposal)

**Date**: October 14, 2025  
**Status**: 📋 PROPOSAL - NOT YET APPLIED  
**Goal**: Enable Tailwind v4 + shadcn/ui for custom Planner and future pages WITHOUT affecting Payload Admin  
**Risk Level**: LOW (Scoped imports, zero Admin impact)

---

## 1. SUMMARY (What Will Be Done)

### Overview
Set up Tailwind CSS v4 and shadcn/ui components **exclusively** for:
- Custom Planner UI (existing custom admin view)
- Future custom pages (e.g., resident upload portal at `content.diaradio.live/portal`)

While **preserving** Payload's default Admin styles completely untouched.

### Key Strategy: Scoped CSS Imports
Instead of global CSS injection via `payload.config.ts`, we'll use **co-located CSS imports** within custom React components. This ensures Tailwind classes are only available in our custom subtrees.

### Installation Steps (10 Bullets)

1. ✅ Install Tailwind v4 with Vite plugin (`tailwindcss`, `@tailwindcss/vite`)
2. ✅ Install shadcn/ui dependencies (`clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`)
3. ✅ Create `vite.config.ts` with Tailwind Vite plugin (Next.js 15+ supports Vite)
4. ✅ Create scoped CSS entrypoint: `src/admin/planner/tw.css` with `@import "tailwindcss"`
5. ✅ Create scoped CSS entrypoint: `src/site/tw.css` for future custom pages
6. ✅ Import `tw.css` ONLY at root of Planner component (`PlannerViewWithLibreTime.tsx`)
7. ✅ Create `src/shared/ui/` folder for shadcn components (manual setup)
8. ✅ Add path alias `@/*` in `tsconfig.json` for clean imports
9. ✅ Add minimal shadcn components: Button, Dialog, Badge, Alert
10. ✅ Test isolation: removing `import './tw.css'` should kill all Tailwind in Planner

---

## 2. PROPOSED FILE STRUCTURE

```
/srv/payload/
├── vite.config.ts                    # NEW - Tailwind Vite plugin
├── tsconfig.json                     # MODIFIED - add path aliases
├── package.json                      # MODIFIED - new deps
│
├── src/
│   ├── admin/
│   │   ├── planner/
│   │   │   ├── tw.css                # NEW - Planner-scoped Tailwind
│   │   │   └── PlannerPage.tsx       # NEW - Wrapper with CSS import
│   │   │
│   │   └── components/
│   │       └── PlannerViewWithLibreTime.tsx  # MODIFIED - wrapped by PlannerPage
│   │
│   ├── site/
│   │   └── tw.css                    # NEW - Site-scoped Tailwind (future)
│   │
│   └── shared/
│       └── ui/                       # NEW - shadcn components folder
│           ├── button.tsx
│           ├── dialog.tsx
│           ├── badge.tsx
│           ├── alert.tsx
│           └── utils.ts              # cn() helper
```

---

## 3. DETAILED DIFFS

### 3.1 Package Dependencies

**File**: `package.json`

```diff
  "devDependencies": {
    "@playwright/test": "1.50.0",
    "@testing-library/react": "16.3.0",
+   "@tailwindcss/vite": "^4.0.0",
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
+   "tailwindcss": "^4.0.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.3",
    "vite-tsconfig-paths": "5.1.4",
    "vitest": "3.2.3"
  }
```

**Install Command**:
```bash
pnpm add -D tailwindcss @tailwindcss/vite
pnpm add clsx tailwind-merge class-variance-authority lucide-react
```

---

### 3.2 Vite Configuration

**File**: `vite.config.ts` (NEW)

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(), // Tailwind v4 Vite plugin
    tsconfigPaths(), // Already used in project
  ],
})
```

**Why Vite with Next.js 15?**
- Next.js 15.3+ has experimental Vite support via `next.config.mjs`
- Alternatively, Tailwind v4 can work with Next.js directly (check compatibility)
- **RISK**: May need to verify Next.js 15.3.2 + Tailwind v4 compatibility

**Alternative Approach** (if Vite not supported):
Use Tailwind v4 with PostCSS (traditional Next.js approach):
```bash
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

---

### 3.3 TypeScript Path Aliases

**File**: `tsconfig.json`

```diff
  {
    "compilerOptions": {
      "target": "ES2017",
      "lib": ["dom", "dom.iterable", "esnext"],
      "allowJs": true,
      "skipLibCheck": true,
      "strict": true,
      "forceConsistentCasingInFileNames": true,
      "noEmit": true,
      "esModuleInterop": true,
      "module": "esnext",
      "moduleResolution": "bundler",
      "resolveJsonModule": true,
      "isolatedModules": true,
      "jsx": "preserve",
      "incremental": true,
      "plugins": [
        {
          "name": "next"
        }
      ],
      "paths": {
-       "@/*": ["./src/*"]
+       "@/*": ["./src/*"],
+       "@/ui/*": ["./src/shared/ui/*"]
      }
    },
    "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
    "exclude": ["node_modules"]
  }
```

---

### 3.4 Scoped Tailwind CSS - Planner

**File**: `src/admin/planner/tw.css` (NEW)

```css
/**
 * Tailwind v4 CSS - Planner Scoped
 * 
 * This file is ONLY imported in PlannerPage.tsx.
 * It does NOT affect Payload's Admin UI.
 * 
 * Removing the import from PlannerPage will immediately
 * disable all Tailwind classes in the planner.
 */

@import "tailwindcss";

/* Optional: Planner-specific overrides */
.planner-ui {
  /* Force isolation - all Tailwind classes scoped here */
  @apply min-h-screen;
}
```

---

### 3.5 Scoped Tailwind CSS - Site (Future)

**File**: `src/site/tw.css` (NEW)

```css
/**
 * Tailwind v4 CSS - Site Scoped
 * 
 * For future custom pages like resident upload portal.
 * Import this in site-specific entry points (NOT in admin).
 */

@import "tailwindcss";

/* Site-specific base styles */
.site-wrapper {
  @apply antialiased;
}
```

---

### 3.6 Planner Wrapper Component

**File**: `src/admin/planner/PlannerPage.tsx` (NEW)

```typescript
'use client'

import React from 'react'
import PlannerViewWithLibreTime from '../components/PlannerViewWithLibreTime'

// ⚠️ CRITICAL: This import enables Tailwind for planner subtree ONLY
import './tw.css'

/**
 * Planner Page Wrapper
 * 
 * This component serves as the entry point for the custom planner.
 * By importing './tw.css' here, Tailwind classes become available
 * for all child components (PlannerViewWithLibreTime, CalendarComponent, etc.)
 * 
 * The import is scoped to this React subtree - it does NOT leak into
 * Payload's admin UI.
 */
export default function PlannerPage() {
  return (
    <div className="planner-ui bg-gray-50">
      {/* Original planner component - now with Tailwind available */}
      <PlannerViewWithLibreTime />
    </div>
  )
}
```

---

### 3.7 Update Payload Config to Use Wrapper

**File**: `src/payload.config.ts`

```diff
  import { mongooseAdapter } from '@payloadcms/db-mongodb'
  import { lexicalEditor } from '@payloadcms/richtext-lexical'
  import path from 'path'
  import { buildConfig } from 'payload'
  import { fileURLToPath } from 'url'
  
+ import PlannerPage from './admin/planner/PlannerPage'
  
  const filename = fileURLToPath(import.meta.url)
  const dirname = path.dirname(filename)
  
  export default buildConfig({
    admin: {
      user: Users.slug,
+     components: {
+       views: {
+         Planner: {
+           Component: PlannerPage, // Use wrapper instead of direct component
+           path: '/planner',
+         },
+       },
+     },
-     // DO NOT SET admin.css - that would affect all of admin
    },
    // ... rest of config
  })
```

**Note**: Adjust based on how planner is currently mounted. If it's already a custom view, just update the component reference.

---

### 3.8 shadcn/ui Utilities

**File**: `src/shared/ui/utils.ts` (NEW)

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

### 3.9 shadcn Button Component

**File**: `src/shared/ui/button.tsx` (NEW)

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
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
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

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

### 3.10 shadcn Dialog Component

**File**: `src/shared/ui/dialog.tsx` (NEW)

```typescript
'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from './utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className,
    )}
    {...props}
  />
)
DialogHeader.displayName = 'DialogHeader'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className,
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
}
```

**Note**: Requires additional dependency:
```bash
pnpm add @radix-ui/react-dialog
```

---

### 3.11 shadcn Badge Component

**File**: `src/shared/ui/badge.tsx` (NEW)

```typescript
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80',
        outline: 'text-foreground',
        success:
          'border-transparent bg-green-500 text-white shadow hover:bg-green-600',
        warning:
          'border-transparent bg-yellow-500 text-white shadow hover:bg-yellow-600',
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
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
```

---

### 3.12 Example Usage in Planner

**File**: `src/admin/components/PlannerViewWithLibreTime.tsx` (EXAMPLE MODIFICATION)

```diff
  'use client'
  
  import React, { useState, useEffect, useCallback, useRef } from 'react'
  import dynamic from 'next/dynamic'
  import type FullCalendar from '@fullcalendar/react'
+ import { Button } from '@/shared/ui/button'
+ import { Badge } from '@/shared/ui/badge'
+ import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
  
  // ... existing imports ...
  
  export default function PlannerViewWithLibreTime() {
    // ... existing state and hooks ...
    
    return (
      <div style={{ /* ... existing styles ... */ }}>
        {/* Toolbar with new shadcn Button */}
-       <button
-         onClick={handleSyncThisWeek}
-         disabled={syncInFlight}
-         style={{ /* ... old styles ... */ }}
-       >
-         {syncInFlight ? 'Syncing...' : 'Sync This Week'}
-       </button>
+       <Button
+         onClick={handleSyncThisWeek}
+         disabled={syncInFlight}
+         variant="default"
+         size="default"
+       >
+         {syncInFlight ? 'Syncing...' : 'Sync This Week'}
+       </Button>
        
        {/* Example: Status badge */}
+       <Badge variant={syncInFlight ? 'warning' : 'success'}>
+         {syncInFlight ? 'Syncing' : 'Ready'}
+       </Badge>
        
        {/* Rest of component */}
      </div>
    )
  }
```

---

## 4. ADDITIONAL DEPENDENCIES

Beyond the base Tailwind packages, shadcn components require:

```bash
# Dialog component
pnpm add @radix-ui/react-dialog

# Future components (as needed)
pnpm add @radix-ui/react-dropdown-menu  # Dropdown
pnpm add @radix-ui/react-popover        # Popover
pnpm add @radix-ui/react-select         # Select
pnpm add @radix-ui/react-tooltip        # Tooltip
pnpm add @radix-ui/react-alert-dialog   # Alert Dialog
```

**Note**: Only install as needed to keep bundle size small.

---

## 5. SAFETY CHECKS & VERIFICATION

### What NOT to Do ❌

1. **❌ DO NOT** add Tailwind CSS to `payload.config.ts`:
   ```typescript
   // ❌ WRONG - This affects all of Admin
   export default buildConfig({
     admin: {
       css: '/path/to/tailwind.css', // DON'T DO THIS
     }
   })
   ```

2. **❌ DO NOT** import `tw.css` in any global entry point:
   ```typescript
   // ❌ WRONG - In src/app/layout.tsx or src/app/admin/layout.tsx
   import '../admin/planner/tw.css' // DON'T DO THIS
   ```

3. **❌ DO NOT** use `@layer` directives in global CSS files

### What TO Do ✅

1. **✅ DO** import `tw.css` only in custom component roots:
   ```typescript
   // ✅ CORRECT - In PlannerPage.tsx only
   import './tw.css'
   ```

2. **✅ DO** verify isolation by temporarily removing import:
   ```typescript
   // import './tw.css' // Commented out
   // Result: All Tailwind classes should stop working in Planner
   ```

3. **✅ DO** check Payload Admin pages after setup:
   - Navigate to Collections, Globals, Dashboard
   - Verify no visual changes
   - Check browser DevTools for unexpected Tailwind classes

---

## 6. TESTING PLAN

### Phase 1: Installation Verification
```bash
# 1. Install dependencies
pnpm add -D tailwindcss @tailwindcss/vite
pnpm add clsx tailwind-merge class-variance-authority lucide-react
pnpm add @radix-ui/react-dialog

# 2. Check package.json
cat package.json | grep -A 5 "devDependencies"

# 3. Verify Vite config
cat vite.config.ts
```

### Phase 2: Build Test
```bash
# 1. Build project
pnpm run build

# 2. Check for errors
# Expected: No Tailwind-related build errors

# 3. Check bundle size (should not drastically increase)
du -sh .next/
```

### Phase 3: Runtime Test
```bash
# 1. Start dev server
pnpm run dev

# 2. Navigate to Planner (/admin/planner)
# Expected: Planner renders with Tailwind classes

# 3. Navigate to other Admin pages (/admin/collections/episodes)
# Expected: No visual changes, no Tailwind classes in HTML

# 4. Browser DevTools check
# - Inspect Planner: should see Tailwind utility classes
# - Inspect Admin pages: should NOT see Tailwind classes
```

### Phase 4: Isolation Test
```typescript
// In PlannerPage.tsx, comment out:
// import './tw.css'

// Expected result:
// - Planner loses all Tailwind styling
// - Other Admin pages remain unchanged
```

---

## 7. MIGRATION IMPACT

### Current State
```
Planner Component Structure:
- PlannerViewWithLibreTime.tsx (inline styles)
  ├─ CalendarComponent.tsx (inline styles)
  └─ EventPalette.tsx (inline styles)
```

### After Migration
```
Planner Component Structure:
- PlannerPage.tsx (NEW - imports tw.css)
  └─ PlannerViewWithLibreTime.tsx (Tailwind classes available)
      ├─ CalendarComponent.tsx (can use Tailwind)
      └─ EventPalette.tsx (can use Tailwind)
```

### Breaking Changes
**NONE** - All changes are additive:
- Existing inline styles continue to work
- Tailwind classes are opt-in (use as you refactor)
- Original components remain functional

---

## 8. PERFORMANCE CONSIDERATIONS

### Bundle Size Impact

| Item | Size (Estimated) | Notes |
|------|------------------|-------|
| Tailwind CSS (base) | ~10KB (gzipped) | Only base layer |
| shadcn Button | ~2KB | Includes CVA |
| shadcn Dialog | ~5KB | Includes Radix UI |
| shadcn Badge | ~1KB | Lightweight |
| **Total Added** | **~18KB** | Acceptable for feature richness |

### Optimization Strategies

1. **Tree Shaking**: Vite automatically removes unused Tailwind classes
2. **Code Splitting**: Each scoped CSS file is a separate chunk
3. **Lazy Loading**: shadcn components can be dynamically imported if needed

```typescript
// Optional: Lazy load Dialog for even better initial load
const Dialog = dynamic(() => import('@/shared/ui/dialog').then(m => m.Dialog))
```

---

## 9. QUESTIONS & RISKS

### Questions (8 Items)

1. **Q: Is Next.js 15.3.2 compatible with Vite/Tailwind v4?**  
   A: Next.js 15 has experimental Vite support. May need to use PostCSS approach instead.  
   **Action**: Test Vite config first; fallback to PostCSS if issues.

2. **Q: How is Planner currently mounted in Admin?**  
   A: Need to verify if it's via `admin.components.views` or custom route.  
   **Action**: Check `payload.config.ts` for exact mounting mechanism.

3. **Q: Will scoped CSS leak due to CSS cascade?**  
   A: No - Tailwind utilities are atomic classes. No global selectors or `@layer` in Admin.  
   **Action**: Verify in DevTools that Admin pages have no Tailwind classes.

4. **Q: Can we use Tailwind v4 alpha/beta safely?**  
   A: v4 is still in development (as of Oct 2025). May have breaking changes.  
   **Action**: Pin exact version in package.json; monitor changelog.

5. **Q: Do we need `tailwind.config.js` file?**  
   A: Tailwind v4 uses CSS-based config (`@import "tailwindcss"`). No JS config needed.  
   **Action**: Do NOT create `tailwind.config.js` unless customization required.

6. **Q: How to handle Tailwind color palette?**  
   A: Use CSS variables in `tw.css` for theme colors.  
   **Action**: Add custom properties after `@import "tailwindcss"`.

7. **Q: Will this conflict with FullCalendar styles?**  
   A: FullCalendar has its own CSS. Tailwind utilities won't override it.  
   **Action**: Test calendar rendering after Tailwind setup.

8. **Q: How to update shadcn components later?**  
   A: Manual copy-paste from shadcn docs (no CLI in this setup).  
   **Action**: Document component versions in `src/shared/ui/README.md`.

### Risks (8 Items)

1. **MEDIUM**: Tailwind v4 + Next.js 15 compatibility unknown  
   **Mitigation**: Use PostCSS fallback if Vite approach fails

2. **LOW**: CSS cascade could theoretically leak styles  
   **Mitigation**: Test thoroughly; use DevTools to verify isolation

3. **LOW**: Shadcn components may need updates for Tailwind v4  
   **Mitigation**: Check shadcn docs for v4 compatibility notes

4. **LOW**: Bundle size increase (~18KB)  
   **Mitigation**: Acceptable for modern apps; monitor with `pnpm run build`

5. **VERY LOW**: Payload Admin update could break custom views  
   **Mitigation**: Custom views are supported API; minimal risk

6. **LOW**: Developer confusion about when to use Tailwind vs inline styles  
   **Mitigation**: Document in code comments; add linting rules

7. **VERY LOW**: Path alias conflicts with existing `@/*`  
   **Mitigation**: Already using `@/*` in project; just add `@/ui/*`

8. **LOW**: Future Payload updates might change custom view API  
   **Mitigation**: Follow Payload 3.x migration guides; test after updates

---

## 10. ROLLBACK PLAN

If issues arise:

### Quick Rollback (< 5 minutes)
```bash
# 1. Remove Tailwind import from PlannerPage
# In src/admin/planner/PlannerPage.tsx:
# Comment out: import './tw.css'

# 2. Restart dev server
pnpm run dev
```

### Full Rollback (< 15 minutes)
```bash
# 1. Remove packages
pnpm remove tailwindcss @tailwindcss/vite clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-dialog

# 2. Delete files
rm -rf src/admin/planner/tw.css
rm -rf src/site/tw.css
rm -rf src/shared/ui/
rm vite.config.ts

# 3. Revert component changes
git checkout src/admin/components/PlannerViewWithLibreTime.tsx
git checkout src/payload.config.ts
git checkout tsconfig.json

# 4. Reinstall dependencies
pnpm install
```

---

## 11. FUTURE ENHANCEMENTS

### Phase 1: Planner UI Polish (Immediate)
- Replace inline styles in `PlannerViewWithLibreTime` with Tailwind
- Add shadcn Dialog for sync preview modal
- Add shadcn Badge for episode status indicators
- Improve responsive design with Tailwind breakpoints

### Phase 2: Additional Components (Week 2)
- Add shadcn Dropdown for episode actions
- Add shadcn Tooltip for calendar events
- Add shadcn Alert for error messages
- Create custom color palette in `tw.css`

### Phase 3: Resident Portal (Future)
- Create `src/site/pages/upload.tsx` with `import '../tw.css'`
- Full shadcn form components (Input, Select, File Upload)
- Authentication UI (Login, Register)
- Public-facing design system

---

## 12. DOCUMENTATION TASKS

After implementation:

1. **Create**: `src/shared/ui/README.md` - Component usage guide
2. **Create**: `src/admin/planner/STYLING.md` - Tailwind vs inline styles guide
3. **Update**: `docs/DEVELOPMENT_SETUP.md` - Add Tailwind setup steps
4. **Create**: `docs/CUSTOM_COMPONENTS.md` - How to add new shadcn components
5. **Update**: `README.md` - Mention Tailwind + shadcn in tech stack

---

## 13. SUCCESS CRITERIA

✅ **Planner** renders with Tailwind classes and shadcn components  
✅ **Admin** pages (Collections, Globals, Dashboard) have NO visual changes  
✅ **Build** succeeds without errors  
✅ **Bundle size** increase < 25KB (gzipped)  
✅ **DevTools** inspection shows Tailwind only in Planner subtree  
✅ **Isolation test** passes (removing `import './tw.css'` kills Tailwind)  
✅ **No console errors** related to CSS or styling  
✅ **FullCalendar** rendering unaffected  

---

## 14. REVIEWER CHECKLIST

Before approving:

- [ ] Verify all dependencies are in `devDependencies` or `dependencies` correctly
- [ ] Confirm `vite.config.ts` only adds Tailwind plugin (no other changes)
- [ ] Check `tw.css` files have ONLY `@import "tailwindcss"` (no global styles)
- [ ] Ensure PlannerPage wrapper is minimal (just import + wrap)
- [ ] Verify `payload.config.ts` does NOT have `admin.css` set
- [ ] Check path aliases in `tsconfig.json` don't conflict
- [ ] Review shadcn component code for TypeScript errors
- [ ] Confirm testing plan covers isolation verification
- [ ] Validate rollback plan is actionable

---

## 15. NEXT STEPS

**After Approval**:

1. Run installation commands
2. Create file structure
3. Apply diffs to existing files
4. Test in dev environment
5. Verify isolation in browser
6. Update documentation
7. Create PR for review
8. Deploy to staging
9. Monitor bundle size
10. Iterate on Planner UI polish

---

**END OF REVIEWER PACK**

**Status**: 📋 PROPOSAL - AWAITING USER APPROVAL  
**Estimated Implementation Time**: 2-3 hours  
**Risk Assessment**: LOW (Scoped changes, easy rollback)  
**Recommendation**: APPROVE with verification of Next.js 15 + Tailwind v4 compatibility

