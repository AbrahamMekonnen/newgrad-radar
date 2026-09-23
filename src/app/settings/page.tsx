'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { UserPreferences, RoleType, ROLE_LABELS } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { cn } from '@/lib/utils';
import { generateNtfyTopic } from '@/lib/ntfy';

const ALL_ROLES: RoleType[] = ['swe', 'ml', 'backend', 'frontend', 'fullstack', 'infra', 'data', 'security', 'mobile'];

export default function SettingsPage() {
  return (
    <AuthGuard>
      {(user) => <SettingsContent userId={user.id} email={user.email || ''} />}
    </AuthGuard>
  );
}

function SettingsContent({ userId, email }: { userId: string; email: string }) {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  const fetchPreferences = useCallback(async () => {
    setLoading(true);

    // Fetch user preferences
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching preferences:', error);
    }

    if (data) {
      setPreferences(data);
    } else {
      // Set defaults
      setPreferences({
        user_id: userId,
        notify_scope: 'all',
        push_enabled: false,
        email_enabled: true,
        ntfy_topic: null,
        role_filters: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleSave = async () => {
    if (!preferences) return;

    setSaving(true);
    setMessage(null);

    // Save preferences
    const { error: prefError } = await supabase
      .from('user_preferences')
      .upsert({
        ...preferences,
        updated_at: new Date().toISOString(),
      });

    if (prefError) {
      setMessage({ type: 'error', text: 'Failed to save preferences' });
    } else {
      const { error: alertError } = await supabase
        .from('job_alerts')
        .update({ push_enabled: preferences.push_enabled, email_enabled: preferences.email_enabled })
        .eq('user_id', userId)
        .eq('is_active', true);
      setMessage(alertError
        ? { type: 'error', text: 'Preferences saved, but existing alert channels could not be synced.' }
        : { type: 'success', text: 'Preferences saved and active alerts updated!' });
    }
    setSaving(false);
  };

  const toggleRole = (role: RoleType) => {
    if (!preferences) return;
    const roles = preferences.role_filters || [];
    if (roles.includes(role)) {
      setPreferences({
        ...preferences,
        role_filters: roles.filter((r) => r !== role),
      });
    } else {
      setPreferences({
        ...preferences,
        role_filters: [...roles, role],
      });
    }
  };

  if (loading || !preferences) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-1/2" />
          <div className="space-y-4">
            <div className="h-20 bg-gray-200 dark:bg-slate-700 rounded" />
            <div className="h-20 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Manage your notification preferences
        </p>
      </div>

      <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-xl border border-gray-200/50 dark:border-slate-700/50 divide-y divide-gray-200 dark:divide-slate-700">
        {/* Feedback */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Feedback</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Report bugs, request features, or share your thoughts to help us improve
          </p>
          <Link
            href="/feedback"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Submit Feedback
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* All jobs notification */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">All Jobs Notifications</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Notify me about all new jobs</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Get notified whenever any new job is posted</p>
            </div>
            <Checkbox
              label=""
              checked={preferences.notify_scope === 'all'}
              onChange={(checked) => setPreferences({ ...preferences, notify_scope: checked ? 'all' : 'my_list' })}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
            For more control, enable notifications per-company in My List.
          </p>
        </div>

        {/* Notification channels */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Notification Channels</h2>
          <div className="space-y-4">
            <div>
              <Checkbox
                label="Email notifications"
                checked={preferences.email_enabled}
                onChange={(checked) => setPreferences({ ...preferences, email_enabled: checked })}
              />
              {preferences.email_enabled && (
                <p className="ml-6 mt-1 text-xs text-gray-500">
                  Emails will be sent to <span className="font-medium">{email}</span>
                </p>
              )}
            </div>
            <Checkbox
              label="Push notifications (via ntfy.sh)"
              checked={preferences.push_enabled}
              onChange={(checked) =>
                setPreferences({
                  ...preferences,
                  push_enabled: checked,
                  // Auto-generate a secure topic the first time push is enabled.
                  ntfy_topic: checked && !preferences.ntfy_topic ? generateNtfyTopic() : preferences.ntfy_topic,
                })
              }
            />
            {preferences.push_enabled && (
              <div className="ml-6 space-y-3">
                <div>
                  <Input
                    label="Your ntfy.sh Topic"
                    value={preferences.ntfy_topic || ''}
                    onChange={(e) => setPreferences({ ...preferences, ntfy_topic: e.target.value })}
                    placeholder="hireradar-xxxxxxxx"
                  />
                  <button
                    type="button"
                    onClick={() => setPreferences({ ...preferences, ntfy_topic: generateNtfyTopic() })}
                    className="mt-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
                  >
                    Generate a new random topic
                  </button>
                </div>
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-900 mb-2">How to set up push notifications:</p>
                  <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                    <li>We generated a private topic above — keep it secret (anyone with it can see your alerts).</li>
                    <li>Download the <strong>ntfy</strong> app on your phone (iOS/Android)</li>
                    <li>In the app, tap &quot;+&quot; and subscribe to that exact topic</li>
                    <li>Save your settings here — done!</li>
                  </ol>
                  <p className="text-xs text-blue-700 mt-2">
                    No account needed. Topics are auto-created when you subscribe.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Role filters */}
        <div className="p-6">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Role Filters</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Only notify about these role types (leave empty for all roles)
          </p>
          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map((role) => (
              <button
                key={role}
                onClick={() => toggleRole(role)}
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                  preferences.role_filters?.includes(role)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
                )}
              >
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>

        {/* Save button */}
        <div className="p-6">
          {message && (
            <div
              className={cn(
                'mb-4 p-3 rounded-lg text-sm',
                message.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              )}
            >
              {message.text}
            </div>
          )}
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </div>
    </div>
  );
}
