'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Job } from '@/lib/types';
import { formatTimeAgo } from '@/lib/utils';
import Link from 'next/link';

interface NotificationBellProps {
  userId: string;
}

export function NotificationBell({ userId }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchNewJobs();

    // Real-time subscription for new jobs
    const channel = supabase
      .channel('new_jobs_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'jobs',
        },
        (payload) => {
          checkIfTrackedCompany(payload.new as Job);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchNewJobs = async () => {
    setLoading(true);

    // Get tracked company slugs
    const { data: trackedList } = await supabase
      .from('user_lists')
      .select('company_slug')
      .eq('user_id', userId);

    if (!trackedList || trackedList.length === 0) {
      setJobs([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    const trackedSlugs = trackedList.map((t) => t.company_slug);

    // Get jobs from tracked companies posted in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentJobs } = await supabase
      .from('jobs')
      .select('*')
      .in('company_slug', trackedSlugs)
      .eq('is_active', true)
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentJobs) {
      setJobs(recentJobs);
      // For now, all recent jobs are "unread" - we could track this properly with a separate table
      setUnreadCount(recentJobs.length);
    }

    setLoading(false);
  };

  const checkIfTrackedCompany = async (job: Job) => {
    const { data } = await supabase
      .from('user_lists')
      .select('company_slug')
      .eq('user_id', userId)
      .eq('company_slug', job.company_slug)
      .single();

    if (data) {
      // This job is from a tracked company - add to list
      setJobs((prev) => [job, ...prev.slice(0, 9)]);
      setUnreadCount((prev) => prev + 1);

      // Show browser notification if permitted
      if (Notification.permission === 'granted') {
        new Notification(`New job at ${job.company_name}`, {
          body: job.title,
          icon: '/favicon.ico',
        });
      }
    }
  };

  const handleBellClick = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      // Mark as read when opening
      setUnreadCount(0);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification('Notifications enabled!', {
          body: "You'll be notified when new jobs are posted from your tracked companies.",
        });
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleBellClick}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-50"
          role="region"
          aria-label="Notifications"
        >
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 dark:text-white">New Jobs</h3>
            {typeof Notification !== 'undefined' && Notification.permission !== 'granted' && (
              <button
                onClick={requestNotificationPermission}
                className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                aria-label="Enable push notifications"
              >
                Enable push
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : jobs.length === 0 ? (
              <div className="p-6 text-center">
                <svg
                  className="mx-auto h-10 w-10 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                  />
                </svg>
                <p className="mt-2 text-sm text-gray-500">No new jobs yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Track companies in My List to get notified
                </p>
              </div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-gray-500">
                        {job.company_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {job.company_name}
                      </p>
                      <p className="text-sm text-gray-600 truncate">{job.title}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {job.location} &middot; {formatTimeAgo(job.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2 ml-11">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                    >
                      View Job
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>

          {jobs.length > 0 && (
            <Link
              href="/my-list"
              className="block px-4 py-3 text-center text-sm font-medium text-blue-600 hover:bg-gray-50 border-t border-gray-100"
              onClick={() => setIsOpen(false)}
            >
              View all tracked companies
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
