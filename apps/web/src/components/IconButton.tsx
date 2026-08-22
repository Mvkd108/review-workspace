import type { ButtonHTMLAttributes } from 'react';

export function IconButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = ['icon-button', className].filter(Boolean).join(' ');
  return <button type="button" className={classes} {...rest}>{children}</button>;
}
