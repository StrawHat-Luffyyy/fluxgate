# ADR 0002: Telemetry never blocks traffic, and may be lost

Status: accepted

## Context

Each gateway request produces a record used for analytics and for anomaly detection. If writing that record is part of serving the request, a slow database or a broker outage becomes a traffic outage.

## Decision

`emitTelemetry` never awaits I/O and never throws. It adds the record to two independent, bounded, in-process buffers:

- `requestLogWriter` batches rows into the `request_logs` table in Postgres, the source of all analytics.
- The Kafka producer publishes to `gateway.traffic.logs`, read by the anomaly consumer.

When a buffer is full, the oldest record is dropped and counted in `fluxgate_telemetry_dropped_total{sink}`.

Analytics live in Postgres, not in a separate columnar store, and are queried with `percentile_cont` over raw rows on their own small connection pool. That was the simplest option that gives real percentiles, and a retention job bounds the table.

## Consequences

- A Kafka or Postgres outage cannot block the telemetry step or affect the other sink. Postgres is still needed for auth and route lookups on a cache miss.
- Telemetry is at-most-once from the gateway's point of view. A crash loses what is in the buffers, and a long outage drops records. Analytics are therefore approximate during incidents, and the drop counter says by how much.
- This is the wrong design for billing or audit logs, which would need a durable write before responding.
- Raw-row percentiles get slower as a tenant's data grows. The dashboard query is cached for 10 seconds and is isolated from the request path by its pool, but high volumes would need rollups or a columnar store.
- The consumer runs behind the gateway under sustained load, because it commits per message. This builds Kafka lag rather than losing data.
