// Preload for the gateway: profiles a window during load, then writes PROF_OUT. See docs/benchmarks/cpu-profile.md.
import { Session } from "node:inspector";
import { writeFileSync } from "node:fs";

if (process.argv[1]?.endsWith("server.js")) {
const session = new Session();
session.connect();
const post = (method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (err, res) => (err ? reject(err) : resolve(res))),
  );

const START_MS = Number(process.env.PROF_START_MS ?? 15000);
const LENGTH_MS = Number(process.env.PROF_LENGTH_MS ?? 15000);
setTimeout(async () => {
  await post("Profiler.enable");
  await post("Profiler.start");
  setTimeout(async () => {
    const { profile } = await post("Profiler.stop");
    writeFileSync(process.env.PROF_OUT, JSON.stringify(profile));
    process.stderr.write("profile written\n");
  }, LENGTH_MS).unref();
}, START_MS).unref();
}
