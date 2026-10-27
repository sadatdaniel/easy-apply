import { useSyncExternalStore } from 'react';

// What the AI chain is doing right now ("Asking Gemini…", "Waiting 12s for OpenRouter's limit…"), shown in the title bar.
let status = '';
const listeners = new Set<() => void>();

export function setAiStatus(s: string) {
  if (s === status) return;
  status = s;
  listeners.forEach(l => l());
}

export const useAiStatus = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => status);
