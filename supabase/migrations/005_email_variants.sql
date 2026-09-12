-- Add email_variants column to store multiple email possibilities with confidence scores
ALTER TABLE recruiters
ADD COLUMN IF NOT EXISTS email_variants JSONB DEFAULT NULL;

-- Add comment explaining the format
COMMENT ON COLUMN recruiters.email_variants IS 'Array of {email, confidence, verified} objects for possible email addresses';
