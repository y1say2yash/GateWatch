# GateWatch — API Design

## 1. API Overview

GateWatch exposes REST-style JSON APIs for platform management and gateway-related operations.

The API supports:

- GitHub OAuth authentication
- User and session management
- Project management
- API registration and configuration
- Gateway route management
- API key management
- Rate-limit configuration
- Health monitoring
- API testing
- Request history
- Alert management
- Administrative operations
- CI/CD-triggered test execution

Gateway traffic and management APIs are logically separate while being implemented inside the same modular monolith.

---

## 2. API Architecture

The backend uses Node.js and Express.

Logical API areas include:

```
Client
  │
  ├── Management API
  │      └── /api/v1/...
  │
  └── Gateway
         └── /p/{project-slug}/{path}
```

### Management API

Used for:

- Authentication
- Resource management
- Configuration
- Testing
- Monitoring
- Administration

### Gateway

Used to:

1. Identify the project and configured route
2. Resolve the API
3. Check API lifecycle
4. Authenticate the request
5. Apply rate limiting
6. Build the upstream request
7. Forward the request
8. Receive the upstream response
9. Record request history
10. Evaluate monitoring
11. Return the response

---

## 3. Base URL

Management APIs use:

```
/api/v1
```

Examples:

```
http://localhost:<port>/api/v1
https://<gatewatch-domain>/api/v1
```

The production domain is environment-dependent.

Gateway requests use the project namespace:

```
https://<gatewatch-domain>/p/{project-slug}/{path}
```

Example:

```
https://gatewatch.example/p/demo/users
```

---

## 4. Authentication

GateWatch uses separate authentication mechanisms for different purposes.

### 4.1 Browser Authentication

Browser users authenticate through GitHub OAuth.

Successful authentication creates a server-side session.

The browser receives a secure HTTP-only cookie.

Session lookup:

```
Cookie
  ↓
Redis session cache
  ↓ cache miss
PostgreSQL session store
```

PostgreSQL remains authoritative.

### 4.2 CI/CD Authentication

CI/CD systems use a GateWatch access token.

Example:

```
Authorization: Bearer <access-token>
```

The token identifies the GateWatch user but does not automatically grant unrestricted access to all resources owned by that user.

Normal authentication, ownership, and authorization checks still apply.

### 4.3 Registered API Authentication

Protected upstream APIs use GateWatch-managed API keys:

```
X-API-Key: <api-key>
```

GateWatch validates the key before forwarding the request.

The GateWatch API key is removed before the upstream request is sent.

GateWatch API keys are intended for trusted server-side clients. They must not be embedded in public frontend code or exposed to end users.

### 4.4 Authentication Separation

These credentials serve different purposes:

| Credential | Purpose |
| --- | --- |
| GitHub OAuth/session | GateWatch browser user authentication |
| GateWatch access token | CI/CD/programmatic GateWatch authentication |
| GateWatch API key | Client authentication for registered upstream APIs |

---

## 5. Request Conventions

### Content Type

JSON management requests use:

```
Content-Type: application/json
```

unless the endpoint explicitly requires another format.

### JSON Naming

API responses and request bodies use `camelCase`.

Example:

```json
{
  "projectId": "uuid",
  "projectName": "Demo",
  "createdAt": "2026-09-30T17:45:00Z"
}
```

Database columns use `snake_case`.

### Resource IDs

Resource IDs are UUIDs.

### Authentication

Protected endpoints require the appropriate session or access token.

### Request IDs

Gateway requests have a request identifier used for tracing and request-history correlation.

### HTTP Methods

Standard HTTP semantics are used:

```
GET
POST
PATCH
DELETE
```

---

## 6. Response Conventions

Successful responses use a consistent `data` wrapper.

### Single Resource

```json
{
  "data": {
    "projectId": "uuid",
    "projectName": "Demo"
  }
}
```

### Collection

```json
{
  "data": [
    {
      "projectId": "uuid",
      "projectName": "Demo"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Creation

Successful resource creation returns:

```
201 Created
```

with the created resource.

### Update

Successful updates return:

```
200 OK
```

with the updated resource.

### Deletion

Successful deletion/revocation returns:

```
204 No Content
```

Deletion is logical for soft-deletable resources.

---

## 7. Error Response Format

GateWatch-generated management errors use:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "API not found."
  }
}
```

Validation errors may include `details`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {
      "name": "Name is required."
    }
  }
}
```

Unexpected internal errors return a generic error response.

Detailed internal information is logged server-side and production stack traces are not exposed.

### Gateway Errors

GateWatch-generated gateway errors use the same structured error model.

Successful upstream response bodies are passed through unchanged.

If the upstream API itself returns an error such as `404`, GateWatch normally passes that upstream response through rather than converting it into a GateWatch resource error.

---

## 8. HTTP Status Codes

| Status | Usage |
| --- | --- |
| `200 OK` | Successful read, update, or action |
| `201 Created` | Successful creation |
| `204 No Content` | Successful deletion/revocation |
| `400 Bad Request` | Malformed or invalid request |
| `401 Unauthorized` | Missing or invalid authentication |
| `403 Forbidden` | Authenticated but not authorized |
| `404 Not Found` | Resource or gateway route not found |
| `409 Conflict` | Duplicate or conflicting resource |
| `422 Unprocessable Entity` | Semantically invalid request where distinction is required |
| `429 Too Many Requests` | Rate limit exceeded |
| `500 Internal Server Error` | Unexpected GateWatch error |
| `502 Bad Gateway` | Upstream failure |
| `503 Service Unavailable` | Disabled/unavailable registered API |
| `504 Gateway Timeout` | Upstream timeout |

---

## 9. Authentication Endpoints

### Start GitHub OAuth

```
GET /api/v1/auth/github
```

### OAuth Callback

```
GET /api/v1/auth/github/callback
```

### Logout

```
POST /api/v1/auth/logout
```

### Current Session

```
GET /api/v1/auth/me
```

---

## 10. User Endpoints

### Get Current User

```
GET /api/v1/users/me
```

### Update Current User

```
PATCH /api/v1/users/me
```

### Delete Current User

```
DELETE /api/v1/users/me
```

Deletion is implemented as soft deletion.

### Create Access Token

```
POST /api/v1/users/me/access-tokens
```

Requires a GateWatch session. The JSON body accepts a required `name` (1–100
characters) and optional `expiresAt` (a future ISO 8601 timestamp; omit or set
to `null` for no expiration). The complete bearer token is returned only in the
creation response; subsequent list responses expose metadata only.

### List Access Tokens

```
GET /api/v1/users/me/access-tokens
```

Requires a GateWatch session and lists only the current user's access tokens.

### Revoke Access Token

```
DELETE /api/v1/access-tokens/:accessTokenId
```

Requires a GateWatch session. Revoked tokens can no longer authenticate.

---

## 11. Core Feature Endpoints

### 11.1 Projects

```
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
```

### 11.2 APIs

```
GET    /api/v1/projects/:projectId/apis
POST   /api/v1/projects/:projectId/apis
GET    /api/v1/apis/:apiId
PATCH  /api/v1/apis/:apiId
DELETE /api/v1/apis/:apiId
```

### API Lifecycle

```
POST /api/v1/apis/:apiId/enable
POST /api/v1/apis/:apiId/disable
```

`DELETE` performs API soft deletion.

Invalid lifecycle transitions are rejected.

### 11.3 API Routes

```
GET    /api/v1/apis/:apiId/routes
POST   /api/v1/apis/:apiId/routes
PATCH  /api/v1/routes/:routeId
DELETE /api/v1/routes/:routeId
```

Routes are registered for explicit HTTP methods.

### 11.4 API Keys

```
GET    /api/v1/apis/:apiId/keys
POST   /api/v1/apis/:apiId/keys
DELETE /api/v1/keys/:keyId
```

`DELETE` revokes the key.

### 11.5 Rate Limit

```
GET   /api/v1/apis/:apiId/rate-limit
PATCH /api/v1/apis/:apiId/rate-limit
```

### 11.6 Health Configuration

```
GET   /api/v1/apis/:apiId/health
PATCH /api/v1/apis/:apiId/health
```

These endpoints require an authenticated user and are scoped to APIs owned by
that user. Configuration fields are `enabled`, `path`, `intervalSeconds`,
`timeoutMs`, `expectedStatusMin`, `expectedStatusMax`, and
`latencyThresholdMs`. PATCH accepts any non-empty subset and rejects unknown
fields. Defaults for new APIs are enabled checks at `/`, every 60 seconds,
with a 5-second timeout, expected HTTP status 200-299, and a 1,000 ms latency
threshold. The configured interval is validated from 1 to 86,400 seconds and
is honored per API, including intervals shorter than 60 seconds. The scheduler
waits until the next API is due rather than polling on a fixed 60-second tick.
Attempt timeouts are capped at 5 seconds.

### Current Health

```
GET /api/v1/apis/:apiId/health/status
```

Returns the current `healthStatus`, `lastHealthCheckAt`, and latest summarized
check, if available.

### Manual Health Check

```
POST /api/v1/apis/:apiId/health/check
```

Runs the same retry, timeout, classification, and persistence flow as the
scheduler. A check already running for that API returns `409`.

### Health History

```
GET /api/v1/apis/:apiId/health/history
```

Accepts an optional `limit` from 1 to 100 (default 20) and returns checks
newest first, including result status, response time, HTTP status, attempt
count, safe error message, `isManual`, and timestamp. Response bodies are
never included.

The MVP classifies a check as `HEALTHY` when its final HTTP status falls in the
configured expected range and total check latency is at or below the configured
threshold. A successful retry or a slower expected response is `DEGRADED`;
failure to obtain an expected response after one retry is `DOWN`.

### 11.7 Tests

```
GET    /api/v1/apis/:apiId/tests
POST   /api/v1/apis/:apiId/tests
GET    /api/v1/tests/:testId
PATCH  /api/v1/tests/:testId
DELETE /api/v1/tests/:testId
```

These endpoints require a GateWatch session and enforce ownership through
test → API → project → user. Admin role does not grant ownership. Tests use
soft deletion.

M23 provides these backend endpoints only; the user-facing interface is
deferred until the frontend foundation is established.

Create and PATCH bodies accept `name`, `method`, absolute `url`, `headers`
(string-valued JSON object), `body` (JSON), `authentication`, `assertions`,
and `timeoutMs`. Supported methods: GET, POST, PUT, PATCH, DELETE, HEAD, and
OPTIONS. Timeout defaults to 5,000 ms and must be 1–30,000 ms. Headers are
limited to 50 entries with values up to 8,192 characters; request bodies are
limited to 64 KB and cannot contain credential-like fields. Configure
credentials using the dedicated authentication field.

Authentication formats:

```json
{"type":"NONE"}
{"type":"BASIC","username":"…","password":"…"}
{"type":"BEARER","token":"…"}
{"type":"API_KEY","name":"X-API-Key","value":"…"}
```

Credentials are encrypted at rest. Read responses include only `type`, safe
username/header metadata, and `credentialConfigured`; they never include
credential values. When updating a configured credential, omit its value to
retain it, or provide a replacement.

Assertions are a JSON array of at most 50 objects:

```json
[
  {"type":"STATUS_CODE","operator":"EQUALS","expected":200},
  {"type":"JSON_BODY","path":"/status","operator":"EQUALS","expected":"ok"},
  {"type":"RESPONSE_HEADER","name":"content-type","operator":"CONTAINS","expected":"application/json"},
  {"type":"RESPONSE_TIME","operator":"LESS_THAN_OR_EQUAL","expected":1000}
]
```

JSON-body `path` uses JSON Pointer syntax (the empty string means the root).
Body operators are `EQUALS`, `NOT_EQUALS`, `CONTAINS`, and `EXISTS`.
`EQUALS` and `NOT_EQUALS` accept JSON values; `CONTAINS` accepts a string
(substring for string results, exact member for array results); `EXISTS`
does not accept an expected value. Expected values and paths must not contain
reusable credentials; credential-like body paths and response-header names
are rejected. Response-header operators are `EQUALS`,
`CONTAINS`, and `EXISTS`; expected values are strings up to 8,192 characters.
Status code supports integer `EQUALS` values from 100–599; response time
supports integer `LESS_THAN_OR_EQUAL` values from 0–30,000 ms. Executions
reuse the saved definition and return safe assertion summaries; upstream
response bodies and credentials are not persisted.

Targets must be HTTP(S), contain no URL credentials or fragment, and match
the associated API's upstream origin. Loopback, private, link-local, and
metadata destinations and known local/container hostnames are rejected,
except origins explicitly listed in `TEST_LOCAL_ALLOWED_ORIGINS` in
non-production environments. DNS resolution is validated at execution time,
redirects are disabled, and response bodies are size-limited.

Create returns `201`, reads and updates return `200`, and soft-delete returns
`204`. Invalid definitions return structured `400` errors, missing or
unowned resources return `404`, missing sessions return `401`, and missing
credential-encryption configuration returns `503`.

### Execute Test

```
POST /api/v1/tests/:testId/execute
```

The same execution endpoint supports both browser and CI/CD callers.

Browser:

```
POST /api/v1/tests/:testId/execute
Cookie: <session>
```

CI/CD:

```
POST /api/v1/tests/:testId/execute
Authorization: Bearer <access-token>
```

Use a GateWatch access token created through the endpoints above. The token
authenticates as its owner and does not grant access to tests owned by other
users. Session-authenticated executions are stored with `triggerType:
"MANUAL"`; access-token executions are stored with `triggerType: "CI_CD"`.
Both return `200` with the standard `data` wrapper containing `executionId`,
`status` (`PASSED`, `FAILED`, or `ERROR`), `passed`, `durationMs`, and safe
`result` assertion summaries. Missing, invalid, revoked, expired, or
inactive-owner credentials return `401`; tests not owned by the token's user
return `404`.

Executions are not idempotent: a repeated request starts a new upstream test.
If audit logging fails after the execution is persisted, GateWatch logs the
audit failure and returns the completed execution result rather than inviting
an automatic retry with a failure response. A client that loses the HTTP
response cannot assume the execution did not occur.

### Test Executions

```
GET /api/v1/tests/:testId/executions
GET /api/v1/test-executions/:executionId
```

### 11.8 Request History

```
GET /api/v1/apis/:apiId/requests
GET /api/v1/request-history/:requestId
```

Request-history collection queries support `page` (default `1`), `limit`
(default `20`, maximum `100`), `statusCode`, `method`, `from`, `to`, and
`sort=timestamp&order=asc|desc` (default `timestamp` descending). `from` and
`to` are inclusive timestamps; `from` must not be later than `to`. Unsupported
query parameters and sort fields are rejected. A successful response uses the
standard paginated envelope and each item includes `requestId`, `apiId`,
`routeId`, `method`, `path`, `statusCode`, `latencyMs`, `clientIdentity`,
`timestamp`, and safe `result` metadata. The path excludes the query string.
Credential-style and likely opaque token path segments are redacted.
`latencyMs`, `clientIdentity`, and `routeId` may be `null` for legacy entries
or when the value is unavailable.
An owned API with no matching history returns an empty page. Both endpoints
return not found for missing or unowned resources.

### Monitoring Summary

```
GET /api/v1/apis/:apiId/monitoring/summary?from=<timestamp>&to=<timestamp>
```

The optional inclusive `from` and `to` parameters accept valid timestamps;
`from` must not be later than `to`. The response is wrapped in `data` and
contains `apiId`, `period`, `totalRequests`, `statusCodeCounts`,
`averageLatencyMs`, `errorCount`, and `errorRate`. Errors are status codes
greater than or equal to 400; `errorRate` is `errorCount / totalRequests`, or
zero when no requests match. `averageLatencyMs` is `null` when the range has no
recorded latency.

### Monitoring Time Series

```
GET /api/v1/apis/:apiId/monitoring/timeseries?from=<timestamp>&to=<timestamp>
```

Both inclusive timestamps are required and `from` must not be later than `to`.
The maximum range is 90 days. Ranges up to 48 hours use UTC-aligned hourly
buckets; longer ranges use UTC-aligned daily buckets. The response is wrapped
in `data` and contains `apiId`, `period`, `bucketSize`, and an ascending
`buckets` array. Each bucket includes `bucketStart`, `requestCount`, status
counts for 1xx, 2xx, 3xx, 4xx, 5xx and out-of-range status codes, plus the
count and average latency of records with a recorded response time. Empty
time buckets are returned with zero request and status counts and a `null`
average latency.

The endpoint aggregates persisted request-history records using PostgreSQL
time buckets and the existing `(api_id, created_at)` index. It uses the same
authenticated session and owned-API checks as the summary endpoint. Request
and response bodies, client identity, credentials, and upstream configuration
are not returned. It is not a gateway-wide or infrastructure metric. Health
history continues to use `GET /api/v1/apis/:apiId/health/history`.

### 11.9 Alerts

```
GET    /api/v1/apis/:apiId/alerts
POST   /api/v1/apis/:apiId/alerts
GET    /api/v1/alerts/:alertId
PATCH  /api/v1/alerts/:alertId
POST   /api/v1/alerts/:alertId/enable
POST   /api/v1/alerts/:alertId/disable
DELETE /api/v1/alerts/:alertId
GET    /api/v1/alerts/:alertId/evaluate
POST   /api/v1/alerts/:alertId/evaluate
GET    /api/v1/alerts/:alertId/events
```

All alert management endpoints require an authenticated user who owns the API
through its project. Foreign and deleted resources are returned as not found.
`DELETE` soft-deletes the alert configuration. List responses use the standard
`data` wrapper and return active (not soft-deleted) configurations.

Create requests require `name`, `type`, and `configuration`. Updates accept
any non-empty subset of `name`, `type`, and `configuration`; if `type` or
`configuration` changes, the complete resulting configuration is validated.
The supported configurations are:

| Type | Configuration |
| --- | --- |
| `API_DOWN` | `{}`; no additional fields |
| `UNHEALTHY_DURATION` | `durationSeconds`: integer from 1 to 604800 |
| `ERROR_RATE` | `threshold`: number greater than 0 and at most 1; `windowSeconds`: integer from 60 to 86400 |
| `LATENCY` | `thresholdMs`: integer from 1 to 60000; `windowSeconds`: integer from 60 to 86400 |

`ERROR_RATE.threshold` uses the same 0–1 ratio as the monitoring summary
(for example, `0.05` represents 5%). Latency is measured in milliseconds,
and durations/windows are measured in seconds. These are M26 configuration
units and bounds.

Alert `status` describes configuration lifecycle and remains separate from
`runtimeState`, which is either `INACTIVE` or `TRIGGERED`. Newly created
alerts start `INACTIVE`. Evaluation changes runtime state only when an
enabled alert's condition changes: becoming active emits one `TRIGGERED`
event and sets `triggeredAt`; becoming inactive after a trigger emits one
`RECOVERED` event and sets `recoveredAt`. Repeated evaluations in the same
condition do not add events. Evaluation of a disabled alert does not change
runtime state or event history. If disabled while triggered, the alert stays
triggered until it is re-enabled and an evaluation reconciles its condition.
State updates and event inserts are atomic and concurrent evaluations are
serialized for that alert.

`GET /api/v1/alerts/:alertId/evaluate` remains a read-only condition preview
and returns the existing `{ data: evaluation }` response. `POST` on the same
path evaluates and persists any transition. Its `data` contains the
evaluation fields plus `runtimeState` and `transitioned`.

### Alert Events

```
GET /api/v1/alerts/:alertId/events?page=1&limit=20
```

This authenticated endpoint is restricted to the alert owner; foreign,
deleted, or missing alerts return `404`. Events are ordered newest first by
`occurredAt`, then event ID descending. `page` defaults to `1`; `limit`
defaults to `20` and is bounded from `1` to `100`. Unsupported, repeated, or
invalid query parameters return a structured `400` error. The response
contains safe event fields (`id`, `alertId`, `eventType`, `message`,
`metadata`, and `occurredAt`) in `data`, plus `pagination` with `page`,
`limit`, `total`, and `totalPages`. Empty history returns `200` with an empty
`data` array. `occurredAt` is the transition time; `triggeredAt` is populated
for trigger events and `resolvedAt` for recovery events in storage.

---

## 12. Administrative Endpoints

### Users

```
GET   /api/v1/admin/users
PATCH /api/v1/admin/users/:userId
```

These operations allow Admins to:

- View users
- View basic user information
- Enable/disable users
- Manage Admin role assignment

### Platform Resources

```
GET /api/v1/admin/resources
```

### Platform Health

```
GET /api/v1/admin/health
```

### Audit Logs

```
GET /api/v1/admin/audit-logs
```

Audit-log viewing is Admin-only in the MVP.

The endpoint supports `page` (default `1`), `limit` (default `20`, maximum
`100`), and inclusive `from` and `to` timestamps. Invalid timestamps, reversed
ranges, repeated/non-string values, and unsupported query parameters return
`400` with the standard structured error envelope. Records are ordered newest
first by `created_at`, then by `id` descending for stable ordering.

The paginated response contains audit records with `id`, `userId`,
`actorRole`, `action`, `resourceType`, `resourceId`, `details`, `ipAddress`,
and `createdAt`, plus the standard `pagination` object. `details` includes
only safe scalar metadata; sensitive-key entries and nested values are
excluded.

Admins do not automatically become owners of another user's resources.

---

## 13. Request Validation

All management API requests are validated before business logic execution.

Validation includes:

- Required fields
- Data types
- String lengths
- Enum values
- UUID formats
- URL format
- HTTP methods
- Numeric ranges
- Configuration limits
- Resource-specific business rules

Examples:

- `baseUrl` must be a valid URL.
- `maxRequests` must be positive.
- `windowSeconds` must be positive.
- Test timeout cannot exceed 30 seconds.
- Gateway request body size cannot exceed the configured maximum.
- Duplicate route definitions are rejected.
- Invalid API lifecycle transitions are rejected.

Validation failures return:

```
400 Bad Request
```

with structured field-level details where applicable.

---

## 14. Pagination

Paginated endpoints use:

```
?page=1&limit=20
```

Defaults:

```
page = 1
limit = 20
```

Maximum:

```
limit = 100
```

Response:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 125,
    "totalPages": 7
  }
}
```

Pagination applies primarily to history, execution, audit, project, API, and other collection endpoints where result size can grow.

---

## 15. Filtering

Resource-specific filters are supported where useful.

### Request History

```
?statusCode=500
?method=GET
```

### Health History

```
?status=DOWN
```

### Date Range

Supported history endpoints may use:

```
?from=<timestamp>&to=<timestamp>
```

This applies to resources such as:

- Request history
- Health history
- Test executions
- Alert events
- Audit logs

GateWatch does not use a generic filtering query language in the MVP.

---

## 16. Sorting

List endpoints may support:

```
?sort=createdAt&order=desc
```

Only explicitly supported fields are sortable.

Example:

```
GET /api/v1/apis/:apiId/requests?sort=timestamp&order=desc
```

Supported sorting fields are defined per endpoint rather than accepting arbitrary database columns.

---

## 17. Rate Limiting

### Gateway Rate Limiting

Gateway rate limiting is applied independently per client and per registered API.

The applicable identity is:

1. API key for authenticated API requests
2. Client IP for unauthenticated requests where applicable

Redis stores the active fixed-window counters.

### Management API Rate Limiting

The GateWatch management API also has a separate basic rate limit.

This is independent of registered API gateway rate limiting and is implementation/configuration controlled.

A rate-limit violation returns:

```
429 Too Many Requests
```

---

## 18. API Versioning

GateWatch uses URL-based API versioning:

```
/api/v1/...
```

`v1` is treated as a stable API contract.

Breaking changes require a new version such as:

```
/api/v2/...
```

Non-breaking additions may be introduced within the existing version.

---

## 19. Example Requests

### Create Project

```
POST /api/v1/projects
Content-Type: application/json
Cookie: <session>

{
  "projectName": "Demo APIs",
  "projectSlug": "demo-apis",
  "description": "Demo API collection"
}
```

### Register API

```
POST /api/v1/projects/{projectId}/apis
Content-Type: application/json
Cookie: <session>

{
  "name": "Users API",
  "description": "Demo users API",
  "baseUrl": "https://example.com/api"
}
```

### Create API Key

```
POST /api/v1/apis/{apiId}/keys
Content-Type: application/json
Cookie: <session>

{
  "name": "Backend Client"
}
```

### Create Test

```
POST /api/v1/apis/{apiId}/tests
Content-Type: application/json
Cookie: <session>

{
  "name": "Users Health Test",
  "method": "GET",
  "url": "https://example.com/api/users",
  "headers": {},
  "authentication": {},
  "assertions": {
    "statusCode": 200
  },
  "timeoutMs": 5000
}
```

### Execute Test from CI/CD

```
POST /api/v1/tests/{testId}/execute
Authorization: Bearer <access-token>
```

### Gateway Request

```
GET /p/demo-apis/users
X-API-Key: <api-key>
```

GateWatch resolves:

```
project → route → API → authentication → rate limit → upstream
```

---

## 20. Example Responses

### Successful Resource

```json
{
  "data": {
    "projectId": "550e8400-e29b-41d4-a716-446655440000",
    "projectName": "Demo APIs",
    "projectSlug": "demo-apis"
  }
}
```

### Paginated Response

```json
{
  "data": [
    {
      "requestId": "550e8400-e29b-41d4-a716-446655440000",
      "method": "GET",
      "statusCode": 200,
      "latencyMs": 142
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Validation Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {
      "baseUrl": "Must be a valid URL."
    }
  }
}
```

### Resource Not Found

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "API not found."
  }
}
```

### Rate Limit Error

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Request rate limit exceeded."
  }
}
```

### Gateway Upstream Failure

```json
{
  "error": {
    "code": "UPSTREAM_UNAVAILABLE",
    "message": "The upstream API could not be reached."
  }
}
```

### Gateway Upstream Timeout

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "The upstream API request timed out."
  }
}
```

### Successful Upstream Response

When an upstream request succeeds, GateWatch returns the upstream response according to the gateway forwarding rules. The upstream response body is not wrapped in the management API's `data` structure.