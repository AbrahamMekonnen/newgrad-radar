# AI Options for Job Application Auto-Fill System

> **Note**: Pricing and limits as of mid-2025. Verify current rates before implementation.
> Last updated: September 2026

## Overview

This document evaluates AI options for a job application system serving 20+ users with needs for:
- Generating application answers
- Parsing resumes
- Classifying jobs

---

## 1. Free Tier Options

### Google Gemini (AI Studio)

| Model | Free Tier Limits | Quality |
|-------|------------------|---------|
| Gemini 1.5 Flash | 15 RPM, 1M tokens/day, 1,500 requests/day | Good for simple tasks |
| Gemini 1.5 Pro | 2 RPM, 32K tokens/day, 50 requests/day | Better quality, very limited |
| Gemini 2.0 Flash | 10 RPM, 1M tokens/day | Latest, fast |

**Pros:**
- Generous token limits on Flash models
- 1M context window available
- Good for bulk processing during off-peak

**Cons:**
- Per-minute rate limits restrictive for concurrent users
- Quality concerns noted (user feedback: "not great")
- Vertex AI requires billing enabled

**Best for:** Batch processing, non-time-sensitive tasks

---

### Groq (Free Tier)

| Model | Free Limits | Speed |
|-------|-------------|-------|
| Llama 3.1 70B | 30 RPM, 14,400 requests/day | ~500 tokens/sec |
| Llama 3.1 8B | 30 RPM, 14,400 requests/day | ~750 tokens/sec |
| Mixtral 8x7B | 30 RPM, 14,400 requests/day | ~480 tokens/sec |

**Pros:**
- Extremely fast inference (fastest available)
- Decent daily request limits
- Open-source models, no lock-in

**Cons:**
- Limited model selection (open-source only)
- Context windows smaller than proprietary models
- Quality varies by task (noted: "limited")

**Best for:** High-volume, simple classification tasks

---

### OpenRouter (Free Models)

OpenRouter aggregates providers and offers some free models:

| Model | Cost | Notes |
|-------|------|-------|
| meta-llama/llama-3.1-8b-instruct:free | $0.00 | Rate limited |
| google/gemma-2-9b-it:free | $0.00 | Rate limited |
| mistralai/mistral-7b-instruct:free | $0.00 | Rate limited |
| nousresearch/nous-hermes-2-mixtral | $0.00 | Uncensored |

**Pros:**
- Single API for multiple providers
- Fallback routing between models
- Some models truly free

**Cons:**
- Free models heavily rate limited (~20 req/min shared)
- Queue delays during peak times
- Credit system can be confusing

**Best for:** Development/testing, fallback provider

---

### Hugging Face Inference API

| Tier | Limits | Cost |
|------|--------|------|
| Free | 1,000 requests/day, rate limited | $0 |
| Pro | 20,000 requests/day | $9/month |

**Models available:** Llama, Mistral, Falcon, custom fine-tunes

**Pros:**
- Access to thousands of models
- Can deploy custom fine-tuned models
- Serverless inference

**Cons:**
- Cold starts on free tier (30s+ delays)
- Free tier severely rate limited
- Quality varies wildly by model

**Best for:** Specialized models, experimentation

---

### Cloudflare Workers AI

| Model | Free Limits |
|-------|-------------|
| @cf/meta/llama-3-8b-instruct | 10,000 neurons/day (free) |
| @cf/mistral/mistral-7b-instruct | 10,000 neurons/day |

**Conversion:** ~1,000 neurons = 750 tokens input or 250 tokens output

**Pros:**
- Edge deployment (low latency)
- Integrated with Workers ecosystem
- No cold starts

**Cons:**
- Limited model selection
- Neuron pricing confusing
- ~7,500 input tokens/day or ~2,500 output tokens/day free

**Best for:** Edge use cases, existing Cloudflare users

---

### Together.ai (Free Tier)

| Offer | Value |
|-------|-------|
| Sign-up credits | $5 free (promotional) |
| Free models | Some Llama variants |

**Pricing after credits:**
- Llama 3.1 8B: $0.18/M tokens
- Llama 3.1 70B: $0.88/M tokens

**Pros:**
- Fast inference
- Good model selection
- Fine-tuning available

**Cons:**
- Free credits deplete quickly
- No true free tier after credits

**Best for:** Testing, short-term projects

---

### Mistral API (La Plateforme)

| Model | Free Tier | Paid Rate |
|-------|-----------|-----------|
| Mistral Small | Limited free trial | $0.2/M input, $0.6/M output |
| Mistral Medium | Limited free trial | $2.7/M input, $8.1/M output |
| Mistral Large | No free tier | $4/M input, $12/M output |

**Pros:**
- High-quality European models
- Good for multilingual tasks
- Competitive pricing

**Cons:**
- Free tier is trial only
- Rate limits not well documented

**Best for:** Quality-conscious budget users

---

## 2. Cheap Options (<$10/month for 20 users)

### Usage Estimates

For a job application system with 20 users:
- **Resumes parsed:** 20 resumes/month = ~30K tokens
- **Jobs classified:** 100 jobs/user/month = 2,000 jobs = ~200K tokens
- **Answers generated:** 50 applications/user/month = 1,000 apps = ~500K tokens
- **Total estimate:** ~730K tokens/month input, ~365K tokens output

---

### Claude 3.5 Haiku (Anthropic)

| Metric | Value |
|--------|-------|
| Input | $0.25/M tokens |
| Output | $1.25/M tokens |
| Context | 200K tokens |

**Monthly cost estimate:**
- Input: 730K x $0.25/M = $0.18
- Output: 365K x $1.25/M = $0.46
- **Total: ~$0.64/month**

**Pros:**
- Excellent quality for the price
- Fast inference
- Strong instruction following
- Best-in-class for structured outputs

**Cons:**
- Requires API key management
- Anthropic API rate limits

**Best for:** Production workloads, quality-critical tasks

---

### GPT-4o-mini (OpenAI)

| Metric | Value |
|--------|-------|
| Input | $0.15/M tokens |
| Output | $0.60/M tokens |
| Context | 128K tokens |

**Monthly cost estimate:**
- Input: 730K x $0.15/M = $0.11
- Output: 365K x $0.60/M = $0.22
- **Total: ~$0.33/month**

**Pros:**
- Cheapest quality option
- OpenAI reliability
- Structured outputs support
- Fast

**Cons:**
- Slightly lower quality than Haiku
- OpenAI rate limits

**Best for:** High volume, cost-sensitive applications

---

### DeepSeek (DeepSeek API)

| Model | Input | Output |
|-------|-------|--------|
| DeepSeek-V2 | $0.14/M tokens | $0.28/M tokens |
| DeepSeek-V2.5 | $0.14/M tokens | $0.28/M tokens |
| DeepSeek-Coder | $0.14/M tokens | $0.28/M tokens |

**Monthly cost estimate:**
- Input: 730K x $0.14/M = $0.10
- Output: 365K x $0.28/M = $0.10
- **Total: ~$0.20/month**

**Pros:**
- Extremely cheap
- Surprisingly capable
- Good for coding tasks

**Cons:**
- China-based company (data concerns)
- Sometimes inconsistent availability
- Less documentation

**Best for:** Maximum cost savings, non-sensitive data

---

### Local Models (Ollama)

| Model | VRAM Required | Quality |
|-------|---------------|---------|
| Llama 3.1 8B | 8GB | Good |
| Llama 3.1 70B | 48GB | Excellent |
| Mistral 7B | 8GB | Good |
| Phi-3 | 4GB | Decent |

**Cost:** Hardware only (free inference)

**Pros:**
- Zero per-token costs
- Complete data privacy
- No rate limits
- No API dependency

**Cons:**
- Requires server/GPU
- Setup complexity
- Lower quality than cloud models
- Maintenance burden

**Best for:** Privacy-critical, high-volume, technical teams

---

## 3. Cost Comparison Matrix

| Provider | Monthly Cost (20 users) | Quality | Rate Limits | Reliability |
|----------|-------------------------|---------|-------------|-------------|
| DeepSeek | $0.20 | Good | Moderate | Medium |
| GPT-4o-mini | $0.33 | Very Good | Generous | Excellent |
| Claude Haiku | $0.64 | Excellent | Generous | Excellent |
| Groq (free) | $0.00 | Good | Tight | Good |
| Gemini Flash (free) | $0.00 | Moderate | Tight | Good |
| OpenRouter (free) | $0.00 | Varies | Very Tight | Fair |
| Ollama (local) | $0 + hardware | Good-Excellent | None | Self-managed |

---

## 4. Recommendations

### Tier 1: Best Quality/Cost Balance

**Primary: Claude 3.5 Haiku**
- $0.64/month for 20 users is negligible
- Best instruction following
- Excellent for structured outputs (resume parsing)
- Most reliable for production

**Fallback: GPT-4o-mini**
- Even cheaper at $0.33/month
- Good reliability

### Tier 2: Zero-Cost Options

**Primary: Groq (Llama 3.1 70B)**
- Fast and free
- 14,400 requests/day should handle 20 users
- Good quality for most tasks

**Fallback: Gemini 1.5 Flash**
- 1,500 free requests/day
- Use for overflow

### Tier 3: Hybrid Approach (Recommended)

```
Job Classification (high volume, simple)
  └── Groq Free (Llama 3.1 70B)
      └── Fallback: Gemini Flash Free

Resume Parsing (structured output needed)
  └── Claude Haiku ($0.64/mo)
      └── Fallback: GPT-4o-mini

Answer Generation (quality critical)
  └── Claude Haiku
      └── Fallback: GPT-4o-mini
```

**Estimated monthly cost with hybrid:** $0.30-0.50/month

---

## 5. Implementation Notes

### Groq Integration

```typescript
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function classifyJob(jobDescription: string) {
  const completion = await groq.chat.completions.create({
    messages: [{ role: 'user', content: `Classify this job: ${jobDescription}` }],
    model: 'llama-3.1-70b-versatile',
    temperature: 0.1,
  });
  return completion.choices[0].message.content;
}
```

### Claude Haiku Integration

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function parseResume(resumeText: string) {
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `Parse this resume: ${resumeText}` }],
  });
  return response.content[0].text;
}
```

### GPT-4o-mini Integration

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateAnswer(question: string, context: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: `Answer: ${question}\nContext: ${context}` }],
    temperature: 0.7,
  });
  return response.choices[0].message.content;
}
```

### Fallback Pattern

```typescript
async function callWithFallback(prompt: string, task: 'classify' | 'parse' | 'generate') {
  const providers = {
    classify: [groqCall, geminiCall],
    parse: [claudeCall, openaiCall],
    generate: [claudeCall, openaiCall, groqCall],
  };
  
  for (const provider of providers[task]) {
    try {
      return await provider(prompt);
    } catch (error) {
      console.warn(`Provider failed, trying next...`);
    }
  }
  throw new Error('All providers failed');
}
```

### Rate Limit Handling

```typescript
import pLimit from 'p-limit';

// Groq: 30 RPM
const groqLimit = pLimit(25);  // Leave buffer

// Gemini: 15 RPM
const geminiLimit = pLimit(12);

async function batchClassify(jobs: string[]) {
  return Promise.all(
    jobs.map(job => groqLimit(() => classifyJob(job)))
  );
}
```

---

## 6. API Key Sources

| Provider | Sign-up URL | Notes |
|----------|-------------|-------|
| Anthropic | console.anthropic.com | Credit card required |
| OpenAI | platform.openai.com | Credit card required |
| Groq | console.groq.com | Free, no card |
| Google AI | aistudio.google.com | Free, no card |
| DeepSeek | platform.deepseek.com | Prepaid credits |
| OpenRouter | openrouter.ai | Various options |
| Together.ai | api.together.xyz | Free credits on signup |

---

## 7. Final Recommendation

For a job application system serving 20+ users:

**Start with the hybrid approach:**
1. Sign up for **Groq** (free) for job classification
2. Add **Claude Haiku** (~$1/month) for resume parsing and answer generation
3. Add **Gemini Flash** (free) as a fallback

**Total estimated cost: $0.50-1.00/month**

This gives you:
- High quality where it matters (Haiku for answers)
- Zero cost for high-volume classification (Groq)
- Resilient fallbacks
- Room to scale without architecture changes

---

## Appendix: Quick Reference

### Tokens per Task (estimates)

| Task | Input Tokens | Output Tokens |
|------|--------------|---------------|
| Resume parse | 1,500 | 500 |
| Job classify | 100 | 20 |
| Answer generate | 500 | 300 |

### Monthly Token Budget (20 users)

| Task | Requests | Total Input | Total Output |
|------|----------|-------------|--------------|
| Resume parse | 20 | 30K | 10K |
| Job classify | 2,000 | 200K | 40K |
| Answer generate | 1,000 | 500K | 300K |
| **Total** | 3,020 | 730K | 350K |
