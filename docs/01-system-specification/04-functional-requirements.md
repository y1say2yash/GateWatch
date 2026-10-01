# GateWatch — Functional Requirements

## 1. Requirements Overview

GateWatch is an API Gateway and Monitoring Platform that allows users to register, configure, protect, test, monitor, and observe APIs through a centralized platform.

This document defines the functional behavior required for the GateWatch MVP.

### Actors

| Actor | Description |
| --- | --- |
| User | Developer/operator who manages their own projects, APIs, gateway configuration, tests, monitoring, and alerts. |
| Admin | Platform administrator responsible for user and platform-level administration. |
| CI/CD System | External system such as GitHub Actions that can trigger authenticated API tests. |
| Upstream API | External API registered in GateWatch and accessed through the gateway. |

### MVP Principles

- Users manage only resources they own.
- Collaboration and resource sharing are out of scope for the MVP.
- Projects are organizational groupings and are not required to represent applications.
- APIs registered in the same project are independently configured.
- API authentication and GateWatch user authentication are separate concerns.
- Gateway request history is stored separately from administrative audit logs.
- Full request/response bodies are not persisted by default.
- Scheduled API testing is out of scope for the MVP.

---

## 2. User Requirements

### FR-USER-001 — User Resource Access

Users shall be able to access and manage only projects, APIs, tests, monitoring configurations, alerts, and other resources they own.

### FR-USER-002 — Project Management

Users shall be able to create and manage multiple projects.

### FR-USER-003 — API Management

Users shall be able to register, configure, enable, disable, and delete APIs within their projects.

### FR-USER-004 — Gateway Access

Users shall be able to access registered APIs through their configured GateWatch gateway routes.

### FR-USER-005 — Testing

Users shall be able to create and execute HTTP API tests and view their execution results.

### FR-USER-006 — Monitoring

Users shall be able to view API health, request history, and configured monitoring information for their APIs.

### FR-USER-007 — Alerts

Users shall be able to configure and manage alerts for their APIs.

### FR-USER-008 — Account Management

Users shall be able to manage their GateWatch account and session.

---

## 3. Authentication Requirements

### 3.1 GateWatch User Authentication

### FR-AUTH-001 — GitHub OAuth

GateWatch shall authenticate users using GitHub OAuth.

### FR-AUTH-002 — OAuth Callback Configuration

GateWatch shall support environment-specific OAuth callback configuration so that local development and deployed environments can use different callback URLs.

### FR-AUTH-003 — User Session

GateWatch shall establish an authenticated session after successful GitHub authentication.

### FR-AUTH-004 — Authentication Protection

Protected GateWatch management operations shall require an authenticated user session.

### 3.2 API Authentication

### FR-AUTH-005 — API Key Authentication

GateWatch shall support API key authentication for protected registered APIs.

### FR-AUTH-006 — API Key Validation

GateWatch shall validate an API key before forwarding an authenticated request to the configured upstream API.

### FR-AUTH-007 — API Key Lifecycle

Users shall be able to create, associate, and revoke API keys for APIs they own.

### FR-AUTH-008 — Future Authentication Methods

JWT and OAuth-based authentication for registered APIs are deferred from the MVP.

---

## 4. User Management Requirements

### FR-USER-MGMT-001 — User Accounts

GateWatch shall maintain an account for each authenticated GateWatch user.

### FR-USER-MGMT-002 — User Roles

GateWatch shall support the following roles:

- User
- Admin

### FR-USER-MGMT-003 — User Ownership

Resources created by a user shall be associated with that user as their owner.

### FR-USER-MGMT-004 — User Lifecycle

User accounts shall support enable/disable lifecycle management.

### FR-USER-MGMT-005 — Soft Deletion

Supported user deletion shall use soft deletion rather than permanent deletion.

### FR-USER-MGMT-006 — Collaboration

Resource collaboration, invitations, shared ownership, and team-based permissions are out of scope for the MVP.

---

## 5. Core Feature Requirements

### 5.1 API Registration

### FR-API-001 — Register API

Users shall be able to register an API by providing its required configuration.

An API registration shall support:

- API name
- Description
- Base upstream URL
- Public route prefix
- HTTP method restrictions where applicable
- Authentication configuration
- Rate-limit configuration
- Health-check configuration

### FR-API-002 — Upstream Configuration

Each registered API shall have one configured base upstream URL.

### FR-API-003 — API Lifecycle

An API shall support the following lifecycle states:

- Registered
- Active
- Disabled
- Deleted

API lifecycle state shall be independent of API health state.

### FR-API-004 — API Health State

An API shall have an independent health state:

- Healthy
- Degraded
- Down

### 5.2 Gateway Routing

### FR-GATEWAY-001 — Prefix Routing

GateWatch shall use prefix-based route matching.

### FR-GATEWAY-002 — Route Forwarding

When a route matches, GateWatch shall strip the configured public route prefix before forwarding the request to the upstream API.

### FR-GATEWAY-003 — Request Preservation

Gateway forwarding shall preserve:

- Remaining request path
- Query parameters
- Trailing slash

### FR-GATEWAY-004 — HTTP Method Restrictions

Routes may optionally restrict the HTTP methods allowed through them.

### FR-GATEWAY-005 — Longest Prefix Match

When multiple routes match a request, GateWatch shall select the most specific matching route using the longest matching prefix.

### FR-GATEWAY-006 — Duplicate Route Prevention

GateWatch shall reject identical route definitions.

### 5.3 Rate Limiting

### FR-GATEWAY-007 — Per-Client API Rate Limit

Rate limiting shall be applied independently per client and per API.

### FR-GATEWAY-008 — Rate Limit Identity

For authenticated API requests, the API key shall identify the client.

For unauthenticated requests, the client IP address may be used as a fallback identity.

### FR-GATEWAY-009 — Rate Limit Window

Each API shall support a configurable maximum number of requests within a configured fixed time window.

### FR-GATEWAY-010 — Request Counting

Every request reaching the gateway shall count toward the applicable rate limit.

### FR-GATEWAY-011 — Rate Limit Response

When the applicable limit is exceeded, GateWatch shall return HTTP `429 Too Many Requests`.

### FR-GATEWAY-012 — Redis Rate Limiting

Redis shall maintain the active rate-limit counters.

---

## 6. Project Management Requirements

### FR-PROJECT-001 — Create Project

Users shall be able to create multiple projects.

### FR-PROJECT-002 — Project Purpose

A project shall provide a logical grouping of independently configured APIs and their associated:

- Gateway resources
- Testing resources
- Monitoring resources
- Alerting resources

### FR-PROJECT-003 — Application Independence

APIs within the same project may belong to the same application or to different applications.

GateWatch shall not require an application-level relationship between APIs.

### FR-PROJECT-004 — Project Ownership

A project shall belong to its creating user.

### FR-PROJECT-005 — Project Resource Ownership

Resources within a project shall be accessible only to the owning user.

### FR-PROJECT-006 — Project Deletion

Supported project deletion shall use soft deletion.

---

## 7. Deployment / Execution Requirements

### 7.1 Gateway Execution

### FR-DEPLOY-001 — Request Execution

GateWatch shall receive gateway requests, authenticate them where configured, apply applicable rate limits, route them to the upstream API, and return the upstream response.

### FR-DEPLOY-002 — Upstream Failure Handling

GateWatch shall return an appropriate error response when an upstream API is unavailable or cannot be reached.

### FR-DEPLOY-003 — Upstream Timeout

GateWatch shall handle upstream request timeouts and return an appropriate timeout response.

### 7.2 Test Execution

### FR-TEST-001 — API Test Definition

Users shall be able to create HTTP API tests containing:

**Request definition**

- HTTP method
- URL
- Headers
- Request body
- Authentication

**Assertions**

- Status code
- Response body
- Response headers
- Response time

### FR-TEST-002 — Manual Test Execution

Users shall be able to execute tests manually through the GateWatch interface.

### FR-TEST-003 — CI/CD Test Execution

GateWatch shall expose an authenticated API through which CI/CD systems can trigger tests.

### FR-TEST-004 — Test Execution Result

Each test execution shall produce:

- Overall pass/fail result
- Individual assertion results

### FR-TEST-005 — Response Handling

The test engine may use the upstream response for assertion evaluation, but the complete response shall not be persisted after execution.

### FR-TEST-006 — Scheduled Testing

Scheduled test execution is out of scope for the MVP.

### FR-TEST-007 — CI/CD Responsibility

GateWatch shall execute and report tests when triggered by a CI/CD system but shall not act as the CI/CD server itself.

---

## 8. Logging Requirements

### 8.1 Request History

### FR-LOG-001 — Request History

GateWatch shall maintain structured request history for gateway traffic.

Request history shall include, where applicable:

- Request ID
- API ID
- Route
- HTTP method
- Status code
- Latency
- Client identity
- Timestamp
- Request result

### FR-LOG-002 — Request Body Storage

GateWatch shall not persist complete request or response bodies by default.

### FR-LOG-003 — User Request History

Users shall be able to view request history for APIs they own.

### 8.2 Audit Logs

### FR-LOG-004 — Audit Logging

GateWatch shall maintain audit records for relevant administrative and user actions.

### FR-LOG-005 — Shared Audit Log

User and Admin actions shall be stored in the same audit log structure.

Audit records shall identify the:

- Actor
- Actor role
- Action
- Resource type
- Resource ID where applicable
- Timestamp
- Additional metadata where applicable

### FR-LOG-006 — Operational Logs

Application and infrastructure operational logs shall be handled separately from user-facing request history and audit logs.

AWS CloudWatch shall be used for operational logging and monitoring in the deployed environment.

---

## 9. Monitoring Requirements

### 9.1 Health Checks

### FR-MON-001 — Automatic Health Checks

GateWatch shall perform automatic health checks for registered APIs at a 60-second interval.

### FR-MON-002 — Manual Health Checks

Users shall be able to manually trigger a health check at any time for APIs they own.

### FR-MON-003 — Health Check Timeout

Each health check shall use a 5-second timeout.

### FR-MON-004 — Health Check Retry

A failed or timed-out health check shall allow one retry.

### FR-MON-005 — Health Classification

GateWatch shall classify APIs as:

- Healthy
- Degraded
- Down

based on request success, response time, and availability.

Exact thresholds and response validation rules shall be defined in the System Design document.

### 9.2 Monitoring Data

### FR-MON-006 — API Health Visibility

Users shall be able to view the current health state of APIs they own.

### FR-MON-007 — Performance Monitoring

GateWatch shall monitor API response latency and request errors.

### FR-MON-008 — Error Rate Monitoring

GateWatch shall support monitoring of API error rates against configured thresholds.

### 9.3 Alerts

### FR-MON-009 — API Down Alert

GateWatch shall support alerts when an API transitions to the Down state.

### FR-MON-010 — Persistent Unhealthy Alert

GateWatch shall support alerts when an API remains in an unhealthy state for a configured duration.

The alert shall not be generated repeatedly for every failed health check.

### FR-MON-011 — Error Rate Alert

GateWatch shall support alerts when the configured error-rate threshold is exceeded within a configured time window.

### FR-MON-012 — Latency Alert

GateWatch shall support alerts when the configured latency threshold is exceeded within a configured time window.

### FR-MON-013 — Notification Delivery

GateWatch shall support configured notification mechanisms for alerts, including AWS SNS.

### FR-MON-014 — Advanced Alert Rules

Complex alert expressions and additional notification channels are out of scope for the MVP.

---

## 10. Error Handling Requirements

### FR-ERR-001 — Structured Errors

GateWatch management APIs shall return structured JSON error responses.

Example:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Request rate limit exceeded."
  }
}
```

### FR-ERR-002 — Authentication Errors

GateWatch shall return appropriate authentication errors for missing or invalid credentials.

Example: HTTP `401 Unauthorized`.

### FR-ERR-003 — Authorization Errors

GateWatch shall return an authorization error when an authenticated user attempts to access a resource they do not own or are not permitted to access.

Example: HTTP `403 Forbidden`.

### FR-ERR-004 — Route Not Found

GateWatch shall return an appropriate response when no configured gateway route matches the request.

Example: HTTP `404 Not Found`.

### FR-ERR-005 — Rate Limit Error

GateWatch shall return HTTP `429 Too Many Requests` when a rate limit is exceeded.

### FR-ERR-006 — Upstream Failure

GateWatch shall return an appropriate upstream failure response when the target API cannot be reached or fails during request execution.

Example: HTTP `502 Bad Gateway`.

### FR-ERR-007 — Upstream Timeout

GateWatch shall return an appropriate timeout response when the upstream API exceeds the configured timeout.

Example: HTTP `504 Gateway Timeout`.

Exact error schemas and status-code mappings shall be defined in the API Design document.

---

## 11. Administration Requirements

### FR-ADMIN-001 — User Administration

Admins shall be able to:

- View users
- View basic user information
- Enable or disable users
- Manage Admin role assignment

### FR-ADMIN-002 — Platform Resource Visibility

Admins shall be able to view platform-level information about registered resources.

### FR-ADMIN-003 — Platform Health

Admins shall be able to view platform-level health and operational information.

### FR-ADMIN-004 — System Administration

Admins shall be able to manage applicable system-level configuration and platform settings.

### FR-ADMIN-005 — Resource Ownership

Admin access shall not automatically make the Admin the owner of another user's resources.

### FR-ADMIN-006 — User Resource Modification

Admins shall not arbitrarily modify another user's API configuration unless a specific administrative capability requires it.

---

## 12. Requirement IDs

Requirement IDs use a feature-based naming convention.

| Prefix | Area |
| --- | --- |
| `FR-AUTH` | Authentication |
| `FR-USER` | User requirements |
| `FR-USER-MGMT` | User management |
| `FR-API` | API registration and lifecycle |
| `FR-PROJECT` | Project management |
| `FR-GATEWAY` | Gateway and rate limiting |
| `FR-DEPLOY` | Gateway execution |
| `FR-TEST` | API testing |
| `FR-LOG` | Logging and audit |
| `FR-MON` | Monitoring and alerts |
| `FR-ERR` | Error handling |
| `FR-ADMIN` | Administration |

Format:

```
FR-<AREA>-<NUMBER>
```

Example:

```
FR-GATEWAY-001
FR-MON-004
FR-TEST-002
```

---

## 13. Requirement Priority

| Priority | Meaning |
| --- | --- |
| P0 | Required for MVP and review-critical |
| P1 | Important MVP functionality |
| P2 | Optional or future functionality |

---

## 14. Requirement Status

| Status | Meaning |
| --- | --- |
| Planned | Requirement is defined but implementation has not started |
| In Progress | Requirement is currently being implemented |
| Implemented | Requirement has been implemented |
| Verified | Requirement has been tested and confirmed |
| Deferred | Requirement is intentionally postponed |

---

## 15. MVP and Deferred Features

### MVP

- GitHub OAuth authentication
- User and Admin roles
- User-owned projects and APIs
- API registration and configuration
- API lifecycle management
- Prefix-based gateway routing
- API key authentication
- Fixed-window rate limiting
- Redis rate-limit counters
- Gateway request history
- Audit logging
- Automatic and manual health checks
- API health classification
- API testing
- CI/CD-triggered test execution
- Test assertion results
- API monitoring
- Basic alerting
- AWS SNS notification integration
- AWS CloudWatch operational monitoring
- Structured error handling
- AWS deployment using:
    - S3
    - CloudFront
    - EC2
    - RDS PostgreSQL
    - Redis
    - CloudWatch
    - SNS

### Deferred / Future

- Scheduled API tests
- JWT/OAuth authentication for registered APIs
- SQS-based processing
- Kubernetes
- ECS/Fargate
- Advanced alert expressions
- Additional notification channels
- OpenAPI import
- Advanced analytics
- Distributed or multi-node gateway deployment
- API marketplace/monetization
- Collaboration and team-based permissions
- Complex project/resource sharing