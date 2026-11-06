"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RotateCw, Send, Trash2, Webhook } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { FormError, InlineSelect, TextField, useFocusFirstInvalid } from "@/components/ui/field";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ReadOnlyNote,
  TableSkeleton,
  type BadgeTone,
} from "@/components/ui/primitives";
import { SecretDialog } from "@/components/ui/secret-dialog";
import { Segmented, Switch } from "@/components/ui/switch";
import { TableWrap } from "@/components/ui/table";
import { api, ApiError, errorMessage, fieldErrorFrom } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { queryKeys, useDeliveries, useEndpoints, useMe } from "@/lib/queries";
import type { DeliveryStatus, WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import { validateHttpUrl } from "@/lib/validate";

const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Pending", tone: "warn" },
  delivered: { label: "Delivered", tone: "ok" },
  dead: { label: "Failed", tone: "bad" },
};

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "delivered", label: "Delivered" },
  { value: "dead", label: "Failed" },
] as const;

function EndpointDialog({
  endpoint,
  onClose,
  onCreated,
}: {
  endpoint?: WebhookEndpoint;
  onClose: () => void;
  onCreated?: (secret: string) => void;
}) {
  const client = useQueryClient();
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [errors, setErrors] = useState<{ url?: string }>({});
  const [formError, setFormError] = useState<string>();
  useFocusFirstInvalid(errors);

  const save = useMutation({
    // The secret is handed over here rather than returned, so that it never becomes
    // mutation data, which the query cache would hold on to.
    mutationFn: async () => {
      const body = { url: url.trim() };
      if (endpoint) {
        await api(`/webhooks/${endpoint.id}`, { method: "PATCH", body });
        return;
      }
      const { secret } = await api<{ secret: string }>("/webhooks", { method: "POST", body });
      onCreated?.(secret);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.endpoints });
      if (endpoint) {
        toast.success("Endpoint updated");
        onClose();
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "UNSAFE_TARGET_URL") {
        setErrors({ url: err.message });
        return;
      }
      const { field, message } = fieldErrorFrom(err, ["url"]);
      if (field) setErrors({ url: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateHttpUrl(url);
    setErrors({ url: found });
    setFormError(undefined);
    if (!found) save.mutate();
  };

  return (
    <Modal
      open
      title={endpoint ? "Edit endpoint" : "Add endpoint"}
      description="FluxGate POSTs a signed JSON payload here when an anomaly is detected."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {endpoint ? "Save endpoint" : "Add endpoint"}
          </Button>
        </>
      }
    >
      <FormError>{formError}</FormError>
      <TextField
        label="Endpoint URL"
        mono
        data-autofocus
        placeholder="https://hooks.example.com/fluxgate"
        value={url}
        error={errors.url}
        hint="Private and metadata addresses are refused."
        onChange={(event) => setUrl(event.target.value)}
      />
    </Modal>
  );
}

function DeliveryLog({
  endpoints,
  canEdit,
}: {
  endpoints: WebhookEndpoint[] | undefined;
  canEdit: boolean;
}) {
  const client = useQueryClient();
  const { data: deliveries, error, isPending, refetch } = useDeliveries();
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["value"]>("all");
  const [endpointId, setEndpointId] = useState("all");

  const endpointById = useMemo(
    () => new Map(endpoints?.map((endpoint) => [endpoint.id, endpoint])),
    [endpoints],
  );

  const retry = useMutation({
    mutationFn: (delivery: WebhookDelivery) =>
      api(`/webhooks/deliveries/${delivery.id}/retry`, { method: "POST" }),
    onMutate: async (delivery) => {
      await client.cancelQueries({ queryKey: queryKeys.deliveries });
      const previous = client.getQueryData<WebhookDelivery[]>(queryKeys.deliveries);
      client.setQueryData<WebhookDelivery[]>(queryKeys.deliveries, (rows) =>
        rows?.map((row) =>
          row.id === delivery.id
            ? { ...row, status: "pending" as const, attempts: 0, lastError: null }
            : row,
        ),
      );
      return { previous };
    },
    onError: (err, _delivery, context) => {
      client.setQueryData(queryKeys.deliveries, context?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.deliveries }),
  });

  const visible = deliveries?.filter(
    (delivery) =>
      (status === "all" || delivery.status === status) &&
      (endpointId === "all" || delivery.endpointId === endpointId),
  );

  return (
    <Panel
      title="Delivery log"
      description="The 50 most recent deliveries. Updates on its own."
      flush
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {endpoints && endpoints.length > 1 && (
            <InlineSelect
              label="Filter by endpoint"
              className="max-w-52"
              value={endpointId}
              onChange={(event) => setEndpointId(event.target.value)}
            >
              <option value="all">All endpoints</option>
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.url}
                </option>
              ))}
            </InlineSelect>
          )}
          <Segmented label="Filter by status" value={status} options={STATUS_FILTERS} onChange={setStatus} />
        </div>
      }
    >
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : visible?.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-3">
          {deliveries?.length === 0
            ? "No deliveries yet. Send a test event to an endpoint to see one here."
            : "No deliveries match these filters."}
        </p>
      ) : (
        <TableWrap label="Webhook deliveries">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Event</th>
              <th scope="col" className="num hidden sm:table-cell">Attempts</th>
              <th scope="col" className="num hidden sm:table-cell">Last HTTP</th>
              <th scope="col" className="hidden sm:table-cell">Created</th>
              {canEdit && <th scope="col" className="w-0"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {visible?.map((delivery) => {
              const endpoint = endpointById.get(delivery.endpointId);
              const badge = DELIVERY_STATUS[delivery.status];
              return (
                <tr key={delivery.id} data-testid="delivery-row" data-status={delivery.status}>
                  <td>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </td>
                  <td>
                    <div className="font-mono text-xs">{delivery.eventType}</div>
                    {endpoint && <div className="text-xs break-all text-fg-3">{endpoint.url}</div>}
                    {delivery.lastError && (
                      <div className="mt-0.5 text-xs break-words text-bad">{delivery.lastError}</div>
                    )}
                    {/* Stands in for the columns hidden at this width, which keeps Retry on screen. */}
                    <div className="mt-0.5 text-xs text-fg-3 sm:hidden">
                      {delivery.attempts} {delivery.attempts === 1 ? "attempt" : "attempts"}
                      {delivery.lastStatusCode !== null && ` · HTTP ${delivery.lastStatusCode}`} ·{" "}
                      {formatRelative(delivery.createdAt)}
                    </div>
                  </td>
                  <td className="num hidden sm:table-cell">{delivery.attempts}</td>
                  <td className="num hidden sm:table-cell">{delivery.lastStatusCode ?? "—"}</td>
                  <td
                    className="hidden whitespace-nowrap text-fg-2 sm:table-cell"
                    title={formatDateTime(delivery.createdAt)}
                  >
                    {formatRelative(delivery.createdAt)}
                  </td>
                  {canEdit && (
                    <td>
                      {delivery.status === "dead" && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            // The worker refuses disabled endpoints, so a retry would just fail again.
                            disabled={!endpoint?.enabledAt}
                            title={endpoint?.enabledAt ? undefined : "Enable the endpoint to retry"}
                            onClick={() => retry.mutate(delivery)}
                          >
                            <RotateCw aria-hidden className="size-3" />
                            Retry
                          </Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );
}

export function WebhooksView() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role === "admin";
  const { data: endpoints, error, isPending, refetch } = useEndpoints();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint>();
  const [deleting, setDeleting] = useState<WebhookEndpoint>();
  const [secret, setSecret] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: ({ endpoint, enabled }: { endpoint: WebhookEndpoint; enabled: boolean }) =>
      api(`/webhooks/${endpoint.id}`, { method: "PATCH", body: { enabled } }),
    onMutate: async ({ endpoint, enabled }) => {
      await client.cancelQueries({ queryKey: queryKeys.endpoints });
      const previous = client.getQueryData<WebhookEndpoint[]>(queryKeys.endpoints);
      const enabledAt = enabled ? new Date().toISOString() : null;
      client.setQueryData<WebhookEndpoint[]>(queryKeys.endpoints, (rows) =>
        rows?.map((row) => (row.id === endpoint.id ? { ...row, enabledAt } : row)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      client.setQueryData(queryKeys.endpoints, context?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.endpoints }),
  });

  const test = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) => api(`/webhooks/${endpoint.id}/test`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Test event queued. Its result appears in the delivery log.");
      client.invalidateQueries({ queryKey: queryKeys.deliveries });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) => api(`/webhooks/${endpoint.id}`, { method: "DELETE" }),
    onMutate: async (endpoint) => {
      await client.cancelQueries({ queryKey: queryKeys.endpoints });
      const previous = client.getQueryData<WebhookEndpoint[]>(queryKeys.endpoints);
      client.setQueryData<WebhookEndpoint[]>(queryKeys.endpoints, (rows) =>
        rows?.filter((row) => row.id !== endpoint.id),
      );
      return { previous };
    },
    onError: (err, _endpoint, context) => {
      client.setQueryData(queryKeys.endpoints, context?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.endpoints });
      // Deleting an endpoint also deletes its deliveries.
      client.invalidateQueries({ queryKey: queryKeys.deliveries });
    },
  });

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Get notified of anomalies at your own endpoints. Every payload is signed."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-3.5" />
              Add endpoint
            </Button>
          ) : me ? (
            <ReadOnlyNote />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-3">
        <Panel title="Endpoints" flush>
          {isPending ? (
            <TableSkeleton rows={2} />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : endpoints.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="No endpoints yet"
              action={
                canEdit && (
                  <Button variant="primary" onClick={() => setAdding(true)}>
                    Add your first endpoint
                  </Button>
                )
              }
            >
              Anomalies are still recorded without an endpoint, but nothing outside this dashboard
              hears about them.
            </EmptyState>
          ) : (
            <TableWrap label="Webhook endpoints">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Enabled</th>
                  <th scope="col" className="hidden md:table-cell">Created</th>
                  {canEdit && <th scope="col" className="w-0"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => {
                  const enabled = Boolean(endpoint.enabledAt);
                  return (
                    <tr key={endpoint.id} data-testid="endpoint-row">
                      <td className="font-mono text-xs break-all">{endpoint.url}</td>
                      <td>
                        {canEdit ? (
                          <Switch
                            checked={enabled}
                            label={`Enable ${endpoint.url}`}
                            onChange={(next) => toggle.mutate({ endpoint, enabled: next })}
                          />
                        ) : (
                          <Badge tone={enabled ? "ok" : "neutral"}>{enabled ? "Enabled" : "Disabled"}</Badge>
                        )}
                      </td>
                      <td className="hidden whitespace-nowrap text-fg-2 md:table-cell">
                        {formatRelative(endpoint.createdAt)}
                      </td>
                      {canEdit && (
                        <td>
                          <div className="flex justify-end gap-0.5">
                            <IconButton
                              label={enabled ? `Send test event to ${endpoint.url}` : "Enable the endpoint to send a test event"}
                              disabled={!enabled}
                              onClick={() => test.mutate(endpoint)}
                            >
                              <Send aria-hidden className="size-3.5" />
                            </IconButton>
                            <IconButton label={`Edit ${endpoint.url}`} onClick={() => setEditing(endpoint)}>
                              <Pencil aria-hidden className="size-3.5" />
                            </IconButton>
                            <IconButton label={`Delete ${endpoint.url}`} onClick={() => setDeleting(endpoint)}>
                              <Trash2 aria-hidden className="size-3.5" />
                            </IconButton>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <DeliveryLog endpoints={endpoints} canEdit={canEdit} />

        <details className="rounded-lg border border-line bg-surface">
          <summary className="rounded-lg px-4 py-3 text-sm font-medium">Verifying a signature</summary>
          <div className="flex max-w-[75ch] flex-col gap-2 border-t border-line px-4 py-3 text-sm text-fg-2">
            <p>
              Each request carries{" "}
              <code className="font-mono text-xs">X-FluxGate-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>
              , plus <code className="font-mono text-xs">X-FluxGate-Event</code> and{" "}
              <code className="font-mono text-xs">X-FluxGate-Delivery</code>.
            </p>
            <p>
              Compute HMAC-SHA256 of <code className="font-mono text-xs">{"{t}.{raw body}"}</code>{" "}
              with the endpoint&apos;s signing secret, compare it to{" "}
              <code className="font-mono text-xs">v1</code> in constant time, and reject old
              timestamps. Deliveries can repeat, so deduplicate on the delivery ID.
            </p>
          </div>
        </details>
      </div>

      {adding && (
        <EndpointDialog
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setSecret(created);
          }}
        />
      )}
      {editing && <EndpointDialog endpoint={editing} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title="Delete this endpoint?"
        body={
          <>
            <span className="font-mono text-xs break-all">{deleting?.url}</span> will stop receiving
            events, and its delivery history is deleted with it.
          </>
        }
        confirmLabel="Delete endpoint"
        onClose={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(undefined);
        }}
      />
      <SecretDialog
        secret={secret}
        title="Your signing secret"
        description="Use it to verify that a request really came from FluxGate."
        onClose={() => setSecret(null)}
      />
    </>
  );
}
