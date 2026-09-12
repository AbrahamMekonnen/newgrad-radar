-- Migration: Create feedback_reports table for bug reports and feature requests
-- Created: 2024-09-10

-- Create enum for report types
CREATE TYPE feedback_report_type AS ENUM ('bug', 'feature', 'feedback');

-- Create enum for report status
CREATE TYPE feedback_report_status AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'wontfix');

-- Create enum for report priority
CREATE TYPE feedback_report_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Create feedback_reports table
CREATE TABLE IF NOT EXISTS feedback_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type feedback_report_type NOT NULL DEFAULT 'feedback',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status feedback_report_status NOT NULL DEFAULT 'open',
  priority feedback_report_priority NOT NULL DEFAULT 'medium',
  screenshot_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_feedback_reports_user_id ON feedback_reports(user_id);
CREATE INDEX idx_feedback_reports_status ON feedback_reports(status);
CREATE INDEX idx_feedback_reports_type ON feedback_reports(type);
CREATE INDEX idx_feedback_reports_created_at ON feedback_reports(created_at DESC);

-- Enable RLS
ALTER TABLE feedback_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Users can create their own reports
CREATE POLICY "Users can create own reports"
  ON feedback_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can read their own reports
CREATE POLICY "Users can read own reports"
  ON feedback_reports
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can update their own reports (only open ones)
CREATE POLICY "Users can update own open reports"
  ON feedback_reports
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'open')
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own open reports
CREATE POLICY "Users can delete own open reports"
  ON feedback_reports
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'open');

-- Create trigger for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_feedback_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_feedback_reports_updated_at
  BEFORE UPDATE ON feedback_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_feedback_reports_updated_at();

-- Add comment to table
COMMENT ON TABLE feedback_reports IS 'Stores user bug reports, feature requests, and general feedback';
