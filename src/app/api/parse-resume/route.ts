import { NextRequest, NextResponse } from 'next/server';
import { ResumeData } from '@/lib/resume-templates';
import crypto from 'crypto';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Gemini models to try in order of preference. gemini-flash-latest is the live
// alias that works on current keys; gemini-2.5-flash is NOT available to new API
// keys (404 "no longer available to new users"), so it must not lead or every
// request wastes a guaranteed-failing first call.
const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
];

// A resume is PERSONAL data, so it must only ever go to providers that DO NOT
// train on their inputs. That rules out the free Gemini tier and Mistral's
// Experiment tier (both train) — those are reserved for public-data crons, never
// here. These are all OpenAI-compatible and no-train, tried in order; each is
// skipped when its key isn't set, so the chain works with whatever is configured.
// Order = fastest/most-generous hosted first, with a self-owned Modal endpoint
// LAST as a scale-to-zero floor (idle = $0) that only runs if all hosted ones are down.
interface OAProvider { name: string; baseUrl: string; apiKey?: string; models: string[]; trainsOnData: boolean }
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const OA_PROVIDERS: OAProvider[] = [
  { name: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey: process.env.NVIDIA_API_KEY,
    models: ['qwen/qwen2.5-7b-instruct', 'meta/llama-3.1-8b-instruct'], trainsOnData: false },
  { name: 'cloudflare', baseUrl: CF_ACCOUNT ? `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1/chat/completions` : '',
    apiKey: process.env.CLOUDFLARE_AI_TOKEN,
    models: ['@cf/qwen/qwen2.5-7b-instruct', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'], trainsOnData: false },
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1/chat/completions', apiKey: GROQ_API_KEY,
    models: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'], trainsOnData: false },
  { name: 'together', baseUrl: 'https://api.together.xyz/v1/chat/completions', apiKey: process.env.TOGETHER_API_KEY,
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'], trainsOnData: false },
  { name: 'cerebras', baseUrl: 'https://api.cerebras.ai/v1/chat/completions', apiKey: process.env.CEREBRAS_API_KEY,
    models: ['llama-3.3-70b', 'gpt-oss-120b'], trainsOnData: false },
  // Owned last-resort floor: your Modal endpoint (Qwen2.5-7B, scale-to-zero).
  // Only reached when every hosted provider above is unavailable; idle costs $0.
  { name: 'modal', baseUrl: process.env.MODAL_LLM_URL || '', apiKey: process.env.MODAL_LLM_SECRET,
    models: [process.env.MODAL_LLM_MODEL || 'qwen2.5-7b-instruct'], trainsOnData: false },
];

// In-memory cache for parsed resumes
// Key: hash of resume text, Value: { data: ResumeData, timestamp: number }
const resumeCache = new Map<string, { data: ResumeData; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function getCachedResume(textHash: string): ResumeData | null {
  const cached = resumeCache.get(textHash);
  if (!cached) return null;

  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL_MS) {
    // Cache expired, remove it
    resumeCache.delete(textHash);
    return null;
  }

  console.log('[parse-resume] Cache hit for hash:', textHash.slice(0, 8));
  return cached.data;
}

function setCachedResume(textHash: string, data: ResumeData): void {
  // Limit cache size to prevent memory issues (max 100 entries)
  if (resumeCache.size >= 100) {
    // Remove oldest entry
    const oldestKey = resumeCache.keys().next().value;
    if (oldestKey) resumeCache.delete(oldestKey);
  }

  resumeCache.set(textHash, { data, timestamp: Date.now() });
  console.log('[parse-resume] Cached resume with hash:', textHash.slice(0, 8));
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let resumeText: string | null = null;

    if (contentType.includes('application/json')) {
      // JSON request with resumeUrl or text
      const body = await request.json();
      const { resumeUrl, text } = body;

      if (resumeUrl) {
        // Fetch resume from URL (Supabase storage)
        console.log('[parse-resume] Fetching from URL:', resumeUrl);
        const response = await fetch(resumeUrl);
        console.log('[parse-resume] Fetch status:', response.status);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          console.log('[parse-resume] PDF buffer size:', buffer.byteLength);
          resumeText = await extractTextFromPDF(buffer);
          console.log('[parse-resume] Extracted text length:', resumeText?.length);
        } else {
          console.error('[parse-resume] Failed to fetch PDF:', response.status, response.statusText);
        }
      } else if (text) {
        resumeText = text;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // URL-encoded form (from fetch with URLSearchParams)
      const body = await request.text();
      const params = new URLSearchParams(body);
      const url = params.get('url');
      const text = params.get('text');

      if (url) {
        // Fetch resume from URL
        const response = await fetch(url);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          resumeText = await extractTextFromPDF(buffer);
        }
      } else if (text) {
        resumeText = text;
      }
    } else {
      // Multipart form data (file upload)
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      const text = formData.get('text') as string | null;

      resumeText = text;

      // If PDF file uploaded, extract text
      if (file && !text) {
        const buffer = await file.arrayBuffer();
        resumeText = await extractTextFromPDF(buffer);
      }
    }

    if (!resumeText || resumeText.trim().length < 50) {
      return NextResponse.json(
        { error: 'Could not extract text from resume. Please paste your resume text.' },
        { status: 400 }
      );
    }

    // Check cache first
    const textHash = hashText(resumeText.trim());
    const cachedResult = getCachedResume(textHash);
    if (cachedResult) {
      return NextResponse.json({ ...cachedResult, _cached: true });
    }

    // Use AI to parse the resume text into structured format
    const parsedResume = await parseResumeWithAI(resumeText);

    // Cache the result
    setCachedResume(textHash, parsedResume);

    // Return the parsed resume directly (for JobCard integration)
    return NextResponse.json(parsedResume);
  } catch (error) {
    console.error('Resume parse error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to parse resume: ${errorMessage}` },
      { status: 500 }
    );
  }
}

async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  // Primary: unpdf — a serverless-optimized PDF extractor that bundles its own
  // pdfjs build with the needed shims, so it works in the Node serverless
  // runtime. (The default pdfjs-dist and pdf-parse both require browser globals
  // like DOMMatrix and throw on the server, silently falling back to near-empty
  // text for a normal compressed PDF — which is why a valid text PDF "couldn't
  // be read".)
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join('\n') : text || '').trim();
    if (merged.length > 30) {
      console.log('[parse-resume] unpdf extracted text length:', merged.length);
      return merged;
    }
    console.warn('[parse-resume] unpdf produced too little text; using raw fallback');
  } catch (e) {
    console.error('[parse-resume] unpdf extraction failed:', e);
  }

  // Last resort: pull any literal (...) strings out of the raw bytes.
  const bytes = new Uint8Array(buffer);
  const rawText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const textMatches = rawText.match(/\((.*?)\)/g) || [];
  const extractedText = textMatches
    .map((m) => m.slice(1, -1))
    .filter((t) => t.length > 2 && /[a-zA-Z]/.test(t))
    .join(' ');
  return extractedText || rawText.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function parseResumeWithAI(resumeText: string): Promise<ResumeData> {
  const hasUsableProvider = OA_PROVIDERS.some((p) => p.apiKey && p.baseUrl);
  if (!hasUsableProvider) {
    throw new Error('No no-train AI provider configured for resume parsing. Set one of: '
      + 'NVIDIA_API_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN, GROQ_API_KEY, '
      + 'TOGETHER_API_KEY, CEREBRAS_API_KEY, or MODAL_LLM_URL + MODAL_LLM_SECRET.');
  }

  const prompt = `Parse this resume text into a structured JSON format. Extract all information accurately - do NOT invent or add anything that isn't in the text.

RESUME TEXT:
${resumeText}

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "name": "Full Name",
  "email": "email@example.com",
  "phone": "phone number or null",
  "linkedin": "linkedin url or null",
  "github": "github url or null",
  "portfolio": "portfolio url or null",
  "location": "city, state or null",
  "education": [
    {
      "school": "University Name",
      "degree": "Degree and Major",
      "location": "City, State",
      "date": "Start - End",
      "gpa": "GPA or null"
    }
  ],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "location": "City, State",
      "date": "Start - End",
      "bullets": ["Achievement 1", "Achievement 2"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "technologies": "Tech1, Tech2, Tech3",
      "date": "Date or null",
      "bullets": ["Description 1", "Description 2"]
    }
  ],
  "skills": [
    {
      "category": "Languages",
      "items": ["Python", "JavaScript", "etc"]
    },
    {
      "category": "Frameworks",
      "items": ["React", "Node.js", "etc"]
    }
  ]
}

Rules:
- Extract EXACTLY what's in the resume, nothing more
- If a section is missing, use empty array []
- Parse bullet points from experience/projects
- Group skills by category if possible
- Keep dates in original format`;

  let lastError: Error | null = null;

  // A resume is PII, so train-on-data providers (free Gemini, Mistral Experiment)
  // are OFF here. Keep this false on the resume path; only a non-PII caller would
  // ever flip it. This is what prevents resume text from being used for training.
  const ALLOW_TRAIN_ON_DATA = false;

  // Gemini (free tier) trains on inputs — disabled for resumes via the flag above.
  if (ALLOW_TRAIN_ON_DATA && GEMINI_API_KEY) {
    for (const model of GEMINI_MODELS) {
      try {
        console.log(`[parse-resume] Trying Gemini model: ${model}`);
        const result = await callGeminiAPI(model, prompt);
        console.log(`[parse-resume] Success with Gemini model: ${model}`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[parse-resume] Gemini ${model} failed:`, lastError.message);

        if (lastError.message.includes('429') || lastError.message.includes('rate limit')) {
          console.log('[parse-resume] Rate limited, waiting 2s before next model...');
          await sleep(2000);
        }
      }
    }
  }

  // Fall through the no-train OpenAI-compatible providers in order (Modal last).
  for (const provider of OA_PROVIDERS) {
    if (!provider.apiKey || !provider.baseUrl) continue;      // not configured
    if (!ALLOW_TRAIN_ON_DATA && provider.trainsOnData) continue; // PII guard
    for (const model of provider.models) {
      try {
        console.log(`[parse-resume] Trying ${provider.name} model: ${model}`);
        const result = await callOpenAICompatibleAPI(provider, model, prompt);
        console.log(`[parse-resume] Success with ${provider.name} model: ${model}`);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[parse-resume] ${provider.name} ${model} failed:`, lastError.message);
        if (lastError.message.includes('429') || lastError.message.includes('rate limit')) {
          await sleep(1500);
        }
      }
    }
  }

  throw lastError || new Error('All AI models failed');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiAPI(model: string, prompt: string): Promise<ResumeData> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[parse-resume] Gemini API error (${model}):`, response.status, errorBody);

    // Handle specific error codes
    if (response.status === 429) {
      throw new Error(`Rate limited (429): ${errorBody.slice(0, 100)}`);
    }
    if (response.status === 400) {
      // Model may not exist or invalid request
      throw new Error(`Bad request (400): ${errorBody.slice(0, 100)}`);
    }
    if (response.status === 403) {
      throw new Error(`API key issue (403): ${errorBody.slice(0, 100)}`);
    }
    if (response.status === 500 || response.status === 503) {
      throw new Error(`Server error (${response.status}): ${errorBody.slice(0, 100)}`);
    }

    throw new Error(`AI parsing failed: ${response.status} - ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();

  // Check for blocked content
  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error('Content was blocked by safety filters');
  }

  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  if (!resultText) {
    throw new Error('Empty response from AI');
  }

  // Extract JSON from response
  const jsonMatch = resultText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response as JSON');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON in response: ${e instanceof Error ? e.message : 'parse error'}`);
  }

  // Ensure all required fields exist
  return {
    name: parsed.name || 'Unknown',
    email: parsed.email || '',
    phone: parsed.phone || undefined,
    linkedin: parsed.linkedin || undefined,
    github: parsed.github || undefined,
    portfolio: parsed.portfolio || undefined,
    location: parsed.location || undefined,
    education: parsed.education || [],
    experience: parsed.experience || [],
    projects: parsed.projects || [],
    skills: parsed.skills || [],
  };
}

async function callOpenAICompatibleAPI(provider: OAProvider, model: string, prompt: string): Promise<ResumeData> {
  const response = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
      // Groq (and some others) front their API with Cloudflare, which 403s the
      // default server/runtime agent (error 1010). A browser UA gets through.
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000,
      // Ask for strict JSON where the provider supports it (ignored otherwise).
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[parse-resume] ${provider.name} API error (${model}):`, response.status, errorBody);
    if (response.status === 429) {
      throw new Error(`Rate limited (429): ${errorBody.slice(0, 100)}`);
    }
    throw new Error(`${provider.name} API failed: ${response.status} - ${errorBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const resultText = data.choices?.[0]?.message?.content || '';
  if (!resultText) {
    throw new Error(`Empty response from ${provider.name}`);
  }

  const jsonMatch = resultText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse ${provider.name} response as JSON`);
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`Invalid JSON in ${provider.name} response: ${e instanceof Error ? e.message : 'parse error'}`);
  }

  return {
    name: parsed.name || 'Unknown',
    email: parsed.email || '',
    phone: parsed.phone || undefined,
    linkedin: parsed.linkedin || undefined,
    github: parsed.github || undefined,
    portfolio: parsed.portfolio || undefined,
    location: parsed.location || undefined,
    education: parsed.education || [],
    experience: parsed.experience || [],
    projects: parsed.projects || [],
    skills: parsed.skills || [],
  };
}

