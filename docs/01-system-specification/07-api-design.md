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

### List Access Tokens

```
GET /api/v1/users/me/access-tokens
```

### Revoke Access Token

```
DELETE /api/v1/access-tokens/:accessTokenId
```

The complete token is shown only when it is created.

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

### Current Health

```
GET /api/v1/apis/:apiId/health/status
```

### Manual Health Check

```
POST /api/v1/apis/:apiId/health/check
```

### Health History

```
GET /api/v1/apis/:apiId/health/history
```

### 11.7 Tests

```
GET    /api/v1/apis/:apiId/tests
POST   /api/v1/apis/:apiId/tests
GET    /api/v1/tests/:testId
PATCH  /api/v1/tests/:testId
DELETE /api/v1/tests/:testId
```

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

### 11.9 Alerts

```
GET    /api/v1/apis/:apiId/alerts
POST   /api/v1/apis/:apiId/alerts
GET    /api/v1/alerts/:alertId
PATCH  /api/v1/alerts/:alertId
DELETE /api/v1/alerts/:alertId
```

`DELETE` soft-deletes the alert configuration.

### Alert Events

```
GET /api/v1/alerts/:alertId/events
```

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