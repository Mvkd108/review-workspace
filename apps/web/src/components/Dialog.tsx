import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export function Dialog({ onClose, labelledBy, children }: { onClose: () => void; labelledBy: string; children: ReactNode }) {
  return (
    <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <IconButton className="dialog-close" onClick={onClose} aria-label="Close"><Icon name="close" /></IconButton>
        {children}
      </section>
    </div>
  );
}
