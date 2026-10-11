import type { ReactNode, SVGProps } from 'react';

export type CustomerIconName =
  | 'home'
  | 'card'
  | 'sparkles'
  | 'family'
  | 'user'
  | 'location'
  | 'map'
  | 'ticket'
  | 'target'
  | 'gift'
  | 'trophy'
  | 'bell'
  | 'shield'
  | 'help'
  | 'arrow-left'
  | 'chevron-left'
  | 'clock'
  | 'check'
  | 'close'
  | 'plus'
  | 'ferris-wheel'
  | 'roller-coaster'
  | 'carousel'
  | 'candy'
  | 'heart'
  | 'settings'
  | 'route'
  | 'clipboard';

type CustomerIconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: CustomerIconName;
  size?: number;
  label?: string;
};

function IconPaths({ name }: { name: CustomerIconName }): ReactNode {
  switch (name) {
    case 'home':
      return <path d="m3.5 10.5 8.5-7 8.5 7M5.5 9v10.5h13V9M9 19.5v-5h6v5" />;
    case 'card':
      return (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 10h18M7 15h4" />
        </>
      );
    case 'sparkles':
      return (
        <>
          <path d="m12 3 1.3 4.7L18 9l-4.7 1.3L12 15l-1.3-4.7L6 9l4.7-1.3L12 3Z" />
          <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15ZM5 14l.5 1.5L7 16l-1.5.5L5 18l-.5-1.5L3 16l1.5-.5L5 14Z" />
        </>
      );
    case 'family':
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M3.5 19c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5M14.5 14.5c2.8-.5 4.7 1 5.5 4.5" />
        </>
      );
    case 'user':
      return (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c.6-3.8 3-6 7-6s6.4 2.2 7 6" />
        </>
      );
    case 'location':
      return (
        <path d="M19 10c0 5-7 10-7 10s-7-5-7-10a7 7 0 1 1 14 0Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      );
    case 'map':
      return (
        <>
          <path d="M4 5.5 9 3l6 3 5-2.5v15L15 21l-6-3-5 2.5v-15Z" />
          <path d="M9 3v15M15 6v15" />
        </>
      );
    case 'ticket':
      return (
        <path d="M4 7.5a2 2 0 0 0 0 4v1a2 2 0 0 0 0 4h16v-4a2 2 0 0 0 0-4v-1a2 2 0 0 0 0-4H4v4ZM12 5.5v2M12 12v2M12 17v1.5" />
      );
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'gift':
      return (
        <>
          <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13" />
          <path d="M12 7H8.5a2.5 2.5 0 1 1 2.5-2.5C11 6 12 7 12 7ZM12 7h3.5A2.5 2.5 0 1 0 13 4.5C13 6 12 7 12 7Z" />
        </>
      );
    case 'trophy':
      return (
        <>
          <path d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z" />
          <path d="M7 6H4v1a4 4 0 0 0 4 4M17 6h3v1a4 4 0 0 1-4 4M12 13.5V18M8 21h8M9.5 18h5" />
        </>
      );
    case 'bell':
      return <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />;
    case 'shield':
      return (
        <path d="M12 3 20 6v5c0 5-3.2 8.5-8 10-4.8-1.5-8-5-8-10V6l8-3Z M8.5 12l2.2 2.2 4.8-4.8" />
      );
    case 'help':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.7 2.7 0 1 1 4.5 2c-1.2.8-2 1.2-2 2.7M12 17h.01" />
        </>
      );
    case 'arrow-left':
      return <path d="M19 12H5M11 6l-6 6 6 6" />;
    case 'chevron-left':
      return <path d="m14.5 5-7 7 7 7" />;
    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.5 2" />
        </>
      );
    case 'check':
      return <path d="m5 12 4.5 4.5L19 7" />;
    case 'close':
      return <path d="m6 6 12 12M18 6 6 18" />;
    case 'plus':
      return <path d="M12 5v14M5 12h14" />;
    case 'ferris-wheel':
      return (
        <>
          <circle cx="12" cy="10.5" r="6.5" />
          <path d="M12 4v13M5.5 10.5h13M7.4 5.9l9.2 9.2M16.6 5.9l-9.2 9.2M8 20h8M10 17v3M14 17v3" />
        </>
      );
    case 'roller-coaster':
      return (
        <>
          <path d="M3 18c2-7 4.5-7 6.5 0s4.5 7 6.5 0 4.5-7 5.5 0" />
          <path d="M4 18h16M6 18l-2 3M18 18l2 3M9 18l-1 3M15 18l1 3" />
          <circle cx="9.5" cy="9" r="2.5" />
          <path d="M7 9h5M9.5 6.5v5" />
        </>
      );
    case 'carousel':
      return (
        <>
          <path d="M4 18h16M6 18l2-3h8l2 3M8 15V9h8v6M5 9h14M12 9V4M9.5 4h5" />
          <path d="M7 9 5 5M17 9l2-4" />
          <circle cx="5" cy="4.5" r="1.5" />
          <circle cx="19" cy="4.5" r="1.5" />
        </>
      );
    case 'candy':
      return (
        <path d="M8 5.5c-2 1-3 3-3 5.5a7 7 0 0 0 14 0c0-2.5-1-4.5-3-5.5M8 5.5 5.5 3M16 5.5 18.5 3M9 10h6M9 14h6" />
      );
    case 'heart':
      return <path d="M20 8.5c0 5-8 10-8 10s-8-5-8-10a4.5 4.5 0 0 1 8-2.7 4.5 4.5 0 0 1 8 2.7Z" />;
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1A1.7 1.7 0 0 0 8.4 15a1.7 1.7 0 0 0-1.5-1H6.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1A1.7 1.7 0 0 0 8.1 8.7L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" />
        </>
      );
    case 'route':
      return (
        <>
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="6" r="2" />
          <path d="M8 18h2a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4" />
        </>
      );
    case 'clipboard':
      return (
        <>
          <rect x="5" y="4.5" width="14" height="17" rx="2" />
          <path d="M9 4.5h6v3H9zM8.5 12h7M8.5 16h7" />
        </>
      );
  }
}

export function CustomerIcon({ name, size = 20, label, className, ...props }: CustomerIconProps) {
  return (
    <svg
      {...props}
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label && <title>{label}</title>}
      <IconPaths name={name} />
    </svg>
  );
}
