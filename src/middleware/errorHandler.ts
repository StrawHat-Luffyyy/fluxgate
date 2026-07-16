import type { ErrorHandler } from "hono";
import { AppError } from "../lib/AppError.js";
import { createChildLogger } from "../lib/logger.js";

const log = createChildLogger("error-handler");

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get("requestId") ?? "unknown";

  if (err instanceof AppError) {
    if (!err.isOperational) {
      log.error(
        { err, requestId, path: c.req.path },
        "Non-operational AppError caught",
      );
    } else {
      log.warn(
        { code: err.code, statusCode: err.statusCode, requestId, path: c.req.path },
        err.message,
      );
    }

    return c.json(
      {
        error: err.message,
        code: err.code,
        requestId,
      },
      err.statusCode as any,
    );
  }

  // Unexpected / non-operational error
  log.error(
    { err, requestId, path: c.req.path },
    "Unhandled error",
  );

  return c.json(
    {
      error: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
      requestId,
    },
    500,
  );
};
