-- Analytics and Resume Tracking for application optimization

-- Track different resume versions per user
CREATE TABLE IF NOT EXISTS user_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,  -- "Base Resume", "AI/ML Focused", "Backend Heavy"
    file_url TEXT,
    file_name TEXT,

    -- Resume attributes for analysis
    word_count INTEGER,
    skills_listed TEXT[],  -- ["Python", "React", "AWS"]
    years_experience_shown TEXT,  -- "2 years", "New Grad"
    has_projects BOOLEAN DEFAULT true,
    has_education BOOLEAN DEFAULT true,
    has_cover_letter BOOLEAN DEFAULT false,

    -- AI-generated tweaks
    is_base BOOLEAN DEFAULT false,  -- The original/master resume
    parent_id UUID REFERENCES user_resumes(id),  -- If this is a tweak of another
    tweak_description TEXT,  -- "Added ML keywords for AI roles"

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track which resume was used for each application
ALTER TABLE application_logs
ADD COLUMN IF NOT EXISTS resume_id UUID REFERENCES user_resumes(id),
ADD COLUMN IF NOT EXISTS resume_version TEXT,  -- Quick label like "v1", "AI-focused"
ADD COLUMN IF NOT EXISTS company_tier TEXT,  -- Denormalized for easy analytics
ADD COLUMN IF NOT EXISTS role_types TEXT[],  -- Denormalized
ADD COLUMN IF NOT EXISTS response_received_at TIMESTAMPTZ,  -- When they heard back
ADD COLUMN IF NOT EXISTS response_type TEXT;  -- 'interview', 'rejection', 'ghosted', 'offer'

-- Analytics aggregates (refreshed periodically)
CREATE TABLE IF NOT EXISTS application_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Time period
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type TEXT NOT NULL,  -- 'day', 'week', 'month'

    -- Counts
    total_applications INTEGER DEFAULT 0,
    pending_count INTEGER DEFAULT 0,
    submitted_count INTEGER DEFAULT 0,
    interview_count INTEGER DEFAULT 0,
    rejection_count INTEGER DEFAULT 0,
    offer_count INTEGER DEFAULT 0,
    ghosted_count INTEGER DEFAULT 0,

    -- Rates
    response_rate DECIMAL(5,2),  -- % that got any response
    interview_rate DECIMAL(5,2),  -- % that got interviews
    offer_rate DECIMAL(5,2),  -- % that got offers

    -- By tier
    faang_count INTEGER DEFAULT 0,
    ai_count INTEGER DEFAULT 0,
    unicorn_count INTEGER DEFAULT 0,

    -- Resume analysis
    top_resume_id UUID REFERENCES user_resumes(id),  -- Best performing resume

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, period_start, period_type)
);

-- Resume performance tracking
CREATE TABLE IF NOT EXISTS resume_performance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resume_id UUID NOT NULL REFERENCES user_resumes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Stats
    total_used INTEGER DEFAULT 0,
    interview_count INTEGER DEFAULT 0,
    offer_count INTEGER DEFAULT 0,
    rejection_count INTEGER DEFAULT 0,

    -- Rates
    interview_rate DECIMAL(5,2),
    offer_rate DECIMAL(5,2),

    -- By company tier
    faang_interview_rate DECIMAL(5,2),
    ai_interview_rate DECIMAL(5,2),
    unicorn_interview_rate DECIMAL(5,2),

    -- Calculated score (for ranking resumes)
    performance_score DECIMAL(5,2),

    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(resume_id)
);

-- Index for fast analytics queries
CREATE INDEX IF NOT EXISTS idx_application_logs_user_status
ON application_logs(user_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_application_logs_resume
ON application_logs(resume_id) WHERE resume_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_application_analytics_user_period
ON application_analytics(user_id, period_type, period_start);

-- RLS policies
ALTER TABLE user_resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own resumes"
ON user_resumes FOR ALL
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own analytics"
ON application_analytics FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their resume performance"
ON resume_performance FOR SELECT
USING (auth.uid() = user_id);
