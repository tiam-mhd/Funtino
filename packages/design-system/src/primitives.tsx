import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export type ButtonTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export type BadgeTone = 'success' | 'warning' | 'info' | 'neutral' | 'danger';
export type IconBadgeTone = 'teal' | 'orange' | 'purple' | 'pink' | 'blue';

type ClassNameProps = {
  className?: string;
};

function cx(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export function FuntinoMark({
  compact = false,
  className,
}: ClassNameProps & { compact?: boolean }) {
  return (
    <span
      className={cx('ft-mark', compact && 'ft-mark--compact', className)}
      role="img"
      aria-label="فانتینو"
    >
      <img className="ft-mark__logo" src="/brand/funtino-logo.png" alt="" />
    </span>
  );
}

export function Surface({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & ClassNameProps) {
  return (
    <div className={cx('ft-surface', className)} {...props}>
      {children}
    </div>
  );
}

export function Button({
  children,
  tone = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ClassNameProps & { tone?: ButtonTone }) {
  return (
    <button className={cx('ft-button', 'ft-button--' + tone, className)} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({
  children,
  tone = 'primary',
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ClassNameProps & { tone?: ButtonTone }) {
  return (
    <a className={cx('ft-button', 'ft-button--' + tone, className)} {...props}>
      {children}
    </a>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: ClassNameProps & { children: ReactNode; tone?: BadgeTone }) {
  return <span className={cx('ft-badge', 'ft-badge--' + tone, className)}>{children}</span>;
}

export function IconBadge({
  icon,
  label,
  tone = 'teal',
  className,
}: ClassNameProps & {
  icon: ReactNode;
  label?: string;
  tone?: IconBadgeTone;
}) {
  return (
    <span
      className={cx('ft-icon-badge', 'ft-icon-badge--' + tone, className)}
      aria-label={label}
      title={label}
    >
      {icon}
    </span>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: ClassNameProps & { value: number; label?: string }) {
  const safeValue = Math.min(100, Math.max(0, value));

  return (
    <div className={cx('ft-progress', className)}>
      <div
        className="ft-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
      >
        <span className="ft-progress__value" style={{ width: String(safeValue) + '%' }} />
      </div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  actionHref,
  actionLabel,
  className,
}: ClassNameProps & {
  eyebrow?: string;
  title: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className={cx('ft-section-heading', className)}>
      <div>
        {eyebrow && <span className="ft-section-heading__eyebrow">{eyebrow}</span>}
        <h2 className="ft-section-heading__title">{title}</h2>
      </div>
      {actionHref && actionLabel && (
        <a href={actionHref} className="ft-section-heading__action">
          {actionLabel}
        </a>
      )}
    </div>
  );
}
