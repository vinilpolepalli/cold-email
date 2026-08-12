import { UserProfile } from './types';
import { nimAvailable, nimChat } from './nim';

const SECTION_HEADERS: Record<string, keyof Pick<UserProfile, 'education' | 'experience' | 'projects' | 'skills' | 'publications' | 'researchInterests'>> = {
  education: 'education',
  'academic background': 'education',
  experience: 'experience',
  'work experience': 'experience',
  'research experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
  projects: 'projects',
  'selected projects': 'projects',
  skills: 'skills',
  'technical skills': 'skills',
  publications: 'publications',
  'papers': 'publications',
  'research interests': 'researchInterests',
  interests: 'researchInterests',
};

export async function parseResumePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export function parseResumeText(raw: string): Omit<UserProfile, 'id' | 'aiSummary' | 'updatedAt'> {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const emailMatch = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';

  // Name heuristic: first line that isn't contact info or a section header.
  const name =
    lines.find(
      (l) =>
        l.length < 60 &&
        !l.includes('@') &&
        !/\d{3}/.test(l) &&
        !SECTION_HEADERS[l.toLowerCase().replace(/[:\s]+$/, '')] &&
        /^[A-Za-z][A-Za-z .'-]+$/.test(l)
    ) ?? 'Unknown';

  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/[:\s]+$/, '');
    const target = SECTION_HEADERS[normalized];
    if (target) {
      current = target;
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
  }

  const grab = (key: string, max = 8): string[] => (sections[key] ?? []).slice(0, max);

  // Skills are often comma-separated on a few lines.
  const skills = grab('skills', 6)
    .flatMap((l) => l.split(/[,;•|]/))
    .map((s) => s.replace(/^[-–\s]+/, '').trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, 20);

  return {
    name,
    email,
    education: grab('education'),
    experience: grab('experience', 12),
    projects: grab('projects'),
    skills,
    publications: grab('publications'),
    researchInterests: grab('researchInterests', 6),
    rawResumeText: raw.slice(0, 20000),
  };
}

export async function summarize(profile: Omit<UserProfile, 'id' | 'aiSummary' | 'updatedAt'>): Promise<{ summary: string; generator: 'nim' | 'template' }> {
  if (nimAvailable()) {
    try {
      const reply = await nimChat(
        [
          {
            role: 'system',
            content:
              'You summarize a candidate resume into 2-3 sentences, third person, for use in a cold email to a professor. Focus on education, strongest research/technical experience, and interests. Never use em-dashes; use periods or commas. No preamble; reply with the summary only.',
          },
          { role: 'user', content: profile.rawResumeText.slice(0, 8000) },
        ],
        { temperature: 0.3, maxTokens: 200 }
      );
      return { summary: reply.trim(), generator: 'nim' };
    } catch {
      // fall through to the template summary
    }
  }
  const parts: string[] = [];
  if (profile.education[0]) parts.push(profile.education[0]);
  if (profile.experience[0]) parts.push(`Experience includes: ${profile.experience.slice(0, 2).join('; ')}`);
  if (profile.skills.length) parts.push(`Key skills: ${profile.skills.slice(0, 6).join(', ')}`);
  return { summary: parts.join('. ') || 'Aspiring researcher.', generator: 'template' };
}
