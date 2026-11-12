import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-slate-800 active:bg-slate-950 shadow-sm',
  brand: 'bg-brand text-white hover:bg-brand-strong active:bg-indigo-800 shadow-sm',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-muted active:bg-slate-200',
  ghost: 'bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink',
  danger: 'bg-danger text-white hover:bg-danger-strong active:bg-red-800 shadow-sm',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-11 px-3 py-2 text-xs gap-1.5 rounded-control',
  md: 'min-h-11 px-4 py-2.5 text-sm gap-2 rounded-control',
  lg: 'min-h-12 px-5 py-3 text-base gap-2.5 rounded-control',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    iconRight,
    fullWidth = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-colors select-none tap-target disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" /> : icon}
      {children && <span className="truncate">{children}</span>}
      {!loading && iconRight}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: 'h-11 w-11 rounded-control',
  md: 'h-11 w-11 rounded-control',
  lg: 'h-12 w-12 rounded-control',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center transition-colors select-none tap-target shrink-0 disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        iconSizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : children}
    </button>
  );
});
