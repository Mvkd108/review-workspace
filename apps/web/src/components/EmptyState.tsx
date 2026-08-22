import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon = 'branch', title, copy, action }: { icon?: IconName; title: string; copy?: string; action?: ReactNode }) {
  return (
    <div className="queue-empty">
      <div className="empty-symbol"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {copy && <p>{copy}</p>}
      {action}
    </div>
  );
}

export function Placeholder({ title, copy }: { title: string; copy?: string }) {
  return (
    <main className="detail-placeholder">
      <div className="empty-symbol large"><Icon name="check" /></div>
      <h1>{title}</h1>
      {copy && <p>{copy}</p>}
    </main>
  );
}

export function SoftEmpty({ compact = false, children }: { compact?: boolean; children: ReactNode }) {
  return <div className={compact ? 'soft-empty compact' : 'soft-empty'}>{children}</div>;
}
