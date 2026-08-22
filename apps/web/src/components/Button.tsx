import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  size?: 'small';
}

export function Button({ variant, size, className, type = 'button', children, ...rest }: ButtonProps) {
  const classes = ['button', variant, size, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest}>{children}</button>;
}
