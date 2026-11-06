import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const GATEWAY_SECRETS = {
  JWT_SECRET: "e2e-jwt-secret-e2e-jwt-secret-e2e-jwt-secret",
  INTERNAL_ALERT_SECRET: "e2e-internal-alert-secret",
  SECRETS_ENCRYPTION_KEY: "e2e-secrets-encryption-key",
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async <T>(
  description: string,
  probe: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${String(lastError)}` : ""}`);
};

export interface RunningProcess {
  child: ChildProcess;
  output: () => string;
  stop: (signal?: NodeJS.Signals) => Promise<number | null>;
}

const start = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): RunningProcess => {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "pipe" });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  return {
    child,
    output: () => output,
    stop: async (signal = "SIGTERM") => {
      if (child.exitCode === null) child.kill(signal);
      return exited;
    },
  };
};

/** Runs the real server entry point, in its own process, as production would. */
export const startGateway = (port: number, env: NodeJS.ProcessEnv = {}): RunningProcess =>
  start(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    process.cwd(),
    {
      NODE_ENV: "development",
      PORT: String(port),
      LOG_LEVEL: "info",
      ALLOW_PRIVATE_TARGETS: "true",
      // Development mode reads .env for anything unset, so pin what it could change.
      KAFKA_BROKER: process.env.KAFKA_BROKER ?? "localhost:19092",
      SENTRY_DSN: "",
      OTEL_ENABLED: "false",
      TRUST_PROXY: "false",
      ...GATEWAY_SECRETS,
      ...env,
    },
  );

const pythonBinary = () => {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  const venv = path.resolve(
    "ai-service/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  return existsSync(venv) ? venv : "python";
};

export const startConsumer = (env: NodeJS.ProcessEnv): RunningProcess =>
  start(pythonBinary(), ["consumer.py"], path.resolve("ai-service"), {
    INTERNAL_ALERT_SECRET: GATEWAY_SECRETS.INTERNAL_ALERT_SECRET,
    KAFKA_BROKERS: process.env.KAFKA_BROKER ?? "localhost:19092",
    ...env,
  });

/** Minimal API client that keeps the session cookie, for the gateway under test. */
export const apiClient = (baseUrl: string) => {
  let cookie = "";
  const request = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return res;
  };
  return { request };
};

export const provisionTenant = async (baseUrl: string) => {
  const api = apiClient(baseUrl);
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const password = "e2e-password-long-enough";
  const signup = await api.request("POST", "/auth/signup", {
    tenantName: "E2E tenant",
    email,
    password,
  });
  if (signup.status !== 201) throw new Error(`Signup failed: ${signup.status}`);
  const login = await api.request("POST", "/auth/login", { email, password });
  if (login.status !== 200) throw new Error(`Login failed: ${login.status}`);
  const key = await api.request("POST", "/keys", { name: "e2e" });
  const { apiKey } = (await key.json()) as { apiKey: string };
  return { api, apiKey };
};
