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
  /**
   * Where this address was published, when that is not `sourceUrl`.
   *
   * Kept separate because the two answer different questions. `sourceUrl` is
   * the directory page the person was found on; this is the page the address
   * itself appeared on. For most entries they are the same and this is unset.
   * It is set for addresses recovered from a researcher's own papers, where
   * the department page lists no address at all.
   */
  emailSource?: string;
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
  major?: string;
}

/**
 * A paper the sender says they have read, used for the paragraph that proves
 * this email was written for one person. Either picked from the researcher's
 * publication record or supplied by hand on the compose screen.
 */
export interface FocusPaper {
  title: string | null;
  url: string | null;
  venue: string | null;
  year: number | null;
  abstract: string | null;
  /** What the sender took from it, in their own words. Wins over the abstract. */
  notes: string | null;
  source: 'matched' | 'manual';
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

/**
 * Someone else worth copying on the email: the professor's assistant, a lab
 * manager, a postdoc who runs the project. Every address here was published on
 * a page we fetched, never constructed, same rule as researcher emails.
 */
export interface LabContact {
  name: string | null;
  role: string | null;
  email: string;
  /** admin: assistants and coordinators. lab: people doing the research. */
  kind: 'admin' | 'lab';
  sourceUrl: string;
}

export interface ContactLookup {
  researcherId: string;
  contacts: LabContact[];
  /** Pages actually read, so the UI can say where an address came from. */
  pagesChecked: string[];
  fetchedAt: string;
}

/**
 * The research directions the sender is pursuing. Declared here rather than in
 * tracks.ts so records that carry a track (outbox entries, campaign targets)
 * can be typed without importing the classifier they have no use for.
 */
export type TrackId = 'cs-core' | 'cs-bio' | 'cs-robotics' | 'cs-other';

export interface OutboxEntry {
  id: string;
  userId: string;
  researcherId: string;
  researcherName: string;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  attachmentName?: string | null;
  method: 'school-gmail' | 'gmail-oauth' | 'smtp' | 'resend' | 'demo-outbox';
  status: 'sent' | 'queued' | 'failed';
  detail: string | null;
  createdAt: string;
  // ── added for campaigns and follow-ups; all optional so entries written
  //    before they existed keep loading.
  /** Gmail's thread id, so a follow-up lands on the original conversation
   *  rather than starting a second one the professor has to reconcile. */
  threadId?: string | null;
  /** The RFC822 Message-ID, quoted in a follow-up's In-Reply-To so mail clients
   *  other than Gmail also thread the nudge onto the original. */
  rfcMessageId?: string | null;
  /** Which track this email belonged to, for the per-track approval gate. */
  trackId?: TrackId;
  /** True when a routine sent this unattended, false when a human pressed send.
   *  The gate counts only the reviewed ones. */
  autonomous?: boolean;
  /** The outbox entry this one is a nudge for, when it is a follow-up. */
  followUpOf?: string | null;
  /** How many nudges have gone out on this thread, including this one. */
  followUpNumber?: number;
}

export interface GeneratedDraft {
  subject: string;
  body: string;
  /** `saved` means nothing was generated: this is the email the sender was
   *  already working on, reopened as they left it. */
  generator: 'nim' | 'template' | 'saved';
}
