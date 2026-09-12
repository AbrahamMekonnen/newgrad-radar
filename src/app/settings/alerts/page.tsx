'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Button } from '@/components/ui/Button';
import { AlertEditor, AlertList, JobAlert } from '@/components/alerts';

export default function AlertsPage() {
  return (
    <AuthGuard>
      {(user) => <AlertsContent userId={user.id} />}
    </AuthGuard>
  );
}

function AlertsContent({ userId }: { userId: string }) {
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<JobAlert | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('job_alerts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching alerts:', error);
      setMessage({ type: 'error', text: 'Failed to load alerts' });
    } else {
      setAlerts(data || []);
    }
    setLoading(false);
  }, [userId, supabase]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleCreateAlert = () => {
    setEditingAlert(null);
    setEditorOpen(true);
  };

  const handleEditAlert = (alert: JobAlert) => {
    setEditingAlert(alert);
    setEditorOpen(true);
  };

  const handleSaveAlert = async (alertData: Partial<JobAlert>) => {
    setMessage(null);

    if (alertData.id) {
      // Update existing alert
      const { error } = await supabase
        .from('job_alerts')
        .update({
          name: alertData.name,
          delivery_mode: alertData.delivery_mode,
          push_enabled: alertData.push_enabled,
          email_enabled: alertData.email_enabled,
          filters: alertData.filters,
          updated_at: new Date().toISOString(),
        })
        .eq('id', alertData.id)
        .eq('user_id', userId);

      if (error) {
        console.error('Error updating alert:', error);
        setMessage({ type: 'error', text: 'Failed to update alert' });
        throw error;
      }
      setMessage({ type: 'success', text: 'Alert updated successfully' });
    } else {
      // Create new alert
      const { error } = await supabase
        .from('job_alerts')
        .insert({
          user_id: userId,
          name: alertData.name,
          delivery_mode: alertData.delivery_mode,
          push_enabled: alertData.push_enabled,
          email_enabled: alertData.email_enabled,
          filters: alertData.filters,
        });

      if (error) {
        console.error('Error creating alert:', error);
        setMessage({ type: 'error', text: 'Failed to create alert' });
        throw error;
      }
      setMessage({ type: 'success', text: 'Alert created successfully' });
    }

    await fetchAlerts();
  };

  const handleDeleteAlert = async (alertId: string) => {
    setMessage(null);
    const { error } = await supabase
      .from('job_alerts')
      .delete()
      .eq('id', alertId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting alert:', error);
      setMessage({ type: 'error', text: 'Failed to delete alert' });
    } else {
      setMessage({ type: 'success', text: 'Alert deleted' });
      await fetchAlerts();
    }
  };

  const handleToggleAlert = async (alertId: string, isActive: boolean) => {
    setMessage(null);
    const { error } = await supabase
      .from('job_alerts')
      .update({
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', alertId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error toggling alert:', error);
      setMessage({ type: 'error', text: 'Failed to update alert' });
    } else {
      // Optimistically update the local state
      setAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, is_active: isActive } : a))
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Settings
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Smart Alerts</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Get notified when new jobs match your criteria
          </p>
        </div>
        <Button onClick={handleCreateAlert}>
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Alert
        </Button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`mb-6 p-4 rounded-lg text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
              : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Info box */}
      <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex gap-3">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <p className="font-medium mb-1">How Smart Alerts Work</p>
            <p className="text-blue-700 dark:text-blue-300">
              Create alerts with specific filters for company tiers, role types, locations, and more.
              When new jobs matching your criteria are posted, you&apos;ll be notified instantly or via
              digest based on your preferences.
            </p>
          </div>
        </div>
      </div>

      {/* Alert list */}
      <AlertList
        alerts={alerts}
        onEdit={handleEditAlert}
        onDelete={handleDeleteAlert}
        onToggle={handleToggleAlert}
        loading={loading}
      />

      {/* Editor modal */}
      <AlertEditor
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingAlert(null);
        }}
        onSave={handleSaveAlert}
        editingAlert={editingAlert}
      />
    </div>
  );
}
