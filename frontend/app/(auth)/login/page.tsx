import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    // LoginForm reads ?next=, which needs a Suspense boundary to prerender this page.
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
