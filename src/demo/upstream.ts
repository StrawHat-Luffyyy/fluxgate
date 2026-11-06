import { createServer } from "node:http";
import { verifySignature } from "../lib/signature.js";
import { DEMO_WEBHOOK_SECRET } from "./constants.js";

// A small service for the gateway to proxy to in the demo, and the receiver for its
// webhooks. Delays and sizes sit inside the model's training range (see
// ai-service/synthetic.py): traffic that looks like localhost would all be flagged.

const PORT = Number(process.env.PORT ?? 4000);
const HUGE_BYTES = 3 * 1024 * 1024;

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

const readBody = async (req: AsyncIterable<Buffer>) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
};

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url === "/health") {
    res.end("ok");
    return;
  }

  if (url === "/webhook-sink" || url === "/webhook-flaky") {
    const body = await readBody(req);
    const valid = verifySignature(
      req.headers["x-fluxgate-signature"] as string | undefined,
      DEMO_WEBHOOK_SECRET,
      body,
    );
    process.stdout.write(`webhook ${url} signature=${valid ? "valid" : "INVALID"}\n`);
    if (!valid) res.statusCode = 401;
    else if (url === "/webhook-flaky" && Math.random() < 0.5) res.statusCode = 503;
    res.end();
    return;
  }

  const body = await readBody(req);
  const huge = url.includes("/huge");
  const failed = url.includes("/fail");
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const size = huge
    ? HUGE_BYTES
    : failed
      ? 120
      : isWrite
        ? Math.round(randomBetween(200, 800))
        : Math.round(randomBetween(800, 8000));

  setTimeout(
    () => {
      res.statusCode = failed ? 500 : isWrite ? 201 : 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ path: url, received: body.length, padding: "x".repeat(Math.max(0, size - 60)) }),
      );
    },
    randomBetween(failed ? 20 : 40, failed ? 60 : 160),
  );
});

server.listen(PORT, () => process.stdout.write(`Demo upstream listening on ${PORT}\n`));

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
