-- Durable record of jobs a user was PUSHED about that don't come from a saved
-- alert (watchlist / all-jobs). Alert matches already persist in alert_matches;
-- this fills the gap so those notifications become a returnable to-do list under
-- Applications -> Notified Jobs instead of vanishing after one tap.
CREATE TABLE IF NOT EXISTS public.notified_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,  -- 'watchlist' | 'all_jobs'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, source)
);

CREATE INDEX IF NOT EXISTS idx_notified_jobs_user_recent
  ON public.notified_jobs (user_id, created_at DESC);

ALTER TABLE public.notified_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own notified jobs" ON public.notified_jobs;
CREATE POLICY "own notified jobs" ON public.notified_jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
