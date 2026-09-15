# Job Queue Implementation for Auto-Apply

## Recommendation: BullMQ

**BullMQ** is the recommended solution for auto-apply background processing because:

1. **Battle-tested** - Used by thousands of production apps
2. **Redis-backed** - Persistence, clustering, horizontal scaling
3. **Priority queues** - Native support for job prioritization
4. **Rich features** - Retries, delays, rate limiting, job dependencies
5. **Dashboard** - Bull Board for monitoring
6. **TypeScript** - First-class TS support

### When to Use Alternatives

| Solution | Use When |
|----------|----------|
| **BullMQ** | Production, multiple workers, need persistence |
| **Agenda** | MongoDB already in stack, cron-style scheduling |
| **bee-queue** | Simpler needs, lighter weight than BullMQ |
| **In-memory** | Development only, or truly ephemeral jobs |
| **Supabase Edge Functions** | Serverless, low volume, already using Supabase |

---

## Complete BullMQ Setup

### 1. Installation

```bash
cd auto-apply
npm install bullmq ioredis bull-board @bull-board/express express
npm install -D @types/express
```

### 2. Redis Connection

```typescript
// auto-apply/src/queue/connection.ts
import { Redis } from 'ioredis';

// For local development: use Docker
// docker run -d -p 6379:6379 redis:alpine

// For production: use Upstash (free tier) or Railway Redis
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

connection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

connection.on('connect', () => {
  console.log('Connected to Redis');
});

export { connection };
```

### 3. Queue Definition with Priorities

```typescript
// auto-apply/src/queue/applicationQueue.ts
import { Queue, QueueEvents } from 'bullmq';
import { connection } from './connection';

// Job priority levels (lower number = higher priority)
export enum JobPriority {
  URGENT = 1,      // User-initiated "Apply Now"
  HIGH = 2,        // Jobs expiring soon
  NORMAL = 3,      // Regular auto-apply
  LOW = 4,         // Bulk/batch applications
  BACKGROUND = 5,  // Retry attempts
}

// Job data interface
export interface ApplicationJobData {
  jobId: string;           // Database job ID
  userId: string;          // User ID
  jobUrl: string;          // Application URL
  atsType: 'greenhouse' | 'lever' | 'ashby' | 'jobvite' | 'workday' | 'unknown';
  companyName: string;
  jobTitle: string;
  resumePath?: string;     // Path to user's resume
  coverLetter?: string;    // Generated cover letter
  answers?: Record<string, string>; // Pre-filled answers
  attempt: number;         // Current attempt number
  maxAttempts: number;     // Max retry attempts
}

// Create the queue
export const applicationQueue = new Queue<ApplicationJobData>('applications', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute, then 2, 4, etc.
    },
    removeOnComplete: {
      age: 24 * 3600, // Keep completed jobs for 24 hours
      count: 1000,    // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 7 * 24 * 3600, // Keep failed jobs for 7 days
    },
  },
});

// Queue events for monitoring
export const queueEvents = new QueueEvents('applications', { connection });

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed:`, returnvalue);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed:`, failedReason);
});

queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress:`, data);
});
```

### 4. Adding Jobs to Queue

```typescript
// auto-apply/src/queue/addJob.ts
import { applicationQueue, ApplicationJobData, JobPriority } from './applicationQueue';

export async function queueApplication(
  data: Omit<ApplicationJobData, 'attempt' | 'maxAttempts'>,
  priority: JobPriority = JobPriority.NORMAL,
  delay?: number // Delay in milliseconds
) {
  const jobData: ApplicationJobData = {
    ...data,
    attempt: 1,
    maxAttempts: 3,
  };

  const job = await applicationQueue.add(
    `apply-${data.companyName}-${data.jobId}`, // Job name for identification
    jobData,
    {
      priority,
      delay,
      jobId: `${data.userId}-${data.jobId}`, // Prevent duplicate submissions
    }
  );

  console.log(`Queued job ${job.id} for ${data.companyName} - ${data.jobTitle}`);
  return job;
}

// Queue multiple applications with rate limiting
export async function queueBulkApplications(
  applications: Omit<ApplicationJobData, 'attempt' | 'maxAttempts'>[],
  intervalMs: number = 30000 // 30 seconds between applications
) {
  const jobs = [];
  
  for (let i = 0; i < applications.length; i++) {
    const job = await queueApplication(
      applications[i],
      JobPriority.LOW,
      i * intervalMs // Stagger the applications
    );
    jobs.push(job);
  }
  
  return jobs;
}

// Priority queue for expiring jobs
export async function queueUrgentApplication(
  data: Omit<ApplicationJobData, 'attempt' | 'maxAttempts'>
) {
  return queueApplication(data, JobPriority.URGENT);
}
```

### 5. Worker Implementation

```typescript
// auto-apply/src/queue/worker.ts
import { Worker, Job } from 'bullmq';
import { connection } from './connection';
import { ApplicationJobData } from './applicationQueue';
import { applyToGreenhouse } from '../handlers/greenhouse';
import { applyToLever } from '../handlers/lever';
import { applyToAshby } from '../handlers/ashby';
import { applyToJobvite } from '../handlers/jobvite';
import { updateJobStatus, moveToDeadLetterQueue } from './jobStatus';

// Handler registry
const handlers: Record<string, (job: Job<ApplicationJobData>) => Promise<any>> = {
  greenhouse: applyToGreenhouse,
  lever: applyToLever,
  ashby: applyToAshby,
  jobvite: applyToJobvite,
};

// Create the worker
export const applicationWorker = new Worker<ApplicationJobData>(
  'applications',
  async (job) => {
    const { data } = job;
    
    console.log(`Processing job ${job.id}: ${data.companyName} - ${data.jobTitle}`);
    
    // Update status to "processing"
    await updateJobStatus(data.jobId, data.userId, 'processing');
    await job.updateProgress(10);

    // Get the appropriate handler
    const handler = handlers[data.atsType];
    
    if (!handler) {
      throw new Error(`Unknown ATS type: ${data.atsType}`);
    }

    try {
      // Execute the application
      await job.updateProgress(20);
      const result = await handler(job);
      await job.updateProgress(100);
      
      // Update status to "applied"
      await updateJobStatus(data.jobId, data.userId, 'applied', {
        appliedAt: new Date().toISOString(),
        confirmationId: result.confirmationId,
      });
      
      return result;
    } catch (error) {
      // Check if we've exhausted retries
      if (job.attemptsMade >= data.maxAttempts) {
        await moveToDeadLetterQueue(data, error);
        await updateJobStatus(data.jobId, data.userId, 'failed', {
          error: error.message,
          failedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  },
  {
    connection,
    concurrency: 2, // Process 2 jobs at a time (browser instances)
    limiter: {
      max: 10,        // Max 10 jobs
      duration: 60000, // Per minute (rate limiting)
    },
  }
);

// Worker event handlers
applicationWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

applicationWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

applicationWorker.on('error', (err) => {
  console.error('Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down worker...');
  await applicationWorker.close();
  process.exit(0);
});
```

### 6. Job Status Tracking

```typescript
// auto-apply/src/queue/jobStatus.ts
import { createClient } from '@supabase/supabase-js';
import { Queue } from 'bullmq';
import { connection } from './connection';
import { ApplicationJobData } from './applicationQueue';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Dead Letter Queue for failed jobs
export const deadLetterQueue = new Queue('applications-dlq', { connection });

export type JobStatus = 
  | 'queued'
  | 'processing'
  | 'applied'
  | 'failed'
  | 'cancelled';

export async function updateJobStatus(
  jobId: string,
  userId: string,
  status: JobStatus,
  metadata?: Record<string, any>
) {
  const { error } = await supabase
    .from('saved_jobs')
    .update({
      status,
      auto_apply_metadata: metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('job_id', jobId)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to update job status:', error);
    throw error;
  }
}

export async function moveToDeadLetterQueue(
  data: ApplicationJobData,
  error: Error
) {
  await deadLetterQueue.add('failed-application', {
    ...data,
    error: error.message,
    stack: error.stack,
    failedAt: new Date().toISOString(),
  });
}

// Get queue statistics
export async function getQueueStats() {
  const { applicationQueue } = await import('./applicationQueue');
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    applicationQueue.getWaitingCount(),
    applicationQueue.getActiveCount(),
    applicationQueue.getCompletedCount(),
    applicationQueue.getFailedCount(),
    applicationQueue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
}

// Get job by ID
export async function getJobById(jobId: string) {
  const { applicationQueue } = await import('./applicationQueue');
  return applicationQueue.getJob(jobId);
}

// Cancel a pending job
export async function cancelJob(jobId: string, userId: string) {
  const { applicationQueue } = await import('./applicationQueue');
  const job = await applicationQueue.getJob(`${userId}-${jobId}`);
  
  if (job) {
    const state = await job.getState();
    
    if (state === 'waiting' || state === 'delayed') {
      await job.remove();
      await updateJobStatus(jobId, userId, 'cancelled');
      return true;
    }
  }
  
  return false;
}
```

### 7. Dashboard with Bull Board

```typescript
// auto-apply/src/dashboard/server.ts
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { applicationQueue } from '../queue/applicationQueue';
import { deadLetterQueue } from '../queue/jobStatus';

const app = express();
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(applicationQueue),
    new BullMQAdapter(deadLetterQueue),
  ],
  serverAdapter,
});

// Basic auth for dashboard (production)
app.use('/admin/queues', (req, res, next) => {
  const auth = req.headers.authorization;
  
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required');
  }
  
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64')
    .toString()
    .split(':');
  
  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    next();
  } else {
    res.status(401).send('Invalid credentials');
  }
});

app.use('/admin/queues', serverAdapter.getRouter());

const PORT = process.env.DASHBOARD_PORT || 3001;

app.listen(PORT, () => {
  console.log(`Bull Board dashboard running at http://localhost:${PORT}/admin/queues`);
});

export { app };
```

### 8. Example Handler (Greenhouse)

```typescript
// auto-apply/src/handlers/greenhouse.ts
import { Job } from 'bullmq';
import { chromium, Browser, Page } from 'playwright';
import { ApplicationJobData } from '../queue/applicationQueue';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

export async function applyToGreenhouse(job: Job<ApplicationJobData>) {
  const { data } = job;
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await job.updateProgress(30);
    
    // Navigate to application page
    await page.goto(data.jobUrl, { waitUntil: 'networkidle' });
    
    await job.updateProgress(40);
    
    // Fill in basic info
    await page.fill('#first_name', data.answers?.firstName || '');
    await page.fill('#last_name', data.answers?.lastName || '');
    await page.fill('#email', data.answers?.email || '');
    await page.fill('#phone', data.answers?.phone || '');
    
    await job.updateProgress(60);
    
    // Upload resume
    if (data.resumePath) {
      const resumeInput = await page.$('input[type="file"]');
      await resumeInput?.setInputFiles(data.resumePath);
    }
    
    await job.updateProgress(80);
    
    // Handle custom questions (simplified)
    // In reality, you'd have more sophisticated question handling
    
    // Submit application
    await page.click('button[type="submit"]');
    
    // Wait for confirmation
    await page.waitForSelector('.confirmation', { timeout: 30000 });
    
    await job.updateProgress(90);
    
    // Extract confirmation info
    const confirmationText = await page.textContent('.confirmation');
    const confirmationId = extractConfirmationId(confirmationText);
    
    return {
      success: true,
      confirmationId,
      appliedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Take screenshot for debugging
    const screenshot = await page.screenshot();
    console.error('Application failed, screenshot saved');
    throw error;
  } finally {
    await context.close();
  }
}

function extractConfirmationId(text: string | null): string | undefined {
  if (!text) return undefined;
  const match = text.match(/confirmation[:\s#]*(\w+)/i);
  return match?.[1];
}
```

---

## Alternative: Simpler In-Memory Queue

For development or very low volume, use an in-memory queue:

```typescript
// auto-apply/src/queue/simpleQueue.ts

interface QueueJob<T> {
  id: string;
  data: T;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  error?: string;
}

class SimpleQueue<T> {
  private jobs: QueueJob<T>[] = [];
  private processing = false;
  private handler: ((job: QueueJob<T>) => Promise<void>) | null = null;

  async add(data: T, priority: number = 3): Promise<QueueJob<T>> {
    const job: QueueJob<T> = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      data,
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: new Date(),
    };
    
    // Insert by priority (lower = higher priority)
    const insertIndex = this.jobs.findIndex(j => j.priority > priority);
    if (insertIndex === -1) {
      this.jobs.push(job);
    } else {
      this.jobs.splice(insertIndex, 0, job);
    }
    
    this.processNext();
    return job;
  }

  process(handler: (job: QueueJob<T>) => Promise<void>) {
    this.handler = handler;
    this.processNext();
  }

  private async processNext() {
    if (this.processing || !this.handler) return;
    
    const job = this.jobs.find(j => j.status === 'pending');
    if (!job) return;
    
    this.processing = true;
    job.status = 'processing';
    job.attempts++;
    
    try {
      await this.handler(job);
      job.status = 'completed';
    } catch (error) {
      if (job.attempts >= job.maxAttempts) {
        job.status = 'failed';
        job.error = error.message;
      } else {
        job.status = 'pending'; // Retry
      }
    }
    
    this.processing = false;
    this.processNext();
  }

  getStats() {
    return {
      pending: this.jobs.filter(j => j.status === 'pending').length,
      processing: this.jobs.filter(j => j.status === 'processing').length,
      completed: this.jobs.filter(j => j.status === 'completed').length,
      failed: this.jobs.filter(j => j.status === 'failed').length,
    };
  }

  getJob(id: string) {
    return this.jobs.find(j => j.id === id);
  }

  cancel(id: string): boolean {
    const job = this.jobs.find(j => j.id === id && j.status === 'pending');
    if (job) {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      return true;
    }
    return false;
  }
}

export const simpleQueue = new SimpleQueue();
```

---

## Alternative: Supabase-Based Queue

Uses Supabase tables for persistence (no Redis needed):

```typescript
// auto-apply/src/queue/supabaseQueue.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// First, create the table:
// CREATE TABLE job_queue (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id UUID NOT NULL,
//   job_data JSONB NOT NULL,
//   priority INTEGER DEFAULT 3,
//   status TEXT DEFAULT 'pending',
//   attempts INTEGER DEFAULT 0,
//   max_attempts INTEGER DEFAULT 3,
//   scheduled_for TIMESTAMPTZ DEFAULT NOW(),
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   error TEXT,
//   result JSONB
// );

export async function addToQueue(
  userId: string,
  jobData: any,
  priority: number = 3,
  delayMs?: number
) {
  const scheduledFor = delayMs 
    ? new Date(Date.now() + delayMs).toISOString()
    : new Date().toISOString();

  const { data, error } = await supabase
    .from('job_queue')
    .insert({
      user_id: userId,
      job_data: jobData,
      priority,
      scheduled_for: scheduledFor,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getNextJob() {
  // Atomic: select and lock the next available job
  const { data, error } = await supabase
    .rpc('claim_next_job');
  
  if (error) throw error;
  return data;
}

export async function completeJob(id: string, result: any) {
  const { error } = await supabase
    .from('job_queue')
    .update({
      status: 'completed',
      result,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
}

export async function failJob(id: string, errorMsg: string) {
  // Increment attempts, mark as failed if exhausted
  const { error } = await supabase.rpc('fail_job', {
    job_id: id,
    error_message: errorMsg,
  });

  if (error) throw error;
}

// Poll for jobs (run in a worker process)
export async function startWorker(
  handler: (jobData: any) => Promise<any>,
  pollIntervalMs: number = 5000
) {
  console.log('Starting Supabase queue worker...');
  
  while (true) {
    try {
      const job = await getNextJob();
      
      if (job) {
        console.log(`Processing job ${job.id}`);
        try {
          const result = await handler(job.job_data);
          await completeJob(job.id, result);
        } catch (err) {
          await failJob(job.id, err.message);
        }
      }
    } catch (err) {
      console.error('Worker error:', err);
    }
    
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
}
```

### Supabase Functions for Atomic Operations

```sql
-- Create function to atomically claim the next job
CREATE OR REPLACE FUNCTION claim_next_job()
RETURNS job_queue AS $$
DECLARE
  claimed_job job_queue;
BEGIN
  UPDATE job_queue
  SET status = 'processing',
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = (
    SELECT id FROM job_queue
    WHERE status = 'pending'
      AND scheduled_for <= NOW()
      AND attempts < max_attempts
    ORDER BY priority, created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO claimed_job;
  
  RETURN claimed_job;
END;
$$ LANGUAGE plpgsql;

-- Create function to fail a job
CREATE OR REPLACE FUNCTION fail_job(job_id UUID, error_message TEXT)
RETURNS VOID AS $$
DECLARE
  job_record job_queue;
BEGIN
  SELECT * INTO job_record FROM job_queue WHERE id = job_id;
  
  IF job_record.attempts >= job_record.max_attempts THEN
    UPDATE job_queue
    SET status = 'failed',
        error = error_message,
        updated_at = NOW()
    WHERE id = job_id;
  ELSE
    -- Return to pending for retry (with exponential backoff)
    UPDATE job_queue
    SET status = 'pending',
        error = error_message,
        scheduled_for = NOW() + (POWER(2, attempts) * INTERVAL '1 minute'),
        updated_at = NOW()
    WHERE id = job_id;
  END IF;
END;
$$ LANGUAGE plpgsql;
```

---

## Comparison Summary

| Feature | BullMQ | In-Memory | Supabase Queue |
|---------|--------|-----------|----------------|
| **Persistence** | Redis | None | PostgreSQL |
| **Scaling** | Horizontal | Single process | Limited |
| **Complexity** | Medium | Low | Medium |
| **Cost** | Redis hosting | Free | Already have Supabase |
| **Dashboard** | Bull Board | Custom | Custom |
| **Priority** | Native | Manual | SQL ORDER BY |
| **Rate Limiting** | Built-in | Manual | Manual |
| **Retries** | Built-in | Manual | Manual |

---

## Recommendation for HireRadar

### Phase 1: Start Simple (Supabase Queue)
- No additional infrastructure
- Works with existing Supabase setup
- Good for < 100 jobs/day
- Easy to debug (SQL)

### Phase 2: Scale Up (BullMQ)
- When hitting > 100 jobs/day
- Need real-time progress updates
- Multiple concurrent workers
- Use Upstash Redis (free tier: 10K commands/day)

---

## Environment Variables

```bash
# .env for BullMQ
REDIS_URL=redis://localhost:6379
# Or for Upstash
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# Dashboard auth
ADMIN_USER=admin
ADMIN_PASS=secure-password

# Supabase (already have)
SUPABASE_URL=https://jmrbyubrrpxxvotsljms.supabase.co
SUPABASE_SERVICE_KEY=xxx
```

## Running the Worker

```bash
# Start worker process
npx tsx src/queue/worker.ts

# Start dashboard (separate terminal)
npx tsx src/dashboard/server.ts

# Or with PM2 for production
pm2 start ecosystem.config.js
```

### PM2 Config

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'auto-apply-worker',
      script: 'src/queue/worker.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'auto-apply-dashboard',
      script: 'src/dashboard/server.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      instances: 1,
      autorestart: true,
    },
  ],
};
```
