# Analytics Feature

The Analytics page provides real-time insights into application performance with live updates via Supabase Realtime.

## Overview

| Property | Value |
|----------|-------|
| **Route** | `/analytics` |
| **Source File** | `src/app/analytics/page.tsx` |
| **Auth Required** | Yes (uses AuthGuard) |
| **Data Source** | `application_logs` table |
| **Live Updates** | Supabase Realtime (postgres_changes) |

## Live Updates Architecture

The Analytics page uses Supabase Realtime subscriptions to automatically refresh data when application status changes occur.

```typescript
// Realtime subscription for live updates
const channel = supabase
  .channel(`analytics-${userId}`)
  .on(
    'postgres_changes',
    {
      event: '*',           // INSERT, UPDATE, DELETE
      schema: 'public',
      table: 'application_logs',
      filter: `user_id=eq.${userId}`,
    },
    () => {
      loadData();           // Refresh all analytics
    }
  )
  .subscribe();
```

**How it works:**
1. On mount, fetches initial data from `application_logs` with joined `jobs` table
2. Subscribes to postgres_changes on `application_logs` filtered by user_id
3. Any INSERT, UPDATE, or DELETE triggers a full data reload
4. Cleanup removes channel subscription on unmount

## Status Mapping

The Analytics page reads from `application_logs`, which uses different status values than `saved_jobs`:

| application_logs Status | Display Label | Color |
|------------------------|---------------|-------|
| `pending` | Pending | Yellow (#FBBF24) |
| `submitted` | Processing | Blue (#3B82F6) |
| `in_review` | Processing | Blue (#3B82F6) |
| `interview_scheduled` | Interviewing | Purple (#8B5CF6) |
| `rejected` | Rejected | Red (#EF4444) |
| `offer` | Offers | Green (#10B981) |

**Key Mapping Note:** `saved_jobs.interviewing` corresponds to `application_logs.interview_scheduled`

### Interview Count Logic

The "Interviews" metric includes both currently interviewing AND offers, because receiving an offer implies successfully passing interviews:

```typescript
// "Got interviews" = currently interviewing + offers
const currentlyInterviewing = applications.filter(
  a => ['interviewing', 'interview_scheduled'].includes(a.status)
).length;
stats.interviewing = currentlyInterviewing + offers;
```

This provides a more accurate view of interview success rate.

## Charts and Visualizations

### 1. Summary Stat Cards

Four key metrics displayed at the top:

| Metric | Calculation | Color |
|--------|-------------|-------|
| Total Applications | Count of all applications | Blue |
| Interviews | Currently interviewing + offers | Purple |
| Offers | Count with status = 'offer' | Green |
| Response Rate | (interviews + rejections + offers) / total | Gray |

### 2. Source Analytics Section

Summary cards showing:
- **Most Jobs From**: Top source by application volume
- **Best Response Rate**: Source with highest response rate (min 3 applications)
- **Best Interview Rate**: Source with highest interview rate (min 3 applications)
- **Sources Used**: Count of unique job sources

### 3. Applications Over Time (Area Chart)

Shows daily application count over the selected time range.

### 4. Application Status (Donut Chart)

Breakdown of applications by current status:
- Pending, Processing, Interviewing, Rejected, Offers

### 5. By Company Tier (Horizontal Bar Chart)

Application count by company tier (FAANG, AI, Unicorn, YC, Fintech, Infra).

### 6. Success by Tier (Configurable Bar Chart)

Compare tiers by selectable metric:
- **Interview Rate**: % getting to interview stage
- **Response Rate**: % receiving any response
- **Offer Rate**: % receiving offers

Toggle between metrics using the button group in the chart header.

### 7. Jobs by Source (Donut Chart)

Distribution of applications by job source (Simplify, Greenhouse, Lever, etc.)

### 8. Response Rate by Source (Horizontal Bar Chart)

Compare response rates across different job sources.

### 9. Application Funnel

Visual funnel showing conversion at each stage:
- Applied -> Response -> Interview -> Offer

## Time Range Filtering

Users can filter analytics by time range:

| Option | Days Back |
|--------|-----------|
| 7d | 7 days |
| 30d | 30 days (default) |
| 90d | 90 days |
| All | No date filter |

```typescript
if (timeRange !== 'all') {
  const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
  const startDate = subDays(new Date(), days).toISOString();
  query = query.gte('created_at', startDate);
}
```

## Color Constants

### Tier Colors

```typescript
const TIER_COLORS: Record<string, string> = {
  faang: '#9333EA',   // Purple
  ai: '#EF4444',      // Red
  unicorn: '#06B6D4', // Cyan
  yc: '#F97316',      // Orange
  fintech: '#22C55E', // Green
  infra: '#6B7280',   // Gray
};
```

### Source Colors

```typescript
const SOURCE_COLORS: Record<string, string> = {
  simplify: '#10B981',   // Emerald
  greenhouse: '#22C55E', // Green
  lever: '#3B82F6',      // Blue
  ashby: '#8B5CF6',      // Purple
  workday: '#F97316',    // Orange
  jobvite: '#EC4899',    // Pink
  custom: '#6B7280',     // Gray
  unknown: '#9CA3AF',    // Light gray
};
```

### Status Colors

```typescript
const STATUS_COLORS: Record<string, string> = {
  saved: '#9CA3AF',
  pending: '#FBBF24',
  applied: '#3B82F6',
  submitted: '#3B82F6',
  in_review: '#A855F7',
  interviewing: '#8B5CF6',
  interview_scheduled: '#8B5CF6',
  rejected: '#EF4444',
  offer: '#10B981',
};
```

## Dark Mode Support

All charts and UI elements support dark mode:
- Custom tooltip component with dark mode styling
- Chart backgrounds adapt to `dark:bg-slate-800`
- Text colors use `dark:text-white` and `dark:text-gray-300`
- Borders use `dark:border-slate-600`

## Dependencies

- **Recharts**: AreaChart, BarChart, PieChart with ResponsiveContainer
- **date-fns**: Time range calculations (subDays, format, eachDayOfInterval)
- **Supabase**: Realtime subscriptions and data fetching

## Data Query

```typescript
const { data } = await supabase
  .from('application_logs')
  .select('status, created_at, submitted_at, jobs(tier, company_name, role_types, source)')
  .eq('user_id', userId)
  .order('created_at', { ascending: true });
```

## Coming Soon

The page includes a placeholder for **Resume Analytics**:
- A/B test different resume versions
- AI-powered suggestions
- Tier-specific resume tweaks
- Track which resume versions perform best at different company tiers
