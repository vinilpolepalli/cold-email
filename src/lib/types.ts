export interface ResearcherProfile {
  id: string;
  name: string;
  title: string;
  school: string;
  department: string;
  email: string | null;
  website: string | null;
  researchAreas: string[];
  bio: string | null;
  sourceUrl: string;
  scrapedFrom?: string; // set when added via the in-app scraper
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  education: string[];
  experience: string[];
  projects: string[];
  skills: string[];
  publications: string[];
  researchInterests: string[];
  awards: string[];
  aiSummary: string;
  rawResumeText: string;
  updatedAt: string;
  // Optional because profiles saved before these existed must keep loading.
  // The email opens with "I am a <standing> at <school>" and signs off with the
  // degree and class year, so these are asked for directly rather than being
  // re-derived from an education line on every draft.
  standing?: string;
  school?: string;
  gradYear?: string;
  degree?: string;
}

/** One of a researcher's papers, as shown on their profile and cited in drafts. */
export interface Publication {
  title: string;
  year: number | null;
  venue: string | null;
  authors: string[];
  citations: number | null;
  doi: string | null;
  /** Landing page: publisher, repository, or doi.org. */
  url: string | null;
  /** Direct PDF, only when the work is openly accessible. */
  pdfUrl: string | null;
  abstract: string | null;
}

/** A researcher's publication record, cached per researcher. */
export interface ResearcherWorks {
  researcherId: string;
  /** Author name as the provider spells it, which may differ from ours. */
  authorName: string | null;
  authorUrl: string | null;
  worksCount: number | null;
  citedByCount: number | null;
  topics: string[];
  publications: Publication[];
  provider: 'openalex' | 'crossref' | 'none';
  fetchedAt: string;
}

export interface OutboxEntry {
  id: string;
  userId: string;
  researcherId: string;
  researcherName: string;
  to: string;
  subject: string;
  body: string;
  attachmentName?: string | null;
  method: 'gmail-oauth' | 'smtp' | 'resend' | 'demo-outbox';
  status: 'sent' | 'queued' | 'failed';
  detail: string | null;
  createdAt: string;
}

export interface GeneratedDraft {
  subject: string;
  body: string;
  generator: 'nim' | 'template';
}
