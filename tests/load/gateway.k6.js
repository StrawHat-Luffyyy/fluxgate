// Real HTTP through auth, rate limiting and proxying. Driven by
// scripts/run-benchmarks.ts, which sets TARGET_URL, API_KEY, VUS and DURATION.
import http from "k6/http";
import { check } from "k6";

// The ramp keeps a burst of new connections from overflowing the listen backlog,
// which would measure the OS accept queue rather than the server.
export const options = {
  stages: [
    { duration: "5s", target: Number(__ENV.VUS || 50) },
    { duration: __ENV.DURATION || "20s", target: Number(__ENV.VUS || 50) },
  ],
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max"],
};

const headers = __ENV.API_KEY ? { Authorization: `Bearer ${__ENV.API_KEY}` } : {};

export default function () {
  const res = http.get(__ENV.TARGET_URL, { headers });
  check(res, { "status is 200": (r) => r.status === 200 });
  // A fail-open response is also a 200, but it skipped the rate limiter.
  if (__ENV.API_KEY) {
    check(res, {
      "went through the rate limiter": (r) =>
        Boolean(r.headers["X-Ratelimit-Strategy"]) && !r.headers["X-Ratelimit-Fallback"],
    });
  }
}
