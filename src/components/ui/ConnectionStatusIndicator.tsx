'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ConnectionStatus } from '@/hooks/useSupabaseRealtime';

interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
  onReconnect?: () => void;
  className?: string;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  {
    color: string;
    bgColor: string;
    label: string;
    icon: 'pulse' | 'static' | 'spin';
  }
> = {
  connected: {
    color: 'bg-green-500',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    label: 'Live',
    icon: 'pulse',
  },
  connecting: {
    color: 'bg-yellow-500',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    label: 'Connecting',
    icon: 'spin',
  },
  reconnecting: {
    color: 'bg-yellow-500',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900/30',
    label: 'Reconnecting',
    icon: 'spin',
  },
  disconnected: {
    color: 'bg-red-500',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    label: 'Offline',
    icon: 'static',
  },
};

export function ConnectionStatusIndicator({
  status,
  onReconnect,
  className,
  showLabel = true,
}: ConnectionStatusIndicatorProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const config = STATUS_CONFIG[status];

  // Auto-hide tooltip after 3 seconds
  useEffect(() => {
    if (showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showTooltip]);

  return (
    <div className={cn('relative inline-flex items-center gap-2', className)}>
      {/* Status Indicator */}
      <button
        type="button"
        onClick={() => {
          if (status === 'disconnected' && onReconnect) {
            onReconnect();
          } else {
            setShowTooltip(!showTooltip);
          }
        }}
        className={cn(
          'relative flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all',
          config.bgColor,
          status === 'disconnected' && onReconnect && 'cursor-pointer hover:opacity-80'
        )}
        aria-label={`Connection status: ${config.label}`}
      >
        {/* Dot */}
        <span className="relative flex h-2 w-2">
          {config.icon === 'pulse' && (
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                config.color
              )}
            />
          )}
          {config.icon === 'spin' && (
            <span
              className={cn(
                'animate-spin absolute inline-flex h-full w-full rounded-full border border-current border-t-transparent',
                status === 'connecting' ? 'text-yellow-500' : 'text-yellow-500'
              )}
            />
          )}
          <span
            className={cn(
              'relative inline-flex rounded-full h-2 w-2',
              config.color
            )}
          />
        </span>

        {/* Label */}
        {showLabel && (
          <span
            className={cn(
              'text-xs',
              status === 'connected' && 'text-green-700 dark:text-green-400',
              status === 'connecting' && 'text-yellow-700 dark:text-yellow-400',
              status === 'reconnecting' && 'text-yellow-700 dark:text-yellow-400',
              status === 'disconnected' && 'text-red-700 dark:text-red-400'
            )}
          >
            {config.label}
          </span>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 z-50">
          <div className="bg-gray-900 text-white text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs">
            {status === 'connected' && (
              <p>Real-time updates are active. You will see new jobs instantly.</p>
            )}
            {status === 'connecting' && (
              <p>Establishing connection to receive real-time updates...</p>
            )}
            {status === 'reconnecting' && (
              <p>Connection lost. Attempting to reconnect...</p>
            )}
            {status === 'disconnected' && (
              <div>
                <p className="mb-2">Not connected. Click to reconnect.</p>
                {onReconnect && (
                  <button
                    onClick={() => {
                      onReconnect();
                      setShowTooltip(false);
                    }}
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    Reconnect now
                  </button>
                )}
              </div>
            )}
            {/* Arrow */}
            <div className="absolute -top-1 left-4 w-2 h-2 bg-gray-900 transform rotate-45" />
          </div>
        </div>
      )}
    </div>
  );
}

export default ConnectionStatusIndicator;
