export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const parseJson = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/**
 * The session is an HttpOnly cookie set by the gateway, so every call carries
 * credentials and nothing here can read the token.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      signal: options.signal,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(`Could not reach the gateway at ${API_BASE_URL}.`, 0, "NETWORK_ERROR");
  }

  if (res.status === 204) return undefined as T;

  const body = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(
      typeof body.message === "string" ? body.message : `Request failed with status ${res.status}`,
      res.status,
      typeof body.error === "string" ? body.error : undefined,
    );
  }
  return body as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong.";

/**
 * parseBody answers validation failures as "field: reason". This returns the
 * field when it is one the form shows, so the message can sit beside its input.
 */
export const fieldErrorFrom = (
  err: unknown,
  fields: readonly string[],
): { field?: string; message: string } => {
  const message = errorMessage(err);
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") {
    const separator = message.indexOf(": ");
    const field = message.slice(0, Math.max(separator, 0));
    if (fields.includes(field)) return { field, message: message.slice(separator + 2) };
  }
  return { message };
};
