import type { ReactNode } from 'react';

export function GlobalError({ children }: { children: ReactNode }) {
  return <div className="global-error" role="alert">{children}</div>;
}

export function FieldError({ children }: { children: ReactNode }) {
  return <div className="form-error" role="alert">{children}</div>;
}
