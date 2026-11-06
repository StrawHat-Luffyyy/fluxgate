
## Complete Request Lifecycle

Client
   │
   │ GET /gateway/users/42
   ▼
Authentication Middleware
   │
   │ Validate API key
   │ Attach tenantId
   ▼
Proxy Handler
   │
   ├── Check Redis
   │       │
   │       ├── Hit → target URL
   │       │
   │       └── Miss
   │              │
   │              ▼
   │          PostgreSQL
   │              │
   │          Cache in Redis
   ▼
Build Upstream URL
   ▼
Forward Request (fetch)
   ▼
Upstream Service
   ▼
Receive Response
   ▼
Extract Metrics
   ▼
Publish to Kafka
   ▼
Strip Sensitive Headers
   ▼
Return Response to Client
