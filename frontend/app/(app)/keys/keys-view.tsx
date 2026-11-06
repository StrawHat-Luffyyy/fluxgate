"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { FormError, TextField, useFocusFirstInvalid } from "@/components/ui/field";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ReadOnlyNote,
  TableSkeleton,
} from "@/components/ui/primitives";
import { SecretDialog } from "@/components/ui/secret-dialog";
import { TableWrap } from "@/components/ui/table";
import { api, errorMessage, fieldErrorFrom } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/format";
import { queryKeys, useKeys, useMe } from "@/lib/queries";
import type { ApiKey } from "@/lib/types";
import { validateNumber } from "@/lib/validate";

interface IssuedKey {
  key: ApiKey;
  apiKey: string;
}

type KeyState = "active" | "expired" | "revoked";

const stateOf = (key: ApiKey): KeyState => {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
};

const STATE_BADGE = {
  active: <Badge tone="ok">Active</Badge>,
  expired: <Badge tone="warn">Expired</Badge>,
  revoked: <Badge>Revoked</Badge>,
};

function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (rawKey: string) => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [days, setDays] = useState("");
  const [errors, setErrors] = useState<{ name?: string; expiresInDays?: string }>({});
  const [formError, setFormError] = useState<string>();
  useFocusFirstInvalid(errors);

  const create = useMutation({
    // The secret is handed over here rather than returned, so that it never becomes
    // mutation data, which the query cache would hold on to.
    mutationFn: async () => {
      const issued = await api<IssuedKey>("/keys", {
        method: "POST",
        body: { name: name.trim(), ...(days.trim() ? { expiresInDays: Number(days) } : {}) },
      });
      onCreated(issued.apiKey);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.keys }),
    onError: (err) => {
      const { field, message } = fieldErrorFrom(err, ["name", "expiresInDays"]);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const found = {
      name: !trimmed
        ? "Name the key after the client that will use it."
        : trimmed.length > 80
          ? "Use 80 characters or fewer."
          : undefined,
      expiresInDays: days.trim()
        ? validateNumber(days, { min: 1, max: 3650, integer: true, label: "Expiry" })
        : undefined,
    };
    setErrors(found);
    setFormError(undefined);
    if (!found.name && !found.expiresInDays) create.mutate();
  };

  return (
    <Modal
      open
      title="Create API key"
      description="Clients send this as a bearer token on requests to the gateway."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create key
          </Button>
        </>
      }
    >
      <FormError>{formError}</FormError>
      <TextField
        label="Name"
        data-autofocus
        placeholder="billing-service"
        value={name}
        error={errors.name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label="Expires after (days)"
        type="number"
        inputMode="numeric"
        min={1}
        max={3650}
        value={days}
        error={errors.expiresInDays}
        hint="Optional. Leave empty for a key that does not expire."
        onChange={(event) => setDays(event.target.value)}
      />
    </Modal>
  );
}

export function KeysView() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role === "admin";
  const { data: keys, error, isPending, refetch } = useKeys();
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState<ApiKey>();
  const [revoking, setRevoking] = useState<ApiKey>();
  const [secret, setSecret] = useState<string | null>(null);

  // Keys that still work come first; the gateway returns newest first within each.
  const sorted = useMemo(
    () =>
      keys
        ?.map((key) => ({ key, state: stateOf(key) }))
        .sort((a, b) => Number(a.state !== "active") - Number(b.state !== "active")),
    [keys],
  );

  // Not optimistic: the response carries the only copy of the new secret, which is
  // handed over here so that it never becomes mutation data in the query cache.
  const rotate = useMutation({
    mutationFn: async (key: ApiKey) => {
      const issued = await api<IssuedKey>(`/keys/${key.id}/rotate`, { method: "POST" });
      setRotating(undefined);
      setSecret(issued.apiKey);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.keys }),
    onError: (err) => {
      setRotating(undefined);
      toast.error(errorMessage(err));
    },
  });

  const revoke = useMutation({
    mutationFn: (key: ApiKey) => api(`/keys/${key.id}`, { method: "DELETE" }),
    onMutate: async (key) => {
      await client.cancelQueries({ queryKey: queryKeys.keys });
      const previous = client.getQueryData<ApiKey[]>(queryKeys.keys);
      const revokedAt = new Date().toISOString();
      client.setQueryData<ApiKey[]>(queryKeys.keys, (rows) =>
        rows?.map((row) => (row.id === key.id ? { ...row, revokedAt } : row)),
      );
      return { previous };
    },
    onError: (err, _key, context) => {
      client.setQueryData(queryKeys.keys, context?.previous);
      toast.error(errorMessage(err));
    },
    onSuccess: (_data, key) => toast.success(`Key "${key.name}" revoked`),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.keys }),
  });

  return (
    <>
      <PageHeader
        title="API keys"
        description="Authenticate clients calling the gateway. FluxGate stores only a hash of each key."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-3.5" />
              Create key
            </Button>
          ) : me ? (
            <ReadOnlyNote />
          ) : undefined
        }
      />
      <Panel flush>
        {isPending ? (
          <TableSkeleton />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : sorted?.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            action={
              canEdit && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create your first key
                </Button>
              )
            }
          >
            The gateway rejects requests without a valid key, so a client needs one before it can
            send traffic.
          </EmptyState>
        ) : (
          <TableWrap label="API keys">
            <thead>
              <tr>
                <th scope="col">Key</th>
                <th scope="col">Status</th>
                <th scope="col" className="hidden sm:table-cell">Created</th>
                <th scope="col" className="hidden sm:table-cell">Expires</th>
                {canEdit && <th scope="col" className="w-0"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {sorted?.map(({ key, state }) => (
                <tr key={key.id} data-testid={`key-${key.name}`} data-state={state}>
                  <td className={state === "active" ? "" : "opacity-70"}>
                    <div className="font-medium">{key.name}</div>
                    <div className="font-mono text-xs whitespace-nowrap text-fg-3">{key.hint}</div>
                  </td>
                  <td>{STATE_BADGE[state]}</td>
                  <td className="hidden whitespace-nowrap text-fg-2 sm:table-cell">
                    {formatRelative(key.createdAt)}
                  </td>
                  <td className="hidden whitespace-nowrap text-fg-2 sm:table-cell">
                    {key.expiresAt ? formatDate(key.expiresAt) : "Never"}
                  </td>
                  {canEdit && (
                    <td>
                      {!key.revokedAt && (
                        <div className="flex justify-end gap-0.5">
                          {/* The new key inherits the expiry, so rotating an expired key would issue a dead one. */}
                          {state === "active" && (
                            <IconButton label={`Rotate ${key.name}`} onClick={() => setRotating(key)}>
                              <RefreshCw aria-hidden className="size-3.5" />
                            </IconButton>
                          )}
                          <IconButton label={`Revoke ${key.name}`} onClick={() => setRevoking(key)}>
                            <Ban aria-hidden className="size-3.5" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {creating && (
        <CreateKeyDialog
          onClose={() => setCreating(false)}
          onCreated={(rawKey) => {
            setCreating(false);
            setSecret(rawKey);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(rotating)}
        title={`Rotate "${rotating?.name}"?`}
        body={`The current key stops working immediately. Clients need the new key before they can send traffic again. ${
          rotating?.expiresAt
            ? `The new key keeps the same expiry: ${formatDate(rotating.expiresAt)}.`
            : "The new key does not expire, like the current one."
        }`}
        confirmLabel="Rotate key"
        pending={rotate.isPending}
        onClose={() => setRotating(undefined)}
        onConfirm={() => rotating && rotate.mutate(rotating)}
      />
      <ConfirmDialog
        open={Boolean(revoking)}
        danger
        title={`Revoke "${revoking?.name}"?`}
        body="Requests using this key will be refused straight away. This cannot be undone."
        confirmLabel="Revoke key"
        onClose={() => setRevoking(undefined)}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking);
          setRevoking(undefined);
        }}
      />
      <SecretDialog
        secret={secret}
        title="Your new API key"
        description="Send it as: Authorization: Bearer <key>"
        onClose={() => setSecret(null)}
      />
    </>
  );
}
