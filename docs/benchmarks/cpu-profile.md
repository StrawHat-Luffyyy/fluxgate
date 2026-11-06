# Gateway CPU profile under load

A 12 second profile of the gateway during the 50 virtual user stage of `pnpm bench`, taken once at commit 7bc19a7. Other work was running on the machine, and the profiler itself takes a little CPU, so read the shape and not exact percentages.

To reproduce (on Git Bash, with an absolute path to this repository):

```bash
PROF_OUT="$PWD/gateway.cpuprofile" PROF_START_MS=25000 PROF_LENGTH_MS=12000 NODE_OPTIONS="--import=file:///$PWD/scripts/cpu-profile-preload.mjs" BENCH_DURATION=15s pnpm bench
```

```bash
python scripts/summarize-cpu-profile.py gateway.cpuprofile
```

Self time by module, top entries:

| Share | Module |
| --- | --- |
| 9.5% | undici |
| 8.4% | idle |
| 6.5% | `writeUtf8String` (socket and log writes) |
| 6.4% | Node's internal undici |
| 5.7% | drizzle-orm |
| 4.8% | hono |
| 3.1% | Node `task_queues` |
| 2.9% | `runMicrotasks` |
| 2.7% | `writev` |
| 2.7% | native program time |
| 2.7% | @hono/node-server |
| 2.7% | ioredis |
| 2.6% | garbage collector |
| 2.2% | Node web streams |
| 1.9% | kafkajs |

The largest single function is `writeUtf8String` at 6.5%. No entry dominates, so no single fix would change throughput much. Little idle time means that the one event loop is close to saturated.
