'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type PickerDialogProps = {
  id: string;
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
};

export function PickerDialog({ id, open, title, onClose, children, footer }: PickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => setPortalContainer(document.body), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        requestAnimationFrame(() => dialog.querySelector<HTMLElement>('[data-picker-autofocus]')?.focus());
      }
      document.body.classList.add('ft-picker-dialog-open');
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      document.body.classList.remove('ft-picker-dialog-open');
    };
  }, [open, portalContainer]);

  const dialogElement = (
    <dialog
      ref={dialogRef}
      id={id}
      className="ft-picker-dialog"
      aria-labelledby={titleId}
      dir="rtl"
      lang="fa"
      onCancel={() => onClose()}
      onClose={() => {
        document.body.classList.remove('ft-picker-dialog-open');
        onClose();
        requestAnimationFrame(() => returnFocusRef.current?.focus());
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="ft-picker-dialog__panel">
        <header className="ft-picker-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <button className="ft-picker-dialog__close" type="button" aria-label="بستن پنجره" onClick={() => dialogRef.current?.close()}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="ft-picker-dialog__body">{children}</div>
        <footer className="ft-picker-dialog__footer">{footer}</footer>
      </div>
    </dialog>
  );

  return portalContainer ? createPortal(dialogElement, portalContainer) : null;
}
