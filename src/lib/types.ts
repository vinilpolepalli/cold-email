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
