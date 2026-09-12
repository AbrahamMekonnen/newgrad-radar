import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ valid: false, error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ valid: false, error: 'Invalid URL format' });
    }

    // Try to fetch the URL with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(url, {
        method: 'HEAD', // Just check if it exists, don't download content
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewGradRadar/1.0)',
        },
      });

      clearTimeout(timeout);

      // Accept any 2xx or 3xx response as valid
      if (response.ok || (response.status >= 300 && response.status < 400)) {
        return NextResponse.json({ valid: true });
      }

      // Some sites block HEAD requests, try GET
      const getResponse = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewGradRadar/1.0)',
        },
      });

      if (getResponse.ok) {
        return NextResponse.json({ valid: true });
      }

      return NextResponse.json({ valid: false, error: `URL returned status ${response.status}` });
    } catch (fetchError) {
      clearTimeout(timeout);

      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return NextResponse.json({ valid: false, error: 'Request timed out' });
      }

      return NextResponse.json({ valid: false, error: 'Could not reach URL' });
    }
  } catch (error) {
    return NextResponse.json({ valid: false, error: 'Server error' });
  }
}
