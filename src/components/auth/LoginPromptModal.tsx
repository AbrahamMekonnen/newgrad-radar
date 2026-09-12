'use client';

import { usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface LoginPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}

export function LoginPromptModal({
  isOpen,
  onClose,
  title = 'Sign in to save jobs',
  message = 'Create a free account to save jobs and track your applications.',
}: LoginPromptModalProps) {
  const pathname = usePathname();
  const redirectParam = encodeURIComponent(pathname);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          {message}
        </p>

        <div className="flex flex-col gap-3">
          <a href={`/auth/login?redirect=${redirectParam}`} className="w-full">
            <Button variant="primary" className="w-full">
              Sign In
            </Button>
          </a>
          <a href={`/auth/signup?redirect=${redirectParam}`} className="w-full">
            <Button variant="outline" className="w-full">
              Create Account
            </Button>
          </a>
        </div>

        <div className="pt-2 border-t border-gray-100 dark:border-slate-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Free forever. No credit card required.
          </p>
        </div>
      </div>
    </Modal>
  );
}
