"use client";

import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "./button";
import { Modal } from "./dialog";

export function CopyButton({
  value,
  label = "Copy",
  size = "md",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("The browser refused clipboard access. Select the text and copy it instead.");
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-ok" /> : <Copy aria-hidden className="size-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </Button>
  );
}

export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("The browser refused clipboard access.");
        }
      }}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-ok" /> : <Copy aria-hidden className="size-3.5" />}
    </IconButton>
  );
}

/**
 * The gateway stores only a hash (keys) or ciphertext it never returns (webhook
 * secrets), so this is the only time the value exists in the browser. Leaving
 * needs a deliberate click: Esc and the backdrop do not dismiss it.
 */
export function SecretDialog({
  secret,
  title,
  description,
  onClose,
}: {
  secret: string | null;
  title: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open={secret !== null}
      title={title}
      description={description}
      dismissable={false}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          I have stored it
        </Button>
      }
    >
      <div className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <p>This is the only time it will be shown. It cannot be recovered after you close this.</p>
      </div>
      <code
        data-testid="one-time-secret"
        className="block rounded-md border border-line bg-sunken px-3 py-2.5 font-mono text-xs break-all select-all"
      >
        {secret}
      </code>
      <div>
        <CopyButton value={secret ?? ""} label="Copy to clipboard" />
      </div>
    </Modal>
  );
}
