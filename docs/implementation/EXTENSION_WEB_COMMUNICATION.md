# Chrome Extension to Web App Communication

This document describes the communication architecture between the NewGrad Radar Chrome extension and the Next.js web application, including message passing, authentication sharing, real-time synchronization, and security considerations.

---

## Table of Contents

1. [Overview](#overview)
2. [Message Passing Architecture](#message-passing-architecture)
3. [Auth Token Sharing](#auth-token-sharing)
4. [Real-Time Status Updates](#real-time-status-updates)
5. [Security Considerations](#security-considerations)
6. [Implementation Guide](#implementation-guide)

---

## Overview

The architecture uses a hybrid approach where the web dashboard handles complex UI (job browsing, profile editing) and the extension handles browser-level operations (form filling, DOM manipulation).

```
+------------------+     +-------------------+     +------------------+
|  Web Dashboard   |<--->|  Supabase Backend |<--->|  Chrome Extension|
|  (newgrad-radar) |     |  (Postgres + API) |     |  (content script)|
|                  |     |                   |     |                  |
| - Profile CRUD   |     | - User data       |     | - Auto-fill forms|
| - Job browsing   |     | - Job tracking    |     | - Status updates |
| - Apply queue    |     | - Sync state      |     | - Resume upload  |
+------------------+     +-------------------+     +------------------+
```

### Communication Channels

| Channel | Direction | Use Case |
|---------|-----------|----------|
| External Messaging | Web -> Extension | Trigger auto-apply, sync profile |
| External Messaging | Extension -> Web | Report status, request data |
| Supabase Realtime | Bidirectional | Live sync via database |
| chrome.storage | Extension internal | Cached profile, offline state |
| postMessage | Content script -> Page | Detect web app presence |

---

## Message Passing Architecture

### 1. Extension Manifest Configuration

The extension must declare external connectivity in `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "NewGrad Radar Auto-Apply",
  "version": "1.0.0",
  "permissions": [
    "storage",
    "activeTab",
    "tabs"
  ],
  "host_permissions": [
    "https://boards.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://jobs.ashbyhq.com/*",
    "https://*.myworkdayjobs.com/*"
  ],
  "externally_connectable": {
    "matches": [
      "https://newgrad-radar.com/*",
      "https://*.newgrad-radar.com/*",
      "http://localhost:3000/*"
    ]
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

### 2. Web App to Extension Communication

The web app initiates communication using `chrome.runtime.sendMessage()` with the extension ID:

```typescript
// src/lib/extension-bridge.ts

// Extension ID from Chrome Web Store (or unpacked extension)
const EXTENSION_ID = 'your-extension-id-here';

export interface ExtensionMessage {
  type: 'START_AUTO_APPLY' | 'SYNC_PROFILE' | 'GET_STATUS' | 'CANCEL_APPLICATION';
  payload?: unknown;
}

export interface ExtensionResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Check if the extension is installed and connected
 */
export async function isExtensionInstalled(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        EXTENSION_ID,
        { type: 'PING' },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
            return;
          }
          resolve(response?.success === true);
        }
      );

      // Timeout fallback
      setTimeout(() => resolve(false), 1000);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Send a message to the extension
 */
export async function sendToExtension(
  message: ExtensionMessage
): Promise<ExtensionResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      reject(new Error('Chrome runtime not available'));
      return;
    }

    chrome.runtime.sendMessage(EXTENSION_ID, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Start an auto-apply job
 */
export async function startAutoApply(jobData: {
  jobId: string;
  applicationUrl: string;
  atsType: string;
  profile: UserProfile;
}): Promise<ExtensionResponse> {
  return sendToExtension({
    type: 'START_AUTO_APPLY',
    payload: jobData,
  });
}

/**
 * Sync user profile to extension
 */
export async function syncProfileToExtension(
  profile: UserProfile
): Promise<ExtensionResponse> {
  return sendToExtension({
    type: 'SYNC_PROFILE',
    payload: profile,
  });
}

/**
 * Get current extension status
 */
export async function getExtensionStatus(): Promise<{
  installed: boolean;
  version?: string;
  activeJobs?: number;
  lastSync?: string;
}> {
  try {
    const response = await sendToExtension({ type: 'GET_STATUS' });
    return {
      installed: true,
      ...(response.data as Record<string, unknown>),
    };
  } catch {
    return { installed: false };
  }
}
```

### 3. Extension Background Service Worker

The service worker handles incoming messages from the web app:

```typescript
// extension/src/background/index.ts

import { createClient } from '@supabase/supabase-js';

interface Message {
  type: string;
  payload?: unknown;
}

// Handle external messages from the web app
chrome.runtime.onMessageExternal.addListener(
  (message: Message, sender, sendResponse) => {
    // Verify sender origin
    const allowedOrigins = [
      'https://newgrad-radar.com',
      'http://localhost:3000',
    ];

    if (!sender.url || !allowedOrigins.some((o) => sender.url?.startsWith(o))) {
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return true;
    }

    handleMessage(message)
      .then((response) => sendResponse(response))
      .catch((error) =>
        sendResponse({ success: false, error: error.message })
      );

    // Return true to indicate async response
    return true;
  }
);

async function handleMessage(message: Message): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'PING':
      return { success: true, data: { version: chrome.runtime.getManifest().version } };

    case 'START_AUTO_APPLY':
      return handleStartAutoApply(message.payload);

    case 'SYNC_PROFILE':
      return handleSyncProfile(message.payload);

    case 'GET_STATUS':
      return handleGetStatus();

    case 'CANCEL_APPLICATION':
      return handleCancelApplication(message.payload);

    default:
      return { success: false, error: `Unknown message type: ${message.type}` };
  }
}

async function handleStartAutoApply(payload: unknown): Promise<ExtensionResponse> {
  const { jobId, applicationUrl, atsType, profile } = payload as {
    jobId: string;
    applicationUrl: string;
    atsType: string;
    profile: UserProfile;
  };

  // Open the application URL in a new tab
  const tab = await chrome.tabs.create({ url: applicationUrl, active: true });

  // Store the job context for the content script
  await chrome.storage.session.set({
    currentJob: { jobId, applicationUrl, atsType, profile, tabId: tab.id },
  });

  // The content script will pick up the job and start filling
  return { success: true, data: { tabId: tab.id } };
}

async function handleSyncProfile(payload: unknown): Promise<ExtensionResponse> {
  const profile = payload as UserProfile;

  // Store in extension storage
  await chrome.storage.local.set({ userProfile: profile });

  return { success: true };
}

async function handleGetStatus(): Promise<ExtensionResponse> {
  const [storage, sessionStorage] = await Promise.all([
    chrome.storage.local.get(['userProfile', 'lastSync']),
    chrome.storage.session.get(['activeJobs']),
  ]);

  return {
    success: true,
    data: {
      version: chrome.runtime.getManifest().version,
      hasProfile: !!storage.userProfile,
      lastSync: storage.lastSync,
      activeJobs: sessionStorage.activeJobs?.length || 0,
    },
  };
}
```

### 4. Content Script to Web Page Communication

For detecting when the user is on the NewGrad Radar web app:

```typescript
// extension/src/content/web-app-detector.ts

// Only run on our web app
const WEB_APP_ORIGINS = ['https://newgrad-radar.com', 'http://localhost:3000'];

function isOnWebApp(): boolean {
  return WEB_APP_ORIGINS.some((origin) => window.location.origin === origin);
}

if (isOnWebApp()) {
  // Inject a script to communicate with the page
  const script = document.createElement('script');
  script.textContent = `
    window.__NEWGRAD_RADAR_EXTENSION__ = {
      installed: true,
      version: '${chrome.runtime.getManifest().version}',
    };
    window.dispatchEvent(new CustomEvent('newgrad-extension-ready'));
  `;
  document.head.appendChild(script);

  // Listen for messages from the page
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (event.data.type !== 'NEWGRAD_RADAR_TO_EXTENSION') return;

    const response = await chrome.runtime.sendMessage(event.data.payload);

    window.postMessage({
      type: 'NEWGRAD_EXTENSION_RESPONSE',
      id: event.data.id,
      response,
    }, '*');
  });
}
```

Web app side detection:

```typescript
// src/hooks/useExtension.ts

import { useState, useEffect, useCallback } from 'react';
import { isExtensionInstalled, sendToExtension, ExtensionMessage, ExtensionResponse } from '@/lib/extension-bridge';

export interface UseExtensionReturn {
  isInstalled: boolean;
  isLoading: boolean;
  version: string | null;
  sendMessage: (message: ExtensionMessage) => Promise<ExtensionResponse>;
  refresh: () => Promise<void>;
}

export function useExtension(): UseExtensionReturn {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [version, setVersion] = useState<string | null>(null);

  const checkExtension = useCallback(async () => {
    setIsLoading(true);
    try {
      const installed = await isExtensionInstalled();
      setIsInstalled(installed);

      if (installed) {
        const status = await sendToExtension({ type: 'GET_STATUS' });
        if (status.success && status.data) {
          setVersion((status.data as { version?: string }).version || null);
        }
      }
    } catch {
      setIsInstalled(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkExtension();

    // Listen for extension ready event (from content script injection)
    const handleReady = () => {
      checkExtension();
    };

    window.addEventListener('newgrad-extension-ready', handleReady);
    return () => window.removeEventListener('newgrad-extension-ready', handleReady);
  }, [checkExtension]);

  const sendMessage = useCallback(async (message: ExtensionMessage) => {
    if (!isInstalled) {
      throw new Error('Extension not installed');
    }
    return sendToExtension(message);
  }, [isInstalled]);

  return {
    isInstalled,
    isLoading,
    version,
    sendMessage,
    refresh: checkExtension,
  };
}
```

---

## Auth Token Sharing

### Strategy: Supabase Session Sharing

Both the web app and extension use the same Supabase project. The extension receives auth tokens from the web app and uses them for API calls.

### 1. Web App Sends Auth Token to Extension

```typescript
// src/hooks/useExtensionAuth.ts

import { useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useExtension } from './useExtension';

export function useExtensionAuth() {
  const { isInstalled, sendMessage } = useExtension();
  const supabase = createClient();

  const syncAuthToExtension = useCallback(async () => {
    if (!isInstalled) return;

    const { data: { session } } = await supabase.auth.getSession();

    if (session) {
      await sendMessage({
        type: 'SYNC_AUTH',
        payload: {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          user: {
            id: session.user.id,
            email: session.user.email,
          },
        },
      });
    }
  }, [isInstalled, sendMessage, supabase]);

  // Sync auth on session change
  useEffect(() => {
    if (!isInstalled) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          syncAuthToExtension();
        } else if (event === 'SIGNED_OUT') {
          sendMessage({ type: 'CLEAR_AUTH' });
        }
      }
    );

    // Initial sync
    syncAuthToExtension();

    return () => subscription.unsubscribe();
  }, [isInstalled, syncAuthToExtension, sendMessage, supabase]);

  return { syncAuthToExtension };
}
```

### 2. Extension Stores and Uses Auth Token

```typescript
// extension/src/background/auth.ts

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jmrbyubrrpxxvotsljms.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

let supabaseClient: SupabaseClient | null = null;

interface AuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string; email: string };
}

export async function handleSyncAuth(payload: AuthData): Promise<ExtensionResponse> {
  // Store encrypted auth data
  await chrome.storage.local.set({
    auth: {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      expiresAt: payload.expiresAt,
      user: payload.user,
    },
  });

  // Initialize Supabase client with the token
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${payload.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return { success: true };
}

export async function handleClearAuth(): Promise<ExtensionResponse> {
  await chrome.storage.local.remove(['auth']);
  supabaseClient = null;
  return { success: true };
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseClient) return supabaseClient;

  const { auth } = await chrome.storage.local.get(['auth']);
  if (!auth) return null;

  // Check if token is expired
  if (auth.expiresAt * 1000 < Date.now()) {
    // Token expired - request refresh from web app
    await requestTokenRefresh();
    return null;
  }

  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

async function requestTokenRefresh(): Promise<void> {
  // Find tabs with our web app and request token refresh
  const tabs = await chrome.tabs.query({ url: ['https://newgrad-radar.com/*', 'http://localhost:3000/*'] });

  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_TOKEN_REFRESH' });
    }
  }
}
```

### 3. Token Refresh Flow

```typescript
// src/components/auth/ExtensionAuthSync.tsx
'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useExtension } from '@/hooks/useExtension';

/**
 * Component that handles token refresh requests from the extension
 */
export function ExtensionAuthSync() {
  const { isInstalled, sendMessage } = useExtension();
  const supabase = createClient();

  useEffect(() => {
    if (!isInstalled) return;

    // Listen for token refresh requests from extension
    const handleMessage = async (event: MessageEvent) => {
      if (event.data.type !== 'EXTENSION_REQUEST_TOKEN_REFRESH') return;

      // Get fresh session
      const { data: { session }, error } = await supabase.auth.refreshSession();

      if (session && !error) {
        await sendMessage({
          type: 'SYNC_AUTH',
          payload: {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            expiresAt: session.expires_at,
            user: {
              id: session.user.id,
              email: session.user.email,
            },
          },
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isInstalled, sendMessage, supabase]);

  return null;
}
```

---

## Real-Time Status Updates

### 1. Extension Reports Status via Supabase

The extension updates application status directly in Supabase, which the web app subscribes to via Realtime:

```typescript
// extension/src/background/status-reporter.ts

import { getSupabaseClient } from './auth';

export type ApplicationStatus =
  | 'pending'
  | 'in_progress'
  | 'filling_form'
  | 'submitting'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

interface StatusUpdate {
  jobId: string;
  status: ApplicationStatus;
  progress?: number; // 0-100
  currentStep?: string;
  error?: string;
  timestamp: string;
}

export async function updateApplicationStatus(update: StatusUpdate): Promise<void> {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    console.error('No Supabase client available');
    return;
  }

  const { auth } = await chrome.storage.local.get(['auth']);
  if (!auth?.user?.id) return;

  // Update the application_logs table
  const { error } = await supabase
    .from('application_logs')
    .upsert({
      job_id: update.jobId,
      user_id: auth.user.id,
      status: update.status,
      progress: update.progress,
      current_step: update.currentStep,
      error_message: update.error,
      updated_at: update.timestamp,
    }, {
      onConflict: 'job_id,user_id',
    });

  if (error) {
    console.error('Failed to update status:', error);
  }

  // Also broadcast via extension messaging for immediate UI update
  chrome.runtime.sendMessage({
    type: 'APPLICATION_STATUS_CHANGED',
    payload: update,
  });
}

// Progress reporter for content scripts
export function createProgressReporter(jobId: string) {
  let lastUpdate = 0;
  const MIN_UPDATE_INTERVAL = 500; // Throttle to max 2 updates per second

  return {
    async report(status: ApplicationStatus, progress?: number, step?: string) {
      const now = Date.now();
      if (now - lastUpdate < MIN_UPDATE_INTERVAL) return;
      lastUpdate = now;

      await updateApplicationStatus({
        jobId,
        status,
        progress,
        currentStep: step,
        timestamp: new Date().toISOString(),
      });
    },

    async complete() {
      await updateApplicationStatus({
        jobId,
        status: 'confirmed',
        progress: 100,
        timestamp: new Date().toISOString(),
      });
    },

    async fail(error: string) {
      await updateApplicationStatus({
        jobId,
        status: 'failed',
        error,
        timestamp: new Date().toISOString(),
      });
    },
  };
}
```

### 2. Web App Subscribes to Status Updates

```typescript
// src/hooks/useApplicationStatus.ts

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface ApplicationStatusData {
  jobId: string;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  updatedAt: string;
}

export function useApplicationStatus(userId: string | null) {
  const [statuses, setStatuses] = useState<Map<string, ApplicationStatusData>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;

    // Subscribe to application_logs changes for this user
    channel = supabase
      .channel(`application_status_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'application_logs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const data = payload.new as Record<string, unknown>;

          setStatuses((prev) => {
            const updated = new Map(prev);
            updated.set(data.job_id as string, {
              jobId: data.job_id as string,
              status: data.status as string,
              progress: (data.progress as number) || 0,
              currentStep: data.current_step as string | null,
              error: data.error_message as string | null,
              updatedAt: data.updated_at as string,
            });
            return updated;
          });
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [userId]);

  const getStatus = useCallback(
    (jobId: string): ApplicationStatusData | null => {
      return statuses.get(jobId) || null;
    },
    [statuses]
  );

  return {
    statuses,
    getStatus,
    isConnected,
    inProgressJobs: Array.from(statuses.values()).filter(
      (s) => s.status === 'in_progress' || s.status === 'filling_form' || s.status === 'submitting'
    ),
  };
}
```

### 3. Status Display Component

```typescript
// src/components/autoapply/LiveApplicationStatus.tsx
'use client';

import { useApplicationStatus } from '@/hooks/useApplicationStatus';
import { cn } from '@/lib/utils';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: 'Queued', color: 'text-gray-500', icon: 'clock' },
  in_progress: { label: 'Starting...', color: 'text-blue-500', icon: 'play' },
  filling_form: { label: 'Filling Form', color: 'text-amber-500', icon: 'edit' },
  submitting: { label: 'Submitting', color: 'text-amber-600', icon: 'send' },
  submitted: { label: 'Submitted', color: 'text-green-500', icon: 'check' },
  confirmed: { label: 'Confirmed', color: 'text-green-600', icon: 'check-circle' },
  failed: { label: 'Failed', color: 'text-red-500', icon: 'x-circle' },
  cancelled: { label: 'Cancelled', color: 'text-gray-400', icon: 'x' },
};

interface LiveApplicationStatusProps {
  jobId: string;
  userId: string;
}

export function LiveApplicationStatus({ jobId, userId }: LiveApplicationStatusProps) {
  const { getStatus, isConnected } = useApplicationStatus(userId);
  const status = getStatus(jobId);

  if (!status) return null;

  const config = STATUS_CONFIG[status.status] || STATUS_CONFIG.pending;

  return (
    <div className="flex items-center gap-2">
      {/* Connection indicator */}
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          isConnected ? 'bg-green-500' : 'bg-red-500'
        )}
        title={isConnected ? 'Live' : 'Reconnecting...'}
      />

      {/* Status label */}
      <span className={cn('text-sm font-medium', config.color)}>
        {config.label}
      </span>

      {/* Progress bar for in-progress states */}
      {status.progress > 0 && status.progress < 100 && (
        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}

      {/* Current step */}
      {status.currentStep && (
        <span className="text-xs text-gray-500">{status.currentStep}</span>
      )}

      {/* Error message */}
      {status.error && (
        <span className="text-xs text-red-500" title={status.error}>
          {status.error.slice(0, 50)}...
        </span>
      )}
    </div>
  );
}
```

---

## Security Considerations

### 1. Origin Verification

Always verify the sender origin for external messages:

```typescript
// extension/src/background/security.ts

const ALLOWED_ORIGINS = [
  'https://newgrad-radar.com',
  'https://www.newgrad-radar.com',
  'http://localhost:3000', // Development only
];

export function isAllowedOrigin(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false;

  try {
    const url = new URL(senderUrl);
    return ALLOWED_ORIGINS.some((origin) => {
      const allowedUrl = new URL(origin);
      return (
        url.protocol === allowedUrl.protocol &&
        url.host === allowedUrl.host
      );
    });
  } catch {
    return false;
  }
}

// Use in message handler
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedOrigin(sender.url)) {
    sendResponse({ success: false, error: 'Unauthorized origin' });
    return true;
  }

  // Process message...
  return true;
});
```

### 2. Token Storage Security

```typescript
// extension/src/background/secure-storage.ts

/**
 * Encrypt sensitive data before storing
 * Uses Web Crypto API for AES-GCM encryption
 */
async function encryptData(data: string, key: CryptoKey): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return { encrypted, iv };
}

async function decryptData(encrypted: ArrayBuffer, iv: Uint8Array, key: CryptoKey): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Generate and store a per-installation encryption key
 */
async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
  const { encryptionKey } = await chrome.storage.local.get(['encryptionKey']);

  if (encryptionKey) {
    return crypto.subtle.importKey(
      'raw',
      new Uint8Array(encryptionKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Generate new key
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const exportedKey = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.local.set({ encryptionKey: Array.from(new Uint8Array(exportedKey)) });

  return key;
}

export async function secureStore(key: string, value: string): Promise<void> {
  const encryptionKey = await getOrCreateEncryptionKey();
  const { encrypted, iv } = await encryptData(value, encryptionKey);

  await chrome.storage.local.set({
    [`secure_${key}`]: {
      data: Array.from(new Uint8Array(encrypted)),
      iv: Array.from(iv),
    },
  });
}

export async function secureRetrieve(key: string): Promise<string | null> {
  const stored = await chrome.storage.local.get([`secure_${key}`]);
  const data = stored[`secure_${key}`];

  if (!data) return null;

  const encryptionKey = await getOrCreateEncryptionKey();
  return decryptData(
    new Uint8Array(data.data).buffer,
    new Uint8Array(data.iv),
    encryptionKey
  );
}
```

### 3. Content Security Policy

In the extension manifest:

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src https://jmrbyubrrpxxvotsljms.supabase.co https://*.supabase.co;"
  }
}
```

### 4. Rate Limiting

Prevent abuse by rate limiting message handling:

```typescript
// extension/src/background/rate-limiter.ts

const REQUEST_LIMITS = {
  START_AUTO_APPLY: { maxRequests: 10, windowMs: 60000 }, // 10 per minute
  SYNC_PROFILE: { maxRequests: 5, windowMs: 60000 }, // 5 per minute
  GET_STATUS: { maxRequests: 30, windowMs: 60000 }, // 30 per minute
};

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(messageType: string): boolean {
  const limit = REQUEST_LIMITS[messageType as keyof typeof REQUEST_LIMITS];
  if (!limit) return true; // No limit defined

  const now = Date.now();
  const key = messageType;
  const current = requestCounts.get(key);

  if (!current || current.resetAt < now) {
    requestCounts.set(key, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }

  if (current.count >= limit.maxRequests) {
    return false;
  }

  current.count++;
  return true;
}
```

### 5. Input Validation

Validate all incoming data:

```typescript
// extension/src/background/validation.ts

import { z } from 'zod';

const StartAutoApplySchema = z.object({
  jobId: z.string().uuid(),
  applicationUrl: z.string().url(),
  atsType: z.enum(['greenhouse', 'lever', 'ashby', 'workday', 'icims', 'taleo', 'generic']),
  profile: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().optional(),
    // ... other profile fields
  }),
});

const SyncAuthSchema = z.object({
  accessToken: z.string().min(100), // JWT tokens are long
  refreshToken: z.string().min(20),
  expiresAt: z.number().positive(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
  }),
});

export function validateStartAutoApply(payload: unknown) {
  return StartAutoApplySchema.safeParse(payload);
}

export function validateSyncAuth(payload: unknown) {
  return SyncAuthSchema.safeParse(payload);
}
```

### 6. Sensitive Data Handling

Never log or expose sensitive data:

```typescript
// extension/src/background/logging.ts

const SENSITIVE_FIELDS = ['accessToken', 'refreshToken', 'password', 'ssn', 'phone'];

function sanitizeForLogging(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeForLogging);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function secureLog(message: string, data?: unknown): void {
  console.log(message, data ? sanitizeForLogging(data) : '');
}
```

---

## Implementation Guide

### Phase 1: Core Communication (Week 1)

1. **Set up extension project structure**
   - Initialize with Vite + CRXJS
   - Configure manifest.json with externally_connectable
   - Set up TypeScript and build pipeline

2. **Implement basic message passing**
   - Background service worker message handlers
   - Web app extension bridge module
   - `useExtension` hook for React integration

3. **Add extension detection**
   - Content script for web app detection
   - Extension install prompt in web app

### Phase 2: Auth Integration (Week 2)

1. **Implement auth token sharing**
   - Web app auth sync on login/logout
   - Extension token storage (encrypted)
   - Token refresh flow

2. **Add Supabase client to extension**
   - Configure with shared tokens
   - Implement authenticated API calls

### Phase 3: Real-Time Sync (Week 2-3)

1. **Set up status reporting**
   - Extension updates application_logs
   - Web app subscribes via Supabase Realtime

2. **Build status UI components**
   - Live status indicators
   - Progress bars
   - Error displays

### Phase 4: Security Hardening (Week 3)

1. **Implement security measures**
   - Origin verification
   - Rate limiting
   - Input validation with Zod
   - Encrypted storage

2. **Security audit**
   - Review CSP settings
   - Test for XSS vectors
   - Validate token handling

---

## Testing

### Manual Testing Checklist

- [ ] Extension detects web app correctly
- [ ] Profile syncs from web app to extension
- [ ] Auth tokens transfer securely
- [ ] Auto-apply triggers from web app
- [ ] Status updates show in real-time
- [ ] Token refresh works when expired
- [ ] Extension handles web app logout
- [ ] Rate limiting prevents abuse
- [ ] Invalid origins are rejected

### Automated Testing

```typescript
// tests/extension-bridge.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExtensionInstalled, sendToExtension } from '@/lib/extension-bridge';

describe('Extension Bridge', () => {
  beforeEach(() => {
    // Mock chrome.runtime
    global.chrome = {
      runtime: {
        sendMessage: vi.fn(),
        lastError: null,
      },
    } as unknown as typeof chrome;
  });

  it('detects when extension is not installed', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_id, _msg, callback) => {
        chrome.runtime.lastError = { message: 'Extension not found' };
        callback(undefined);
      }
    );

    const result = await isExtensionInstalled();
    expect(result).toBe(false);
  });

  it('detects when extension is installed', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_id, _msg, callback) => {
        callback({ success: true, data: { version: '1.0.0' } });
      }
    );

    const result = await isExtensionInstalled();
    expect(result).toBe(true);
  });
});
```

---

## Related Documents

- [Auto-Apply Architecture](../research/AUTOAPPLY_ARCHITECTURE.md)
- [Anti-Detection Strategies](../research/ANTI_DETECTION.md)
- [ATS Form Patterns](../research/ATS_FORM_PATTERNS.md)
- [Error Handling](../research/AUTOAPPLY_ERROR_HANDLING.md)
