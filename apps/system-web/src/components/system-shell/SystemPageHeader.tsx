import type { ReactNode } from 'react';
import styles from './SystemPageHeader.module.css';

export function SystemPageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleId,
  titleTabIndex,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  titleId?: string;
  titleTabIndex?: number;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 id={titleId} tabIndex={titleTabIndex}>
          {title}
        </h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
