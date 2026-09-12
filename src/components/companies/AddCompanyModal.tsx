'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface AddCompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, careersUrl: string, tier: string) => Promise<{ success: boolean; error?: string }>;
}

const TIER_OPTIONS = [
  { value: 'faang', label: 'FAANG' },
  { value: 'ai', label: 'AI' },
  { value: 'unicorn', label: 'Unicorn' },
  { value: 'yc', label: 'YC' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'infra', label: 'Infra' },
  { value: 'other', label: 'Other' },
];

export function AddCompanyModal({ isOpen, onClose, onSubmit }: AddCompanyModalProps) {
  const [name, setName] = useState('');
  const [careersUrl, setCareersUrl] = useState('');
  const [tier, setTier] = useState('other');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Company name is required');
      return;
    }

    // Basic URL validation if provided
    if (careersUrl.trim()) {
      try {
        new URL(careersUrl.trim());
      } catch {
        setError('Please enter a valid URL (e.g., https://company.com/careers)');
        return;
      }
    }

    setLoading(true);
    try {
      const result = await onSubmit(name.trim(), careersUrl.trim(), tier);
      if (result.success) {
        setName('');
        setCareersUrl('');
        setTier('other');
      } else {
        setError(result.error || 'Failed to add company');
      }
    } catch (err) {
      setError('Failed to add company. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Add Custom Company</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          Add a company that&apos;s not in our list. It will be verified and made
          available to all users, helping grow our company database.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Company Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Corp"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="careersUrl" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Careers Page URL (optional)
            </label>
            <input
              type="url"
              id="careersUrl"
              value={careersUrl}
              onChange={(e) => setCareersUrl(e.target.value)}
              placeholder="https://company.com/careers"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="tier" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Company Type
            </label>
            <select
              id="tier"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="flex-1"
            >
              {loading ? 'Verifying...' : 'Add Company'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
