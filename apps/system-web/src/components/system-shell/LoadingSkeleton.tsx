import styles from './LoadingSkeleton.module.css';

export function LoadingSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div aria-label={label} aria-busy="true" className={styles.group} role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div className={styles.row} key={index}>
          <span className={styles.square} />
          <span className={styles.lines}>
            <i />
            <i />
          </span>
          <span className={styles.pill} />
        </div>
      ))}
    </div>
  );
}
