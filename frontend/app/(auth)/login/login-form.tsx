"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api";
import { validateEmail } from "@/lib/validate";

/** Only same-site paths: this value comes from the URL, so it must not be an open redirect. */
const safeNext = (next: string | null) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/overview";

export function LoginForm() {
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const login = useMutation({
    mutationFn: () => api("/auth/login", { method: "POST", body: { email: email.trim(), password } }),
    // A full navigation, so no cached data from another session can survive a sign-in.
    onSuccess: () => window.location.assign(next),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = {
      email: validateEmail(email),
      password: password ? undefined : "Enter your password.",
    };
    setErrors(found);
    if (!found.email && !found.password) login.mutate();
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-fg-2">Use your FluxGate account.</p>
      </div>
      <FormError>{login.isError && errorMessage(login.error)}</FormError>
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        error={errors.email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        error={errors.password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" variant="primary" loading={login.isPending || login.isSuccess}>
        Sign in
      </Button>
      <p className="text-center text-sm text-fg-2">
        New to FluxGate?{" "}
        <Link href="/signup" className="text-accent underline">
          Create a workspace
        </Link>
      </p>
    </form>
  );
}
