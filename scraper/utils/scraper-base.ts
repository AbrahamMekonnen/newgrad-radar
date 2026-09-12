import {
  ScraperConfig,
  ScraperResult,
  ScraperError,
  ScraperStats,
  ScraperProgress,
  InterviewQuestion,
  DEFAULT_CONFIG,
} from './types';

export abstract class ScraperBase {
  protected config: ScraperConfig;
  protected stats: ScraperStats;
  protected errors: ScraperError[] = [];
  protected questions: InterviewQuestion[] = [];
  protected progress: ScraperProgress;
  protected abortController: AbortController | null = null;

  private requestTimestamps: number[] = [];
  private hourlyRequestTimestamps: number[] = [];

  constructor(config: Partial<ScraperConfig> & { name: string; platform: ScraperConfig['platform']; baseUrl: string }) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      rateLimit: { ...DEFAULT_CONFIG.rateLimit!, ...config.rateLimit },
      dateFilter: { ...DEFAULT_CONFIG.dateFilter!, ...config.dateFilter },
      retry: { ...DEFAULT_CONFIG.retry!, ...config.retry },
    } as ScraperConfig;

    this.stats = this.initStats();
    this.progress = this.initProgress();
  }

  private initStats(): ScraperStats {
    return {
      startTime: new Date(),
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      questionsFound: 0,
      questionsFiltered: 0,
      rateLimitHits: 0,
      avgResponseTimeMs: 0,
      bytesDownloaded: 0,
    };
  }

  private initProgress(): ScraperProgress {
    return {
      phase: 'initializing',
      currentPage: 0,
      questionsFound: 0,
      lastUpdate: new Date(),
      message: 'Initializing scraper...',
    };
  }

  protected updateProgress(update: Partial<ScraperProgress>): void {
    this.progress = { ...this.progress, ...update, lastUpdate: new Date() };
    this.onProgress?.(this.progress);
  }

  protected onProgress?: (progress: ScraperProgress) => void;

  public setProgressCallback(callback: (progress: ScraperProgress) => void): void {
    this.onProgress = callback;
  }

  protected async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    this.hourlyRequestTimestamps = this.hourlyRequestTimestamps.filter(t => t > oneHourAgo);

    if (this.requestTimestamps.length >= this.config.rateLimit.requestsPerMinute) {
      const waitTime = this.requestTimestamps[0] - oneMinuteAgo + 100;
      this.stats.rateLimitHits++;
      this.updateProgress({ message: `Rate limited (minute), waiting ${Math.round(waitTime / 1000)}s...` });
      await this.sleep(waitTime);
    }

    if (this.hourlyRequestTimestamps.length >= this.config.rateLimit.requestsPerHour) {
      const waitTime = this.hourlyRequestTimestamps[0] - oneHourAgo + 100;
      this.stats.rateLimitHits++;
      this.updateProgress({ message: `Rate limited (hour), waiting ${Math.round(waitTime / 1000)}s...` });
      await this.sleep(waitTime);
    }

    const randomDelay = this.config.rateLimit.minDelayMs +
      Math.random() * (this.config.rateLimit.maxDelayMs - this.config.rateLimit.minDelayMs);
    await this.sleep(randomDelay);

    this.requestTimestamps.push(Date.now());
    this.hourlyRequestTimestamps.push(Date.now());
  }

  protected async fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
    let lastError: Error | null = null;
    const { maxRetries, baseDelayMs, maxDelayMs, backoffMultiplier } = this.config.retry;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.waitForRateLimit();

        const startTime = Date.now();
        const response = await fetch(url, {
          ...options,
          headers: {
            'User-Agent': this.config.userAgent || DEFAULT_CONFIG.userAgent!,
            ...this.config.headers,
            ...options.headers,
          },
          signal: this.abortController?.signal,
        });

        const responseTime = Date.now() - startTime;
        this.updateAvgResponseTime(responseTime);
        this.stats.totalRequests++;

        if (response.status === 429) {
          this.stats.rateLimitHits++;
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10) * 1000;
          this.updateProgress({ message: `Rate limited (429), waiting ${retryAfter / 1000}s...` });
          await this.sleep(retryAfter);
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        this.stats.successfulRequests++;
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.abortController?.signal.aborted) {
          throw new Error('Scraper aborted');
        }

        if (attempt < maxRetries) {
          const delay = Math.min(baseDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs);
          this.updateProgress({ message: `Request failed, retry ${attempt + 1}/${maxRetries} in ${delay / 1000}s...` });
          await this.sleep(delay);
        }
      }
    }

    this.stats.failedRequests++;
    this.addError({
      code: 'FETCH_FAILED',
      message: lastError?.message || 'Unknown fetch error',
      url,
      retryable: false,
    });

    throw lastError;
  }

  private updateAvgResponseTime(newTime: number): void {
    const total = this.stats.avgResponseTimeMs * (this.stats.totalRequests || 1);
    this.stats.avgResponseTimeMs = (total + newTime) / (this.stats.totalRequests + 1);
  }

  protected addError(error: Omit<ScraperError, 'timestamp'>): void {
    this.errors.push({ ...error, timestamp: new Date() });
  }

  protected isWithinDateRange(date: Date | null): boolean {
    if (!date) return false;

    const { monthsBack, startDate, endDate } = this.config.dateFilter;
    const now = new Date();

    const effectiveStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - monthsBack, now.getDate());
    const effectiveEndDate = endDate || now;

    return date >= effectiveStartDate && date <= effectiveEndDate;
  }

  protected filterByDate(questions: InterviewQuestion[]): InterviewQuestion[] {
    const beforeCount = questions.length;
    const filtered = questions.filter(q => {
      const dateToCheck = q.interviewDate || q.postedDate;
      return this.isWithinDateRange(dateToCheck);
    });
    this.stats.questionsFiltered += beforeCount - filtered.length;
    return filtered;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public abort(): void {
    this.abortController?.abort();
    this.updateProgress({ phase: 'error', message: 'Scraper aborted by user' });
  }

  protected abstract scrape(): Promise<void>;

  public async run(): Promise<ScraperResult> {
    this.abortController = new AbortController();
    this.stats = this.initStats();
    this.errors = [];
    this.questions = [];

    try {
      this.updateProgress({ phase: 'fetching', message: 'Starting scrape...' });
      await this.scrape();
      this.updateProgress({ phase: 'complete', message: `Complete. Found ${this.questions.length} questions.` });
    } catch (error) {
      this.updateProgress({
        phase: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      this.addError({
        code: 'SCRAPE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: true,
      });
    }

    this.stats.endTime = new Date();
    this.stats.questionsFound = this.questions.length;

    return {
      success: this.errors.length === 0,
      questions: this.questions,
      errors: this.errors,
      stats: this.stats,
      hasMore: false,
    };
  }

  protected generateId(question: Partial<InterviewQuestion>): string {
    const parts = [
      this.config.platform,
      question.companyNormalized || question.companyName || 'unknown',
      question.roleNormalized || question.role || 'unknown',
      question.questionText?.slice(0, 50) || '',
      question.sourceUrl || '',
    ];
    const str = parts.join('|').toLowerCase();
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${this.config.platform}_${Math.abs(hash).toString(36)}`;
  }

  public getStats(): ScraperStats {
    return { ...this.stats };
  }

  public getProgress(): ScraperProgress {
    return { ...this.progress };
  }
}
