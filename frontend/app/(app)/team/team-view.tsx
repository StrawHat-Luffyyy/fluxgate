"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog, Modal } from "@/components/ui/dialog";
import { FormError, InlineSelect, SelectField, TextField } from "@/components/ui/field";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ReadOnlyNote,
  TableSkeleton,
} from "@/components/ui/primitives";
import { TableWrap } from "@/components/ui/table";
import { api, ApiError, errorMessage, fieldErrorFrom } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { queryKeys, useMe, useTeam } from "@/lib/queries";
import type { Role, TeamMember } from "@/lib/types";
import { validateEmail, validateNewPassword } from "@/lib/validate";

function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();

  const add = useMutation({
    mutationFn: () =>
      api("/team", { method: "POST", body: { email: email.trim(), password, role } }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.team });
      toast.success(`${email.trim()} added`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "USER_EXISTS") {
        setErrors({ email: err.message });
        return;
      }
      const { field, message } = fieldErrorFrom(err, ["email", "password"]);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = { email: validateEmail(email), password: validateNewPassword(password) };
    setErrors(found);
    setFormError(undefined);
    if (!found.email && !found.password) add.mutate();
  };

  return (
    <Modal
      open
      title="Add team member"
      description="There are no email invitations: you set their first password and share it with them yourself."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add member
          </Button>
        </>
      }
    >
      <FormError>{formError}</FormError>
      <TextField
        label="Email"
        type="email"
        autoComplete="off"
        data-autofocus
        value={email}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        error={errors.password}
        hint="At least 10 characters."
        onChange={(event) => setPassword(event.target.value)}
      />
      <SelectField
        label="Role"
        value={role}
        hint={role === "admin" ? "Can change everything in this workspace." : "Can see everything but change nothing."}
        onChange={(event) => setRole(event.target.value as Role)}
      >
        <option value="viewer">Viewer</option>
        <option value="admin">Admin</option>
      </SelectField>
    </Modal>
  );
}

export function TeamView() {
  const client = useQueryClient();
  const { data: me } = useMe();
  const canEdit = me?.role === "admin";
  const { data: members, error, isPending, refetch } = useTeam();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TeamMember>();

  const adminCount = members?.filter((member) => member.role === "admin").length ?? 0;

  const setRole = useMutation({
    mutationFn: ({ member, role }: { member: TeamMember; role: Role }) =>
      api(`/team/${member.id}`, { method: "PATCH", body: { role } }),
    onMutate: async ({ member, role }) => {
      await client.cancelQueries({ queryKey: queryKeys.team });
      const previous = client.getQueryData<TeamMember[]>(queryKeys.team);
      client.setQueryData<TeamMember[]>(queryKeys.team, (rows) =>
        rows?.map((row) => (row.id === member.id ? { ...row, role } : row)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      client.setQueryData(queryKeys.team, context?.previous);
      if (!(err instanceof ApiError && err.status === 401)) toast.error(errorMessage(err));
    },
    onSuccess: (_data, { member, role }) => toast.success(`${member.email} is now ${role === "admin" ? "an admin" : "a viewer"}`),
    onSettled: (_data, _err, { member }) => {
      client.invalidateQueries({ queryKey: queryKeys.team });
      // Demoting yourself takes effect now, so the rest of the UI has to follow.
      if (member.id === me?.id) client.invalidateQueries({ queryKey: queryKeys.me });
    },
  });

  const remove = useMutation({
    mutationFn: (member: TeamMember) => api(`/team/${member.id}`, { method: "DELETE" }),
    onMutate: async (member) => {
      await client.cancelQueries({ queryKey: queryKeys.team });
      const previous = client.getQueryData<TeamMember[]>(queryKeys.team);
      client.setQueryData<TeamMember[]>(queryKeys.team, (rows) =>
        rows?.filter((row) => row.id !== member.id),
      );
      return { previous };
    },
    onError: (err, _member, context) => {
      client.setQueryData(queryKeys.team, context?.previous);
      toast.error(errorMessage(err));
    },
    onSuccess: (_data, member) => toast.success(`${member.email} removed`),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.team }),
  });

  return (
    <>
      <PageHeader
        title="Team"
        description="Admins can change anything in this workspace. Viewers can see everything but change nothing."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-3.5" />
              Add member
            </Button>
          ) : me ? (
            <ReadOnlyNote />
          ) : undefined
        }
      />
      <Panel flush>
        {isPending ? (
          <TableSkeleton rows={2} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : members.length === 0 ? (
          <EmptyState icon={Users} title="No members">
            This workspace has no members.
          </EmptyState>
        ) : (
          <TableWrap label="Team members">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col" className="hidden sm:table-cell">Added</th>
                {canEdit && <th scope="col" className="w-0"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.id === me?.id;
                // The gateway refuses to leave a workspace without an admin.
                const lastAdmin = member.role === "admin" && adminCount === 1;
                return (
                  <tr key={member.id} data-testid={`member-${member.email}`}>
                    <td className="break-all">
                      {member.email}
                      {isSelf && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge icon={false}>You</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      {canEdit ? (
                        <InlineSelect
                          label={`Role for ${member.email}`}
                          value={member.role}
                          disabled={lastAdmin}
                          title={lastAdmin ? "A workspace must keep at least one admin" : undefined}
                          onChange={(event) =>
                            setRole.mutate({ member, role: event.target.value as Role })
                          }
                        >
                          <option value="admin">Admin</option>
                          <option value="viewer">Viewer</option>
                        </InlineSelect>
                      ) : (
                        <Badge icon={false}>{member.role === "admin" ? "Admin" : "Viewer"}</Badge>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap text-fg-2 sm:table-cell">
                      {formatDate(member.createdAt)}
                    </td>
                    {canEdit && (
                      <td>
                        <div className="flex justify-end">
                          {/* Removing yourself would end your own session mid-task. */}
                          {!isSelf && (
                            <IconButton
                              label={lastAdmin ? "A workspace must keep at least one admin" : `Remove ${member.email}`}
                              disabled={lastAdmin}
                              onClick={() => setRemoving(member)}
                            >
                              <Trash2 aria-hidden className="size-3.5" />
                            </IconButton>
                          )}
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

      {adding && <AddMemberDialog onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        danger
        title={`Remove ${removing?.email}?`}
        body="They lose access on their next request. This deletes their account."
        confirmLabel="Remove member"
        onClose={() => setRemoving(undefined)}
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(undefined);
        }}
      />
    </>
  );
}
