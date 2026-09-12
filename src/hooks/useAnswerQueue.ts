'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AnswerQueueItem, CompanyAnswer } from '@/lib/types';

interface AnswerQueueState {
  queue: AnswerQueueItem[];
  answers: CompanyAnswer[];
  loading: boolean;
  error: string | null;
}

interface AnswerQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

/**
 * Hook to manage and monitor the answer generation queue
 */
export function useAnswerQueue(userId: string) {
  const [state, setState] = useState<AnswerQueueState>({
    queue: [],
    answers: [],
    loading: true,
    error: null,
  });

  const supabase = createClient();

  // Fetch queue and answers
  const refresh = useCallback(async () => {
    try {
      const [queueResponse, answersResponse] = await Promise.all([
        fetch('/api/answers/queue'),
        fetch('/api/answers/company'),
      ]);

      if (queueResponse.ok) {
        const queueData = await queueResponse.json();
        setState((prev) => ({
          ...prev,
          queue: queueData.items || [],
        }));
      }

      if (answersResponse.ok) {
        const answersData = await answersResponse.json();
        setState((prev) => ({
          ...prev,
          answers: answersData.answers || [],
          loading: false,
        }));
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to fetch queue status',
        loading: false,
      }));
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh, userId]);

  // Set up real-time subscription for queue updates
  useEffect(() => {
    const channel = supabase
      .channel('answer_queue_updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'answer_generation_queue',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refresh when queue changes
          refresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'company_answers',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          // Refresh when new answer is generated
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, supabase, refresh]);

  // Generate answer for a company
  const generateAnswer = useCallback(
    async (
      companySlug: string,
      companyName: string,
      immediate: boolean = false
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const response = await fetch('/api/answers/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companySlug,
            companyName,
            immediate,
          }),
        });

        const data = await response.json();

        if (data.success) {
          await refresh();
          return { success: true };
        }

        return { success: false, error: data.error };
      } catch (error) {
        return { success: false, error: 'Failed to queue generation' };
      }
    },
    [refresh]
  );

  // Cancel a queued generation
  const cancelGeneration = useCallback(
    async (queueId: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/answers/queue?id=${queueId}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  // Delete an answer
  const deleteAnswer = useCallback(
    async (answerId: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `/api/answers/company?id=${answerId}`,
          {
            method: 'DELETE',
          }
        );

        if (response.ok) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  // Update an answer
  const updateAnswer = useCallback(
    async (
      answerId: string,
      updates: Partial<Pick<CompanyAnswer, 'why_company_short' | 'why_company_standard' | 'why_company_long' | 'user_connection'>>
    ): Promise<boolean> => {
      try {
        const response = await fetch('/api/answers/company', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: answerId, ...updates }),
        });

        if (response.ok) {
          await refresh();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  // Get answer for a specific company
  const getAnswerForCompany = useCallback(
    (companySlug: string): CompanyAnswer | undefined => {
      return state.answers.find((a) => a.company_slug === companySlug);
    },
    [state.answers]
  );

  // Get queue item for a specific company
  const getQueueItemForCompany = useCallback(
    (companySlug: string): AnswerQueueItem | undefined => {
      return state.queue.find(
        (q) =>
          q.company_slug === companySlug &&
          (q.status === 'pending' || q.status === 'processing')
      );
    },
    [state.queue]
  );

  // Compute stats
  const stats: AnswerQueueStats = {
    pending: state.queue.filter((q) => q.status === 'pending').length,
    processing: state.queue.filter((q) => q.status === 'processing').length,
    completed: state.queue.filter((q) => q.status === 'completed').length,
    failed: state.queue.filter((q) => q.status === 'failed').length,
  };

  return {
    // State
    queue: state.queue,
    answers: state.answers,
    loading: state.loading,
    error: state.error,
    stats,

    // Actions
    refresh,
    generateAnswer,
    cancelGeneration,
    deleteAnswer,
    updateAnswer,

    // Helpers
    getAnswerForCompany,
    getQueueItemForCompany,
    hasAnswerFor: (companySlug: string) =>
      state.answers.some((a) => a.company_slug === companySlug),
    isGenerating: (companySlug: string) =>
      state.queue.some(
        (q) =>
          q.company_slug === companySlug &&
          (q.status === 'pending' || q.status === 'processing')
      ),
  };
}
