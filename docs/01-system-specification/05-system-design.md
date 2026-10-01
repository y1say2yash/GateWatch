# GateWatch — System Design

## 1. Design Overview

GateWatch uses a **modular monolith architecture** implemented as a single Node.js + Express backend.

The backend has a logical separation between:

- **Control Plane:** authentication, user management, projects, API configuration, tests, monitoring, alerts, and administration.
- **Data Plane:** gateway request processing, authentication, rate limiting, routing, upstream communication, and request logging.

The Control Plane and Data Plane run in the **same backend process and container** for the MVP.

### High-Level Architecture

```
                              Internet
                                  │
                                  ▼
                             CloudFront
                           /             \
                          /               \
                 Static Assets          API Requests
                       │                    │
                       ▼                    ▼
                      S3                   EC2
                                           │
                              ┌────────────┼────────────┐
                              │            │            │
                              ▼            ▼            ▼
                         GateWatch       Redis       Demo APIs
                          Backend
                              │
                  ┌───────────┼────────────┐
                  │           │            │
                  ▼           ▼            ▼
                 RDS       CloudWatch      SNS
             PostgreSQL
```

### Backend Architecture

```
GateWatch Backend
│
├── Control Plane
│   ├── Auth
│   ├── Users
│   ├── Projects
│   ├── APIs
│   ├── Tests
│   ├── Monitoring
│   ├── Alerts
│   └── Admin
│
└── Data Plane
    ├── Gateway
    ├── Routing
    ├── Authentication
    ├── Rate Limiting
    └── Request Logging
```

---

## 2. Core Modules

The backend is organized into logical feature modules.

```
auth
users
projects
apis
gateway
routes
rate-limiting
tests
monitoring
alerts
logs
health
admin
```

All modules execute within the same Node.js process.

### Module Boundaries

| Module | Primary Responsibility |
| --- | --- |
| `auth` | GitHub OAuth and GateWatch sessions |
| `users` | User accounts, roles, and lifecycle |
| `projects` | Project creation, ownership, and lifecycle |
| `apis` | API registration, configuration, and lifecycle |
| `gateway` | Gateway request orchestration |
| `routes` | Route matching and route configuration |
| `rate-limiting` | Fixed-window request limiting |
| `tests` | Test definitions, execution, and assertions |
| `monitoring` | Health, latency, errors, and monitoring state |
| `health` | Health-check execution and classification |
| `alerts` | Alert rules, state, deduplication, and notifications |
| `logs` | Request history and audit logging |
| `admin` | Platform and user administration |

---

## 3. Module Responsibilities

### 3.1 Auth

Responsible for:

- GitHub OAuth
- OAuth callback handling
- User authentication
- Session creation
- Session validation
- Session termination

### 3.2 Users

Responsible for:

- User records
- GitHub identity mapping
- User roles
- User lifecycle
- User ownership

### 3.3 Projects

Responsible for:

- Project creation
- Project configuration
- Project ownership
- Project lifecycle
- Resource ownership boundaries

### 3.4 APIs

The `apis` module defines and manages what an API is.

It is responsible for:

- API registration
- API metadata
- Upstream configuration
- Authentication configuration
- Rate-limit configuration
- Health-check configuration
- API lifecycle
- API ownership

The module does not process gateway traffic.

### 3.5 Gateway

The `gateway` module uses API configuration to process incoming API requests.

It is responsible for:

- Gateway request orchestration
- API resolution
- Request authentication
- Rate limiting
- Upstream request execution
- Response handling
- Request history recording

### 3.6 Routes

Responsible for:

- Public route configuration
- Prefix matching
- Longest-prefix selection
- HTTP method restrictions
- Route normalization
- Duplicate route detection

### 3.7 Rate Limiting

Responsible for:

- Client identification
- Fixed-window counters
- Redis interaction
- Atomic request counting
- Rate-limit enforcement

### 3.8 Tests

Responsible for:

- Test definitions
- Request construction
- Direct upstream execution
- Assertion evaluation
- Test results
- CI/CD-triggered execution

### 3.9 Monitoring and Health

Responsible for:

- Automatic health checks
- Manual health checks
- Response-time measurement
- Error monitoring
- Health classification
- Monitoring state

### 3.10 Alerts

Responsible for:

- Alert condition evaluation
- Alert state
- Deduplication
- Recovery detection
- Notification delivery through SNS

### 3.11 Logs

Responsible for:

- Gateway request history
- Audit logging
- Structured logging integration

Operational application logs are handled through CloudWatch in the deployed environment.

### 3.12 Admin

Responsible for:

- User administration
- Role management
- Platform-level visibility
- System-level configuration
- Platform health information

---

## 4. Authentication Design

### 4.1 GitHub OAuth

GateWatch uses GitHub OAuth for user authentication.

```
Browser
   │
   ▼
GateWatch /auth/github
   │
   ▼
GitHub OAuth
   │
   ▼
OAuth Callback
   │
   ▼
Validate GitHub Identity
   │
   ▼
Create / Update User
   │
   ▼
Create Session
   │
   ▼
Authenticated Browser Session
```

OAuth callback URLs are environment-specific and configured through environment configuration rather than hardcoded into the application.

### 4.2 User Session

GateWatch uses:

- Secure HTTP-only cookies
- Server-side sessions
- PostgreSQL as the authoritative session store
- Redis as the active-session cache

Session lookup follows:

```
Request
  │
  ▼
Session Cookie
  │
  ▼
Redis Session Cache
  │
  ├── Found ──► Authenticate
  │
  └── Not Found
         │
         ▼
    PostgreSQL
         │
         ▼
   Repopulate Redis
         │
         ▼
      Authenticate
```

Cookies shall use appropriate security attributes including `HttpOnly` and `Secure` in deployed environments.

### 4.3 API Key Authentication

API keys are used to authenticate protected registered APIs.

API keys shall be:

- Generated by GateWatch
- Associated with an API
- Stored using a secure hash
- Represented to users using a short fixed-length key prefix
- Revocable

The plaintext API key is not stored.

### 4.4 API Key Forwarding

GateWatch validates its own API key and removes it before forwarding the request upstream.

If an API has a separate upstream authentication configuration, that credential is handled independently.

---

## 5. User Management Design

### 5.1 User Creation

After successful GitHub authentication:

```
GitHub Identity
      │
      ▼
Find User
   /       \
Exists     Missing
  │           │
Update      Create
  │           │
  └─────┬─────┘
        ▼
Create / Restore Session
```

A new user is created when no matching GateWatch account exists.

### 5.2 User States

Users support three lifecycle states:

```
Active
Deleted
Admin_disabled
```

#### Active

The user can authenticate and use GateWatch according to their role and ownership permissions.

#### Deleted

User deletion is soft deletion.

A deleted user may return through GitHub OAuth. Successful re-authentication can restore the account to `Active`.

Existing owned resources remain retained according to the system's soft-delete and ownership rules.

#### Admin_disabled

An Admin-disabled user cannot establish an active GateWatch session.

The user must contact an Admin to have the account re-enabled.

### 5.3 Admin Bootstrap

The initial Admin account is established through controlled configuration or database setup.

The first user to authenticate is **not automatically made Admin**.

### 5.4 Resource Ownership

Users can access only resources they own.

MVP does not support:

- Invitations
- Shared ownership
- Teams
- Collaboration
- Resource sharing

---

## 6. Core Business Logic

### 6.1 API Configuration

PostgreSQL is the authoritative source for API configuration.

Redis maintains a cached representation of frequently accessed gateway configuration.

```
Configuration Update
        │
        ▼
Validate
        │
        ▼
PostgreSQL
        │
        ▼
Update / Invalidate Redis Cache
```

A gateway request can then use the Redis configuration cache without querying PostgreSQL for every request.

If cached configuration is unavailable, the application can retrieve the authoritative configuration from PostgreSQL and repopulate Redis.

### 6.2 API Lifecycle

Valid API lifecycle transitions are:

```
Registered ──────► Active
     │               │
     │               ├────► Disabled
     │               │          │
     │               │          └────► Active
     │               │
     │               └────► Deleted
     │
     └──────────────► Deleted
```

The following transition is not allowed:

```
Registered ──X──► Disabled
```

`Deleted` is a terminal lifecycle state for the API.

### 6.3 Disabled APIs

When an API becomes `Disabled`:

- Gateway traffic is stopped.
- Automatic health checks stop.
- Manual health checks are not executed.
- Existing historical health data is retained.

### 6.4 Deleted APIs

Deleted APIs remain soft-deleted in persistent storage but are treated as non-existent by gateway routing.

Gateway requests for deleted routes return `404 Not Found`.

---

## 7. Major Workflows

### 7.1 User Authentication

```
User
 │
 ▼
GitHub OAuth
 │
 ▼
GitHub Identity Validation
 │
 ▼
Find/Create/Restore User
 │
 ▼
Check User State
 │
 ├── Active ───────────────► Create Session
 │
 ├── Deleted ──────────────► Restore + Create Session
 │
 └── Admin_disabled ───────► Reject Authentication
```

### 7.2 API Registration

```
User
 │
 ▼
Create API
 │
 ▼
Validate Configuration
 │
 ▼
Check Route Conflicts
 │
 ▼
Store in PostgreSQL
 │
 ▼
Update Configuration Cache
 │
 ▼
API Available
```

### 7.3 Gateway Request

```
Client
 │
 ▼
Route Matching
 │
 ▼
Resolve API
 │
 ▼
Check API Lifecycle
 │
 ▼
Authenticate API Request
 │
 ▼
Apply Rate Limit
 │
 ▼
Build Upstream Request
 │
 ▼
Forward Request
 │
 ▼
Receive Response
 │
 ├──────────────► Request History
 │
 ├──────────────► Monitoring Metrics
 │
 ▼
Return Response
```

### 7.4 API Test

```
User / CI/CD
      │
      ▼
Authenticated Test Request
      │
      ▼
Load Test Definition
      │
      ▼
Build HTTP Request
      │
      ▼
Execute Directly Against Upstream
      │
      ▼
Receive Response
      │
      ▼
Evaluate Assertions
      │
      ▼
Generate Pass/Fail Result
      │
      ▼
Return Result
```

The complete response exists only for the duration required for test execution and assertion evaluation.

### 7.5 Health Check

```
Scheduler / User
      │
      ▼
Acquire API Check Lock
      │
      ▼
Execute Health Request
      │
      ├── Success
      │      ├── Below threshold → Healthy
      │      └── Above threshold → Degraded
      │
      └── Failure / Timeout
             │
             ▼
          Retry Once
             │
             ├── Success → Degraded
             │
             └── Failure → Down
```

---

## 8. Request Lifecycle

### 8.1 Route Resolution

GateWatch first identifies the most specific configured route.

Route prefixes are normalized during registration.

Canonical route form:

```
/api/users
/api/users/admin
/
```

All non-root route prefixes use no trailing slash.

### 8.2 Gateway Pipeline

The canonical gateway pipeline is:

```
Incoming Request
      │
      ▼
Normalize / Resolve Route
      │
      ▼
Select Longest Matching Prefix
      │
      ▼
Resolve API
      │
      ▼
Check API Lifecycle
      │
      ▼
Authenticate API Request
      │
      ▼
Apply Rate Limit
      │
      ▼
Construct Upstream URL
      │
      ▼
Prepare Proxy Headers
      │
      ▼
Forward Request
      │
      ▼
Receive Upstream Response
      │
      ├──────────────► Record Request History
      │
      ├──────────────► Update Monitoring Metrics
      │
      └──────────────► Evaluate Alert Conditions
      │
      ▼
Return Response
```

### 8.3 Route Transformation

Given:

```
Public Route: /api/users
Upstream:     https://example.com/v1
Request:      /api/users/123?active=true
```

GateWatch forwards:

```
https://example.com/v1/123?active=true
```

The public route prefix is removed while the remaining path and query parameters are preserved.

### 8.4 Upstream Base Paths

Upstream base URLs may contain paths.

Path joining is normalized to prevent duplicate or missing `/` characters.

### 8.5 HTTP Methods

The gateway supports:

- GET
- POST
- PUT
- PATCH
- DELETE
- HEAD
- OPTIONS

Configured route method restrictions are enforced before forwarding.

### 8.6 Proxy Headers

GateWatch removes HTTP hop-by-hop headers before forwarding requests.

Controlled proxy headers are used for forwarding client information, including:

```
X-Forwarded-For
```

Upstream response headers are passed through except for proxy-specific or hop-by-hop headers.

---

## 9. State Management

### 9.1 State Sources

| State | Source / Cache |
| --- | --- |
| Users | PostgreSQL |
| Projects | PostgreSQL |
| APIs | PostgreSQL |
| API configuration | PostgreSQL |
| API configuration cache | Redis |
| Tests | PostgreSQL |
| Request history | PostgreSQL |
| Audit logs | PostgreSQL |
| Sessions | PostgreSQL |
| Session cache | Redis |
| Rate-limit counters | Redis |
| Temporary execution state | Application memory |
| Operational logs | CloudWatch |

PostgreSQL remains authoritative for persistent application state.

Redis provides caching and temporary state but is not the authoritative source for persistent business data.

### 9.2 API Configuration Cache

API configuration cached in Redis is updated or invalidated after successful configuration changes.

If cached configuration is missing, PostgreSQL is used as the fallback source and the cache is repopulated.

### 9.3 Rate Limit State

Redis maintains fixed-window rate-limit counters.

Counter operations must be atomic so concurrent gateway requests cannot bypass configured limits.

---

## 10. Internal Communication

### 10.1 Module Communication

Modules communicate through direct in-process service calls.

Example:

```
Gateway Controller
       │
       ▼
Gateway Service
       │
       ├────► API Service
       │
       ├────► Route Service
       │
       ├────► Authentication Service
       │
       └────► Rate Limit Service
```

Modules do not communicate with each other through internal HTTP requests.

### 10.2 Internal Events

Simple in-process events or direct service calls are used for event-driven behavior.

Example:

```
Health Result
     │
     ▼
Monitoring
     │
     ▼
Alert Evaluation
     │
     ▼
SNS Notification
```

The MVP does not require:

- Redis Pub/Sub
- SQS
- Dedicated event infrastructure

---

## 11. Background Processes

### 11.1 Health Check Scheduler

A controlled background scheduler runs inside the backend process.

It:

- Runs every 60 seconds
- Processes eligible APIs
- Uses configurable per-user concurrency
- Allows only one active health check per API
- Skips disabled and deleted APIs

### 11.2 Health Check Concurrency

Health-check concurrency is controlled per user.

For example:

```
User A
├── API 1 ── running
├── API 2 ── running
├── API 3 ── waiting
└── API 4 ── waiting

User B
├── API 1 ── running
└── API 2 ── running
```

A manual health check uses the same per-API lock as the scheduler.

If a check is already running for an API, another check is not started concurrently.

### 11.3 Alert Evaluation

Alert evaluation is event-driven.

Relevant health-check results and gateway metrics trigger alert evaluation.

### 11.4 Alert Notification

SNS is used for configured alert notifications.

Recovery notifications are also supported.

### 11.5 Background Infrastructure

The MVP does not use:

- Dedicated worker services
- SQS
- Scheduled test workers
- Separate monitoring processes

An optional cleanup process may be introduced only if a concrete MVP requirement requires it.

---

## 12. Error Handling

### 12.1 Application Error Flow

Application errors follow a centralized pattern:

```
Controller
    │
    ▼
Service
    │
    ▼
Application / Typed Error
    │
    ▼
Central Express Error Middleware
    │
    ▼
Structured JSON Response
```

### 12.2 Structured Errors

GateWatch-generated errors use a consistent structure:

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "Upstream API request timed out."
  }
}
```

### 12.3 Gateway Errors

GateWatch-generated gateway errors use the same structured format.

Successful upstream responses are passed through without replacing the upstream response body.

### 12.4 Unexpected Errors

Unexpected internal errors shall:

- Return a generic error response to the client.
- Be logged internally.
- Avoid exposing stack traces in production.

### 12.5 Observability Failure

If request-history persistence fails after a successful upstream request, GateWatch shall return the upstream response.

Failure of observability storage shall not normally interrupt API traffic.

---

## 13. Concurrency Considerations

### 13.1 Rate Limiting

Redis operations used for rate limiting shall be atomic.

This ensures concurrent requests cannot increment or evaluate counters inconsistently.

### 13.2 API Configuration Updates

API configuration uses optimistic locking with versioning.

A stale update shall not silently overwrite a newer configuration version.

### 13.3 Health Checks

Each API has a per-API health-check lock.

The lock is shared between:

- Scheduled checks
- Manual checks

Only one health check for an API may run at a time.

### 13.4 Alert State

Alert state is persisted so concurrent or repeated events do not generate duplicate notifications for the same active condition.

### 13.5 Request Processing

Gateway requests are independently processed and may execute concurrently.

Shared state such as rate-limit counters and configuration updates must use atomic or version-aware operations where required.

---

## 14. Resource Management

### 14.1 HTTP Connections

The gateway uses reusable HTTP client connections where supported rather than creating a completely new connection for every request.

### 14.2 Request Body Limit

Incoming gateway request bodies have a maximum size of:

```
10 MB
```

The limit is configurable.

Requests exceeding the configured limit are rejected before excessive memory consumption occurs.

### 14.3 Upstream Response Limit

Upstream responses have a maximum size of:

```
10 MB
```

The limit is enforced while streaming the response.

This prevents large upstream responses from being fully loaded into memory without bounds.

### 14.4 Gateway Request Timeout

Normal gateway requests use:

```
Default timeout: 30 seconds
Maximum timeout: 60 seconds
```

The configured timeout applies to upstream request execution.

### 14.5 Health Check Timeout

Health checks use:

```
Timeout: 5 seconds
Retries: 1
```

### 14.6 Test Timeout

API tests use:

```
Default timeout: 5 seconds
Maximum timeout: 30 seconds
```

### 14.7 API Count

GateWatch does not impose an application-level maximum number of registered APIs per user or project in the MVP.

Infrastructure capacity remains the practical limit.

---

## 15. Edge Cases

### 15.1 Route Normalization

Route prefixes are normalized during registration.

Canonical forms do not contain a trailing slash except for the root route:

```
/api/users
/api/users/admin
/
```

Equivalent route definitions are rejected.

### 15.2 Root Route

`/` is a valid gateway route prefix.

It can forward requests to the configured upstream base URL without removing additional path content.

### 15.3 Longest Prefix Match

When multiple routes match a request, the route with the longest matching prefix is selected.

Example:

```
/api
/api/users
/api/users/admin
```

A request to:

```
/api/users/admin/123
```

matches:

```
/api/users/admin
```

### 15.4 Query Parameters

Query parameters are preserved unchanged during gateway forwarding.

Example:

```
/api/users?page=2&sort=name
```

becomes:

```
/users?page=2&sort=name
```

after prefix removal.

### 15.5 Upstream Base Path

Upstream URLs may contain a base path.

Example:

```
Public route: /users
Upstream:     https://example.com/api/v1
Request:      /users/123
```

Result:

```
https://example.com/api/v1/123
```

Path joining is normalized.

### 15.6 Disabled API

Requests to a disabled API return:

```
503 Service Unavailable
```

The API does not receive gateway traffic or automatic health checks while disabled.

Historical monitoring data remains available.

### 15.7 Deleted API

Requests targeting a soft-deleted API are treated as unmatched resources and return:

```
404 Not Found
```

### 15.8 Upstream Unavailable

If the upstream API cannot be reached, GateWatch returns an appropriate `502 Bad Gateway` response.

### 15.9 Upstream Timeout

If the upstream request exceeds its configured timeout, GateWatch returns:

```
504 Gateway Timeout
```

### 15.10 Health Check Retry

Health checks retry once for:

- Network failures
- Connection failures
- Timeouts
- HTTP `5xx` responses

Normal `4xx` responses are not retried.

### 15.11 Health Classification

Initial response-time threshold:

```
1000 ms
```

The threshold is configurable because acceptable response time may differ between APIs.

Health classification follows:

```
Successful + <= threshold
        → Healthy

Successful + > threshold
        → Degraded

Failed/timeout
        ↓
      Retry
        ↓
Successful
        → Degraded

Failed/timeout
        ↓
      Retry
        ↓
Failed/timeout
        → Down
```

Expected successful responses use `2xx` by default, with support for an optionally configured expected status where required.

### 15.12 Alert Deduplication

Alert state is maintained to prevent repeated notifications for the same active condition.

Example:

```
Healthy
   ↓
Down
   ↓
Alert
   ↓
Still Down
   ↓
No duplicate alert
   ↓
Healthy
   ↓
Recovery notification
```

### 15.13 No Request History Persistence

If request-history persistence fails but the upstream request succeeds, the client still receives the upstream response.

The persistence failure is recorded through operational logging.

### 15.14 No Redis Configuration Cache

If cached API configuration is unavailable:

```
Redis
  ↓
Cache Miss
  ↓
PostgreSQL
  ↓
Load Configuration
  ↓
Repopulate Redis
```

PostgreSQL remains the source of truth.

---

## 16. AWS Deployment Architecture

### 16.1 MVP Deployment

The deployed GateWatch architecture is:

```
                                Internet
                                    │
                                    ▼
                               CloudFront
                              /          \
                             /            \
                    Static Assets       API Requests
                          │                  │
                          ▼                  ▼
                         S3                 EC2
                                             │
                                ┌────────────┼────────────┐
                                │            │            │
                                ▼            ▼            ▼
                           GateWatch      Redis       Demo APIs
                            Backend
                                │
                                ├──────────────► CloudWatch
                                │
                                ├──────────────► SNS
                                │
                                ▼
                           RDS PostgreSQL
```

### 16.2 Frontend

The React/Vite frontend is built into static assets and hosted using:

- Amazon S3
- Amazon CloudFront

CloudFront serves the frontend to users.

### 16.3 Backend

The GateWatch backend runs inside Docker on an AWS EC2 instance.

The same EC2 environment also hosts:

- Redis
- Demo APIs

The GateWatch backend and Redis communicate over the internal Docker/network environment.

### 16.4 Database

PostgreSQL runs on Amazon RDS.

RDS is private and accessible only from the application infrastructure through the configured network and security controls.

### 16.5 Operational Services

GateWatch integrates with:

- **CloudWatch** for operational logging and monitoring.
- **SNS** for alert notification delivery.

### 16.6 Redis

Redis runs as a Docker container on the same EC2 instance as GateWatch for the MVP.

Redis provides:

- Session caching
- API configuration caching
- Rate-limit counters

### 16.7 Demo APIs

Demo APIs run alongside GateWatch on EC2 and provide controlled targets for demonstrating:

- Gateway routing
- API authentication
- Rate limiting
- Health monitoring
- API testing
- Alerting

### 16.8 Deferred Infrastructure

The MVP does not require:

- Kubernetes
- ECS/Fargate
- SQS
- Managed Redis
- Multi-node gateway deployment
- Multi-region deployment
- Dedicated worker infrastructure