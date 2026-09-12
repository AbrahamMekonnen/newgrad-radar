import { NextRequest, NextResponse } from 'next/server';
import { ResumeData, generateLatex } from '@/lib/resume-templates';

// Use LaTeX.Online API to compile LaTeX to PDF
const LATEX_API_URL = 'https://latexonline.cc/compile';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const resume: ResumeData = body.resume;

    if (!resume) {
      return NextResponse.json({ error: 'Resume data required' }, { status: 400 });
    }

    // Generate LaTeX code
    const latexCode = generateLatex(resume);

    // Compile via LaTeX.Online API
    const response = await fetch(`${LATEX_API_URL}?text=${encodeURIComponent(latexCode)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/pdf',
      },
    });

    if (!response.ok) {
      // Fallback: try alternative API
      const altResponse = await fetch('https://latex.ytotech.com/builds/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          compiler: 'pdflatex',
          resources: [
            {
              main: true,
              content: latexCode,
            },
          ],
        }),
      });

      if (!altResponse.ok) {
        throw new Error('LaTeX compilation failed');
      }

      const pdfBuffer = await altResponse.arrayBuffer();
      return new NextResponse(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="resume.pdf"',
        },
      });
    }

    const pdfBuffer = await response.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="resume.pdf"',
      },
    });
  } catch (error) {
    console.error('Resume compilation error:', error);
    return NextResponse.json(
      { error: 'Failed to compile resume', details: String(error) },
      { status: 500 }
    );
  }
}
