'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { UserProfile } from '@/lib/types';
import { ProfileForm, StoryBankSection } from '@/components/autoapply';
import { AuthGuard } from '@/components/auth/AuthGuard';

export default function ProfileSettingsPage() {
  return (
    <AuthGuard>
      {(user) => <ProfileContent userId={user.id} email={user.email || ''} />}
    </AuthGuard>
  );
}

function ProfileContent({ userId, email }: { userId: string; email: string }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching profile:', error);
    }

    if (data) {
      setProfile(data);
    } else {
      // Set defaults
      setProfile({
        user_id: userId,
        first_name: null,
        last_name: null,
        email: email,
        phone: null,
        location: null,
        linkedin_url: null,
        portfolio_url: null,
        github_url: null,
        resume_url: null,
        resume_filename: null,
        auto_apply_enabled: true,
        auto_submit: false,
        auto_apply_all_jobs: false,
        work_authorization: null,
        require_sponsorship: null,
        years_experience: null,
        start_date: null,
        salary_expectation: null,
        salary_type: 'market_rate',
        salary_min: null,
        salary_max: null,
        salary_target: null,
        salary_display_strategy: 'show_range',
        willing_to_relocate: null,
        custom_answers: {},
      });
    }
    setLoading(false);
  }, [userId, email, supabase]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleSave = async (updatedProfile: UserProfile) => {
    const { error } = await supabase.from('user_profiles').upsert({
      ...updatedProfile,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }

    setProfile(updatedProfile);
  };

  const handleResumeUpload = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/resume.${fileExt}`;

    // First try to delete existing file (ignore errors)
    await supabase.storage.from('resumes').remove([fileName]);

    // Then upload new file
    const { error: uploadError } = await supabase.storage
      .from('resumes')
      .upload(fileName, file);

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      // Check if bucket doesn't exist
      if (uploadError.message?.includes('not found') || uploadError.message?.includes('does not exist')) {
        throw new Error('Storage bucket "resumes" not configured. Please use the Resume Builder at /settings/resume instead.');
      }
      throw uploadError;
    }

    const { data } = supabase.storage.from('resumes').getPublicUrl(fileName);
    return data.publicUrl;
  };

  if (loading || !profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="space-y-4">
            <div className="h-20 bg-gray-200 rounded" />
            <div className="h-20 bg-gray-200 rounded" />
            <div className="h-20 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mb-2 inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Settings
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Auto-Apply Profile</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Set up your profile for automatic job applications
        </p>
      </div>

      {/* Profile Form Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
        <ProfileForm
          profile={profile}
          onSave={handleSave}
          onResumeUpload={handleResumeUpload}
        />
      </div>

      {/* Story Bank Section */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-6">
        <StoryBankSection userId={userId} />
      </div>
    </div>
  );
}
