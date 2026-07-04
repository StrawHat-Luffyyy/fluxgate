import http from "k6/http";
import { check, sleep } from "k6";

// k6 Configuration options
export const options = {
  stages: [
    { duration: "5s", target: 50 }, // Ramp up to 50 concurrent users
    { duration: "15s", target: 50 }, // Stay at 50 users for 15 seconds
    { duration: "5s", target: 0 }, // Ramp down to 0 users
  ],
};

// Replace this with the API Key you generated in Day 3!
const API_KEY = "YOUR_API_KEY_HERE";

export default function () {
  const url = "http://localhost:3000/gateway/posts/1";

  const params = {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
  };

  const res = http.get(url, params);

  // Validate the response
  check(res, {
    "is status 200 (Success)": (r) => r.status === 200,
    "is status 429 (Rate Limited)": (r) => r.status === 429,
    "latency is under 200ms": (r) => r.timings.duration < 200,
  });

  // Short sleep to simulate real user pacing
  sleep(0.1);
}
