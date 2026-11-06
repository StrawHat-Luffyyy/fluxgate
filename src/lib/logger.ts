import pino from "pino";
import { trace } from "@opentelemetry/api";
import { env } from "../config/env.js";
import { currentRequestContext } from "./requestContext.js";


export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  mixin() {
    const context = currentRequestContext();
    const spanId = trace.getActiveSpan()?.spanContext().spanId;
    return {
      ...(context ? { requestId: context.requestId, traceId: context.traceId } : {}),
      ...(spanId ? { spanId } : {}),
    };
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});


export const createChildLogger = (module: string) => {
  return logger.child({ module });
};
