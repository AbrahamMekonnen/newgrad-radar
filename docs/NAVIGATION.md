# Navigation Structure

This document describes the app's navigation architecture across desktop, mobile, and command palette interfaces.

## Navigation Items

| Label | Route | Protected | Description |
|-------|-------|-----------|-------------|
| All Jobs | `/` | No | Main job listing page with filters |
| Interview Prep | `/interview-prep` | No | Interview preparation resources |
| Watchlist | `/my-list` | Yes | Tracked companies and their jobs |
| Applications | `/applications` | Yes | Combined manual + auto-apply tracking |
| Analytics | `/analytics` | Yes | Job search analytics and insights |
| Settings | `/settings` | Yes | User preferences and notifications |

## Components

### Desktop Navigation (`Navbar.tsx`)

Primary nav links appear in the header (excluding Settings, which is in the user dropdown):
- All Jobs, Interview Prep, Watchlist, Applications, Analytics
- Settings accessible via user dropdown menu

### Mobile Navigation (`MobileNav.tsx`)

Slide-out drawer includes all nav items including Settings:
- All Jobs, Interview Prep, Watchlist, Applications, Analytics, Settings
- User email and sign out button at bottom

### Command Palette (`CommandPalette.tsx`)

Opened with `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux).

**Global Keyboard Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+D` | Go to Dashboard (All Jobs) |
| `Cmd+Shift+A` | Go to Applications |
| `Cmd+Shift+W` | Go to Watchlist |
| `Cmd+Shift+T` | Go to Settings |

**Navigation Actions:**
- Go to Dashboard
- Go to Applications
- Go to Watchlist
- Go to Settings
- Browse all jobs
- View applications

## Applications Page Structure

The `/applications` route (`src/app/applications/page.tsx`) combines two types of job tracking:

### Tab 1: Your Applications (Manual)
- Jobs saved from the All Jobs page
- Status tracking: Saved, Applied, In Review, Interviewing, Offer, Rejected
- Notes and applied date tracking
- Data source: `saved_jobs` table

### Tab 2: Auto-Apply
- Automated job submissions
- Status tracking: Pending, Filling, Review, Submitted, Failed
- ATS type indicator
- Data source: `application_logs` table

## Protected Routes

Routes marked as "protected" require authentication. Unauthenticated users are redirected to `/auth/login` with a redirect parameter to return after login.

Protected routes are enforced by:
1. Navigation components (hide links when not logged in)
2. `AuthGuard` component on page level
3. Middleware (`src/middleware.ts`)

## File Locations

```
src/
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx          # Desktop navigation
│   │   └── MobileNav.tsx       # Mobile drawer navigation
│   └── ui/
│       └── CommandPalette.tsx  # Cmd+K command palette
└── app/
    ├── page.tsx                # / - All Jobs
    ├── interview-prep/
    │   └── page.tsx            # /interview-prep
    ├── my-list/
    │   └── page.tsx            # /my-list - Watchlist
    ├── applications/
    │   └── page.tsx            # /applications
    ├── analytics/
    │   └── page.tsx            # /analytics
    └── settings/
        └── page.tsx            # /settings
```
