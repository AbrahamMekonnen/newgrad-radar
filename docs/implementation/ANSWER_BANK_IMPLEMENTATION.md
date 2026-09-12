# Answer Bank Implementation Guide

A comprehensive guide for implementing question classification and cached answer matching for the auto-apply system.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Question Classification](#2-question-classification)
3. [Answer Matching Algorithms](#3-answer-matching-algorithms)
4. [Code Implementation](#4-code-implementation)
5. [LLM Fallback Strategy](#5-llm-fallback-strategy)
6. [Performance Optimization](#6-performance-optimization)
7. [Database Schema](#7-database-schema)
8. [Integration Guide](#8-integration-guide)

---

## 1. Overview

### The Problem

Job applications contain many repetitive questions:
- "Tell us about a challenging project"
- "Why are you interested in this role?"
- "Describe a time you worked in a team"

Without caching, each question requires an LLM call, which is:
- **Slow**: 1-3 seconds per generation
- **Expensive**: Token costs add up across hundreds of applications
- **Inconsistent**: Different answers for the same question type

### The Solution

Build an answer bank system that:
1. **Classifies questions** into known categories
2. **Matches cached answers** when confidence is high
3. **Falls back to LLM** when question is novel or confidence is low
4. **Learns from usage** to improve matching over time

### Expected Performance

| Scenario | Without Answer Bank | With Answer Bank | Improvement |
|----------|---------------------|------------------|-------------|
| Known question | 1-3s (LLM call) | 5-10ms (cache hit) | 99% faster |
| Similar question | 1-3s (LLM call) | 50-100ms (similarity search) | 95% faster |
| Novel question | 1-3s (LLM call) | 1-3s (LLM fallback) | No change |
| Batch of 50 apps | ~150s total | ~15s total | 90% faster |

---

## 2. Question Classification

### 2.1 Classification Hierarchy

Questions fall into a taxonomy that maps to story types:

```
Question Types
├── Behavioral
│   ├── project           -> "Describe a challenging project"
│   ├── teamwork          -> "Tell us about team experience"
│   ├── conflict          -> "How do you handle disagreements?"
│   ├── leadership        -> "Describe a time you led"
│   ├── failure           -> "Tell us about a mistake"
│   ├── achievement       -> "What's your proudest accomplishment?"
│   └── problem_solving   -> "How do you approach problems?"
├── Motivation
│   ├── why_company       -> "Why do you want to work here?"
│   ├── why_role          -> "Why are you interested in this role?"
│   ├── career_goals      -> "What are your career goals?"
│   └── passion           -> "What drives you in your work?"
├── Technical
│   ├── tech_stack        -> "What technologies are you proficient in?"
│   ├── learning          -> "How do you learn new technologies?"
│   └── debugging         -> "Describe your debugging process"
├── Logistics
│   ├── availability      -> "When can you start?"
│   ├── work_auth         -> "Are you authorized to work?"
│   ├── relocation        -> "Are you willing to relocate?"
│   └── salary            -> "What are your salary expectations?"
└── Freeform
    ├── additional_info   -> "Anything else you'd like to share?"
    └── questions         -> "Questions for us?"
```

### 2.2 Rule-Based Classification (Fast, Primary)

Pattern matching using regex and keyword detection:

```typescript
// question-classifier.ts

interface QuestionPattern {
  type: string;
  patterns: RegExp[];
  keywords: string[];
  weight: number;  // 1-10 importance
}

const questionPatterns: QuestionPattern[] = [
  {
    type: 'project',
    patterns: [
      /challenging.*project/i,
      /difficult.*project/i,
      /complex.*project/i,
      /describe.*project/i,
      /tell.*about.*project/i,
      /proud.*project/i,
      /recent.*project/i,
      /significant.*project/i,
    ],
    keywords: ['project', 'built', 'developed', 'created', 'implemented'],
    weight: 8,
  },
  {
    type: 'teamwork',
    patterns: [
      /work.*team/i,
      /team.*experience/i,
      /collaborate/i,
      /group.*project/i,
      /cross-functional/i,
      /worked.*others/i,
    ],
    keywords: ['team', 'collaborate', 'together', 'group', 'colleagues'],
    weight: 7,
  },
  {
    type: 'conflict',
    patterns: [
      /conflict/i,
      /disagree/i,
      /difficult.*colleague/i,
      /handle.*disagreement/i,
      /resolve.*conflict/i,
      /challenging.*relationship/i,
    ],
    keywords: ['conflict', 'disagree', 'difficult', 'resolve', 'tension'],
    weight: 9,
  },
  {
    type: 'leadership',
    patterns: [
      /lead/i,
      /leadership/i,
      /mentor/i,
      /manage/i,
      /influence/i,
      /initiative/i,
      /took charge/i,
    ],
    keywords: ['lead', 'leader', 'mentor', 'manage', 'guide', 'direct'],
    weight: 7,
  },
  {
    type: 'failure',
    patterns: [
      /fail/i,
      /mistake/i,
      /didn.*work/i,
      /wrong/i,
      /learn.*from/i,
      /setback/i,
      /overcome.*obstacle/i,
    ],
    keywords: ['fail', 'mistake', 'wrong', 'learned', 'setback', 'obstacle'],
    weight: 9,
  },
  {
    type: 'achievement',
    patterns: [
      /accomplishment/i,
      /achievement/i,
      /proud.*of/i,
      /success/i,
      /impact/i,
      /contribution/i,
    ],
    keywords: ['accomplish', 'achieve', 'proud', 'success', 'impact'],
    weight: 7,
  },
  {
    type: 'problem_solving',
    patterns: [
      /problem.*solv/i,
      /approach.*problem/i,
      /debug/i,
      /troubleshoot/i,
      /figure.*out/i,
      /overcome.*challenge/i,
    ],
    keywords: ['problem', 'solve', 'debug', 'troubleshoot', 'analyze'],
    weight: 8,
  },
  {
    type: 'why_company',
    patterns: [
      /why.*company/i,
      /why.*us/i,
      /interest.*company/i,
      /attract.*to/i,
      /why.*join/i,
      /what.*excites.*about/i,
    ],
    keywords: ['why', 'company', 'interest', 'join', 'attract'],
    weight: 10,
  },
  {
    type: 'why_role',
    patterns: [
      /why.*role/i,
      /why.*position/i,
      /interested.*position/i,
      /what.*appeal/i,
      /why.*apply/i,
    ],
    keywords: ['role', 'position', 'apply', 'interest'],
    weight: 9,
  },
  {
    type: 'career_goals',
    patterns: [
      /career.*goal/i,
      /where.*see.*yourself/i,
      /five.*years/i,
      /long.*term/i,
      /aspiration/i,
    ],
    keywords: ['career', 'goal', 'future', 'aspire', 'years'],
    weight: 7,
  },
  {
    type: 'availability',
    patterns: [
      /start.*date/i,
      /when.*start/i,
      /availability/i,
      /notice.*period/i,
      /available.*begin/i,
    ],
    keywords: ['start', 'availability', 'begin', 'notice'],
    weight: 8,
  },
  {
    type: 'work_auth',
    patterns: [
      /authorized.*work/i,
      /work.*authorization/i,
      /legally.*authorized/i,
      /sponsorship/i,
      /visa/i,
      /require.*sponsor/i,
    ],
    keywords: ['authorized', 'authorization', 'sponsorship', 'visa', 'legal'],
    weight: 10,
  },
  {
    type: 'salary',
    patterns: [
      /salary/i,
      /compensation/i,
      /expected.*salary/i,
      /desired.*salary/i,
      /pay.*expectation/i,
    ],
    keywords: ['salary', 'compensation', 'pay', 'money'],
    weight: 8,
  },
  {
    type: 'additional_info',
    patterns: [
      /anything.*else/i,
      /additional.*information/i,
      /share.*with.*us/i,
      /want.*us.*know/i,
      /other.*comments/i,
    ],
    keywords: ['additional', 'else', 'share', 'comments'],
    weight: 5,
  },
];

interface ClassificationResult {
  type: string;
  confidence: number;  // 0-1
  matchedPatterns: number;
  matchedKeywords: number;
  wordCountHint: number | null;
}

function classifyQuestion(questionText: string): ClassificationResult {
  const normalizedText = questionText.toLowerCase().trim();
  
  // Detect word/character limits
  const wordCountHint = detectWordLimit(questionText);
  
  // Score each question type
  const scores: Array<{ type: string; score: number; patterns: number; keywords: number }> = [];
  
  for (const pattern of questionPatterns) {
    let patternMatches = 0;
    let keywordMatches = 0;
    
    // Count regex pattern matches
    for (const regex of pattern.patterns) {
      if (regex.test(normalizedText)) {
        patternMatches++;
      }
    }
    
    // Count keyword matches
    for (const keyword of pattern.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        keywordMatches++;
      }
    }
    
    // Calculate weighted score
    const patternScore = (patternMatches / pattern.patterns.length) * pattern.weight;
    const keywordScore = (keywordMatches / pattern.keywords.length) * (pattern.weight * 0.5);
    const totalScore = patternScore + keywordScore;
    
    if (totalScore > 0) {
      scores.push({
        type: pattern.type,
        score: totalScore,
        patterns: patternMatches,
        keywords: keywordMatches,
      });
    }
  }
  
  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  
  if (scores.length === 0) {
    return {
      type: 'unknown',
      confidence: 0,
      matchedPatterns: 0,
      matchedKeywords: 0,
      wordCountHint,
    };
  }
  
  const best = scores[0];
  const maxPossibleScore = 15; // Approximate max score
  
  return {
    type: best.type,
    confidence: Math.min(best.score / maxPossibleScore, 1),
    matchedPatterns: best.patterns,
    matchedKeywords: best.keywords,
    wordCountHint,
  };
}

function detectWordLimit(text: string): number | null {
  // Look for explicit limits in the question text
  const patterns = [
    /(\d+)\s*words?(?:\s+or\s+less)?/i,
    /(\d+)\s*characters?/i,
    /max(?:imum)?\s*(\d+)/i,
    /limit(?:ed)?\s*to\s*(\d+)/i,
    /up\s*to\s*(\d+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const limit = parseInt(match[1], 10);
      // Convert character limit to approximate word count
      if (pattern.source.includes('character')) {
        return Math.floor(limit / 5);
      }
      return limit;
    }
  }
  
  return null;
}
```

### 2.3 Semantic Classification (For Ambiguous Cases)

When rule-based confidence is low, use embedding similarity:

```typescript
// semantic-classifier.ts

import { cosineSimilarity } from './math-utils';

// Pre-computed embeddings for canonical questions
interface CanonicalQuestion {
  type: string;
  text: string;
  embedding: number[];
}

const canonicalQuestions: CanonicalQuestion[] = [
  {
    type: 'project',
    text: 'Tell us about a challenging project you worked on',
    embedding: [], // Pre-computed
  },
  {
    type: 'project',
    text: 'Describe a technical project you are proud of',
    embedding: [],
  },
  {
    type: 'teamwork',
    text: 'Describe a time when you worked effectively in a team',
    embedding: [],
  },
  {
    type: 'conflict',
    text: 'How do you handle disagreements with coworkers?',
    embedding: [],
  },
  // ... more canonical questions per type
];

async function semanticClassify(
  questionText: string,
  getEmbedding: (text: string) => Promise<number[]>
): Promise<ClassificationResult> {
  // Get embedding for input question
  const inputEmbedding = await getEmbedding(questionText);
  
  // Compare to all canonical questions
  const similarities: Array<{ type: string; similarity: number }> = [];
  
  for (const canonical of canonicalQuestions) {
    const similarity = cosineSimilarity(inputEmbedding, canonical.embedding);
    similarities.push({ type: canonical.type, similarity });
  }
  
  // Group by type and take max similarity per type
  const typeScores = new Map<string, number>();
  for (const { type, similarity } of similarities) {
    const current = typeScores.get(type) || 0;
    typeScores.set(type, Math.max(current, similarity));
  }
  
  // Find best match
  let bestType = 'unknown';
  let bestScore = 0;
  
  for (const [type, score] of typeScores) {
    if (score > bestScore) {
      bestType = type;
      bestScore = score;
    }
  }
  
  return {
    type: bestType,
    confidence: bestScore,
    matchedPatterns: 0,
    matchedKeywords: 0,
    wordCountHint: detectWordLimit(questionText),
  };
}
```

### 2.4 Hybrid Classification Pipeline

Combine rule-based and semantic for best results:

```typescript
// hybrid-classifier.ts

const RULE_CONFIDENCE_THRESHOLD = 0.6;
const SEMANTIC_CONFIDENCE_THRESHOLD = 0.75;

interface HybridClassificationResult extends ClassificationResult {
  method: 'rule' | 'semantic' | 'hybrid' | 'fallback';
  requiresLLM: boolean;
}

async function classifyQuestionHybrid(
  questionText: string,
  options: { useSemanticFallback?: boolean } = {}
): Promise<HybridClassificationResult> {
  const { useSemanticFallback = true } = options;
  
  // Step 1: Try rule-based classification
  const ruleResult = classifyQuestion(questionText);
  
  if (ruleResult.confidence >= RULE_CONFIDENCE_THRESHOLD) {
    return {
      ...ruleResult,
      method: 'rule',
      requiresLLM: false,
    };
  }
  
  // Step 2: Try semantic classification if enabled
  if (useSemanticFallback && ruleResult.confidence < RULE_CONFIDENCE_THRESHOLD) {
    try {
      const semanticResult = await semanticClassify(questionText, getEmbedding);
      
      if (semanticResult.confidence >= SEMANTIC_CONFIDENCE_THRESHOLD) {
        return {
          ...semanticResult,
          method: 'semantic',
          requiresLLM: false,
        };
      }
      
      // Combine both results if both have some confidence
      if (ruleResult.confidence > 0.3 && semanticResult.confidence > 0.5) {
        const combinedConfidence = (ruleResult.confidence + semanticResult.confidence) / 2;
        // Use type from higher confidence method
        const bestResult = ruleResult.confidence > semanticResult.confidence 
          ? ruleResult : semanticResult;
        
        return {
          ...bestResult,
          confidence: combinedConfidence,
          method: 'hybrid',
          requiresLLM: combinedConfidence < 0.6,
        };
      }
    } catch (error) {
      console.warn('[classifier] Semantic classification failed:', error);
    }
  }
  
  // Step 3: Low confidence - mark for LLM fallback
  return {
    ...ruleResult,
    method: 'fallback',
    requiresLLM: true,
  };
}
```

---

## 3. Answer Matching Algorithms

### 3.1 Exact Pattern Matching

For questions that match known patterns exactly:

```typescript
// answer-matcher.ts

interface CachedAnswer {
  id: string;
  questionPattern: string;  // Normalized pattern key
  questionType: string;
  wordCountTarget: 'short' | 'standard' | 'long';
  answer: string;
  usageCount: number;
  lastUsedAt: Date;
  companyLastUsed?: string;
}

class AnswerMatcher {
  private answerCache: Map<string, CachedAnswer[]>;
  
  constructor() {
    this.answerCache = new Map();
  }
  
  // Generate cache key from question type and word target
  private getCacheKey(type: string, wordTarget: string): string {
    return `${type}:${wordTarget}`;
  }
  
  // Get word count category
  private getWordCountCategory(wordCount: number | null): 'short' | 'standard' | 'long' {
    if (!wordCount || wordCount <= 100) return 'short';
    if (wordCount <= 200) return 'standard';
    return 'long';
  }
  
  // Find exact match in cache
  findExactMatch(
    questionType: string,
    wordCountHint: number | null,
    excludeCompany?: string
  ): CachedAnswer | null {
    const category = this.getWordCountCategory(wordCountHint);
    const key = this.getCacheKey(questionType, category);
    
    const answers = this.answerCache.get(key);
    if (!answers || answers.length === 0) return null;
    
    // Filter out recently used for same company
    const available = answers.filter(a => 
      !excludeCompany || a.companyLastUsed !== excludeCompany
    );
    
    if (available.length === 0) {
      // All answers used for this company, return least recently used
      return answers.sort((a, b) => 
        a.lastUsedAt.getTime() - b.lastUsedAt.getTime()
      )[0];
    }
    
    // Return least recently used available answer
    return available.sort((a, b) => 
      a.lastUsedAt.getTime() - b.lastUsedAt.getTime()
    )[0];
  }
  
  // Record answer usage
  recordUsage(answerId: string, company: string): void {
    for (const answers of this.answerCache.values()) {
      const answer = answers.find(a => a.id === answerId);
      if (answer) {
        answer.usageCount++;
        answer.lastUsedAt = new Date();
        answer.companyLastUsed = company;
        break;
      }
    }
  }
}
```

### 3.2 Semantic Similarity Search

For questions that don't match exactly but are similar:

```typescript
// semantic-search.ts

interface AnswerWithEmbedding {
  id: string;
  answer: string;
  questionText: string;
  embedding: number[];
  metadata: {
    type: string;
    wordCount: number;
    created: Date;
  };
}

class SemanticAnswerSearch {
  private answers: AnswerWithEmbedding[] = [];
  private index: VectorIndex;  // Could be FAISS, Pinecone, or simple in-memory
  
  constructor() {
    this.index = new InMemoryVectorIndex();
  }
  
  // Add answer to index
  async addAnswer(answer: Omit<AnswerWithEmbedding, 'embedding'>): Promise<void> {
    const embedding = await getEmbedding(answer.questionText);
    const withEmbedding: AnswerWithEmbedding = {
      ...answer,
      embedding,
    };
    this.answers.push(withEmbedding);
    this.index.add(answer.id, embedding);
  }
  
  // Find similar answers
  async findSimilar(
    questionText: string,
    options: {
      topK?: number;
      minSimilarity?: number;
      wordCountTarget?: number;
    } = {}
  ): Promise<Array<{ answer: AnswerWithEmbedding; similarity: number }>> {
    const { topK = 5, minSimilarity = 0.75, wordCountTarget } = options;
    
    const queryEmbedding = await getEmbedding(questionText);
    const results = this.index.search(queryEmbedding, topK);
    
    return results
      .filter(r => r.similarity >= minSimilarity)
      .map(r => ({
        answer: this.answers.find(a => a.id === r.id)!,
        similarity: r.similarity,
      }))
      .filter(r => {
        // Filter by word count if specified
        if (!wordCountTarget) return true;
        const answerWordCount = r.answer.metadata.wordCount;
        const tolerance = wordCountTarget * 0.3; // 30% tolerance
        return Math.abs(answerWordCount - wordCountTarget) <= tolerance;
      });
  }
}

// Simple in-memory vector index
class InMemoryVectorIndex {
  private vectors: Map<string, number[]> = new Map();
  
  add(id: string, vector: number[]): void {
    this.vectors.set(id, vector);
  }
  
  search(query: number[], topK: number): Array<{ id: string; similarity: number }> {
    const results: Array<{ id: string; similarity: number }> = [];
    
    for (const [id, vector] of this.vectors) {
      const similarity = cosineSimilarity(query, vector);
      results.push({ id, similarity });
    }
    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

// Cosine similarity calculation
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 3.3 FAQ Matching System

For frequently asked questions with pre-written responses:

```typescript
// faq-matcher.ts

interface FAQEntry {
  id: string;
  patterns: RegExp[];           // Multiple patterns per FAQ
  canonicalQuestion: string;    // Standard form of question
  answers: {
    short: string;              // ~75 words
    standard: string;           // ~150 words
    long: string;               // ~250 words
  };
  variables?: {                 // Template variables
    [key: string]: string;      // e.g., {company_name: "Google"}
  };
  tags: string[];               // For filtering
}

class FAQMatcher {
  private faqs: FAQEntry[] = [];
  
  constructor(faqs: FAQEntry[]) {
    this.faqs = faqs;
  }
  
  // Find FAQ that matches question
  match(questionText: string): FAQEntry | null {
    const normalizedQuestion = questionText.toLowerCase().trim();
    
    for (const faq of this.faqs) {
      for (const pattern of faq.patterns) {
        if (pattern.test(normalizedQuestion)) {
          return faq;
        }
      }
    }
    
    return null;
  }
  
  // Get answer with variable substitution
  getAnswer(
    faq: FAQEntry,
    length: 'short' | 'standard' | 'long',
    variables: Record<string, string> = {}
  ): string {
    let answer = faq.answers[length];
    
    // Substitute variables
    const allVariables = { ...faq.variables, ...variables };
    for (const [key, value] of Object.entries(allVariables)) {
      answer = answer.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    
    return answer;
  }
}

// Example FAQ entries
const defaultFAQs: FAQEntry[] = [
  {
    id: 'work_auth_yes',
    patterns: [
      /authorized.*work.*united\s*states/i,
      /legally.*authorized.*work/i,
      /work.*authorization/i,
    ],
    canonicalQuestion: 'Are you authorized to work in the United States?',
    answers: {
      short: 'Yes',
      standard: 'Yes, I am authorized to work in the United States.',
      long: 'Yes, I am fully authorized to work in the United States without requiring visa sponsorship.',
    },
    tags: ['logistics', 'work_auth'],
  },
  {
    id: 'sponsorship_no',
    patterns: [
      /require.*sponsorship/i,
      /need.*visa.*sponsor/i,
      /will.*require.*sponsor/i,
    ],
    canonicalQuestion: 'Will you now or in the future require visa sponsorship?',
    answers: {
      short: 'No',
      standard: 'No, I will not require visa sponsorship now or in the future.',
      long: 'No, I am authorized to work in the United States and will not require visa sponsorship for employment now or in the future.',
    },
    tags: ['logistics', 'sponsorship'],
  },
  {
    id: 'start_date_immediate',
    patterns: [
      /when.*start/i,
      /start.*date/i,
      /earliest.*start/i,
      /availability/i,
    ],
    canonicalQuestion: 'When are you available to start?',
    answers: {
      short: 'Immediately',
      standard: 'I am available to start immediately.',
      long: 'I am available to start immediately and am flexible with the start date based on the company\'s needs.',
    },
    tags: ['logistics', 'availability'],
  },
  {
    id: 'relocation_yes',
    patterns: [
      /willing.*relocate/i,
      /open.*relocat/i,
      /relocate.*office/i,
    ],
    canonicalQuestion: 'Are you willing to relocate?',
    answers: {
      short: 'Yes',
      standard: 'Yes, I am willing to relocate for this opportunity.',
      long: 'Yes, I am willing and excited to relocate for this role. I am flexible with timing and open to discussing relocation logistics.',
    },
    tags: ['logistics', 'relocation'],
  },
  {
    id: 'salary_negotiable',
    patterns: [
      /salary.*expectation/i,
      /expected.*salary/i,
      /desired.*compensation/i,
      /compensation.*requirement/i,
    ],
    canonicalQuestion: 'What are your salary expectations?',
    answers: {
      short: 'Negotiable',
      standard: 'I am open to discussing compensation and am flexible based on the total package.',
      long: 'I am open to discussing compensation. I am primarily focused on finding the right opportunity where I can contribute meaningfully and grow. I am flexible on salary and would appreciate learning more about the full compensation package.',
    },
    tags: ['logistics', 'salary'],
  },
];
```

### 3.4 Combined Matching Pipeline

```typescript
// answer-pipeline.ts

interface MatchResult {
  answer: string;
  source: 'exact' | 'semantic' | 'faq' | 'llm';
  confidence: number;
  answerId?: string;
  processingTime: number;
}

class AnswerPipeline {
  private matcher: AnswerMatcher;
  private semanticSearch: SemanticAnswerSearch;
  private faqMatcher: FAQMatcher;
  private llmClient: LLMClient;
  
  constructor(config: PipelineConfig) {
    this.matcher = new AnswerMatcher();
    this.semanticSearch = new SemanticAnswerSearch();
    this.faqMatcher = new FAQMatcher(defaultFAQs);
    this.llmClient = config.llmClient;
  }
  
  async getAnswer(
    questionText: string,
    context: {
      company?: string;
      role?: string;
      wordCountTarget?: number;
    } = {}
  ): Promise<MatchResult> {
    const startTime = Date.now();
    
    // Step 1: Classify the question
    const classification = await classifyQuestionHybrid(questionText);
    const wordCategory = this.getWordCategory(context.wordCountTarget);
    
    // Step 2: Check FAQ first (fastest)
    const faqMatch = this.faqMatcher.match(questionText);
    if (faqMatch) {
      const answer = this.faqMatcher.getAnswer(faqMatch, wordCategory, {
        company_name: context.company || '{company}',
      });
      return {
        answer,
        source: 'faq',
        confidence: 1.0,
        answerId: faqMatch.id,
        processingTime: Date.now() - startTime,
      };
    }
    
    // Step 3: Try exact pattern match
    if (classification.confidence >= 0.6) {
      const exactMatch = this.matcher.findExactMatch(
        classification.type,
        context.wordCountTarget,
        context.company
      );
      
      if (exactMatch) {
        this.matcher.recordUsage(exactMatch.id, context.company || 'unknown');
        return {
          answer: exactMatch.answer,
          source: 'exact',
          confidence: classification.confidence,
          answerId: exactMatch.id,
          processingTime: Date.now() - startTime,
        };
      }
    }
    
    // Step 4: Try semantic search
    if (classification.confidence >= 0.4) {
      const semanticResults = await this.semanticSearch.findSimilar(questionText, {
        topK: 3,
        minSimilarity: 0.75,
        wordCountTarget: context.wordCountTarget,
      });
      
      if (semanticResults.length > 0) {
        const best = semanticResults[0];
        return {
          answer: best.answer.answer,
          source: 'semantic',
          confidence: best.similarity,
          answerId: best.answer.id,
          processingTime: Date.now() - startTime,
        };
      }
    }
    
    // Step 5: Fall back to LLM
    const llmAnswer = await this.generateWithLLM(
      questionText,
      classification.type,
      context
    );
    
    return {
      answer: llmAnswer,
      source: 'llm',
      confidence: 0.9,  // LLM confidence is high but marked differently
      processingTime: Date.now() - startTime,
    };
  }
  
  private getWordCategory(count?: number): 'short' | 'standard' | 'long' {
    if (!count || count <= 100) return 'short';
    if (count <= 200) return 'standard';
    return 'long';
  }
  
  private async generateWithLLM(
    question: string,
    questionType: string,
    context: { company?: string; role?: string; wordCountTarget?: number }
  ): Promise<string> {
    // Implementation of LLM fallback - see next section
    return await this.llmClient.generateAnswer(question, questionType, context);
  }
}
```

---

## 4. Code Implementation

### 4.1 TypeScript Implementation

Complete implementation for Node.js/TypeScript:

```typescript
// src/lib/answer-bank/index.ts

export interface AnswerBankConfig {
  cacheDir?: string;
  enableSemanticSearch?: boolean;
  llmProvider?: 'openai' | 'gemini' | 'anthropic';
  llmApiKey?: string;
}

export class AnswerBank {
  private config: AnswerBankConfig;
  private pipeline: AnswerPipeline;
  private cache: AnswerCache;
  private initialized = false;
  
  constructor(config: AnswerBankConfig = {}) {
    this.config = {
      cacheDir: './.answer-cache',
      enableSemanticSearch: true,
      llmProvider: 'gemini',
      ...config,
    };
  }
  
  async init(): Promise<void> {
    if (this.initialized) return;
    
    // Load cached answers
    this.cache = new AnswerCache(this.config.cacheDir);
    await this.cache.load();
    
    // Initialize pipeline
    this.pipeline = new AnswerPipeline({
      llmClient: this.createLLMClient(),
      enableSemanticSearch: this.config.enableSemanticSearch,
    });
    
    this.initialized = true;
    console.log('[AnswerBank] Initialized');
  }
  
  async getAnswer(
    question: string,
    context: AnswerContext = {}
  ): Promise<AnswerResult> {
    if (!this.initialized) await this.init();
    
    const result = await this.pipeline.getAnswer(question, context);
    
    // Cache LLM-generated answers for future use
    if (result.source === 'llm') {
      await this.cacheAnswer(question, result.answer, context);
    }
    
    return result;
  }
  
  async cacheAnswer(
    question: string,
    answer: string,
    context: AnswerContext
  ): Promise<void> {
    const classification = await classifyQuestionHybrid(question);
    
    if (classification.confidence >= 0.5) {
      await this.cache.add({
        questionText: question,
        questionType: classification.type,
        answer,
        wordCount: answer.split(/\s+/).length,
        createdAt: new Date(),
      });
    }
  }
  
  // Pre-generate answers for common questions
  async warmCache(
    userStories: UserStory[],
    questionTypes: string[] = ['project', 'teamwork', 'leadership', 'failure']
  ): Promise<void> {
    console.log('[AnswerBank] Warming cache...');
    
    for (const type of questionTypes) {
      for (const length of ['short', 'standard', 'long'] as const) {
        const wordTarget = length === 'short' ? 75 : length === 'standard' ? 150 : 250;
        
        // Generate answer using best matching story
        const story = this.selectStoryForType(userStories, type);
        if (!story) continue;
        
        const answer = await this.generateFromStory(story, type, wordTarget);
        
        await this.cache.add({
          questionText: `${type}_${length}`,
          questionType: type,
          answer,
          wordCount: answer.split(/\s+/).length,
          createdAt: new Date(),
        });
      }
    }
    
    console.log('[AnswerBank] Cache warmed');
  }
  
  private createLLMClient(): LLMClient {
    // Create appropriate client based on config
    switch (this.config.llmProvider) {
      case 'gemini':
        return new GeminiClient(this.config.llmApiKey);
      case 'openai':
        return new OpenAIClient(this.config.llmApiKey);
      case 'anthropic':
        return new AnthropicClient(this.config.llmApiKey);
      default:
        return new GeminiClient(this.config.llmApiKey);
    }
  }
  
  private selectStoryForType(stories: UserStory[], type: string): UserStory | null {
    // Match story type to question type
    const typeMap: Record<string, string[]> = {
      project: ['project', 'technical'],
      teamwork: ['teamwork', 'project'],
      leadership: ['leadership', 'project'],
      failure: ['failure', 'challenge'],
      conflict: ['conflict', 'teamwork'],
      achievement: ['achievement', 'project'],
      problem_solving: ['technical', 'challenge'],
    };
    
    const matchingTypes = typeMap[type] || [type];
    
    return stories.find(s => matchingTypes.includes(s.type)) || null;
  }
  
  private async generateFromStory(
    story: UserStory,
    questionType: string,
    wordTarget: number
  ): Promise<string> {
    // Use template-based generation from story data
    return generateSTARAnswer(story, {
      wordTarget,
      structure: 'standard',
    });
  }
}

// Export types
export interface AnswerContext {
  company?: string;
  role?: string;
  wordCountTarget?: number;
  companyValues?: string[];
}

export interface AnswerResult {
  answer: string;
  source: 'exact' | 'semantic' | 'faq' | 'llm';
  confidence: number;
  processingTime: number;
}

export interface UserStory {
  id: string;
  type: string;
  title: string;
  situation: string;
  task: string;
  actions: string[];
  results: Array<{ metric: string; value: string }>;
  learnings?: string[];
}
```

### 4.2 Python Implementation

For use in the scraper/autoapply Python components:

```python
# scraper/autoapply/answer_bank.py

import re
import json
import hashlib
from pathlib import Path
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import numpy as np

@dataclass
class ClassificationResult:
    type: str
    confidence: float
    matched_patterns: int
    matched_keywords: int
    word_count_hint: Optional[int]
    method: str = 'rule'
    requires_llm: bool = False

@dataclass
class CachedAnswer:
    id: str
    question_type: str
    question_text: str
    answer: str
    word_count: int
    created_at: str
    usage_count: int = 0
    last_used_at: Optional[str] = None
    company_last_used: Optional[str] = None

# Question patterns for rule-based classification
QUESTION_PATTERNS = {
    'project': {
        'patterns': [
            r'challenging.*project',
            r'difficult.*project',
            r'describe.*project',
            r'tell.*about.*project',
            r'proud.*project',
        ],
        'keywords': ['project', 'built', 'developed', 'created', 'implemented'],
        'weight': 8,
    },
    'teamwork': {
        'patterns': [
            r'work.*team',
            r'team.*experience',
            r'collaborate',
            r'group.*project',
        ],
        'keywords': ['team', 'collaborate', 'together', 'group'],
        'weight': 7,
    },
    'conflict': {
        'patterns': [
            r'conflict',
            r'disagree',
            r'difficult.*colleague',
            r'resolve.*conflict',
        ],
        'keywords': ['conflict', 'disagree', 'difficult', 'resolve'],
        'weight': 9,
    },
    'leadership': {
        'patterns': [
            r'lead',
            r'leadership',
            r'mentor',
            r'initiative',
        ],
        'keywords': ['lead', 'leader', 'mentor', 'manage', 'guide'],
        'weight': 7,
    },
    'failure': {
        'patterns': [
            r'fail',
            r'mistake',
            r'learn.*from',
            r'setback',
        ],
        'keywords': ['fail', 'mistake', 'wrong', 'learned'],
        'weight': 9,
    },
    'why_company': {
        'patterns': [
            r'why.*company',
            r'why.*us',
            r'interest.*company',
            r'why.*join',
        ],
        'keywords': ['why', 'company', 'interest', 'join'],
        'weight': 10,
    },
    'work_auth': {
        'patterns': [
            r'authorized.*work',
            r'work.*authorization',
            r'sponsorship',
            r'visa',
        ],
        'keywords': ['authorized', 'sponsorship', 'visa', 'legal'],
        'weight': 10,
    },
    'availability': {
        'patterns': [
            r'start.*date',
            r'when.*start',
            r'availability',
        ],
        'keywords': ['start', 'availability', 'begin'],
        'weight': 8,
    },
    'salary': {
        'patterns': [
            r'salary',
            r'compensation',
            r'expected.*salary',
        ],
        'keywords': ['salary', 'compensation', 'pay'],
        'weight': 8,
    },
}

# FAQ responses for common questions
FAQ_RESPONSES = {
    'work_auth_yes': {
        'patterns': [r'authorized.*work.*united\s*states', r'legally.*authorized'],
        'answers': {
            'short': 'Yes',
            'standard': 'Yes, I am authorized to work in the United States.',
            'long': 'Yes, I am fully authorized to work in the United States without requiring visa sponsorship.',
        }
    },
    'sponsorship_no': {
        'patterns': [r'require.*sponsorship', r'need.*visa.*sponsor'],
        'answers': {
            'short': 'No',
            'standard': 'No, I will not require visa sponsorship now or in the future.',
            'long': 'No, I am authorized to work in the United States and will not require visa sponsorship.',
        }
    },
    'start_immediate': {
        'patterns': [r'when.*start', r'start.*date', r'availability'],
        'answers': {
            'short': 'Immediately',
            'standard': 'I am available to start immediately.',
            'long': 'I am available to start immediately and am flexible with the start date.',
        }
    },
    'relocation_yes': {
        'patterns': [r'willing.*relocate', r'open.*relocat'],
        'answers': {
            'short': 'Yes',
            'standard': 'Yes, I am willing to relocate for this opportunity.',
            'long': 'Yes, I am willing and excited to relocate for this role.',
        }
    },
    'salary_negotiable': {
        'patterns': [r'salary.*expectation', r'compensation.*requirement'],
        'answers': {
            'short': 'Negotiable',
            'standard': 'I am open to discussing compensation.',
            'long': 'I am open to discussing compensation based on the total package.',
        }
    },
}


def detect_word_limit(text: str) -> Optional[int]:
    """Extract word/character limit from question text."""
    patterns = [
        (r'(\d+)\s*words?', 1),       # "150 words"
        (r'(\d+)\s*characters?', 5),   # "500 characters" -> ~100 words
        (r'max(?:imum)?\s*(\d+)', 1),
    ]
    
    for pattern, divisor in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            limit = int(match.group(1))
            return limit // divisor
    
    return None


def classify_question(question_text: str) -> ClassificationResult:
    """Classify question using rule-based pattern matching."""
    normalized = question_text.lower().strip()
    word_limit = detect_word_limit(question_text)
    
    scores = []
    
    for qtype, config in QUESTION_PATTERNS.items():
        pattern_matches = sum(
            1 for p in config['patterns'] 
            if re.search(p, normalized, re.IGNORECASE)
        )
        keyword_matches = sum(
            1 for k in config['keywords'] 
            if k.lower() in normalized
        )
        
        if pattern_matches > 0 or keyword_matches > 0:
            pattern_score = (pattern_matches / len(config['patterns'])) * config['weight']
            keyword_score = (keyword_matches / len(config['keywords'])) * (config['weight'] * 0.5)
            total_score = pattern_score + keyword_score
            
            scores.append({
                'type': qtype,
                'score': total_score,
                'patterns': pattern_matches,
                'keywords': keyword_matches,
            })
    
    if not scores:
        return ClassificationResult(
            type='unknown',
            confidence=0,
            matched_patterns=0,
            matched_keywords=0,
            word_count_hint=word_limit,
            requires_llm=True,
        )
    
    best = max(scores, key=lambda x: x['score'])
    max_score = 15  # Approximate max
    
    return ClassificationResult(
        type=best['type'],
        confidence=min(best['score'] / max_score, 1.0),
        matched_patterns=best['patterns'],
        matched_keywords=best['keywords'],
        word_count_hint=word_limit,
        requires_llm=best['score'] / max_score < 0.6,
    )


def match_faq(question_text: str) -> Optional[Tuple[str, Dict]]:
    """Match question to FAQ responses."""
    normalized = question_text.lower()
    
    for faq_id, faq in FAQ_RESPONSES.items():
        for pattern in faq['patterns']:
            if re.search(pattern, normalized, re.IGNORECASE):
                return faq_id, faq
    
    return None


def get_word_category(count: Optional[int]) -> str:
    """Convert word count to category."""
    if not count or count <= 100:
        return 'short'
    elif count <= 200:
        return 'standard'
    return 'long'


class AnswerBank:
    """Answer bank with caching and matching."""
    
    def __init__(self, cache_dir: str = './.answer-cache'):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.answers: Dict[str, List[CachedAnswer]] = {}
        self._load_cache()
    
    def _load_cache(self):
        """Load cached answers from disk."""
        cache_file = self.cache_dir / 'answers.json'
        if cache_file.exists():
            try:
                with open(cache_file, 'r') as f:
                    data = json.load(f)
                    for key, answers in data.items():
                        self.answers[key] = [
                            CachedAnswer(**a) for a in answers
                        ]
            except Exception as e:
                print(f'[AnswerBank] Failed to load cache: {e}')
    
    def _save_cache(self):
        """Save cached answers to disk."""
        cache_file = self.cache_dir / 'answers.json'
        data = {
            key: [asdict(a) for a in answers]
            for key, answers in self.answers.items()
        }
        with open(cache_file, 'w') as f:
            json.dump(data, f, indent=2, default=str)
    
    def _get_cache_key(self, qtype: str, word_category: str) -> str:
        """Generate cache key."""
        return f'{qtype}:{word_category}'
    
    def get_answer(
        self,
        question: str,
        company: Optional[str] = None,
        word_target: Optional[int] = None,
    ) -> Dict:
        """Get answer for question."""
        import time
        start = time.time()
        
        # Step 1: Check FAQ
        faq_match = match_faq(question)
        if faq_match:
            faq_id, faq = faq_match
            category = get_word_category(word_target)
            answer = faq['answers'].get(category, faq['answers']['standard'])
            return {
                'answer': answer,
                'source': 'faq',
                'confidence': 1.0,
                'processing_time_ms': (time.time() - start) * 1000,
            }
        
        # Step 2: Classify question
        classification = classify_question(question)
        word_category = get_word_category(word_target or classification.word_count_hint)
        
        # Step 3: Check cache
        if classification.confidence >= 0.6:
            cache_key = self._get_cache_key(classification.type, word_category)
            cached = self.answers.get(cache_key, [])
            
            # Filter out recently used for same company
            available = [
                a for a in cached
                if not company or a.company_last_used != company
            ]
            
            if available:
                # Use least recently used
                answer = min(
                    available,
                    key=lambda a: a.last_used_at or ''
                )
                self._record_usage(answer.id, company)
                
                return {
                    'answer': answer.answer,
                    'source': 'exact',
                    'confidence': classification.confidence,
                    'answer_id': answer.id,
                    'processing_time_ms': (time.time() - start) * 1000,
                }
        
        # Step 4: LLM fallback needed
        return {
            'answer': None,
            'source': 'llm_required',
            'confidence': classification.confidence,
            'question_type': classification.type,
            'word_target': word_target or 150,
            'processing_time_ms': (time.time() - start) * 1000,
        }
    
    def add_answer(
        self,
        question: str,
        answer: str,
        question_type: Optional[str] = None,
    ):
        """Add answer to cache."""
        if not question_type:
            classification = classify_question(question)
            question_type = classification.type
        
        word_count = len(answer.split())
        word_category = get_word_category(word_count)
        cache_key = self._get_cache_key(question_type, word_category)
        
        new_answer = CachedAnswer(
            id=hashlib.md5(answer.encode()).hexdigest()[:12],
            question_type=question_type,
            question_text=question,
            answer=answer,
            word_count=word_count,
            created_at=datetime.now().isoformat(),
        )
        
        if cache_key not in self.answers:
            self.answers[cache_key] = []
        
        # Avoid duplicates
        existing_ids = {a.id for a in self.answers[cache_key]}
        if new_answer.id not in existing_ids:
            self.answers[cache_key].append(new_answer)
            self._save_cache()
    
    def _record_usage(self, answer_id: str, company: Optional[str]):
        """Record answer usage."""
        for answers in self.answers.values():
            for answer in answers:
                if answer.id == answer_id:
                    answer.usage_count += 1
                    answer.last_used_at = datetime.now().isoformat()
                    answer.company_last_used = company
                    self._save_cache()
                    return
    
    def get_stats(self) -> Dict:
        """Get cache statistics."""
        total = sum(len(a) for a in self.answers.values())
        by_type = {k: len(v) for k, v in self.answers.items()}
        return {
            'total_answers': total,
            'by_type': by_type,
        }


# Usage example
if __name__ == '__main__':
    bank = AnswerBank()
    
    # Add some test answers
    bank.add_answer(
        question='Tell us about a challenging project',
        answer='During my internship, I led the development of a real-time notification system...',
        question_type='project',
    )
    
    # Get answer
    result = bank.get_answer(
        'Describe a difficult project you worked on',
        company='Google',
        word_target=150,
    )
    
    print(f"Source: {result['source']}")
    print(f"Confidence: {result['confidence']}")
    print(f"Answer: {result.get('answer', 'LLM required')[:100]}...")
```

---

## 5. LLM Fallback Strategy

### 5.1 When to Use LLM

Fall back to LLM generation when:

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Low classification confidence | < 0.4 | Always use LLM |
| Medium confidence, no cache hit | 0.4 - 0.6 | Try semantic search, then LLM |
| High confidence, no cache hit | > 0.6 | Generate and cache |
| Company-specific question | Contains company name | Always use LLM |
| Novel question type | Type = 'unknown' | Always use LLM |

### 5.2 LLM Generation with Context

```typescript
// llm-fallback.ts

interface GenerationContext {
  question: string;
  questionType: string;
  company?: string;
  role?: string;
  wordTarget: number;
  userStory?: UserStory;
  companyInfo?: CompanyInfo;
}

async function generateWithLLM(context: GenerationContext): Promise<string> {
  const systemPrompt = `You are helping generate job application answers. 
Write authentic, first-person responses based on the provided context.
Use the STAR method (Situation, Task, Action, Result) for behavioral questions.
Be specific and quantify results when possible.
Target ${context.wordTarget} words.`;

  const userPrompt = buildPrompt(context);
  
  const response = await llmClient.generate({
    model: 'gemini-1.5-flash',  // Fast and cost-effective
    systemPrompt,
    userPrompt,
    maxTokens: context.wordTarget * 2,  // Buffer for word estimation
    temperature: 0.7,  // Some creativity but consistent
  });
  
  return response.text;
}

function buildPrompt(context: GenerationContext): string {
  let prompt = `Question: "${context.question}"

Question Type: ${context.questionType}
Target Length: ${context.wordTarget} words`;

  if (context.userStory) {
    prompt += `

Use this experience as the basis for your answer:
- Situation: ${context.userStory.situation}
- Task: ${context.userStory.task}
- Actions: ${context.userStory.actions.join('; ')}
- Results: ${context.userStory.results.map(r => `${r.metric}: ${r.value}`).join('; ')}`;
  }

  if (context.company) {
    prompt += `

Company context:
- Company: ${context.company}
- Role: ${context.role || 'Software Engineer'}`;
    
    if (context.companyInfo) {
      prompt += `
- Industry: ${context.companyInfo.industry}
- Values: ${context.companyInfo.values?.join(', ') || 'Not specified'}`;
    }
  }

  prompt += `

Write a natural, authentic response that:
1. Uses first-person ("I") perspective
2. Includes specific details and metrics
3. Shows self-awareness and growth
4. Stays within the word limit`;

  return prompt;
}
```

### 5.3 Cost-Effective LLM Selection

Choose the right model based on question complexity:

```typescript
// model-selector.ts

type ModelTier = 'fast' | 'standard' | 'advanced';

interface ModelConfig {
  name: string;
  costPer1kTokens: number;
  avgLatency: number;  // ms
}

const MODEL_TIERS: Record<ModelTier, ModelConfig> = {
  fast: {
    name: 'gemini-1.5-flash',
    costPer1kTokens: 0.000075,
    avgLatency: 500,
  },
  standard: {
    name: 'gemini-1.5-pro',
    costPer1kTokens: 0.00125,
    avgLatency: 1500,
  },
  advanced: {
    name: 'claude-3-opus-20240229',
    costPer1kTokens: 0.015,
    avgLatency: 3000,
  },
};

function selectModel(context: GenerationContext): ModelTier {
  // Fast tier for simple questions
  if (['work_auth', 'availability', 'salary', 'relocation'].includes(context.questionType)) {
    return 'fast';
  }
  
  // Advanced tier for company-specific "why us" questions
  if (context.questionType === 'why_company' && context.companyInfo) {
    return 'standard';  // Or 'advanced' for important companies
  }
  
  // Standard for most behavioral questions
  return 'fast';  // Flash is good enough for most cases
}
```

---

## 6. Performance Optimization

### 6.1 Pre-Generation Strategy

Generate common answers before applications:

```typescript
// pre-generation.ts

async function preGenerateAnswers(
  userStories: UserStory[],
  targetCompanies: string[]
): Promise<void> {
  const questionTypes = [
    'project', 'teamwork', 'leadership', 'failure',
    'achievement', 'problem_solving',
  ];
  
  const wordTargets = [75, 150, 250];
  
  for (const type of questionTypes) {
    const story = selectBestStoryForType(userStories, type);
    if (!story) continue;
    
    for (const wordTarget of wordTargets) {
      const answer = await generateWithLLM({
        question: canonicalQuestions[type],
        questionType: type,
        wordTarget,
        userStory: story,
      });
      
      await answerCache.add({
        questionType: type,
        wordCategory: getWordCategory(wordTarget),
        answer,
        generatedAt: new Date(),
      });
    }
  }
  
  // Generate company-specific "why us" answers
  for (const company of targetCompanies) {
    const companyInfo = await getCompanyInfo(company);
    
    const answer = await generateWithLLM({
      question: `Why do you want to work at ${company}?`,
      questionType: 'why_company',
      wordTarget: 150,
      company,
      companyInfo,
    });
    
    await answerCache.add({
      questionType: 'why_company',
      company,
      answer,
      generatedAt: new Date(),
    });
  }
}
```

### 6.2 Embedding Caching

Cache embeddings to avoid recomputation:

```typescript
// embedding-cache.ts

class EmbeddingCache {
  private cache: Map<string, number[]> = new Map();
  private persistPath: string;
  
  async getOrCompute(text: string): Promise<number[]> {
    const key = this.hashText(text);
    
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    
    const embedding = await computeEmbedding(text);
    this.cache.set(key, embedding);
    
    // Persist periodically
    if (this.cache.size % 100 === 0) {
      await this.persist();
    }
    
    return embedding;
  }
  
  private hashText(text: string): string {
    return crypto.createHash('md5').update(text.toLowerCase()).digest('hex');
  }
  
  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.cache);
    await fs.writeFile(this.persistPath, JSON.stringify(data));
  }
}
```

### 6.3 Batch Processing

Process multiple questions efficiently:

```typescript
// batch-processor.ts

async function processQuestionsBatch(
  questions: Array<{ id: string; text: string; wordTarget?: number }>,
  context: { company?: string }
): Promise<Map<string, AnswerResult>> {
  const results = new Map<string, AnswerResult>();
  
  // Group questions by processing type
  const faqQuestions: typeof questions = [];
  const cacheableQuestions: typeof questions = [];
  const llmQuestions: typeof questions = [];
  
  for (const q of questions) {
    const faq = matchFAQ(q.text);
    if (faq) {
      faqQuestions.push(q);
    } else {
      const classification = classifyQuestion(q.text);
      if (classification.confidence >= 0.6) {
        cacheableQuestions.push(q);
      } else {
        llmQuestions.push(q);
      }
    }
  }
  
  // Process FAQ questions instantly
  for (const q of faqQuestions) {
    const faq = matchFAQ(q.text)!;
    results.set(q.id, {
      answer: getFAQAnswer(faq, q.wordTarget),
      source: 'faq',
      confidence: 1.0,
    });
  }
  
  // Process cacheable questions in parallel
  await Promise.all(
    cacheableQuestions.map(async (q) => {
      const result = await answerCache.get(q.text, q.wordTarget);
      if (result) {
        results.set(q.id, result);
      } else {
        llmQuestions.push(q);
      }
    })
  );
  
  // Process LLM questions in batches to avoid rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < llmQuestions.length; i += BATCH_SIZE) {
    const batch = llmQuestions.slice(i, i + BATCH_SIZE);
    
    await Promise.all(
      batch.map(async (q) => {
        const answer = await generateWithLLM({
          question: q.text,
          wordTarget: q.wordTarget || 150,
          ...context,
        });
        
        results.set(q.id, {
          answer,
          source: 'llm',
          confidence: 0.9,
        });
        
        // Cache for future use
        await answerCache.add(q.text, answer);
      })
    );
    
    // Small delay between batches
    if (i + BATCH_SIZE < llmQuestions.length) {
      await sleep(500);
    }
  }
  
  return results;
}
```

---

## 7. Database Schema

### 7.1 Supabase Schema

```sql
-- Question classification cache
CREATE TABLE question_classifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_hash TEXT NOT NULL UNIQUE,  -- MD5 of normalized question
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  matched_patterns INTEGER DEFAULT 0,
  matched_keywords INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

CREATE INDEX idx_classifications_hash ON question_classifications(question_hash);
CREATE INDEX idx_classifications_type ON question_classifications(question_type);

-- Answer bank
CREATE TABLE answer_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Question metadata
  question_type TEXT NOT NULL,
  question_pattern TEXT NOT NULL,  -- Normalized pattern key
  word_count_target TEXT NOT NULL CHECK (word_count_target IN ('short', 'standard', 'long')),
  
  -- Answer content
  answer_text TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  
  -- Source tracking
  source TEXT NOT NULL CHECK (source IN ('pre_generated', 'llm', 'user_edited')),
  based_on_story_id UUID REFERENCES user_story_bank(id),
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  company_last_used TEXT,
  
  -- Quality tracking
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  is_favorite BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, question_type, word_count_target, answer_text)
);

CREATE INDEX idx_answer_bank_user_type ON answer_bank(user_id, question_type);
CREATE INDEX idx_answer_bank_word_target ON answer_bank(word_count_target);

-- FAQ responses (system-wide, not user-specific)
CREATE TABLE faq_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faq_key TEXT NOT NULL UNIQUE,  -- e.g., 'work_auth_yes'
  
  patterns JSONB NOT NULL,  -- Array of regex patterns
  canonical_question TEXT NOT NULL,
  
  answer_short TEXT NOT NULL,
  answer_standard TEXT NOT NULL,
  answer_long TEXT NOT NULL,
  
  tags TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Answer usage log for analytics
CREATE TABLE answer_usage_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_id UUID REFERENCES answer_bank(id),
  faq_id UUID REFERENCES faq_responses(id),
  
  company_name TEXT,
  job_title TEXT,
  question_text TEXT,
  
  source TEXT NOT NULL,  -- 'cache', 'semantic', 'faq', 'llm'
  confidence REAL,
  processing_time_ms INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_log_user ON answer_usage_log(user_id);
CREATE INDEX idx_usage_log_created ON answer_usage_log(created_at);

-- Embedding cache (for semantic search)
CREATE TABLE answer_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  answer_id UUID REFERENCES answer_bank(id) ON DELETE CASCADE UNIQUE,
  
  embedding VECTOR(768) NOT NULL,  -- Assuming 768-dim embeddings
  model_name TEXT NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable vector similarity search
CREATE INDEX idx_embeddings_vector ON answer_embeddings 
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### 7.2 Local File Cache Schema

```typescript
// cache-schema.ts

interface AnswerCacheFile {
  version: string;
  lastUpdated: string;
  
  // Indexed by question_type:word_category
  answers: {
    [key: string]: Array<{
      id: string;
      questionType: string;
      wordCategory: 'short' | 'standard' | 'long';
      answer: string;
      wordCount: number;
      source: 'pre_generated' | 'llm' | 'user_edited';
      usageCount: number;
      lastUsedAt: string | null;
      companyLastUsed: string | null;
      createdAt: string;
    }>;
  };
  
  // FAQ responses
  faqs: {
    [key: string]: {
      patterns: string[];
      answers: {
        short: string;
        standard: string;
        long: string;
      };
    };
  };
  
  // Classification cache
  classifications: {
    [questionHash: string]: {
      type: string;
      confidence: number;
      cachedAt: string;
    };
  };
}
```

---

## 8. Integration Guide

### 8.1 Integration with Auto-Apply Flow

```typescript
// integration-example.ts

import { AnswerBank } from './answer-bank';
import { fillByLabel } from '../utils/fields';

const answerBank = new AnswerBank();

async function fillBehavioralQuestion(
  page: Page,
  questionLabel: string,
  context: { company: string; role: string }
): Promise<boolean> {
  // Detect word limit from field
  const fieldInfo = await detectFieldInfo(page, questionLabel);
  
  // Get answer from bank
  const result = await answerBank.getAnswer(questionLabel, {
    company: context.company,
    role: context.role,
    wordCountTarget: fieldInfo.wordLimit,
  });
  
  console.log(`[answer-bank] ${questionLabel}`);
  console.log(`  Source: ${result.source}`);
  console.log(`  Confidence: ${result.confidence.toFixed(2)}`);
  console.log(`  Time: ${result.processingTime.toFixed(0)}ms`);
  
  if (!result.answer) {
    console.log('  [!] LLM generation required');
    // Handle LLM fallback if configured
    return false;
  }
  
  // Fill the field
  const filled = await fillByLabel(page, questionLabel, result.answer);
  
  return filled;
}

async function detectFieldInfo(
  page: Page,
  labelText: string
): Promise<{ wordLimit: number | null; fieldType: string }> {
  // Find the field and check for character/word limits
  const label = await page.locator(`label:has-text("${labelText}")`).first();
  const container = await label.locator('xpath=..').first();
  
  // Look for limit text
  const helperText = await container.locator('.helper-text, .char-count, small').textContent();
  const limitMatch = helperText?.match(/(\d+)\s*(?:words?|characters?)/i);
  
  let wordLimit: number | null = null;
  if (limitMatch) {
    const limit = parseInt(limitMatch[1]);
    wordLimit = limitMatch[0].toLowerCase().includes('char') 
      ? Math.floor(limit / 5) 
      : limit;
  }
  
  // Detect field type
  const textarea = await container.locator('textarea').count();
  const input = await container.locator('input[type="text"]').count();
  const fieldType = textarea > 0 ? 'textarea' : 'input';
  
  return { wordLimit, fieldType };
}
```

### 8.2 Usage Example

```typescript
// example-usage.ts

async function applyToJob(jobUrl: string, profile: UserProfile) {
  const answerBank = new AnswerBank({
    cacheDir: './answer-cache',
    enableSemanticSearch: true,
    llmProvider: 'gemini',
    llmApiKey: process.env.GEMINI_API_KEY,
  });
  
  await answerBank.init();
  
  // Pre-warm cache if needed
  if (profile.stories?.length > 0) {
    await answerBank.warmCache(profile.stories);
  }
  
  // During form filling
  const questions = await detectBehavioralQuestions(page);
  
  for (const question of questions) {
    const result = await answerBank.getAnswer(question.text, {
      company: extractCompanyName(jobUrl),
      wordCountTarget: question.wordLimit,
    });
    
    if (result.answer) {
      await fillField(page, question.selector, result.answer);
    } else {
      // Queue for manual review or LLM generation
      console.log(`[!] No cached answer for: ${question.text}`);
    }
  }
  
  // Log stats
  console.log('\n[Answer Bank Stats]');
  console.log(`  FAQ hits: ${stats.faq}`);
  console.log(`  Cache hits: ${stats.cache}`);
  console.log(`  Semantic matches: ${stats.semantic}`);
  console.log(`  LLM generations: ${stats.llm}`);
}
```

---

## Summary

The answer bank implementation provides:

1. **Fast Question Classification** - Rule-based (~1ms) with semantic fallback (~50ms)
2. **Tiered Answer Matching** - FAQ > Exact Cache > Semantic Search > LLM
3. **Smart Caching** - Avoids repetition across companies, learns from usage
4. **Cost Optimization** - Uses LLM only when necessary, selects appropriate model
5. **Performance** - 90%+ of questions answered without LLM calls

Key files to implement:
- `/auto-apply/answer-bank/classifier.ts` - Question classification
- `/auto-apply/answer-bank/matcher.ts` - Answer matching algorithms
- `/auto-apply/answer-bank/faq.ts` - FAQ response system
- `/auto-apply/answer-bank/llm-fallback.ts` - LLM generation
- `/auto-apply/answer-bank/cache.ts` - Caching layer
- `/scraper/autoapply/answer_bank.py` - Python implementation
