"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { validateEmail, validateNewPassword, validateTenantName } from "@/lib/validate";

type Errors = { tenantName?: string; email?: string; password?: string };

export function SignupForm() {
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  // Signup creates the tenant and its admin but no session, so sign in straight after.
  const signup = useMutation({
    mutationFn: async () => {
      const credentials = { email: email.trim(), password };
      await api("/auth/signup", {
        method: "POST",
        body: { tenantName: tenantName.trim(), ...credentials },
      });
      await api("/auth/login", { method: "POST", body: credentials });
    },
    onSuccess: () => window.location.assign("/overview"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: Errors = {
      tenantName: validateTenantName(tenantName),
      email: validateEmail(email),
      password: validateNewPassword(password),
    };
    setErrors(found);
    if (!found.tenantName && !found.email && !found.password) signup.mutate();
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Create a workspace</h1>
        <p className="text-sm text-fg-2">You will be its first admin.</p>
      </div>
      <FormError>{signup.isError && errorMessage(signup.error)}</FormError>
      <TextField
        label="Workspace name"
        autoComplete="organization"
        autoFocus
        value={tenantName}
        error={errors.tenantName}
        onChange={(event) => setTenantName(event.target.value)}
      />
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters."
        value={password}
        error={errors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" variant="primary" loading={signup.isPending || signup.isSuccess}>
        Create workspace
      </Button>
      <p className="text-center text-sm text-fg-2">
        Already have an account?{" "}
        <Link href="/login" className="text-accent underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
