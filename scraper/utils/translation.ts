import { TranslationResult } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

type TranslationProvider = 'google' | 'deepl' | 'azure' | 'gemini' | 'local';

interface TranslationConfig {
  provider: TranslationProvider;
  apiKey?: string;
  geminiApiKey?: string;
  deeplApiKey?: string;
  googleApiKey?: string;
  azureApiKey?: string;
  endpoint?: string;
  fallbackProviders?: TranslationProvider[];
  cacheEnabled?: boolean;
  cachePath?: string;
  maxCacheSize?: number;
  batchSize?: number;
  preserveCodeBlocks?: boolean;
  preserveTechnicalTerms?: boolean;
}

interface CacheEntry {
  result: TranslationResult;
  timestamp: number;
  hits: number;
}

interface BatchJob {
  id: string;
  texts: string[];
  sourceLang: string;
  targetLang: string;
  results: Map<number, TranslationResult>;
}

// ============================================================================
// TECHNICAL TERM PRESERVER
// ============================================================================

const CODE_BLOCK_PLACEHOLDER = '___CODE_BLOCK_{index}___';
const TERM_PLACEHOLDER = '___TECH_TERM_{index}___';

const TECHNICAL_TERMS = new Set([
  // Companies (don't translate these)
  'Google', 'Meta', 'Facebook', 'Amazon', 'Apple', 'Microsoft', 'Netflix',
  'Uber', 'Lyft', 'Airbnb', 'Stripe', 'Coinbase', 'Robinhood', 'Palantir',
  'ByteDance', 'TikTok', 'Alibaba', 'Tencent', 'Baidu', 'JD', 'Meituan',
  'Kakao', 'Naver', 'LINE', 'Samsung', 'LG', 'Coupang',
  'Jane Street', 'Citadel', 'Two Sigma', 'HRT', 'Jump Trading', 'DE Shaw',
  'Goldman Sachs', 'Morgan Stanley', 'JPMorgan', 'Blackrock',
  'Shopify', 'Slack', 'Dropbox', 'Twilio', 'Datadog', 'Snowflake',
  'OpenAI', 'Anthropic', 'DeepMind', 'Nvidia', 'AMD', 'Intel',
  // Tech terms that shouldn't be translated
  'LeetCode', 'HackerRank', 'CodeSignal', 'TopCoder', 'Codeforces',
  'GitHub', 'GitLab', 'Bitbucket', 'npm', 'yarn', 'pip', 'Docker', 'Kubernetes',
  'AWS', 'GCP', 'Azure', 'S3', 'EC2', 'Lambda', 'BigQuery', 'Redshift',
  'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'Spring',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Kafka', 'RabbitMQ',
  'REST', 'GraphQL', 'gRPC', 'WebSocket', 'OAuth', 'JWT', 'SSL', 'TLS',
  'CI/CD', 'DevOps', 'Agile', 'Scrum', 'JIRA', 'Confluence',
  'API', 'SDK', 'CLI', 'GUI', 'UI', 'UX', 'SRE', 'SWE', 'PM', 'TPM',
  'DSA', 'OA', 'LC', 'DP', 'BFS', 'DFS', 'DFS', 'BST', 'AVL', 'TRIE',
  'O(n)', 'O(log n)', 'O(n^2)', 'O(1)', 'O(n log n)',
  'Big-O', 'HashMap', 'HashSet', 'TreeMap', 'LinkedList', 'ArrayList',
  'Stack', 'Queue', 'Heap', 'PriorityQueue', 'Deque',
]);

class TechnicalTermPreserver {
  private codeBlocks: string[] = [];
  private technicalTerms: string[] = [];
  private codeBlockRegex = /```[\s\S]*?```|`[^`]+`/g;
  private customTerms: Set<string>;

  constructor(additionalTerms: string[] = []) {
    this.customTerms = new Set(Array.from(TECHNICAL_TERMS).concat(additionalTerms));
  }

  preserve(text: string): string {
    this.codeBlocks = [];
    this.technicalTerms = [];

    let result = text;

    // Extract code blocks first
    result = result.replace(this.codeBlockRegex, (match) => {
      const index = this.codeBlocks.length;
      this.codeBlocks.push(match);
      return CODE_BLOCK_PLACEHOLDER.replace('{index}', String(index));
    });

    // Extract technical terms (case-insensitive matching, preserve original case)
    Array.from(this.customTerms).forEach(term => {
      const regex = new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'gi');
      result = result.replace(regex, (match) => {
        const index = this.technicalTerms.length;
        this.technicalTerms.push(match);
        return TERM_PLACEHOLDER.replace('{index}', String(index));
      });
    });

    return result;
  }

  restore(text: string): string {
    let result = text;

    // Restore technical terms first
    for (let i = 0; i < this.technicalTerms.length; i++) {
      const placeholder = TERM_PLACEHOLDER.replace('{index}', String(i));
      result = result.replace(placeholder, this.technicalTerms[i]);
    }

    // Restore code blocks
    for (let i = 0; i < this.codeBlocks.length; i++) {
      const placeholder = CODE_BLOCK_PLACEHOLDER.replace('{index}', String(i));
      result = result.replace(placeholder, this.codeBlocks[i]);
    }

    return result;
  }

  getPreservedTerms(): string[] {
    return [...this.technicalTerms, ...this.codeBlocks];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ============================================================================
// PERSISTENT TRANSLATION CACHE
// ============================================================================

class TranslationCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private cachePath: string;
  private dirty: boolean = false;
  private saveInterval: NodeJS.Timeout | null = null;

  constructor(cachePath: string = '.translation_cache.json', maxSize: number = 50000) {
    this.cachePath = cachePath;
    this.maxSize = maxSize;
    this.loadFromDisk();

    // Auto-save every 60 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.saveToDisk();
      }
    }, 60000);
  }

  private getCacheKey(text: string, sourceLang: string, targetLang: string): string {
    const hash = crypto.createHash('sha256')
      .update(`${sourceLang}:${targetLang}:${text}`)
      .digest('hex');
    return hash;
  }

  get(text: string, sourceLang: string, targetLang: string): TranslationResult | null {
    const key = this.getCacheKey(text, sourceLang, targetLang);
    const entry = this.cache.get(key);

    if (entry) {
      entry.hits++;
      this.dirty = true;
      return { ...entry.result, cached: true };
    }

    return null;
  }

  set(text: string, sourceLang: string, targetLang: string, result: TranslationResult): void {
    const key = this.getCacheKey(text, sourceLang, targetLang);

    // Evict LRU entries if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU(Math.floor(this.maxSize * 0.1));
    }

    this.cache.set(key, {
      result: { ...result, cached: false },
      timestamp: Date.now(),
      hits: 0,
    });
    this.dirty = true;
  }

  private evictLRU(count: number): void {
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => {
        // Sort by hits (ascending), then by timestamp (ascending)
        if (a[1].hits !== b[1].hits) {
          return a[1].hits - b[1].hits;
        }
        return a[1].timestamp - b[1].timestamp;
      });

    for (let i = 0; i < count && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = fs.readFileSync(this.cachePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.cache = new Map(Object.entries(parsed));
      }
    } catch (error) {
      console.warn('Failed to load translation cache:', error);
    }
  }

  saveToDisk(): void {
    try {
      const data: Record<string, CacheEntry> = {};
      this.cache.forEach((value, key) => {
        data[key] = value;
      });
      fs.writeFileSync(this.cachePath, JSON.stringify(data), 'utf-8');
      this.dirty = false;
    } catch (error) {
      console.warn('Failed to save translation cache:', error);
    }
  }

  clear(): void {
    this.cache.clear();
    this.dirty = true;
    this.saveToDisk();
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    let totalHits = 0;
    this.cache.forEach((entry) => {
      totalHits += entry.hits;
    });
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }

  destroy(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    if (this.dirty) {
      this.saveToDisk();
    }
  }
}

// ============================================================================
// QUALITY SCORER
// ============================================================================

class QualityScorer {
  scoreTranslation(original: string, translated: string, sourceLang: string): number {
    let score = 0.5; // Base score

    // Check if translation is not empty
    if (!translated || translated.trim().length === 0) {
      return 0;
    }

    // Check if translation is different from original (unless already in target lang)
    if (translated === original && sourceLang !== 'en') {
      return 0.1; // Likely failed translation
    }

    // Length ratio check (translations shouldn't be too short or too long)
    const lengthRatio = translated.length / original.length;
    if (lengthRatio >= 0.3 && lengthRatio <= 3.0) {
      score += 0.2;
    } else if (lengthRatio < 0.1 || lengthRatio > 5.0) {
      score -= 0.2;
    }

    // Check for preserved code blocks and technical terms
    const codeBlockCount = (original.match(/```[\s\S]*?```|`[^`]+`/g) || []).length;
    const translatedCodeCount = (translated.match(/```[\s\S]*?```|`[^`]+`/g) || []).length;
    if (codeBlockCount > 0 && codeBlockCount === translatedCodeCount) {
      score += 0.15;
    }

    // Check for preserved numbers
    const originalNumbers: string[] = original.match(/\d+/g) || [];
    const translatedNumbers: string[] = translated.match(/\d+/g) || [];
    const numberPreserved = originalNumbers.every((n: string) => translatedNumbers.indexOf(n) >= 0);
    if (numberPreserved && originalNumbers.length > 0) {
      score += 0.1;
    }

    // Check for common translation artifacts (bad signs)
    const artifacts = ['[UNK]', '???', '{{', '}}', 'undefined', 'null'];
    for (const artifact of artifacts) {
      if (translated.includes(artifact)) {
        score -= 0.15;
      }
    }

    // CJK specific: check for incomplete character sequences
    if (['zh', 'ja', 'ko'].includes(sourceLang)) {
      // Check if translated text has proper sentence structure
      if (translated.endsWith('。') || translated.endsWith('.') || translated.endsWith('?')) {
        score += 0.05;
      }
    }

    return Math.max(0, Math.min(1, score));
  }
}

// ============================================================================
// BATCH TRANSLATOR
// ============================================================================

class BatchTranslator {
  private config: TranslationConfig;
  private cache: TranslationCache;
  private termPreserver: TechnicalTermPreserver;
  private qualityScorer: QualityScorer;
  private batchQueue: Map<string, BatchJob> = new Map();
  private batchSize: number;

  constructor(config: TranslationConfig) {
    this.config = {
      preserveCodeBlocks: true,
      preserveTechnicalTerms: true,
      cacheEnabled: true,
      batchSize: 50,
      fallbackProviders: ['gemini', 'deepl', 'local'],
      ...config,
    };
    this.cache = new TranslationCache(
      config.cachePath || '.translation_cache.json',
      config.maxCacheSize || 50000
    );
    this.termPreserver = new TechnicalTermPreserver();
    this.qualityScorer = new QualityScorer();
    this.batchSize = config.batchSize || 50;
  }

  async translateBatch(
    texts: string[],
    targetLang: string = 'en'
  ): Promise<TranslationResult[]> {
    const results: TranslationResult[] = new Array(texts.length);
    const toTranslate: { index: number; text: string; sourceLang: string; preserved: string }[] = [];

    // First pass: check cache and detect languages
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const sourceLang = detectLanguage(text);

      // Skip if already in target language or unknown
      if (sourceLang === targetLang || sourceLang === 'unknown') {
        results[i] = {
          originalText: text,
          translatedText: text,
          sourceLanguage: sourceLang,
          targetLanguage: targetLang,
          confidence: 1,
          provider: 'local',
          qualityScore: 1,
        };
        continue;
      }

      // Check cache
      const cached = this.cache.get(text, sourceLang, targetLang);
      if (cached) {
        results[i] = cached;
        continue;
      }

      // Preserve technical terms and code blocks
      let preserved = text;
      if (this.config.preserveCodeBlocks || this.config.preserveTechnicalTerms) {
        preserved = this.termPreserver.preserve(text);
      }

      toTranslate.push({ index: i, text, sourceLang, preserved });
    }

    // Group by source language for efficient batching
    const byLanguage: Record<string, typeof toTranslate> = {};
    for (const item of toTranslate) {
      if (!byLanguage[item.sourceLang]) {
        byLanguage[item.sourceLang] = [];
      }
      byLanguage[item.sourceLang].push(item);
    }

    // Translate each language group
    for (const sourceLang of Object.keys(byLanguage)) {
      await this.translateLanguageGroup(byLanguage[sourceLang], sourceLang, targetLang, results);
    }

    return results;
  }

  private async translateLanguageGroup(
    items: { index: number; text: string; sourceLang: string; preserved: string }[],
    sourceLang: string,
    targetLang: string,
    results: TranslationResult[]
  ): Promise<void> {
    // Process in batches
    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      const batchTexts = batch.map(item => item.preserved);

      const providers: TranslationProvider[] = [
        this.config.provider,
        ...(this.config.fallbackProviders || []),
      ];

      let batchResults: TranslationResult[] | null = null;

      for (const provider of providers) {
        try {
          batchResults = await this.translateWithProvider(
            batchTexts,
            sourceLang,
            targetLang,
            provider
          );
          break;
        } catch (error) {
          console.warn(`Batch translation with ${provider} failed:`, error);
        }
      }

      // Process results
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        let result: TranslationResult;

        if (batchResults && batchResults[j]) {
          result = batchResults[j];
          result.originalText = item.text;

          // Restore preserved terms
          if (this.config.preserveCodeBlocks || this.config.preserveTechnicalTerms) {
            result.translatedText = this.termPreserver.restore(result.translatedText);
            result.preservedTerms = this.termPreserver.getPreservedTerms();
          }

          // Score quality
          result.qualityScore = this.qualityScorer.scoreTranslation(
            item.text,
            result.translatedText,
            sourceLang
          );
        } else {
          // Fallback to local dictionary
          result = localTranslate(item.text, sourceLang, targetLang) || {
            originalText: item.text,
            translatedText: item.text,
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            confidence: 0,
            provider: 'local',
            qualityScore: 0,
          };
        }

        // Cache result
        if (this.config.cacheEnabled) {
          this.cache.set(item.text, sourceLang, targetLang, result);
        }

        results[item.index] = result;
      }
    }
  }

  private async translateWithProvider(
    texts: string[],
    sourceLang: string,
    targetLang: string,
    provider: TranslationProvider
  ): Promise<TranslationResult[]> {
    switch (provider) {
      case 'google':
        return this.translateWithGoogleBatch(texts, sourceLang, targetLang);
      case 'deepl':
        return this.translateWithDeepLBatch(texts, sourceLang, targetLang);
      case 'gemini':
        return this.translateWithGeminiBatch(texts, sourceLang, targetLang);
      case 'azure':
        return this.translateWithAzureBatch(texts, sourceLang, targetLang);
      case 'local':
        return texts.map(text =>
          localTranslate(text, sourceLang, targetLang) || {
            originalText: text,
            translatedText: text,
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            confidence: 0,
            provider: 'local',
          }
        );
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  private async translateWithGoogleBatch(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): Promise<TranslationResult[]> {
    const apiKey = this.config.googleApiKey || this.config.apiKey;
    if (!apiKey) throw new Error('Google Translate API key not provided');

    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: texts,
        source: sourceLang === 'zh' ? 'zh-CN' : sourceLang,
        target: targetLang,
        format: 'text',
      }),
    });

    if (!response.ok) {
      throw new Error(`Google Translate API error: ${response.status}`);
    }

    const data = await response.json();
    const translations = data.data?.translations || [];

    return texts.map((text, i) => ({
      originalText: text,
      translatedText: translations[i]?.translatedText || text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      confidence: 0.9,
      provider: 'google' as const,
    }));
  }

  private async translateWithDeepLBatch(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): Promise<TranslationResult[]> {
    const apiKey = this.config.deeplApiKey || this.config.apiKey;
    if (!apiKey) throw new Error('DeepL API key not provided');

    const langMap: Record<string, string> = {
      'zh': 'ZH', 'ja': 'JA', 'ko': 'KO', 'en': 'EN-US', 'ru': 'RU',
      'de': 'DE', 'fr': 'FR', 'es': 'ES', 'pt': 'PT-BR', 'it': 'IT',
    };

    const url = apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: texts,
        source_lang: langMap[sourceLang] || sourceLang.toUpperCase(),
        target_lang: langMap[targetLang] || targetLang.toUpperCase(),
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepL API error: ${response.status}`);
    }

    const data = await response.json();
    const translations = data.translations || [];

    return texts.map((text, i) => ({
      originalText: text,
      translatedText: translations[i]?.text || text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      confidence: 0.95,
      provider: 'deepl' as const,
    }));
  }

  private async translateWithGeminiBatch(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): Promise<TranslationResult[]> {
    const apiKey = this.config.geminiApiKey || this.config.apiKey;
    if (!apiKey) throw new Error('Gemini API key not provided');

    const langNames: Record<string, string> = {
      'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean', 'en': 'English',
      'ru': 'Russian', 'de': 'German', 'fr': 'French', 'es': 'Spanish',
      'pt': 'Portuguese', 'vi': 'Vietnamese', 'th': 'Thai', 'ar': 'Arabic',
      'hi': 'Hindi', 'id': 'Indonesian',
    };

    const sourceName = langNames[sourceLang] || sourceLang;
    const targetName = langNames[targetLang] || targetLang;

    // Format texts as numbered list for batch processing
    const numberedTexts = texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n');

    const prompt = `Translate the following ${sourceName} texts to ${targetName}.
Preserve the numbering format exactly. Preserve any code blocks, technical terms, company names, and numbers exactly as they appear.
Only provide the translations, no explanations.

${numberedTexts}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse numbered responses
    const translations = this.parseNumberedTranslations(resultText, texts.length);

    return texts.map((text, i) => ({
      originalText: text,
      translatedText: translations[i] || text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      confidence: 0.85,
      provider: 'gemini' as const,
    }));
  }

  private parseNumberedTranslations(text: string, expectedCount: number): string[] {
    const results: string[] = new Array(expectedCount).fill('');
    const lines = text.split('\n');
    let currentIndex = -1;
    let currentText = '';

    for (const line of lines) {
      const match = line.match(/^\[(\d+)\]\s*(.*)/);
      if (match) {
        if (currentIndex >= 0 && currentIndex < expectedCount) {
          results[currentIndex] = currentText.trim();
        }
        currentIndex = parseInt(match[1], 10) - 1;
        currentText = match[2];
      } else if (currentIndex >= 0) {
        currentText += '\n' + line;
      }
    }

    if (currentIndex >= 0 && currentIndex < expectedCount) {
      results[currentIndex] = currentText.trim();
    }

    return results;
  }

  private async translateWithAzureBatch(
    texts: string[],
    sourceLang: string,
    targetLang: string
  ): Promise<TranslationResult[]> {
    const apiKey = this.config.azureApiKey || this.config.apiKey;
    const endpoint = this.config.endpoint;
    if (!apiKey || !endpoint) throw new Error('Azure Translator API key and endpoint required');

    const url = `${endpoint}/translate?api-version=3.0&from=${sourceLang}&to=${targetLang}`;

    const body = texts.map(text => ({ text }));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Azure Translator API error: ${response.status}`);
    }

    const data = await response.json();

    return texts.map((text, i) => ({
      originalText: text,
      translatedText: data[i]?.translations?.[0]?.text || text,
      sourceLanguage: sourceLang,
      targetLanguage: targetLang,
      confidence: 0.9,
      provider: 'azure' as const,
    }));
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  saveCache() {
    this.cache.saveToDisk();
  }

  clearCache() {
    this.cache.clear();
  }

  destroy() {
    this.cache.destroy();
  }
}

// ============================================================================
// LANGUAGE DETECTION
// ============================================================================

const LANGUAGE_DETECTION_PATTERNS: { lang: string; patterns: RegExp[]; weight: number }[] = [
  { lang: 'zh', patterns: [/[一-鿿]/, /[㐀-䶿]/], weight: 1.5 },
  { lang: 'ja', patterns: [/[぀-ゟ]/, /[゠-ヿ]/], weight: 2 },
  { lang: 'ko', patterns: [/[가-힯]/, /[ᄀ-ᇿ]/], weight: 2 },
  { lang: 'ru', patterns: [/[Ѐ-ӿ]/], weight: 1.5 },
  { lang: 'ar', patterns: [/[؀-ۿ]/], weight: 1.5 },
  { lang: 'hi', patterns: [/[ऀ-ॿ]/], weight: 1.5 },
  { lang: 'th', patterns: [/[฀-๿]/], weight: 1.5 },
  { lang: 'vi', patterns: [/[Ḁ-ỿ]/], weight: 1 },
  { lang: 'de', patterns: [/[äöüß]/i], weight: 0.5 },
  { lang: 'fr', patterns: [/[àâçéèêëîïôùûü]/i], weight: 0.5 },
  { lang: 'es', patterns: [/[áéíóúñ¿¡]/i], weight: 0.5 },
  { lang: 'pt', patterns: [/[ãõç]/i], weight: 0.5 },
];

export function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return 'unknown';

  const scores: Record<string, number> = {};

  for (const { lang, patterns, weight } of LANGUAGE_DETECTION_PATTERNS) {
    let matchCount = 0;
    for (const pattern of patterns) {
      const matches = text.match(new RegExp(pattern.source, 'g'));
      if (matches) {
        matchCount += matches.length;
      }
    }
    if (matchCount > 0) {
      scores[lang] = (scores[lang] || 0) + matchCount * weight;
    }
  }

  // Find highest scoring language
  let maxLang = 'en';
  let maxScore = 0;

  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxLang = lang;
    }
  }

  // Require minimum threshold for non-English
  if (maxScore < 3 && /^[\x00-\x7f]*$/.test(text)) {
    return 'en';
  }

  return maxScore > 0 ? maxLang : 'en';
}

export function needsTranslation(text: string, targetLang: string = 'en'): boolean {
  const sourceLang = detectLanguage(text);
  return sourceLang !== targetLang && sourceLang !== 'unknown';
}

// ============================================================================
// LOCAL DICTIONARY TRANSLATIONS
// ============================================================================

const COMMON_TRANSLATIONS: Record<string, Record<string, string>> = {
  'zh:en': {
    '面试': 'interview', '面经': 'interview experience', '题目': 'question',
    '算法': 'algorithm', '编程': 'programming', '代码': 'code',
    '公司': 'company', '谷歌': 'Google', '亚马逊': 'Amazon',
    '微软': 'Microsoft', '苹果': 'Apple', '脸书': 'Facebook',
    '字节跳动': 'ByteDance', '阿里巴巴': 'Alibaba', '腾讯': 'Tencent',
    '软件工程师': 'Software Engineer', '实习': 'Internship',
    '校招': 'Campus Recruiting', '秋招': 'Fall Recruiting',
    '春招': 'Spring Recruiting', '简历': 'Resume', '薪资': 'Salary',
    '福利': 'Benefits', '难度': 'Difficulty', '简单': 'Easy',
    '中等': 'Medium', '困难': 'Hard', '笔试': 'Written Test',
    '在线测试': 'Online Assessment', '系统设计': 'System Design',
    '行为面试': 'Behavioral Interview', '技术面试': 'Technical Interview',
    '动态规划': 'Dynamic Programming', '二分查找': 'Binary Search',
    '链表': 'Linked List', '二叉树': 'Binary Tree', '图': 'Graph',
    '哈希表': 'Hash Table', '栈': 'Stack', '队列': 'Queue', '堆': 'Heap',
  },
  'ko:en': {
    '면접': 'interview', '코딩테스트': 'coding test', '알고리즘': 'algorithm',
    '회사': 'company', '개발자': 'developer', '인턴': 'intern',
    '신입': 'new grad', '경력': 'experienced', '채용': 'hiring',
    '합격': 'pass', '불합격': 'fail', '연봉': 'salary',
    '카카오': 'Kakao', '네이버': 'Naver', '삼성': 'Samsung',
    '쿠팡': 'Coupang', '라인': 'LINE', '배달의민족': 'Woowa Brothers',
  },
  'ja:en': {
    '面接': 'interview', 'コーディング': 'coding', 'アルゴリズム': 'algorithm',
    '会社': 'company', 'エンジニア': 'engineer', 'インターン': 'intern',
    '新卒': 'new grad', '転職': 'career change', '採用': 'hiring',
    '合格': 'pass', '不合格': 'fail', '年収': 'annual salary',
    'システム設計': 'system design', '技術面接': 'technical interview',
  },
  'ru:en': {
    'собеседование': 'interview', 'алгоритм': 'algorithm', 'программирование': 'programming',
    'компания': 'company', 'разработчик': 'developer', 'стажер': 'intern',
    'зарплата': 'salary', 'релокация': 'relocation', 'удаленка': 'remote work',
    'вакансия': 'job opening', 'резюме': 'resume', 'код': 'code',
  },
};

function localTranslate(text: string, sourceLang: string, targetLang: string): TranslationResult | null {
  const dictKey = `${sourceLang}:${targetLang}`;
  const dict = COMMON_TRANSLATIONS[dictKey];

  if (!dict) return null;

  let translatedText = text;
  let matchCount = 0;

  // Sort by length (longest first) to avoid partial matches
  const sortedEntries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);

  for (const [source, target] of sortedEntries) {
    if (translatedText.includes(source)) {
      translatedText = translatedText.replace(new RegExp(source, 'g'), target);
      matchCount++;
    }
  }

  if (matchCount === 0) return null;

  return {
    originalText: text,
    translatedText,
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
    confidence: Math.min(0.3 + matchCount * 0.1, 0.7),
    provider: 'local',
  };
}

// ============================================================================
// SIMPLE API (BACKWARDS COMPATIBLE)
// ============================================================================

let defaultTranslator: BatchTranslator | null = null;

function getDefaultTranslator(): BatchTranslator {
  if (!defaultTranslator) {
    defaultTranslator = new BatchTranslator({
      provider: 'local',
      fallbackProviders: ['gemini', 'deepl', 'google', 'local'],
      geminiApiKey: process.env.GEMINI_API_KEY,
      deeplApiKey: process.env.DEEPL_API_KEY,
      googleApiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
      cacheEnabled: true,
      preserveCodeBlocks: true,
      preserveTechnicalTerms: true,
    });
  }
  return defaultTranslator;
}

export async function translate(
  text: string,
  targetLang: string = 'en',
  config?: TranslationConfig
): Promise<TranslationResult> {
  if (config) {
    const translator = new BatchTranslator(config);
    const results = await translator.translateBatch([text], targetLang);
    return results[0];
  }
  const results = await getDefaultTranslator().translateBatch([text], targetLang);
  return results[0];
}

export async function translateBatch(
  texts: string[],
  targetLang: string = 'en',
  config?: TranslationConfig
): Promise<TranslationResult[]> {
  if (config) {
    const translator = new BatchTranslator(config);
    return translator.translateBatch(texts, targetLang);
  }
  return getDefaultTranslator().translateBatch(texts, targetLang);
}

export function clearTranslationCache(): void {
  getDefaultTranslator().clearCache();
}

export function getTranslationCacheStats(): { size: number; maxSize: number; hitRate: number } {
  return getDefaultTranslator().getCacheStats();
}

export function saveTranslationCache(): void {
  getDefaultTranslator().saveCache();
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  BatchTranslator,
  TranslationCache,
  QualityScorer,
  TechnicalTermPreserver,
  TranslationConfig,
  TranslationProvider,
  localTranslate,
};
