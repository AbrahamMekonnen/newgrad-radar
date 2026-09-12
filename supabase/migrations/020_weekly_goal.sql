-- ============================================
-- NEWGRAD RADAR - WEEKLY GOAL
-- Migration: 020_weekly_goal.sql
-- ============================================

-- Add weekly_goal column to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS weekly_goal INTEGER DEFAULT 10;
