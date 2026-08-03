# FluxGate Performance Benchmarks & Rate-Limiter Analysis

This document provides transparent, reproducible benchmark metrics for **FluxGate API Gateway**. It separates **Redis Rate-Limiter Engine throughput** from **Full End-to-End Gateway HTTP Proxy throughput**.

## Machine & Environment Specifications
- **CPU**: 12th Gen Intel(R) Core(TM) i5-12450H (12 logical cores)
- **RAM**: 15.7 GB
- **OS**: win32 (x64)
- **Runtime**: Node.js v24.11.1 / Hono / Redis 7
- **Configured Rate Limit**: 200 requests per window

---

## 1. Redis Rate-Limiter Engine Benchmarks
*Scope: Measures direct Lua script evaluation throughput & atomicity inside Redis.*

| Algorithm | Concurrency (Workers) | Engine Req/Sec | p50 Latency (ms) | p95 Latency (ms) | p99 Latency (ms) | Script Throttling Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Sliding Window** | 50 | **29,553 req/s** | 0.47 ms | 0.94 ms | 1.43 ms | **100.0% (0 drift)*** |
| **Sliding Window** | 200 | **63,448 req/s** | 2.28 ms | 2.84 ms | 2.88 ms | **100.0% (0 drift)*** |
| **Sliding Window** | 500 | **67,012 req/s** | 3.01 ms | 5.13 ms | 5.24 ms | **100.0% (0 drift)*** |
| **Sliding Window** | 1000 | **70,216 req/s** | 7.95 ms | 12.91 ms | 13.16 ms | **100.0% (0 drift)*** |
| **Token Bucket** | 50 | **7,521 req/s** | 6.38 ms | 6.43 ms | 6.59 ms | **100.0% (0 drift)*** |
| **Token Bucket** | 200 | **2,67,023 req/s** | 0.39 ms | 0.6 ms | 0.62 ms | **100.0% (0 drift)*** |
| **Token Bucket** | 500 | **88,838 req/s** | 1.01 ms | 5.24 ms | 5.28 ms | **100.0% (0 drift)*** |
| **Token Bucket** | 1000 | **89,079 req/s** | 5.87 ms | 7.04 ms | 7.13 ms | **100.0% (0 drift)*** |
| **Leaky Bucket** | 50 | **1,14,705 req/s** | 0.15 ms | 0.23 ms | 0.39 ms | **100.0% (0 drift)*** |
| **Leaky Bucket** | 200 | **41,335 req/s** | 4.34 ms | 4.68 ms | 4.71 ms | **100.0% (0 drift)*** |
| **Leaky Bucket** | 500 | **73,895 req/s** | 4.74 ms | 5.65 ms | 5.73 ms | **100.0% (0 drift)*** |
| **Leaky Bucket** | 1000 | **88,633 req/s** | 8.37 ms | 9.66 ms | 9.77 ms | **100.0% (0 drift)*** |

> **Note on 100.0% Throttling Accuracy**: Single-node Redis Lua scripts execute atomically on a single thread. Inside a single Redis node, check-and-set operations are atomic, guaranteeing 0 race conditions at the Redis script boundary. In multi-region distributed Redis clusters with asynchronous replication, boundary drift (~1-3%) can occur due to replication lag.

---

## 2. End-to-End Gateway HTTP Throughput
*Scope: Measures full end-to-end request processing through Hono HTTP router, middleware stack, header extraction, and JSON response serialization.*

| Concurrency (Workers) | Gateway End-to-End Req/Sec | p50 Latency (ms) | p95 Latency (ms) | p99 Latency (ms) |
| :---: | :---: | :---: | :---: | :---: |
| 50 | **1,460 req/s** | 22.85 ms | 25.01 ms | 34.09 ms |
| 200 | **4,787 req/s** | 38 ms | 41.18 ms | 41.48 ms |
| 500 | **7,541 req/s** | 58.3 ms | 63.12 ms | 65.35 ms |
| 1000 | **10,234 req/s** | 90.94 ms | 96.57 ms | 97.19 ms |

---

## Exact Command to Reproduce

```bash
# 1. Start local Docker Compose environment (Postgres, Redis, Kafka)
docker-compose up -d

# 2. Execute benchmark runner
npx tsx tests/load-test-runner.ts
```
