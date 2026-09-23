'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import { subscribeToPush, isPushSupported } from '@/lib/webpush';

interface RequireOpts {
  reason?: string; // e.g. "so we can ping you the moment a match is posted"
  title?: string;
}

interface GateState extends RequireOpts {
  open: boolean;
  resolve?: (v: boolean) => void;
  denied?: boolean;
}

const NotificationGateContext = createContext<{
  requireNotifications: (opts?: RequireOpts) => Promise<boolean>;
}>({ requireNotifications: async () => false });

export function useNotificationGate() {
  return useContext(NotificationGateContext);
}

function permission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export function NotificationGateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ open: false });
  const [busy, setBusy] = useState(false);

  const requireNotifications = useCallback(async (opts?: RequireOpts): Promise<boolean> => {
    // Already granted → make sure the server has this device, silently, and go.
    if (permission() === 'granted') {
      subscribeToPush();
      return true;
    }
    // Not supported here (e.g. iOS before install) → surface the guided modal.
    return new Promise<boolean>((resolve) => {
      setState({ open: true, resolve, denied: permission() === 'denied', ...opts });
    });
  }, []);

  const close = (result: boolean) => {
    state.resolve?.(result);
    setState({ open: false });
  };

  const enable = async () => {
    setBusy(true);
    const res = await subscribeToPush();
    setBusy(false);
    if (res.ok) {
      close(true);
    } else {
      // Keep the modal open but flip to the appropriate explanation.
      setState((s) => ({ ...s, denied: res.reason === 'denied' }));
    }
  };

  const supported = isPushSupported();

  return (
    <NotificationGateContext.Provider value={{ requireNotifications }}>
      {children}
      {state.open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => close(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-gray-200/70 dark:border-slate-700/70 p-5 animate-in slide-in-from-bottom-4 sm:zoom-in-95 fade-in duration-200">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" className="w-11 h-11 rounded-xl flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                  {state.title || 'Turn on notifications'}
                </h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {state.denied
                    ? 'Notifications are blocked for this site. Enable them in your browser’s site settings, then try again.'
                    : !supported
                      ? 'To get push on your phone, add HireRadar to your Home Screen first (Share → Add to Home Screen), then open the app and try again.'
                      : (state.reason || 'Get notified the moment something you care about happens.')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Not now
              </button>
              {supported && !state.denied && (
                <button
                  onClick={enable}
                  disabled={busy}
                  className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {busy ? 'Enabling…' : 'Turn on notifications'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </NotificationGateContext.Provider>
  );
}
