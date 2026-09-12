# NewGrad Radar

A job tracking app for new grad software engineering positions at top tech companies.

## Quick Links

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Database Schema](docs/DATABASE.md)
- [Frontend Guide](docs/FRONTEND.md)
- [Navigation Structure](docs/NAVIGATION.md)
- [Analytics Feature](docs/ANALYTICS.md)
- [Auto-Apply Feature](docs/AUTO_APPLY.md)
- [Scraper Design](docs/SCRAPER.md)
- [Target Companies](docs/COMPANIES.md)

## Tech Stack

| Layer | Technology | Cost |
|-------|------------|------|
| Frontend | Next.js 15 + Tailwind + TypeScript | Free (Vercel) |
| Auth | Supabase Auth | Free |
| Database | Supabase PostgreSQL | Free (500MB) |
| Scraper | Python + GitHub Actions | Free |
| AI Classification | Gemini API | Free tier |
| Push Notifications | ntfy.sh | Free |

## Supabase Config

- **Project ID**: `jmrbyubrrpxxvotsljms`
- **URL**: `https://jmrbyubrrpxxvotsljms.supabase.co`
- **Anon Key**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcmJ5dWJycnB4eHZvdHNsam1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NTY1MzEsImV4cCI6MjEwNDMzMjUzMX0.HYQtMomrHVwbjlIN8XFXlbiJynxTMM4pabx9TSoR9Vg`

## Project Structure

```
newgrad-radar/
├── src/
│   ├── app/                        # Next.js pages
│   │   ├── page.tsx                # All Jobs (main)
│   │   ├── interview-prep/         # Interview preparation
│   │   ├── my-list/page.tsx        # Watchlist (tracked companies)
│   │   ├── applications/page.tsx   # Applications (manual + auto-apply)
│   │   ├── analytics/page.tsx      # Job search analytics
│   │   ├── settings/page.tsx       # User preferences
│   │   └── auth/                   # Login, signup, callback
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Navbar.tsx          # Desktop navigation
│   │   │   └── MobileNav.tsx       # Mobile drawer navigation
│   │   └── ui/
│   │       └── CommandPalette.tsx  # Cmd+K command palette
│   └── lib/                        # Supabase client, types, utils
├── scraper/                        # Python job scraper
├── docs/                           # Architecture docs
└── supabase/                       # Migrations
```

## Key Features

1. **All Jobs** - Browse every new grad position (public)
2. **Interview Prep** - Interview preparation resources (public)
3. **Watchlist** - Track specific companies, see filtered jobs (renamed from "My List")
4. **Applications** - Combined view of manual saves + auto-apply submissions with status tracking
5. **Analytics** - Job search analytics and insights
6. **Settings** - Notification preferences
7. **Responsive** - Works on mobile and desktop

See [docs/NAVIGATION.md](docs/NAVIGATION.md) for detailed navigation structure.

## Local Development

### Quick Start

```bash
# Frontend (slow, with hot reload)
npm run dev

# Frontend (fast, production build)
npm run build && npm run start
```

### Interview Scraper

```bash
cd scraper
python cli.py list    # Show available scrapers
python cli.py run     # Run all scrapers
```

### Environment Variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here  # For scraper
```

For full setup instructions, see [docs/SETUP.md](docs/SETUP.md).

---

## Role Types (SWE-Focused)

- `swe` - Software Engineer
- `ml` - ML / AI Engineer
- `backend` - Backend
- `frontend` - Frontend
- `fullstack` - Full Stack
- `infra` - Infrastructure / Platform
- `data` - Data Engineer
- `security` - Security
- `mobile` - Mobile (iOS/Android)

## Environment Variables

```bash
# Frontend (.env.local)
NEXT_PUBLIC_SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Scraper (GitHub Secrets)
SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key>
GEMINI_API_KEY=<your_key>
```

## Recent Updates

1. **Navigation restructured** - Watchlist, Applications (combined), Interview Prep
2. **Interview Prep feature** - Shows interview questions for companies, links from job cards
3. **Interview scraper workflow** - Added `.github/workflows/interview_questions.yml`
4. **Analytics live updates** - Real-time updates via Supabase realtime subscriptions
5. **Auto-Apply enabled by default** - Auto-apply toggle is on by default for new users
6. **Filter badges flow** - Filter badges flow together without gaps
7. **Date filter defaults** - 24 months default for interview questions

## Quick Start

Resume work quickly with these key files:

### Interview Prep
- `src/components/InterviewPrepBadge.tsx` - Badge component linking to interview prep
- `src/app/interview-prep/page.tsx` - Interview prep page
- `src/app/api/interview-questions/route.ts` - API endpoint for questions

### Auto-Apply
- `src/components/autoapply/AutoApplyButton.tsx` - Main auto-apply button
- `src/lib/ats-registry.ts` - ATS detection and field mappings
- `src/app/settings/profile/page.tsx` - Profile configuration
- See [docs/AUTO_APPLY.md](docs/AUTO_APPLY.md) for full documentation

### Run Interview Scraper
```bash
cd scraper && python cli.py run
```
