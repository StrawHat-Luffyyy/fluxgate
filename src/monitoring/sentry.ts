import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";


export const initSentry = () => {
  if (!env.SENTRY_DSN) {
    console.log(
      "SENTRY_DSN not provided. Exception monitoring disabled for local dev.",
    );
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0, // Adjust the sample rate based on the environment
    attachStacktrace: true,
  });

  console.log("Sentry exception monitoring activated.");
};

/**
 * Helper to manually capture exceptions with rich tenant and trace context.
 */
export const captureException = (
  err: unknown,
  context?: Record<string, any>,
) => {
  if (!env.SENTRY_DSN) {
    console.error("[Local Exception Capture]:", err, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) {
      if (context.tenantId) scope.setTag("tenantId", context.tenantId);
      if (context.userId) scope.setUser({ id: context.userId });
      scope.setExtras(context);
    }
    Sentry.captureException(err);
  });
};
