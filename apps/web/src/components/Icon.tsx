import type { ReactNode } from 'react';

export type IconName = 'branch' | 'check' | 'warning' | 'plus' | 'refresh' | 'file' | 'gate' | 'close' | 'agent' | 'search' | 'archive' | 'play';

const PATHS: Record<IconName, ReactNode> = {
  branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 9h5a5 5 0 0 0 5-1"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  refresh: <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 8"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
  gate: <><path d="M4 20V5l8-3 8 3v15"/><path d="M8 20v-8h8v8"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  agent: <><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9"/><path d="M10 13h4"/></>,
  play: <path d="M8 5v14l11-7z"/>,
};

export function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{PATHS[name]}</svg>;
}
