"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Button, IconButton } from "./button";

/**
 * A native modal <dialog>: focus trap, Esc, inert background and focus restoration
 * come from the browser. Rendered only while open, so a form's state, or a secret,
 * is gone from the DOM as soon as it closes.
 */
function ModalBody({
  title,
  description,
  children,
  footer,
  dismissable,
  onClose,
  onSubmit,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissable: boolean;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    // React's autoFocus fires before showModal, which then moves focus to the first
    // control, so the initial field is focused here instead.
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      // React has already detached the dialog here, so the browser cannot restore focus.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const content = (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-balance">
            {title}
          </h2>
          {description && <div className="mt-1 text-sm text-fg-2">{description}</div>}
        </div>
        {dismissable && (
          <IconButton label="Close" onClick={onClose} className="-mt-0.5 -mr-1.5">
            <X aria-hidden className="size-4" />
          </IconButton>
        )}
      </div>
      {children && <div className="flex flex-col gap-4 px-5 py-4">{children}</div>}
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-sunken px-5 py-3">
          {footer}
        </div>
      )}
    </>
  );

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="fg-modal m-auto max-h-[calc(100dvh-2rem)] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-line-strong bg-surface shadow-pop"
      onCancel={(event) => {
        event.preventDefault();
        if (dismissable) onClose();
      }}
      onMouseDown={(event) => {
        // A press on the dialog element itself is a press on its backdrop.
        if (dismissable && event.target === ref.current) onClose();
      }}
    >
      {onSubmit ? (
        <form noValidate onSubmit={onSubmit}>
          {content}
        </form>
      ) : (
        content
      )}
    </dialog>
  );
}

export function Modal({
  open,
  dismissable = true,
  ...props
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  dismissable?: boolean;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;
  return <ModalBody dismissable={dismissable} {...props} />;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  pending = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={body}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
