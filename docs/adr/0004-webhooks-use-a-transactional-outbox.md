# ADR 0004: Webhooks use a transactional outbox over at-least-once Kafka

Status: accepted

## Context

An anomaly travels through Kafka, the consumer and an HTTP call before it is stored, then a webhook is sent to a tenant URL. Any of those steps can fail or repeat. Tenants should get each alert, and should not get it twice because Kafka redelivered a message.

## Decision

- **Consumer:** auto-commit is off. The offset is committed only after a message is fully handled. Malformed messages and alerts the gateway permanently rejects go to a real DLQ topic. Transient failures are not committed, and the message is retried.
- **Idempotency:** `anomalies` has a unique `(tenant_id, request_id)`, so a redelivered message inserts nothing and sends nothing.
- **Outbox:** `recordAnomaly` inserts the anomaly and its `webhook_deliveries` rows in one transaction. BullMQ is only a trigger; the row holds the state. A sweeper re-enqueues rows left `pending`, for example when Redis was down at commit time.
- **Delivery:** payloads are signed with an HMAC over `timestamp.body`, per-endpoint secrets are stored with AES-256-GCM, each attempt goes through the SSRF guard, and retries back off exponentially until the row is marked `dead`. A dead delivery can be retried by hand.

## Consequences

- A crash between the commit and the enqueue cannot lose a webhook. `tests/integration/webhooks.test.ts` and the pipeline e2e test cover the path, including that one alert produces one webhook.
- Delivery to the tenant is at-least-once. A crash after the receiver answered but before the row updates sends it again, so receivers should deduplicate on the delivery id in `X-FluxGate-Delivery`.
- Postgres holds delivery state, so there is one more table to bound, and this adds write load per anomaly. Anomalies are rare, so this is acceptable.
- There is no per-tenant alert throttling. A tenant whose traffic is entirely anomalous receives one webhook per request.
