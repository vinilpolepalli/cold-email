import { UserProfile } from './types';
import { NimAuth, extractJson, nimAvailable, nimChat } from './nim';

type ParsedResume = Omit<UserProfile, 'id' | 'aiSummary' | 'updatedAt'>;

/**
 * Section keywords, matched as substrings of a header line (longest first) so
 * real-world headings like "Technical Skills & Awards" or "Relevant Coursework
 * and Education" still resolve. Order matters: "research interests" must beat
 * "research experience", and "awards" must beat "skills" only when it is the
 * dominant word, which is why skills+awards headers open a skills section and
 * the "Awards:" label inside it routes lines to awards.
 */
type SectionKey = 'education' | 'experience' | 'projects' | 'skills' | 'publications' | 'researchInterests' | 'awards';

const SECTION_KEYWORDS: { pattern: RegExp; key: SectionKey }[] = [
  { pattern: /research\s+(interests|areas|focus)|areas\s+of\s+interest/i, key: 'researchInterests' },
  { pattern: /education|academic\s+background|coursework/i, key: 'education' },
  { pattern: /publication|papers|posters|preprints|conference/i, key: 'publications' },
  { pattern: /project|portfolio/i, key: 'projects' },
  { pattern: /skill|technolog|technical|languages\s*&|tools/i, key: 'skills' },
  { pattern: /award|honor|achievement|activit|leadership/i, key: 'awards' },
  { pattern: /experience|employment|work\s+history|internship|positions?/i, key: 'experience' },
];

/** Labels that appear *inside* a skills block, e.g. "Languages: Python, ...". */
const AWARD_LABEL = /^(awards?|honors?|achievements?)\b/i;

function normalize(raw: string): string {
  return (
    raw
      // join words split across a line break: "tran-\nscription" -> "transcription"
      .replace(/(\w)[-‐‑]\s*\n\s*(\w)/g, '$1$2')
      .replace(/\r/g, '')
      // normalize bullet glyphs so entry detection has one shape to look for
      .replace(/^[\s]*[•·▪◦‣*•●▪]\s*/gm, '• ')
      .replace(/^[\s]*[-–—]\s+(?=[A-Z0-9])/gm, '• ')
      // Resume text often carries em/en dashes; fold them to hyphens so they
      // do not travel into generated emails.
      .replace(/\s*[—–]\s*/g, ' - ')
      .replace(/[ \t]+/g, ' ')
  );
}

/** A header is a short, punctuation-light line that names a section. */
function headerKey(line: string): SectionKey | null {
  const t = line.trim();
  if (!t || t.startsWith('• ')) return null;
  if (t.length > 48) return null;
  if (t.includes('@') || /\d{3}[-.)]\d{3}/.test(t)) return null;
  // Headers rarely end in a period or carry many commas (that reads as content).
  if (/[.;]$/.test(t) || (t.match(/,/g) ?? []).length > 1) return null;
  const words = t.split(/\s+/).length;
  if (words > 6) return null;
  for (const { pattern, key } of SECTION_KEYWORDS) {
    if (pattern.test(t)) return key;
  }
  return null;
}

function isContinuation(line: string, previous: string): boolean {
  if (!previous) return false;
  if (line.startsWith('• ')) return false;
  // A wrapped line either starts lowercase/numeric, or the previous line ended
  // without terminal punctuation.
  return /^[a-z0-9(]/.test(line) || !/[.!?;:]$/.test(previous);
}

/**
 * Group a section's lines into readable entries. Consecutive non-bullet lines
 * form a header (company + role + dates, often wrapped over two lines) which is
 * merged into the first bullet beneath it, so an entry reads like a sentence
 * rather than a fragment.
 */
function groupEntries(lines: string[]): string[] {
  const entries: string[] = [];
  let headerBuf: string[] = [];

  const flushHeader = () => {
    if (headerBuf.length) {
      entries.push(headerBuf.join(' | '));
      headerBuf = [];
    }
  };

  for (const line of lines) {
    const isBullet = line.startsWith('• ');
    const text = isBullet ? line.slice(2).trim() : line.trim();
    if (!text) continue;

    if (isBullet) {
      if (headerBuf.length) {
        entries.push(`${headerBuf.join(' | ')}: ${text}`);
        headerBuf = [];
      } else {
        entries.push(text);
      }
      continue;
    }

    const last = entries[entries.length - 1] ?? '';
    if (!headerBuf.length && isContinuation(text, last)) {
      entries[entries.length - 1] = `${last} ${text}`.replace(/\s+/g, ' ');
      continue;
    }
    if (headerBuf.length && isContinuation(text, headerBuf[headerBuf.length - 1])) {
      headerBuf[headerBuf.length - 1] = `${headerBuf[headerBuf.length - 1]} ${text}`;
      continue;
    }
    headerBuf.push(text);
  }
  flushHeader();
  return entries.map((e) => e.trim()).filter((e) => e.length > 2);
}

function splitSkillList(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((s) => s.replace(/^[-–•\s]+/, '').trim())
    .filter((s) => s.length > 1 && s.length < 45);
}

/**
 * pdfjs (under pdf-parse) expects browser globals that Node does not define.
 * Serverless runtimes fail at module load with "DOMMatrix is not defined", so
 * install minimal stand-ins first. Only text extraction is used here, so these
 * need to carry affine transform math, not real rendering.
 */
function ensurePdfGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;

  if (typeof g.DOMMatrix === 'undefined') {
    class DOMMatrixPolyfill {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
      multiplySelf(o: DOMMatrixPolyfill) {
        const { a, b, c, d, e, f } = this;
        this.a = a * o.a + c * o.b;
        this.b = b * o.a + d * o.b;
        this.c = a * o.c + c * o.d;
        this.d = b * o.c + d * o.d;
        this.e = a * o.e + c * o.f + e;
        this.f = b * o.e + d * o.f + f;
        return this;
      }
      multiply(o: DOMMatrixPolyfill) {
        return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(o);
      }
      translateSelf(tx = 0, ty = 0) {
        this.e += this.a * tx + this.c * ty;
        this.f += this.b * tx + this.d * ty;
        return this;
      }
      translate(tx = 0, ty = 0) {
        return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(tx, ty);
      }
      scaleSelf(sx = 1, sy = sx) {
        this.a *= sx; this.b *= sx; this.c *= sy; this.d *= sy;
        return this;
      }
      scale(sx = 1, sy = sx) {
        return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(sx, sy);
      }
      invertSelf() {
        const det = this.a * this.d - this.b * this.c;
        if (!det) return this;
        const { a, b, c, d, e, f } = this;
        this.a = d / det;
        this.b = -b / det;
        this.c = -c / det;
        this.d = a / det;
        this.e = (c * f - d * e) / det;
        this.f = (b * e - a * f) / det;
        return this;
      }
      inverse() {
        return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf();
      }
      transformPoint(p: { x?: number; y?: number } = {}) {
        const x = p.x ?? 0;
        const y = p.y ?? 0;
        return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
      }
      toString() {
        return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`;
      }
    }
    g.DOMMatrix = DOMMatrixPolyfill;
  }

  if (typeof g.Path2D === 'undefined') {
    class Path2DPolyfill {
      addPath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      arc() {}
      rect() {}
      closePath() {}
    }
    g.Path2D = Path2DPolyfill;
  }

  if (typeof g.ImageData === 'undefined') {
    class ImageDataPolyfill {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth: number, maybeHeight?: number) {
        if (typeof widthOrData === 'number') {
          this.width = widthOrData;
          this.height = heightOrWidth;
          this.data = new Uint8ClampedArray(this.width * this.height * 4);
        } else {
          this.data = widthOrData;
          this.width = heightOrWidth;
          this.height = maybeHeight ?? Math.floor(widthOrData.length / 4 / heightOrWidth);
        }
      }
    }
    g.ImageData = ImageDataPolyfill;
  }
}

export async function parseResumePdf(buffer: Buffer): Promise<string> {
  ensurePdfGlobals();
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export function parseResumeText(raw: string): ParsedResume {
  const normalized = normalize(raw);
  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const emailMatch = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';

  // Name: the first content line that reads like a person's name and is not a
  // section header or contact line.
  const name =
    lines.find(
      (l) =>
        l.length > 3 &&
        l.length < 60 &&
        !l.includes('@') &&
        !/\d/.test(l) &&
        !headerKey(l) &&
        !l.startsWith('• ') &&
        /^[A-Z][A-Za-z.'-]*(\s+[A-Z][A-Za-z.'-]*){1,3}$/.test(l)
    ) ?? 'Unknown';

  const buckets: Record<SectionKey, string[]> = {
    education: [],
    experience: [],
    projects: [],
    skills: [],
    publications: [],
    researchInterests: [],
    awards: [],
  };

  let current: SectionKey | null = null;
  for (const line of lines) {
    const key = headerKey(line);
    if (key) {
      // A skills-and-awards style header opens skills; inline "Awards:" labels
      // below still route into the awards bucket.
      current = key;
      continue;
    }
    if (current) buckets[current].push(line);
  }

  // Skills blocks are usually "Label: a, b, c" lines, and a long label's list
  // often wraps onto unlabelled lines below it. Track the active label so those
  // continuations land in the same bucket, which keeps award text (a common
  // neighbour of skills) out of the skills list.
  const skills: string[] = [];
  let activeLabelIsAward = false;
  for (const line of buckets.skills) {
    const text = line.replace(/^•\s*/, '');
    const labelSplit = text.match(/^([A-Za-z /&]{2,30}):\s*(.+)$/);
    if (labelSplit) {
      const [, label, value] = labelSplit;
      activeLabelIsAward = AWARD_LABEL.test(label.trim());
      if (activeLabelIsAward) buckets.awards.push(value.trim());
      else skills.push(...splitSkillList(value));
      continue;
    }
    if (activeLabelIsAward) buckets.awards.push(text);
    else skills.push(...splitSkillList(text));
  }

  // Join first, then split: an award list wrapped across lines must be
  // reassembled before splitting, or entries break mid-name.
  const awards = buckets.awards
    .map((line) => line.replace(/^•\s*/, '').trim())
    .join(' ')
    .split(/;|\s{2,}/)
    .map((a) => a.trim())
    .filter((a) => a.length > 2 && a.length < 160);

  return {
    name,
    email,
    education: groupEntries(buckets.education).slice(0, 8),
    experience: groupEntries(buckets.experience).slice(0, 14),
    projects: groupEntries(buckets.projects).slice(0, 12),
    skills: [...new Set(skills)].slice(0, 28),
    publications: groupEntries(buckets.publications).slice(0, 10),
    researchInterests: groupEntries(buckets.researchInterests)
      .flatMap((l) => (l.includes(',') && l.length < 200 ? l.split(',') : [l]))
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8),
    awards: awards.slice(0, 12),
    rawResumeText: raw.slice(0, 20000),
  };
}

const AI_PARSE_SYSTEM = `You extract structured data from a resume. Reply ONLY with JSON matching:
{"name":string,"email":string,"education":string[],"experience":string[],"projects":string[],"skills":string[],"publications":string[],"researchInterests":string[],"awards":string[],"summary":string}

Rules:
- Copy facts from the resume only. Never invent employers, schools, metrics, or skills.
- education/experience/projects: one complete, readable entry per item. Each entry names the organization or project and what the person did, joining any lines the PDF wrapped. Keep concrete numbers where present.
- skills: individual technologies or methods, not sentences.
- researchInterests: only topics the resume itself indicates through their work; empty array if unclear.
- summary: 2-3 sentences in the FIRST PERSON ("I study...", "I built..."), for the opening of a cold email to a professor: strongest research and technical work plus focus areas.
- Never use em-dashes or en-dashes; use periods or commas.
- Use "" or [] for anything absent.`;

/** LLM-based extraction; returns null when unavailable so callers fall back. */
export async function aiParseResume(
  raw: string,
  nimAuth?: NimAuth
): Promise<(ParsedResume & { summary: string }) | null> {
  if (!nimAvailable(nimAuth)) return null;
  try {
    const reply = await nimChat(
      [
        { role: 'system', content: AI_PARSE_SYSTEM },
        { role: 'user', content: raw.slice(0, 14000) },
      ],
      { temperature: 0.1, maxTokens: 2000 },
      nimAuth
    );
    const parsed = extractJson<Record<string, unknown>>(reply);
    const list = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : [];
    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const name = str(parsed.name);
    // A result with no name and no sections means the model misfired; let the
    // deterministic parser handle it instead of saving an empty profile.
    if (!name && list(parsed.experience).length === 0 && list(parsed.education).length === 0) return null;

    return {
      name: name || 'Unknown',
      email: str(parsed.email),
      education: list(parsed.education).slice(0, 8),
      experience: list(parsed.experience).slice(0, 14),
      projects: list(parsed.projects).slice(0, 12),
      skills: list(parsed.skills).slice(0, 28),
      publications: list(parsed.publications).slice(0, 10),
      researchInterests: list(parsed.researchInterests).slice(0, 8),
      awards: list(parsed.awards).slice(0, 12),
      rawResumeText: raw.slice(0, 20000),
      summary: str(parsed.summary),
    };
  } catch {
    return null;
  }
}

export async function summarize(
  profile: ParsedResume,
  nimAuth?: NimAuth
): Promise<{ summary: string; generator: 'nim' | 'template' }> {
  if (nimAvailable(nimAuth)) {
    try {
      const reply = await nimChat(
        [
          {
            role: 'system',
            content:
              'You summarize a resume into 2-3 sentences written in the first person ("I study...", "I built..."), for the opening of a cold email to a professor. Focus on education, strongest research and technical experience, and focus areas. Never use em-dashes; use periods or commas. No preamble; reply with the summary only.',
          },
          { role: 'user', content: profile.rawResumeText.slice(0, 8000) },
        ],
        { temperature: 0.3, maxTokens: 200 },
        nimAuth
      );
      return { summary: reply.trim(), generator: 'nim' };
    } catch {
      // fall through to the deterministic summary
    }
  }
  return { summary: templateSummary(profile), generator: 'template' };
}

/** Strip city/state and date tails so an entry reads as a name, not a record. */
export function cleanHeadline(entry: string): string {
  return entry
    .split(':')[0]
    .split('|')[0]
    .replace(/\s+(Expected|Anticipated|Present).*$/i, '')
    .replace(
      /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}.*$/i,
      ''
    )
    .replace(/\s+[A-Z][a-zA-Z .]+,\s*[A-Z]{2}\b/, '')
    .replace(/[,\s]+$/, '')
    .trim();
}

/**
 * Deterministic summary used when no LLM key is configured. Written in the
 * first person because its main consumer is the body of the user's own email.
 */
export function templateSummary(profile: ParsedResume): string {
  const sentences: string[] = [];

  const school = profile.education[0];
  if (school) sentences.push(`I study at ${cleanHeadline(school)}.`);

  const topExperience = profile.experience[0] ?? profile.projects[0];
  if (topExperience) {
    const [head, ...rest] = topExperience.split(':');
    const detail = rest.join(':').trim();
    const where = cleanHeadline(head);
    const trimmed = detail.length > 200 ? `${detail.slice(0, 197)}...` : detail;
    sentences.push(where && trimmed ? `At ${where}, I ${lowerFirst(trimmed)}` : `Recently I worked on ${topExperience.slice(0, 200)}`);
  }

  if (profile.skills.length) sentences.push(`I work with ${profile.skills.slice(0, 8).join(', ')}.`);

  return sentences.join(' ') || 'I am an aspiring researcher.';
}

function lowerFirst(text: string): string {
  const t = text.trim();
  if (!t) return t;
  // Only lowercase plain verbs, never acronyms or proper nouns.
  if (/^[A-Z]{2,}/.test(t)) return t;
  const out = t.charAt(0).toLowerCase() + t.slice(1);
  return /[.!?]$/.test(out) ? out : `${out}.`;
}
