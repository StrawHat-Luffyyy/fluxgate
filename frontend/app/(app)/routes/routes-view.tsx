"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Pencil, Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { FormError, TextField, useFocusFirstInvalid } from "@/components/ui/field";
import { EmptyState, ErrorState, PageHeader, Panel, ReadOnlyNote, TableSkeleton } from "@/components/ui/primitives";
import { CopyIconButton } from "@/components/ui/secret-dialog";
import { TableWrap } from "@/components/ui/table";
import { api, API_BASE_URL, ApiError, errorMessage, fieldErrorFrom } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { queryKeys, useMe, useRoutes } from "@/lib/queries";
import type { GatewayRoute } from "@/lib/types";
import { normalizePathPrefix, validateHttpUrl, validatePathPrefix } from "@/lib/validate";

const gatewayUrl = (prefix: string) => `${API_BASE_URL}/gateway${prefix}`;

function RouteDialog({ route, onClose }: { route?: GatewayRoute; onClose: () => void }) {
  const client = useQueryClient();
  const [pathPrefix, setPathPrefix] = useState(route?.pathPrefix ?? "");
  const [targetUrl, setTargetUrl] = useState(route?.targetUrl ?? "");
  const [errors, setErrors] = useState<{ pathPrefix?: string; targetUrl?: string }>({});
  const [formError, setFormError] = useState<string>();
  useFocusFirstInvalid(errors);

  const save = useMutation({
    mutationFn: () => {
      const body = { pathPrefix: normalizePathPrefix(pathPrefix), targetUrl: targetUrl.trim() };
      return route
        ? api(`/admin/routes/${route.id}`, { method: "PATCH", body })
        : api("/admin/routes", { method: "POST", body });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.routes });
      toast.success(route ? "Route updated" : "Route created");
      onClose();
    },
    onError: (err) => {
      // The gateway resolves the target and refuses private addresses, which only it can check.
      if (err instanceof ApiError && err.code === "UNSAFE_TARGET_URL") {
        setErrors({ targetUrl: err.message });
      } else if (err instanceof ApiError && err.code === "ROUTE_EXISTS") {
        setErrors({ pathPrefix: err.message });
      } else {
        const { field, message } = fieldErrorFrom(err, ["pathPrefix", "targetUrl"]);
        if (field) setErrors({ [field]: message });
        else setFormError(message);
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = {
      pathPrefix: validatePathPrefix(pathPrefix),
      targetUrl: validateHttpUrl(targetUrl),
    };
    setErrors(found);
    setFormError(undefined);
    if (!found.pathPrefix && !found.targetUrl) save.mutate();
  };

  const validPrefix = !validatePathPrefix(pathPrefix);

  return (
    <Modal
      open
      title={route ? "Edit route" : "Create route"}
      description="Requests to the gateway under this prefix are forwarded to the target."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {route ? "Save route" : "Create route"}
          </Button>
        </>
      }
    >
      <FormError>{formError}</FormError>
      <TextField
        label="Path prefix"
        mono
        data-autofocus
        placeholder="/users"
        value={pathPrefix}
        error={errors.pathPrefix}
        hint="One path segment. The gateway matches on the first segment only."
        onChange={(event) => setPathPrefix(event.target.value)}
      />
      <TextField
        label="Target URL"
        mono
        placeholder="https://users.internal.example.com"
        value={targetUrl}
        error={errors.targetUrl}
        hint="Private and metadata addresses are refused, and redirects are not followed."
        onChange={(event) => setTargetUrl(event.target.value)}
      />
      <p className="text-xs break-all text-fg-3">
        Clients will call{" "}
        <code className="font-mono text-fg-2">
          {gatewayUrl(validPrefix ? normalizePathPrefix(pathPrefix) : "/<prefix>")}/…
        </code>
      </p>
    </Modal>
  );
}

export function RoutesView() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role === "admin";
  const { data: routes, error, isPending, refetch } = useRoutes();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GatewayRoute>();
  const [deleting, setDeleting] = useState<GatewayRoute>();

  // Optimistic: removing a row is safe to show at once and simple to put back.
  const remove = useMutation({
    mutationFn: (route: GatewayRoute) => api(`/admin/routes/${route.id}`, { method: "DELETE" }),
    onMutate: async (route) => {
      await client.cancelQueries({ queryKey: queryKeys.routes });
      const previous = client.getQueryData<GatewayRoute[]>(queryKeys.routes);
      client.setQueryData<GatewayRoute[]>(queryKeys.routes, (rows) =>
        rows?.filter((row) => row.id !== route.id),
      );
      return { previous };
    },
    onError: (err, _route, context) => {
      client.setQueryData(queryKeys.routes, context?.previous);
      toast.error(errorMessage(err));
    },
    onSuccess: (_data, route) => toast.success(`Route ${route.pathPrefix} deleted`),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.routes }),
  });

  return (
    <>
      <PageHeader
        title="Routes"
        description="Map a path prefix on the gateway to an upstream service."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden className="size-3.5" />
              Create route
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
        ) : routes.length === 0 ? (
          <EmptyState
            icon={RouteIcon}
            title="No routes yet"
            action={
              canEdit && (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create your first route
                </Button>
              )
            }
          >
            Without a route, the gateway answers 404 to every request, even with a valid API key.
          </EmptyState>
        ) : (
          <TableWrap label="Gateway routes">
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col" className="hidden md:table-cell">Updated</th>
                <th scope="col" className="w-0"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id} data-testid={`route-${route.pathPrefix}`}>
                  <td className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
                      <span className="font-medium text-fg">{route.pathPrefix}</span>
                      <ArrowRight aria-label="forwards to" className="size-3 shrink-0 text-fg-3" />
                      <span className="break-all text-fg-2">{route.targetUrl}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-xs break-all text-fg-3">
                      {gatewayUrl(route.pathPrefix)}
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap text-fg-2 md:table-cell">
                    {formatRelative(route.updatedAt)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-0.5">
                      <CopyIconButton
                        value={gatewayUrl(route.pathPrefix)}
                        label={`Copy gateway URL for ${route.pathPrefix}`}
                      />
                      {canEdit && (
                        <>
                          <IconButton label={`Edit ${route.pathPrefix}`} onClick={() => setEditing(route)}>
                            <Pencil aria-hidden className="size-3.5" />
                          </IconButton>
                          <IconButton label={`Delete ${route.pathPrefix}`} onClick={() => setDeleting(route)}>
                            <Trash2 aria-hidden className="size-3.5" />
                          </IconButton>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>

      {creating && <RouteDialog onClose={() => setCreating(false)} />}
      {editing && <RouteDialog route={editing} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title={`Delete ${deleting?.pathPrefix}?`}
        body="Requests under this prefix will get a 404 from the gateway straight away."
        confirmLabel="Delete route"
        onClose={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(undefined);
        }}
      />
    </>
  );
}
