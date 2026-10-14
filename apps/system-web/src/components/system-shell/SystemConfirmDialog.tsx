'use client';

import { useEffect, useRef } from 'react';
import styles from './SystemConfirmDialog.module.css';

export function SystemConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-describedby="system-confirm-description"
      aria-labelledby="system-confirm-title"
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      ref={dialogRef}
    >
      <div className={styles.content}>
        <span className={styles.eyebrow}>تأیید عملیات</span>
        <h2 id="system-confirm-title">{title}</h2>
        <p id="system-confirm-description">{description}</p>
        <div className={styles.actions}>
          <button className={styles.cancel} autoFocus onClick={onCancel} type="button">
            بازگشت
          </button>
          <button className={styles.confirm} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
