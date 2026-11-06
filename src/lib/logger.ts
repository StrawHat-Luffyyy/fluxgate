import pino from "pino";
import { trace } from "@opentelemetry/api";
import { env } from "../config/env.js";


export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === "production" ? "info" : "debug"),
  transport:
    env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  mixin() {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const ctx = activeSpan.spanContext();
      return {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
      };
    }
    return {};
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
