import type { ReactNode } from 'react';
import type { MergeReadinessStatus } from '@review-workspace/schema';

export function Pill({ tone, className, children }: { tone?: string; className?: string; children: ReactNode }) {
  const classes = ['pill', tone && `pill-${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}

export function StatusPill({ status }: { status: MergeReadinessStatus }) {
  const copy = status === 'ready' ? 'Merge ready' : status === 'blocked' ? 'Blocked' : 'Needs evidence';
  return <Pill tone={status}>{copy}</Pill>;
}
