import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/utils';
import { validateRut } from '../lib/rut';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, action, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink-muted">
          {label}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
        {action && <div className="text-xs">{action}</div>}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const baseInputClasses =
  'w-full min-h-11 rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-base md:text-sm text-ink placeholder:text-ink-subtle transition-colors outline-none focus:border-brand focus:ring-3 focus:ring-brand/15 disabled:bg-surface-muted disabled:text-ink-subtle';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        baseInputClasses,
        invalid && 'border-danger focus:border-danger focus:ring-danger/15',
        className,
      )}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        baseInputClasses,
        invalid && 'border-danger focus:border-danger focus:ring-danger/15',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        baseInputClasses,
        'min-h-24 py-2.5',
        invalid && 'border-danger focus:border-danger focus:ring-danger/15',
        className,
      )}
      {...rest}
    />
  );
});

export interface MoneyInputProps extends Omit<InputProps, 'type' | 'value' | 'onChange'> {
  value: number | string;
  onValueChange: (value: number) => void;
  currencyPrefix?: string;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, currencyPrefix = '$', className, ...rest },
  ref,
) {
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(/\D/g, '') || 0);
  const formatted = Number.isFinite(numeric) && numeric > 0 ? numeric.toLocaleString('es-CL') : value === 0 ? '0' : '';

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-subtle">
        {currencyPrefix}
      </span>
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        value={formatted}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onValueChange(digits ? Number(digits) : 0);
        }}
        className={cn('pl-8 font-mono tabular-nums', className)}
        {...rest}
      />
    </div>
  );
});

export function normalizeChileanPlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export interface PlateInputProps extends Omit<InputProps, 'type'> {
  onPlateChange?: (plate: string) => void;
}

export const PlateInput = forwardRef<HTMLInputElement, PlateInputProps>(function PlateInput(
  { onPlateChange, onChange, className, placeholder = 'ABCD12', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="text"
      inputMode="text"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      maxLength={8}
      placeholder={placeholder}
      onChange={(event) => {
        const clean = normalizeChileanPlate(event.target.value);
        event.target.value = clean;
        onPlateChange?.(clean);
        onChange?.(event);
      }}
      className={cn('font-mono uppercase tracking-wider font-semibold', className)}
      {...rest}
    />
  );
});

export function formatChileanRut(raw: string): string {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase().slice(0, 9);
  if (clean.length <= 1) return clean;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

export interface RutInputProps extends Omit<InputProps, 'type'> {
  onRutChange?: (rut: string, isValid: boolean) => void;
}

export const RutInput = forwardRef<HTMLInputElement, RutInputProps>(function RutInput(
  { onRutChange, onChange, value, invalid, className, placeholder = '12.345.678-9', ...rest },
  ref,
) {
  const strValue = typeof value === 'string' ? value : '';
  const isNonEmptyInvalid = strValue.trim().length > 3 && !validateRut(strValue);

  return (
    <Input
      ref={ref}
      type="text"
      inputMode="text"
      autoCapitalize="characters"
      placeholder={placeholder}
      value={value}
      invalid={invalid ?? isNonEmptyInvalid}
      onChange={(event) => {
        const formatted = formatChileanRut(event.target.value);
        event.target.value = formatted;
        onRutChange?.(formatted, formatted.length > 0 ? validateRut(formatted) : false);
        onChange?.(event);
      }}
      className={cn('font-mono tabular-nums', className)}
      {...rest}
    />
  );
});

export const DateInput = forwardRef<HTMLInputElement, InputProps>(function DateInput({ className, ...rest }, ref) {
  const fallbackId = useId();
  return <Input ref={ref} id={rest.id ?? fallbackId} type="date" className={cn('tabular-nums', className)} {...rest} />;
});

