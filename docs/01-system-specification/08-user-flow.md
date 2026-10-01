# GateWatch — User Flows

## 1. User Personas

### User

The primary GateWatch user who manages their own projects, APIs, gateway configuration, testing, monitoring, and alerts.

A User can:

- Create and manage projects.
- Register and configure APIs.
- Configure gateway routes.
- Configure authentication and rate limits.
- Activate or disable APIs.
- Execute API tests.
- View request history and health information.
- Configure and manage alerts.
- Manage their own GateWatch access tokens.

Users can access only resources they own.

### Admin

An Admin has the same normal GateWatch capabilities as a User, along with platform-level administrative capabilities.

An Admin can:

- Manage users.
- View platform resources.
- View platform health.
- View audit logs.
- Perform administrative user-management actions.

Being an Admin does not automatically make the Admin the owner of another user's resources.

### External Actors and Systems

The following participate in GateWatch flows but are not user personas:

- **GitHub**: Provides GitHub OAuth authentication.
- **API Clients**: Send requests through the GateWatch gateway.
- **Registered Upstream APIs**: Receive forwarded gateway requests and direct test requests.
- **GitHub Actions / CI/CD**: Executes GateWatch API tests programmatically using an access token.

---

## 2. Authentication Flow

GateWatch uses GitHub OAuth for browser authentication.

```
User
  ↓
GateWatch Login
  ↓
GitHub OAuth
  ↓
GitHub Authorization
  ↓
OAuth Callback
  ↓
Find/Create/Update User
  ↓
Create Server-Side Session
  ↓
Set Secure HTTP-Only Cookie
  ↓
Dashboard
```

### Existing User

When an existing user successfully authenticates:

```
GitHub Login
  ↓
Identify Existing User
  ↓
Create New Session
  ↓
Existing Valid Sessions May Remain Active
  ↓
Dashboard
```

The new login does not automatically invalidate other valid sessions.

### Deleted User

A user with status `DELETED` can return through successful GitHub authentication.

```
GitHub Login
  ↓
User Identified
  ↓
User Status = DELETED
  ↓
Restore / Reactivate User
  ↓
Create Session
  ↓
Dashboard
```

### Admin-Disabled User

A user with status `ADMIN_DISABLED` cannot log in.

```
GitHub Login
  ↓
User Identified
  ↓
User Status = ADMIN_DISABLED
  ↓
Login Blocked
  ↓
Contact Admin Message
```

### Logout / Session Revocation

```
User
  ↓
Logout
  ↓
Session Revoked / Deleted
  ↓
Session Cookie Invalidated
  ↓
Login Required
```

---

## 3. Onboarding Flow

GateWatch does not use a mandatory guided onboarding wizard.

After the first successful login, the user reaches the normal dashboard.

For an account with no APIs, the dashboard can display an empty state such as:

> **Your APIs deserve a watch.**
> 
> 
> Add your API to see it here. Create a project.
> 

### First-Time User Journey

```
GitHub Login
  ↓
Dashboard
  ↓
No Projects / APIs
  ↓
Create Project
  ↓
Project Created
  ↓
Register API
```

A Project is mandatory before an API can be registered.

---

## 4. Main User Journey

The primary GateWatch user journey is:

```
Login
  ↓
Dashboard
  ↓
Create Project
  ↓
Register API
  ↓
Configure Route
  ↓
Configure Authentication
  ↓
Configure Rate Limit
  ↓
Configure Health Check
  ↓
Activate API
  ↓
Receive Gateway Traffic
  ↓
Record Request History
  ↓
Monitor Health and Metrics
  ↓
Configure Alerts
  ↓
Run API Tests
```

Users can return to individual configuration, testing, monitoring, and alerting areas without repeating the complete journey.

---

## 5. Core Gateway Request Flow

The Gateway Request Flow is the central GateWatch feature.

```
API Client
  ↓
GateWatch Gateway
  ↓
Resolve Gateway Route
  ↓
Check API Lifecycle
  ↓
Authenticate Request
  ↓
Apply Rate Limit
  ↓
Build Upstream Request
  ↓
Forward Request
  ↓
Receive Upstream Response
  ↓
Record Request History
  ↓
Evaluate Monitoring / Alerts
  ↓
Return Response
  ↓
API Client
```

### Route Resolution

GateWatch uses prefix-based route matching.

```
Incoming Request
  ↓
Find Matching Route Prefix
  ↓
Select Longest Matching Prefix
  ↓
Check HTTP Method
  ↓
No Match?
 ├── Yes → GateWatch 404
 └── No → Continue
```

The configured route prefix is stripped before forwarding. The remaining path, query parameters, and trailing slash are preserved.

### Upstream Response Handling

GateWatch-generated errors and upstream-generated responses are treated separately.

```
Gateway Request
  ↓
GateWatch Processing
  ├── GateWatch Error → GateWatch Error Response
  │
  └── Upstream Request
       ↓
       Upstream Response
       ↓
       Return Upstream Response
```

For example:

- No matching GateWatch route → GateWatch `404`.
- Upstream returns `404` → Upstream `404` is normally passed through to the client.
- Upstream timeout → GateWatch `504`.
- Upstream connection failure → GateWatch `502`.

---

## 6. API Registration & Configuration Flow

### Create Project

```
User
  ↓
Projects
  ↓
Create Project
  ↓
Enter Project Name / Details
  ↓
Create Project
  ↓
Project Created
```

The project receives a unique project slug used in the gateway namespace.

### Register API

The initial API creation flow handles the essential configuration required to register an API.

```
Project
  ↓
Register API
  ↓
Enter Basic API Information
  ↓
Configure Upstream URL
  ↓
Configure Initial Gateway Route
  ↓
Configure Authentication
  ↓
Configure Rate Limit
  ↓
Configure Health Check
  ↓
Create API
  ↓
API Status = REGISTERED
```

The initial gateway route is created as part of API registration.

### Additional Configuration

After registration, the API can be managed through its API Details page.

```
API Details
 ├── Overview
 ├── Configuration
 ├── Monitoring
 └── Test History
```

Configuration can be modified after creation, and additional gateway routes can be added separately.

### API Lifecycle

```
REGISTERED
     ↓
   ACTIVE
     ↓
  DISABLED
     ↓
   ACTIVE
```

An API can also be soft-deleted from any non-deleted state:

```
REGISTERED ─┐
ACTIVE      ├──→ DELETED
DISABLED    ┘
```

`DELETED` is a terminal lifecycle state.

---

## 7. API Activation / Disable Flow

### Activate API

```
Registered API
  ↓
Validate Configuration
  ↓
Activate
  ↓
API Status = ACTIVE
  ↓
Gateway Traffic Allowed
  ↓
Automatic Health Checks Enabled
```

### Disable API

```
Active API
  ↓
Disable
  ↓
API Status = DISABLED
  ↓
Gateway Traffic Blocked
  ↓
Automatic Health Checks Stopped
  ↓
Historical Health Data Retained
```

A gateway request to a disabled API receives HTTP `503`.

### Re-enable API

```
Disabled API
  ↓
Enable
  ↓
API Status = ACTIVE
  ↓
Gateway Traffic Allowed
  ↓
Automatic Health Checks Resumed
```

---

## 8. Testing Flow

GateWatch supports manual testing through the interface and programmatic testing through an authenticated API.

### Manual Test

```
Testing
  ↓
Select API
  ↓
Configure Request
  ├── Method
  ├── URL
  ├── Headers
  ├── Body
  └── Authentication
  ↓
Configure Assertions
  ↓
Execute Test
  ↓
Send Request Directly to Configured Upstream
  ↓
Receive Response
  ↓
Evaluate Assertions
  ↓
Show Test Result
  ↓
Save Execution Result
```

The complete upstream response is held temporarily in memory during execution and is not persisted as a complete response body.

### Test History

Test execution history is available from:

```
Testing
  ↓
Test History
```

and:

```
API Details
  ↓
Test History
```

### CI/CD Test Flow

GitHub Actions or another CI/CD system can execute a GateWatch test using a GateWatch access token.

```
GitHub Actions / CI/CD
  ↓
Authenticate with GateWatch Access Token
  ↓
Execute Test API
  ↓
GateWatch Executes Test
  ↓
Evaluate Assertions
  ↓
Return Pass / Fail Result
  ↓
CI/CD Continues Based on Result
```

Manual and CI/CD execution use the same test execution capability with different authentication mechanisms.

### Gateway Testing

MVP tests execute directly against the configured upstream.

Testing an API through the GateWatch gateway is a future capability and is not part of the MVP testing flow.

---

## 9. Failure & Recovery Flow

GateWatch distinguishes between failures generated by GateWatch and responses generated by upstream APIs.

### General Failure Flow

```
Request / Operation
  ↓
Validation / Processing
  ↓
Success?
 ├── Yes → Continue Normal Flow
 └── No
      ↓
Identify Failure
      ↓
Return Appropriate Error
      ↓
Record Relevant Logs / History
```

### Common Failure Cases

| Failure | GateWatch Behavior |
| --- | --- |
| Invalid request | `400 Bad Request` |
| Authentication failure | `401 Unauthorized` |
| Insufficient permission | `403 Forbidden` |
| Resource not found | `404 Not Found` |
| Duplicate/conflicting resource | `409 Conflict` |
| Semantic validation failure | `422 Unprocessable Entity` |
| Rate limit exceeded | `429 Too Many Requests` |
| Disabled API | `503 Service Unavailable` |
| Upstream connection failure | `502 Bad Gateway` |
| Upstream timeout | `504 Gateway Timeout` |
| Unexpected GateWatch error | `500 Internal Server Error` |

### Upstream Error

An upstream response is normally returned to the client without being converted into a GateWatch error.

For example:

```
Client
  ↓
GateWatch
  ↓
Upstream
  ↓
404 Not Found
  ↓
GateWatch
  ↓
Client receives upstream 404
```

This is different from:

```
Client
  ↓
GateWatch
  ↓
No matching GateWatch route
  ↓
GateWatch 404
```

### Recovery

Recovery depends on the failure:

- Disabled API → User re-enables the API.
- Upstream unavailable → Upstream becomes available again.
- Rate limit exceeded → Client waits for the applicable window to reset.
- Health failure → Subsequent health checks determine the current status.
- Triggered alert → Recovery condition produces a recovery event.

---

## 10. Monitoring / Status Flow

GateWatch separates API health from overall platform health.

### API Monitoring

```
API
  ↓
Health Check
  ↓
Current API Status
  ↓
Request History
  ↓
Metrics
  ↓
Alert Evaluation
  ↓
Alert / Recovery
```

Automatic health checks run at a 60-second interval.

Each health check uses:

- 5-second timeout
- One retry after a failed/timed-out request
- Healthy / Degraded / Down classification

### API Health

API health represents the state of an individual registered API.

Users can view:

- Current health status
- Response time
- HTTP status
- Health-check history
- Request history
- Request metrics
- Active alerts

### Platform Health

Platform health represents GateWatch infrastructure and service dependencies.

The dashboard can display platform-level status such as:

- Gateway status
- Database status
- Redis status

Platform health is distinct from the health of registered upstream APIs.

### Monitoring Navigation

Monitoring is a dedicated navigation section:

```
Monitoring
 ├── Overview
 ├── Requests
 ├── Health
 └── Logs
```

---

## 11. Alert Flow

GateWatch supports alerts for API availability and performance conditions.

```
Configure Alert
  ↓
Monitor Condition
  ↓
Condition Triggered
  ↓
Create Alert Event
  ↓
Send SNS Notification
  ↓
Alert Remains Triggered
  ↓
Recovery Condition
  ↓
Create Recovery Event
```

MVP alert conditions include:

- API becoming Down
- API remaining unhealthy for a configured duration
- Error rate exceeding a configured threshold
- Response latency exceeding a configured threshold

### Alert Configuration

API-specific alerts can be configured from the API Details monitoring area.

Global alert management is available through:

```
Alerts
 ├── Active Alerts
 └── Alert History
```

The global Alerts page provides visibility across projects and APIs owned by the user.

---

## 12. Error States

The UI should provide explicit states for common application conditions.

### Loading

Displayed while data or an operation is being loaded.

### Empty

Displayed when a resource has no data.

Example:

> Your APIs deserve a watch.
> 
> 
> Add your API to see it here. Create a project.
> 

### Success

Displayed after a successful create, update, delete, activation, test, or other operation.

### Validation Error

Displayed when submitted data does not satisfy the required format or constraints.

### Unauthorized

Displayed when authentication is missing or invalid.

HTTP: `401`

### Forbidden

Displayed when the authenticated user does not have permission to access the resource.

HTTP: `403`

### Not Found

Displayed when the requested GateWatch resource or gateway route does not exist.

HTTP: `404`

### Conflict

Displayed when an operation conflicts with the current resource state.

HTTP: `409`

This includes configuration version conflicts.

### Rate Limited

Displayed when the applicable request limit has been exceeded.

HTTP: `429`

### Upstream Unavailable

Displayed when GateWatch cannot successfully connect to the configured upstream.

HTTP: `502`

### Timeout

Displayed when the upstream does not respond within the configured gateway timeout.

HTTP: `504`

### Internal Error

Displayed when an unexpected GateWatch error occurs.

HTTP: `500`

### Error Message Handling

The backend returns structured error responses:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Request rate limit exceeded."
  }
}
```

The frontend maps backend error codes to appropriate user-friendly messages.

---

## 13. Edge Cases

The following edge cases are part of the user-flow design.

### Authentication and Sessions

- Expired session
- Revoked session / logout
- GitHub OAuth failure
- `DELETED` user attempting login
- `ADMIN_DISABLED` user attempting login

### Authorization

- User attempts to access another user's project
- User attempts to access another user's API
- Admin views another user's resources without becoming their owner

### Projects and APIs

- Duplicate project name
- Duplicate project slug
- API registered without a valid project
- Duplicate route and HTTP method
- API has no matching gateway route
- No active route for an incoming request
- Disabled API receives a gateway request
- Deleted API receives a gateway request

### Authentication and Credentials

- API key creation
- API key revocation
- Revoked API key
- Expired access token
- Revoked access token
- Invalid access token

### Gateway

- No matching route
- Invalid HTTP method for a route
- Upstream unavailable
- Upstream timeout
- Upstream returns `4xx`
- Upstream returns `5xx`
- Upstream response exceeds configured response-size limit
- Rate limit exceeded

### Configuration

- Invalid health configuration
- Stale or invalid health configuration
- API configuration version conflict (`409`)
- Concurrent API configuration updates

### Monitoring

- Health check failure
- Health check retry
- Manual health check overlapping with scheduled check
- Redis unavailable
- PostgreSQL unavailable
- Alert trigger
- Alert recovery

### Testing

- Test request validation failure
- Test assertion failure
- Upstream timeout
- Upstream unavailable
- Invalid/expired test authentication configuration

---

## 14. UI Navigation

The target GateWatch navigation is:

```
Overview

Projects

APIs

Gateway
 ├── Routes
 ├── Authentication
 └── Rate Limits

Monitoring
 ├── Overview
 ├── Requests
 ├── Health
 └── Logs

Testing

Alerts

Settings
```

### API Details

An API Details page provides API-specific management and visibility.

```
API Details
 ├── Overview
 ├── Configuration
 ├── Monitoring
 └── Test History
```

### Settings

Settings remain intentionally limited to clearly defined MVP requirements.

Additional settings should only be introduced when the corresponding functionality is defined in the system requirements.

### Admin Navigation

Admins use the same base navigation as normal users, with additional administrative functionality conditionally available.

```
User
 └── Normal Navigation

Admin
 ├── Normal Navigation
 └── Admin
      ├── Users
      ├── Resources
      ├── Health
      └── Audit Logs
```

Admin-only pages and actions are not exposed to normal users.

---

## 15. User Journey Diagrams

The following text-based diagrams describe the primary GateWatch journeys.

### 15.1 Authentication Journey

```
User
  ↓
GateWatch Login
  ↓
GitHub OAuth
  ↓
OAuth Callback
  ↓
Check User Status
  ├── ACTIVE → Create Session → Dashboard
  ├── DELETED → Restore User → Create Session → Dashboard
  └── ADMIN_DISABLED → Block Login → Contact Admin
```

### 15.2 First-Time Onboarding

```
Successful GitHub Login
  ↓
Dashboard
  ↓
Check Projects
  ├── Projects Exist → Normal Dashboard
  │
  └── No Projects
       ↓
     Empty State
       ↓
     Create Project
       ↓
     Project Created
       ↓
     Register API
```

### 15.3 API Registration & Configuration

```
Project
  ↓
Register API
  ↓
Basic API Information
  ↓
Upstream URL
  ↓
Initial Gateway Route
  ↓
Authentication
  ↓
Rate Limit
  ↓
Health Check
  ↓
Create API
  ↓
REGISTERED
  ↓
Activate API
  ↓
ACTIVE
```

### 15.4 Gateway Request Journey

```
API Client
  ↓
GateWatch Gateway
  ↓
Resolve Route
  ↓
Route Found?
  ├── No → GateWatch 404
  │
  └── Yes
       ↓
     Check API Lifecycle
       ↓
     Authenticate
       ↓
     Rate Limit
       ↓
     Build Upstream Request
       ↓
     Forward to Upstream
       ↓
     Receive Response
       ↓
     Record Request History
       ↓
     Evaluate Monitoring / Alerts
       ↓
     Return Response
```

### 15.5 Testing Journey

```
User / CI-CD
  ↓
Authenticate
  ↓
Select Test
  ↓
Build Test Request
  ↓
Execute Against Upstream
  ↓
Receive Response
  ↓
Evaluate Assertions
  ↓
Pass / Fail Result
  ↓
Save Execution Result
  ↓
View Test Result / History
```

### 15.6 Monitoring & Alert Journey

```
API
  ↓
Scheduled / Manual Health Check
  ↓
Classify Health
  ↓
Update Current Status
  ↓
Store Health History
  ↓
Evaluate Alert Conditions
  ├── Condition Triggered
  │     ↓
  │   Create Alert Event
  │     ↓
  │   SNS Notification
  │     ↓
  │   Alert Remains Triggered
  │
  └── Recovery
        ↓
      Create Recovery Event
        ↓
      Recovery Notification
```