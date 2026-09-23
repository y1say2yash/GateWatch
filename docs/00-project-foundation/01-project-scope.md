# GateWatch — Project Scope

> **GateWatch is a lightweight API Gateway and Monitoring Platform that provides centralized API routing, security controls, observability, automated API testing, and CI/CD integration.**
> 

---

# 1. Project Overview

GateWatch is a cloud-enabled platform designed to sit between clients and backend APIs.

Instead of a client directly communicating with multiple APIs:

```
Client
 ├────────► Product API
 ├────────► Order API
 └────────► User API
```

the client can communicate through GateWatch:

```
                         ┌──► Product API
                         │
Client ──► GateWatch ────┼──► Order API
                         │
                         └──► User API
```

GateWatch manages the gateway-level responsibilities while the upstream APIs retain their own business logic.

The platform combines:

- API Gateway
- API Management
- API Security
- API Monitoring
- API Health Monitoring
- API Testing
- CI/CD Integration
- Docker-based deployment
- AWS cloud infrastructure

---

# 2. Project Objectives

The primary objectives are:

1. Build a functional API gateway.
2. Allow users to register existing APIs.
3. Provide configurable gateway routes.
4. Implement API authentication.
5. Implement configurable rate limiting.
6. Forward requests to upstream APIs.
7. Record API request logs.
8. Collect basic performance metrics.
9. Monitor API health.
10. Provide a monitoring dashboard.
11. Allow users to define API tests.
12. Execute API tests and record results.
13. Integrate API tests into CI/CD workflows.
14. Containerize the platform using Docker.
15. Deploy the platform on AWS.
16. Demonstrate practical cloud, DevOps, and system-design concepts.

---

# 3. Target Users

## 3.1 Developers

Developers can use GateWatch to register and manage APIs without modifying the APIs themselves.

They can:

- Register APIs
- Configure routes
- Configure authentication
- Set rate limits
- View logs
- Monitor API health
- Create API tests

---

## 3.2 Small Development Teams

Small teams can use GateWatch as a centralized layer for APIs developed as part of a project.

The platform can provide a common layer for:

- Authentication
- Traffic control
- Monitoring
- Testing

---

## 3.3 DevOps / CI/CD Users

Developers working with automated pipelines can use GateWatch's testing capabilities to validate APIs as part of CI/CD.

Example:

```
Git Push
   ↓
GitHub Actions
   ↓
Build
   ↓
Unit Tests
   ↓
Docker Build
   ↓
Start API
   ↓
GateWatch API Tests
   ↓
Pass / Fail
```

---

# 4. User Problems

GateWatch addresses several practical problems.

## 4.1 Scattered API Access

Multiple backend APIs may require different access mechanisms.

GateWatch provides a centralized gateway.

---

## 4.2 Repeated Security Logic

Individual APIs may otherwise need to implement authentication and traffic controls separately.

GateWatch provides gateway-level controls.

---

## 4.3 Limited API Visibility

Developers may not have a unified view of:

- Requests
- Errors
- Latency
- API health

GateWatch provides centralized monitoring.

---

## 4.4 Manual API Validation

API validation can become repetitive when performed manually.

GateWatch allows reusable API tests to be executed automatically.

---

## 4.5 Disconnected CI/CD Validation

A deployment pipeline may successfully build an application while the resulting API is not actually functioning correctly.

GateWatch can provide post-build or post-deployment API validation.

---

# 5. Functional Scope

## 5.1 User Management

The system may provide:

- User registration
- User login
- Authentication
- Session/token management
- Basic user account management

---

# 5.2 API Registration

Users can register an existing API.

Required information may include:

```
API Name
Base URL
Gateway Route
Authentication Configuration
Rate Limit
Health Check Endpoint
```

Example:

```
Name:
Product API

Base URL:
http://product-api:3001

Gateway Route:
/products

Health Endpoint:
/health

Rate Limit:
100 requests/minute
```

GateWatch stores the configuration and uses it for routing.

---

# 5.3 Gateway Routing

GateWatch receives client requests and forwards them to configured upstream APIs.

Example:

```
Client

GET /api/products
        │
        ▼
GateWatch
        │
        ▼
Product API

GET /products
```

The gateway should handle:

- Route matching
- Request forwarding
- Response forwarding
- Upstream errors
- Gateway errors

---

# 5.4 Authentication

The initial implementation should support API authentication.

A practical MVP approach is:

```
Client
   │
   │ API Key
   ▼
GateWatch
   │
   ├── Valid → Forward
   │
   └── Invalid → Reject
```

Potential future authentication methods include:

- JWT
- OAuth-related integrations
- More advanced identity providers

These are not mandatory for the initial implementation.

---

# 5.5 Rate Limiting

GateWatch should provide configurable rate limiting.

Example:

```
API:
Product API

Limit:
100 requests / minute / client
```

If the limit is exceeded:

```
HTTP 429 Too Many Requests
```

Redis can be used to maintain rate-limit counters efficiently.

---

# 5.6 Request Logging

GateWatch should record useful information for incoming requests.

Potential fields:

```
Timestamp
API
HTTP Method
Endpoint
Client
Status Code
Latency
Request Result
```

Sensitive information should not be unnecessarily stored in logs.

---

# 5.7 API Monitoring

The platform should provide basic API monitoring.

Metrics may include:

- Total requests
- Successful requests
- Failed requests
- Error rate
- Average latency
- Response status distribution
- API availability

---

# 5.8 API Health Monitoring

GateWatch should periodically check whether configured APIs are reachable and responding correctly.

Example:

```
GET /health
```

Possible states:

```
Healthy
Degraded
Down
```

The exact health-state logic can be refined during implementation.

---

# 5.9 Monitoring Dashboard

The frontend should provide a centralized view of API activity.

Example dashboard information:

```
APIs
Requests
Error Rate
Average Latency
Healthy APIs
Unhealthy APIs
Recent Requests
Recent Test Results
```

The dashboard should prioritize useful operational information rather than visual complexity.

---

# 5.10 API Testing

API testing is an integrated feature of GateWatch.

Users should be able to define tests such as:

```
Request:
GET /products

Expected Status:
200

Expected Latency:
< 500 ms
```

Possible assertions include:

- HTTP status code
- Response time
- Response body fields
- Basic response structure

Test results should record:

```
Test
Timestamp
Pass/Fail
Status Code
Latency
Failure Reason
```

---

# 5.11 Test History

GateWatch should retain previous test results.

This allows users to identify patterns such as:

- Repeated failures
- Increasing latency
- Intermittent API problems

---

# 5.12 CI/CD Integration

GateWatch should integrate with GitHub Actions.

A CI/CD workflow may look like:

```
Developer Push
       ↓
GitHub
       ↓
GitHub Actions
       ↓
Lint
       ↓
Unit Tests
       ↓
Docker Build
       ↓
Deploy / Start
       ↓
GateWatch API Tests
       ↓
Pass / Fail
```

A failed API validation step can prevent the pipeline from proceeding to later stages.

---

# 5.13 Docker Support

GateWatch should be containerized.

The local environment may contain:

```
Frontend
Gateway/API
PostgreSQL
Redis
Product API
Order API
```

Docker Compose should be used where practical to simplify local development.

---

# 5.14 AWS Deployment

The project should be deployed to AWS.

The initial deployment may use:

### Amazon EC2

For hosting the Dockerized GateWatch application.

### Amazon CloudWatch

For infrastructure/application logs and metrics where appropriate.

### Amazon SNS

For notification/alert delivery.

### Amazon SQS

For asynchronous jobs if implemented.

SQS is an optional feature and should not block the core project.

---

# 6. Non-Functional Scope

## 6.1 Performance

Gateway operations should introduce reasonable overhead and avoid unnecessary processing.

The system should record request latency so performance can be evaluated.

---

## 6.2 Reliability

The system should handle:

- Invalid routes
- Authentication failures
- Rate-limit violations
- Unavailable upstream APIs
- Invalid configurations
- Internal errors

without crashing the entire gateway.

---

## 6.3 Security

The system should:

- Protect authenticated routes
- Avoid exposing unnecessary secrets
- Validate incoming configuration
- Secure sensitive environment variables
- Avoid storing sensitive information in logs
- Use HTTPS in appropriate deployment environments

---

## 6.4 Scalability

The architecture should allow future scaling but does not need to implement large-scale distributed infrastructure in the initial phase.

---

## 6.5 Maintainability

The codebase should use clear module boundaries.

Major responsibilities should be separated into areas such as:

```
Authentication
API Management
Gateway
Rate Limiting
Monitoring
Testing
Users
```

---

## 6.6 Observability

Important system operations should produce logs and measurable metrics.

---

## 6.7 Usability

The dashboard should make common operations understandable without requiring users to interact directly with Docker or server infrastructure.

---

# 7. Phase / Semester Features

The initial semester should focus on the following features.

## Mandatory Features

### API Management

- User authentication
- API registration
- API configuration
- Gateway route configuration

### Gateway

- Reverse proxy
- Request routing
- API key authentication
- Rate limiting
- Error handling

### Monitoring

- Request logging
- Status code tracking
- Latency tracking
- Health checks
- Monitoring dashboard

### Testing

- Test creation
- Test execution
- Basic assertions
- Test history

### DevOps

- Docker
- Docker Compose
- GitHub
- GitHub Actions
- CI/CD pipeline

### Cloud

- AWS EC2 deployment
- Basic CloudWatch integration

---

# 8. Phase / Semester Limitations

The initial implementation intentionally has limitations.

### Deployment Model

The project will initially use a relatively simple deployment architecture.

```
AWS EC2
   │
Docker
   │
GateWatch
```

It does not require multiple clusters or distributed gateway instances.

---

### Authentication

API-key-based authentication is sufficient for the initial version.

More advanced authentication can be added later.

---

### Monitoring

The initial monitoring system will focus on:

- Request counts
- Status codes
- Latency
- Errors
- Health

Advanced observability is not required.

---

### Testing

The initial API testing engine will provide basic request execution and assertions.

It does not need to reproduce the complete feature set of Postman.

---

### Scaling

Horizontal scaling and high-availability architecture are future concerns.

---

# 9. Project Boundaries

The following boundary defines the responsibility of GateWatch:

```
                    GateWatch Boundary

Client
  │
  ▼
┌──────────────────────────────┐
│          GateWatch           │
│                              │
│ Authentication               │
│ Rate Limiting                │
│ Routing                      │
│ Logging                      │
│ Monitoring                   │
│ API Testing                  │
│ API Configuration            │
└──────────────┬───────────────┘
               │
               ▼
        External APIs
```

GateWatch manages the communication layer.

The upstream APIs remain responsible for:

- Business logic
- Business data
- Domain-specific validation
- Application-specific functionality

---

# 10. Assumptions

The project assumes:

1. Users already have an API they want to connect.
2. The upstream API exposes HTTP/HTTPS endpoints.
3. GateWatch can reach the upstream API over the network.
4. The user can provide the necessary API configuration.
5. APIs provide a health-check endpoint where health monitoring is required.
6. Demo APIs can be used for development and demonstration.
7. The initial system operates within a controlled cloud environment.
8. GitHub is used for source-code management.
9. Docker is available for local and deployment environments.

---

# 11. Constraints

The project is constrained by:

### Team Size

3 developers.

### Academic Timeline

The core system must be completed within the allocated semester.

### Infrastructure Budget

AWS usage should be controlled to avoid unnecessary cloud costs.

### Development Complexity

The architecture should remain understandable and implementable by a student team.

### Feature Scope

Optional features should not delay completion of mandatory gateway functionality.

---

# 12. Out of Scope

The following are explicitly outside the initial project scope.

## Enterprise API Management

GateWatch will not attempt to reproduce the complete functionality of commercial API management platforms.

---

## Kubernetes

Kubernetes-based deployment is not required for the initial phase.

---

## Multi-Region Deployment

The initial project will not implement:

- Multi-region gateways
- Global traffic management
- Cross-region failover

---

## API Monetization

The project will not implement:

- API subscriptions
- Billing
- Payments
- Usage-based pricing
- Developer marketplaces

---

## Full API Development Platform

GateWatch will not host arbitrary application source code or act as a PaaS.

---

## Full Postman Replacement

GateWatch's API testing functionality is intended to support gateway monitoring and CI/CD validation.

It is not intended to reproduce every Postman feature.

---

## Advanced AI Features

AI-based:

- anomaly detection
- log analysis
- automatic test generation
- intelligent debugging

may be explored later but are not part of the mandatory scope.

---

## Complex Distributed Infrastructure

The initial system will not require:

- Service mesh
- Distributed gateway clusters
- Event-driven microservice architecture throughout the system
- Complex multi-node orchestration

---

# 13. Expected Deliverables

The completed project should provide:

## Software

- GateWatch web dashboard
- API gateway
- API management system
- Monitoring functionality
- API testing functionality
- Authentication
- Rate limiting
- Logging
- Health monitoring

## Infrastructure

- Docker configuration
- Docker Compose configuration
- AWS deployment
- CloudWatch integration where applicable

## CI/CD

- GitHub repository
- GitHub Actions workflows
- Automated build
- Automated tests
- Docker image build
- Deployment workflow
- API validation

## Supporting Services

- At least one lightweight demo API
- Preferably two demo APIs for routing demonstrations

Example:

```
Product API
Order API
```

These services exist primarily to demonstrate GateWatch and do not need to become separate full-scale projects.

## Documentation

- System architecture
- API documentation
- Database design
- Deployment documentation
- CI/CD workflow
- Setup instructions
- Testing documentation
- Architecture decisions
- Project limitations

---

# 14. Success Criteria

GateWatch will be considered successful for the initial phase when the team can demonstrate the following end-to-end workflow:

```
1. User logs into GateWatch
             ↓
2. User registers an API
             ↓
3. GateWatch creates/configures a route
             ↓
4. Client sends request through GateWatch
             ↓
5. GateWatch authenticates request
             ↓
6. GateWatch applies rate limiting
             ↓
7. GateWatch forwards request
             ↓
8. Upstream API responds
             ↓
9. GateWatch records request information
             ↓
10. Dashboard displays activity
             ↓
11. Health monitoring detects API state
             ↓
12. API test executes
             ↓
13. Test result is recorded
             ↓
14. CI/CD pipeline can execute the test
```

Additional success indicators include:

- Gateway correctly routes requests.
- Invalid authentication is rejected.
- Rate limits are enforced.
- API failures are visible.
- API latency can be observed.
- Health checks identify unavailable APIs.
- Automated API tests can pass and fail correctly.
- Docker deployment works consistently.
- CI/CD workflow executes successfully.
- GateWatch can run on AWS.

---

# 15. Scope Evolution

The project scope should evolve in stages.

## Phase 1 — Core Platform

```
API Registration
       ↓
Gateway Routing
       ↓
Authentication
       ↓
Rate Limiting
       ↓
Logging
       ↓
Monitoring
```

---

## Phase 2 — Testing and Automation

```
API Testing
     ↓
Test History
     ↓
CI/CD Integration
     ↓
Automated Validation
```

---

## Phase 3 — Cloud Integration

```
Docker
   ↓
EC2
   ↓
CloudWatch
   ↓
SNS
```

---

## Phase 4 — Optional Extensions

Only after the core platform is stable:

- OpenAPI import
- Scheduled API tests
- SQS-based background jobs
- Advanced metrics
- API versioning
- Caching
- Advanced authentication
- Distributed deployment
- Kubernetes
- AI-assisted observability

These extensions should be treated as **future scope**, not commitments.

---

# Final Scope Definition

The initial GateWatch project can therefore be summarized as:

```
                    GATEWATCH

              API Gateway Platform
                       │
       ┌───────────────┼────────────────┐
       │               │                │
   API Management   Monitoring       Testing
       │               │                │
       └───────────────┼────────────────┘
                       │
                     CI/CD
                       │
                     Docker
                       │
                      AWS
```

### Core Semester Scope

> **Build a Dockerized, AWS-deployed API Gateway and Monitoring Platform that allows users to register existing APIs, route and secure API traffic, enforce rate limits, collect logs and metrics, monitor API health, define automated API tests, and integrate those tests into CI/CD workflows.**
> 

The project should remain focused on this core capability before expanding into advanced cloud-native or distributed infrastructure.