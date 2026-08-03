"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      toast.success("Login successful");
      router.push("/dashboard");
    } catch (err) {
      if (err instanceof Error) {
        toast.error(err.message || "Login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#0f1115] text-white px-4">
      <form
        onSubmit={handleLogin}
        className="flex flex-col gap-4 p-8 bg-[#1a1d24] rounded-xl border border-gray-800 shadow-2xl w-full max-w-sm"
      >
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold mb-1">FluxGate</h2>
          <p className="text-gray-500 text-sm">
            Sign in to your dashboard
          </p>
        </div>

        <input
          type="email"
          placeholder="Email"
          className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-blue-500 focus:outline-none transition text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
        />
        <input
          type="password"
          placeholder="Password"
          className="p-3 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-blue-500 focus:outline-none transition text-sm"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className="p-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg font-bold transition text-sm mt-2"
        >
          {isLoading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
