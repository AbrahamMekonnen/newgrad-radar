-- Keep the queue constraint aligned with ATS providers supported by both the
-- preparation engine and the browser extension.
ALTER TABLE autoapply_job_queue
  DROP CONSTRAINT IF EXISTS autoapply_job_queue_ats_type_check;

ALTER TABLE autoapply_job_queue
  ADD CONSTRAINT autoapply_job_queue_ats_type_check CHECK (ats_type IN (
    'greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'unknown'
  ));

NOTIFY pgrst, 'reload schema';
