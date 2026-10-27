export const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'] as const;
export type Status = (typeof STATUSES)[number];
export const CLOSED: Status[] = ['rejected', 'ghosted', 'withdrawn'];

export type DocKind = 'cv' | 'cover' | 'other';

export interface StatusEvent { status: Status; at: string; note?: string }

export interface Job {
  id: string;            // folder name under jobs/
  title: string;
  company: string;
  location: string;
  salary: string;
  deadline: string;
  language: string;
  url: string;
  keywords: string[];
  contact: string;
  notes: string;
  status: Status;
  history: StatusEvent[];
  next: string;          // free text shown in the tracker, e.g. "Interview Thu 14:00"
  createdAt: string;
  updatedAt: string;
  postingComplete: boolean | null;
  docs: string[];        // editable .md documents in the job folder
  extras: string[];      // attached files (PDFs) in the job folder
  bucket: string[];      // ordered selection for export (subset of docs + extras)
  exportName: string;
}

export type JobFields = Pick<Job, 'title' | 'company' | 'location' | 'salary' | 'deadline' | 'language' | 'url' | 'keywords' | 'contact' | 'notes'>;

/** Whole-document overrides on top of the theme, set from the formatting bar. Missing = the theme's own value. */
export interface DocStyle { size?: number; lineHeight?: number; align?: 'left' | 'justify'; margins?: 'narrow' | 'wide' }

/** `main`: on a CV in "My documents", marks the main CV for its language, the source of facts for every application */
export interface DocMeta { title: string; kind: DocKind; lang: string; theme: string; template?: string; style?: DocStyle; main?: boolean }

export interface TemplateInfo extends DocMeta { id: string; updatedAt: string }

export interface ProfileField { key: string; label: string; value: string }
export interface Profile { fields: ProfileField[] }

export interface ExtraFile { name: string; size: number; updatedAt: string }

export interface VersionInfo { id: string; at: string; size: number }

export type AiProvider = 'openai' | 'gemini';
export interface AiSettings { provider: AiProvider; preset: string; baseURL: string; apiKey: string; model: string }

/** One entry in the fallback chain (the list order is the order they are tried). Limits are optional: null = no limit. */
export interface ProviderEntry extends AiSettings { id: string; enabled: boolean; timeoutSec: number; perMinute: number | null; perDay: number | null }

/** Requests sent per provider in the last 24 hours, plus a cool-down after a "too many requests" answer. */
export interface ProviderUsage { at: number[]; coolUntil?: number; last?: { ok: boolean; at: number; note: string } }
export type Usage = Record<string, ProviderUsage>;

export interface AppState {
  root: string;
  profile: Profile;
  templates: TemplateInfo[];
  extras: ExtraFile[];
  jobs: Job[];
  ai: { configured: boolean; label: string; count: number };
}

export interface ExtractedFields extends Partial<JobFields> { complete?: boolean; missing?: string }
