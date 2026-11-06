// Client-side checks mirror the Zod schemas in src/routes. They exist to give an
// immediate answer; the gateway still decides, and its error is shown if it differs.

export const validateEmail = (value: string) => {
  const email = value.trim();
  if (!email) return "Enter an email address.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address, like you@company.com.";
  }
};

export const validateNewPassword = (value: string) => {
  if (value.length < 10) return "Use at least 10 characters.";
  // bcrypt ignores input past 72 bytes, and the gateway refuses it.
  if (value.length > 72) return "Use 72 characters or fewer.";
};

export const validateTenantName = (value: string) => {
  const name = value.trim();
  if (name.length < 2) return "Use at least 2 characters.";
  if (name.length > 80) return "Use 80 characters or fewer.";
};

export const validateHttpUrl = (value: string) => {
  const raw = value.trim();
  if (!raw) return "Enter a URL.";
  if (raw.length > 2048) return "Use 2048 characters or fewer.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a full URL, like https://api.example.com.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "The URL must use http or https.";
  if (url.username || url.password) return "Remove the credentials from the URL.";
};

export const validatePathPrefix = (value: string) => {
  const raw = value.trim();
  if (!raw) return "Enter a path prefix.";
  // The proxy matches on the first path segment only.
  if (!/^\/?[A-Za-z0-9._~-]{1,64}\/?$/.test(raw)) {
    return "Use a single path segment, like /users. Letters, digits and . _ ~ - only.";
  }
};

export const normalizePathPrefix = (value: string) => `/${value.trim().replace(/^\/|\/$/g, "")}`;

export const validateNumber = (
  raw: string,
  { min, max, integer, label }: { min: number; max: number; integer?: boolean; label: string },
) => {
  const value = Number(raw);
  if (raw.trim() === "" || Number.isNaN(value)) return `Enter a value for ${label}.`;
  if (integer && !Number.isInteger(value)) return `${label} must be a whole number.`;
  if (value < min || value > max) {
    return `${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
  }
};
