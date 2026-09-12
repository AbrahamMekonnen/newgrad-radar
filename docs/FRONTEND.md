# Frontend Guide

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Language**: TypeScript
- **Auth**: Supabase Auth
- **Data Fetching**: Supabase client + React Server Components

## Pages

| Route | Page | Auth | Description |
|-------|------|------|-------------|
| `/` | All Jobs | No | Main page, browse all jobs with filters |
| `/my-list` | My List | Yes | Jobs from tracked companies + company picker |
| `/saved` | Saved Jobs | Yes | User's saved/applied jobs with status |
| `/analytics` | Analytics | Yes | Application performance insights with live updates |
| `/settings` | Settings | Yes | Notification preferences |
| `/auth/login` | Login | No | Login form |
| `/auth/signup` | Sign Up | No | Sign up form |
| `/auth/callback` | Callback | No | OAuth redirect handler |

## File Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout with Navbar
│   ├── page.tsx                # / - All Jobs
│   ├── my-list/
│   │   └── page.tsx            # /my-list
│   ├── saved/
│   │   └── page.tsx            # /saved
│   ├── analytics/
│   │   └── page.tsx            # /analytics - Real-time application analytics
│   ├── settings/
│   │   └── page.tsx            # /settings
│   └── auth/
│       ├── login/page.tsx      # /auth/login
│       ├── signup/page.tsx     # /auth/signup
│       └── callback/route.ts   # /auth/callback (OAuth)
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   ├── MobileNav.tsx
│   │   └── Footer.tsx
│   ├── jobs/
│   │   ├── JobCard.tsx
│   │   ├── JobList.tsx
│   │   ├── JobFilters.tsx
│   │   └── SearchBox.tsx
│   ├── companies/
│   │   ├── CompanyCard.tsx
│   │   ├── CompanyGrid.tsx
│   │   └── TierBadge.tsx
│   ├── saved/
│   │   ├── SavedJobCard.tsx
│   │   ├── StatusDropdown.tsx
│   │   └── NotesModal.tsx
│   ├── auth/
│   │   ├── AuthForm.tsx
│   │   ├── GoogleButton.tsx
│   │   └── AuthGuard.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Input.tsx
│       ├── Checkbox.tsx
│       ├── Badge.tsx
│       ├── Modal.tsx
│       └── Skeleton.tsx
└── lib/
    ├── supabase/
    │   ├── client.ts           # Browser client
    │   ├── server.ts           # Server client
    │   └── middleware.ts       # Auth middleware
    ├── types.ts                # TypeScript types
    └── utils.ts                # Helper functions
```

## Responsive Layouts

### Desktop (≥1024px)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Logo          [All Jobs]  [My List]  [Saved]                    [Login ▾] │
├───────────────────┬─────────────────────────────────────────────────────────┤
│                   │                                                          │
│   FILTERS         │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│   (sidebar)       │   │ Anthropic    │  │ Stripe       │  │ OpenAI       │  │
│                   │   │ SWE New Grad │  │ Backend Eng  │  │ ML Engineer  │  │
│   Tier            │   │ SF · AI      │  │ Remote       │  │ SF · AI      │  │
│   ☑ FAANG         │   │ 2h ago       │  │ 1d ago       │  │ 3h ago       │  │
│   ☑ AI            │   │ [Save]       │  │ [Save]       │  │ [Save]       │  │
│   ☑ Unicorn       │   └──────────────┘  └──────────────┘  └──────────────┘  │
│   ☐ YC            │                                                          │
│   ☐ Fintech       │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│   ☐ Infra         │   │ Figma        │  │ Databricks   │  │ Cloudflare   │  │
│                   │   │ Full Stack   │  │ Data Eng     │  │ SWE          │  │
│   Role            │   │ NYC          │  │ SF           │  │ Remote       │  │
│   ☑ SWE           │   │ 5h ago       │  │ 1d ago       │  │ 2d ago       │  │
│   ☑ ML/AI         │   │ [Save]       │  │ [Save]       │  │ [Saved ✓]    │  │
│   ☑ Backend       │   └──────────────┘  └──────────────┘  └──────────────┘  │
│   ☑ Frontend      │                                                          │
│   ☑ Full Stack    │                                                          │
│   ☐ Infra         │                     [Load More]                          │
│   ☐ Data          │                                                          │
│   ☐ Security      │                                                          │
│   ☐ Mobile        │                                                          │
│                   │                                                          │
│   [Clear All]     │                                                          │
│                   │                                                          │
└───────────────────┴─────────────────────────────────────────────────────────┘
```

### Mobile (<1024px)

```
┌───────────────────────────┐
│  ☰  Logo                  │  ← Hamburger menu
├───────────────────────────┤
│ [All Jobs] [My List]      │  ← Sticky tab bar
├───────────────────────────┤
│ [🔍 Search...] [Filter ▾] │  ← Filter opens drawer
├───────────────────────────┤
│ ┌───────────────────────┐ │
│ │ Anthropic             │ │
│ │ Software Engineer,    │ │
│ │ New Grad              │ │
│ │ San Francisco · AI    │ │
│ │ 2 hours ago           │ │
│ │                       │ │
│ │ [Save]      [Apply →] │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Stripe                │ │
│ │ Backend Engineer      │ │
│ │ Remote · Unicorn      │ │
│ │ 1 day ago             │ │
│ │                       │ │
│ │ [Save]      [Apply →] │ │
│ └───────────────────────┘ │
│                           │
│      [Load More]          │
│                           │
└───────────────────────────┘
```

### Mobile Filter Drawer

```
┌───────────────────────────┐
│  Filters            [✕]   │
├───────────────────────────┤
│                           │
│  Tier                     │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │FAANG│ │ AI  │ │Unic.│  │
│  └─────┘ └─────┘ └─────┘  │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │ YC  │ │Fint.│ │Infra│  │
│  └─────┘ └─────┘ └─────┘  │
│                           │
│  Role                     │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │ SWE │ │ML/AI│ │Back.│  │
│  └─────┘ └─────┘ └─────┘  │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │Front│ │Full │ │Infra│  │
│  └─────┘ └─────┘ └─────┘  │
│  ┌─────┐ ┌─────┐ ┌─────┐  │
│  │Data │ │Sec. │ │Mobil│  │
│  └─────┘ └─────┘ └─────┘  │
│                           │
│  [Clear All]   [Apply]    │
│                           │
└───────────────────────────┘
```

## Components

### JobCard

```tsx
interface JobCardProps {
  job: Job;
  isSaved?: boolean;
  onSave?: (jobId: string) => void;
}

// Displays:
// - Company name + logo
// - Job title (clickable → opens application URL)
// - Location
// - Tier badge (FAANG, AI, etc.)
// - Role type badges
// - Time ago
// - Save button / Saved indicator
// - Apply button (external link)
```

### CompanyCard

```tsx
interface CompanyCardProps {
  company: Company;
  isTracked?: boolean;
  jobCount?: number;
  onToggle?: (slug: string) => void;
}

// Displays:
// - Company logo
// - Company name
// - Tier badge
// - Job count (if tracked)
// - Add/Remove toggle
```

### JobFilters

```tsx
interface JobFiltersProps {
  tiers: string[];
  roles: string[];
  onTierChange: (tiers: string[]) => void;
  onRoleChange: (roles: string[]) => void;
  onClear: () => void;
}

// Desktop: Sidebar with checkboxes
// Mobile: Drawer with toggle buttons
```

### SavedJobCard

```tsx
interface SavedJobCardProps {
  savedJob: SavedJob & { job: Job };
  onStatusChange: (id: string, status: string) => void;
  onNotesUpdate: (id: string, notes: string) => void;
}

// Displays:
// - All JobCard info
// - Status dropdown (Saved, Applied, Interviewing, Rejected, Offer)
// - Applied date (if applicable)
// - Notes button → opens modal
```

### AuthForm

```tsx
interface AuthFormProps {
  mode: 'login' | 'signup';
}

// Displays:
// - Email input
// - Password input
// - Submit button
// - Google OAuth button
// - Toggle link (Login ↔ Sign Up)
```

## TypeScript Types

```typescript
// lib/types.ts

export interface Company {
  slug: string;
  name: string;
  tier: 'faang' | 'ai' | 'unicorn' | 'yc' | 'fintech' | 'infra';
  ats_type: 'greenhouse' | 'lever' | 'ashby' | 'workday' | null;
  ats_token: string | null;
  logo_url: string | null;
  careers_url: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  company_slug: string;
  company_name: string;
  title: string;
  location: string | null;
  url: string;
  tier: string;
  role_types: string[];
  source: string;
  posted: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserList {
  id: string;
  user_id: string;
  company_slug: string;
  created_at: string;
  company?: Company;
}

export interface SavedJob {
  id: string;
  user_id: string;
  job_id: string;
  status: 'saved' | 'applied' | 'interviewing' | 'rejected' | 'offer';
  notes: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
  job?: Job;
}

export interface UserPreferences {
  user_id: string;
  notify_scope: 'all' | 'my_list';
  push_enabled: boolean;
  email_enabled: boolean;
  ntfy_topic: string | null;
  role_filters: string[];
  created_at: string;
  updated_at: string;
}

export type Tier = 'faang' | 'ai' | 'unicorn' | 'yc' | 'fintech' | 'infra';
export type RoleType = 'swe' | 'ml' | 'backend' | 'frontend' | 'fullstack' | 'infra' | 'data' | 'security' | 'mobile';
export type JobStatus = 'saved' | 'applied' | 'interviewing' | 'rejected' | 'offer';
```

## Supabase Client Setup

### Browser Client (src/lib/supabase/client.ts)

```typescript
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

### Server Client (src/lib/supabase/server.ts)

```typescript
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
```

### Middleware (src/middleware.ts)

```typescript
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Protected routes
  const protectedRoutes = ['/my-list', '/saved', '/settings'];
  if (!user && protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route))) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

## Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcmJ5dWJycnB4eHZvdHNsam1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTY1MzEsImV4cCI6MjEwNDMzMjUzMX0.HYQtMomrHVwbjlIN8XFXlbiJynxTMM4pabx9TSoR9Vg
```

## Color Scheme

### Tier Colors

| Tier | Color | Tailwind |
|------|-------|----------|
| FAANG | Purple | `bg-purple-600` |
| AI | Red | `bg-red-600` |
| Unicorn | Cyan | `bg-cyan-600` |
| YC | Orange | `bg-orange-600` |
| Fintech | Green | `bg-green-600` |
| Infra | Gray | `bg-gray-600` |

### Role Type Colors

| Role | Color | Tailwind |
|------|-------|----------|
| SWE | Blue | `bg-blue-500` |
| ML/AI | Pink | `bg-pink-500` |
| Backend | Indigo | `bg-indigo-500` |
| Frontend | Teal | `bg-teal-500` |
| Full Stack | Violet | `bg-violet-500` |
| Infra | Slate | `bg-slate-500` |
| Data | Amber | `bg-amber-500` |
| Security | Rose | `bg-rose-500` |
| Mobile | Emerald | `bg-emerald-500` |

### Status Colors

| Status | Color | Tailwind |
|--------|-------|----------|
| Saved | Gray | `bg-gray-100 text-gray-700` |
| Applied | Blue | `bg-blue-100 text-blue-700` |
| Interviewing | Yellow | `bg-yellow-100 text-yellow-700` |
| Rejected | Red | `bg-red-100 text-red-700` |
| Offer | Green | `bg-green-100 text-green-700` |
