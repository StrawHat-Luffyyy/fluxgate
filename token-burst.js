import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: 12,
      iterations: 12,
    },
  },
};

const token =
  "fg_live_027bfaaba1b76865fa7b46311923d00ffc91bd626a2e4f5a";

const params = {
  headers: {
    Authorization: `Bearer ${token}`,
  },
};

export default function () {
  const res = http.get(
    "http://localhost:3000/test-rate-limit",
    params
  );

 if (res.status === 200) {
    console.log("SUCCESS");
}

if (res.status === 429) {
    console.log("BLOCKED");
}

  check(res, {
    "200 or 429": (r) =>
      r.status === 200 || r.status === 429,
  });
}