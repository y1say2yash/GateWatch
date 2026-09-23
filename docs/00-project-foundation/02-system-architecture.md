# GateWatch —  System Architecture

## 1. Architecture Overview

GateWatch follows a **modular monolith architecture** with a logically separated **Control Plane** and **Data Plane**.

The system sits between clients and registered upstream APIs. It receives API requests, applies configured policies such as authentication and rate limiting, forwards valid requests to the appropriate upstream API, records request activity, and exposes monitoring and testing capabilities through a web dashboard.

The Control Plane manages configuration and persistent application state, while the Data Plane handles the actual API traffic flowing through the gateway.

At the deployment level, the backend and gateway run as Docker containers on an AWS EC2 instance. PostgreSQL is provided through Amazon RDS, Redis provides fast temporary state for rate limiting, and the frontend is deployed as static files to Amazon S3 and delivered through CloudFront.

### High-Level Architecture

```
                         ┌──────────────────────┐
                         │      Developer       │
                         │      / Client        │
                         └──────────┬───────────┘
                                    │
                         ┌──────────▼───────────┐
                         │  React Web Dashboard │
                         │   S3 + CloudFront    │
                         └──────────┬───────────┘
                                    │
                                    │ HTTPS / API
                                    ▼
                  ┌──────────────────────────────────┐
                  │            GateWatch             │
                  │                                  │
                  │  ┌─────────────┐ ┌─────────────┐ │
                  │  │ Control     │ │ Data        │ │
                  │  │ Plane       │ │ Plane       │ │
                  │  │             │ │             │ │
                  │  │ Users       │ │ Gateway     │ │
                  │  │ API Config  │ │ Auth        │ │
                  │  │ Testing     │ │ Rate Limit  │ │
                  │  │ Monitoring  │ │ Logging     │ │
                  │  └─────────────┘ └──────┬──────┘ │
                  │                         │        │
                  └─────────────────────────┼────────┘
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                              ▼             ▼             ▼
                       Product API     Order API     User API

                  ┌───────────────────────────────────┐
                  │          Supporting Services      │
                  │ PostgreSQL │ Redis │ CloudWatch   │
                  │ RDS        │       │ SNS          │
                  └───────────────────────────────────┘
```

The Control Plane and Data Plane are **logical architectural boundaries**, not separate deployed services in the initial implementation.

---

## 2. Architectural Goals

The architecture is designed around the following goals:

### 2.1 Centralized API Traffic Management

All registered API traffic should pass through GateWatch so that common policies can be applied consistently.

### 2.2 Clear Separation of Responsibilities

Configuration and management operations should remain conceptually separate from request processing.

- Control Plane → manages the system
- Data Plane → processes API traffic

### 2.3 Observability

GateWatch should provide visibility into:

- Request counts
- Response status codes
- Request latency
- API health
- Failures
- Test results
- Gateway activity

### 2.4 Extensibility

The architecture should allow additional gateway features to be added without requiring a complete rewrite.

Potential future additions include:

- Advanced authentication
- Caching
- Retry policies
- OpenAPI support
- Scheduled API testing
- Distributed gateway instances
- Advanced analytics

### 2.5 Deployment Simplicity

The initial architecture should remain manageable for a three-member student team while still demonstrating real-world cloud and DevOps concepts.

### 2.6 Cloud Integration

AWS services should be used where they provide a clear operational benefit without unnecessarily increasing system complexity.

---

# 3. C4 Level 1 — System Context

The System Context diagram shows GateWatch as a single system and focuses on its relationship with external users and systems.

```
                         ┌────────────────────┐
                         │     Developer      │
                         │                    │
                         │ Registers APIs,    │
                         │ configures tests,  │
                         │ views monitoring   │
                         └─────────┬──────────┘
                                   │
                                   │ Uses
                                   ▼
                    ┌─────────────────────────────┐
                    │          GateWatch          │
                    │                             │
                    │ API Gateway & Monitoring    │
                    │ Platform                    │
                    └───────┬─────────┬───────────┘
                            │         │
                Routes      │         │ Uses
                requests    │         │
                            │         ├───────────────┐
                            ▼         ▼               ▼
                    ┌────────────┐ ┌──────────┐ ┌────────────┐
                    │ Upstream   │ │ GitHub / │ │ AWS Cloud  │
                    │ APIs       │ │ Actions  │ │ Services   │
                    │            │ │          │ │            │
                    │ Product    │ │ Source & │ │ Monitoring │
                    │ Order      │ │ CI       │ │ Alerts     │
                    │ User       │ │          │ │            │
                    └────────────┘ └──────────┘ └────────────┘
```

### Primary Actors and Systems

| Entity | Type | Interaction |
| --- | --- | --- |
| Developer | Person | Configures APIs, tests, monitoring and views results |
| GateWatch | System | Central API gateway and monitoring platform |
| Upstream APIs | External System | Receive requests forwarded by GateWatch |
| GitHub / GitHub Actions | External System | Source control and CI/CD automation |
| AWS Services | External Systems | Cloud infrastructure, monitoring and notification |

The internal implementation details such as PostgreSQL, Redis, Docker and individual backend modules are intentionally excluded from the Level 1 diagram.

---

# 4. C4 Level 2 — Container Diagram

The Level 2 diagram describes the major deployable or independently identifiable parts of GateWatch.

```
                           ┌──────────────────────┐
                           │      Developer       │
                           └──────────┬───────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │   Frontend Web App      │
                         │ React + Vite + Tailwind │
                         │       + shadcn/ui       │
                         └────────────┬────────────┘
                                      │ HTTPS
                                      ▼
                    ┌─────────────────────────────────┐
                    │        Backend / Gateway        │
                    │      Node.js + Express          │
                    │                                 │
                    │ ┌────────────┐ ┌──────────────┐ │
                    │ │ Control    │ │ Data Plane   │ │
                    │ │ Plane      │ │              │ │
                    │ │            │ │ Gateway      │ │
                    │ │ API Config │ │ Auth         │ │
                    │ │ Users      │ │ Rate Limit   │ │
                    │ │ Testing    │ │ Logging      │ │
                    │ │ Monitoring │ │ Routing      │ │
                    │ └────────────┘ └──────┬───────┘ │
                    └──────────┬────────────┼─────────┘
                               │            │
                     ┌─────────┘            └──────────────┐
                     │                                     │
                     ▼                                     ▼
              ┌──────────────┐                     ┌──────────────┐
              │ PostgreSQL   │                     │    Redis     │
              │ AWS RDS      │                     │              │
              │              │                     │ Rate limits  │
              │ Persistent   │                     │ Temporary    │
              │ application  │                     │ state / TTL  │
              │ data         │                     │              │
              └──────────────┘                     └──────────────┘

                               │
                               │ HTTP/HTTPS
                               ▼
                  ┌────────────────────────────────┐
                  │        Registered APIs         │
                  │                                │
                  │ Product API                    │
                  │ Order API                      │
                  │ User API                       │
                  └────────────────────────────────┘

        ┌─────────────────┐                ┌──────────────────┐
        │ AWS CloudWatch  │                │    AWS SNS       │
        │ Logs + Metrics  │                │ Alert Delivery   │
        └─────────────────┘                └──────────────────┘
```

### Containers

| Container | Technology | Responsibility |
| --- | --- | --- |
| Frontend Web App | React, Vite, Tailwind, shadcn/ui | Dashboard and management interface |
| Backend / Gateway | Node.js, Express | API gateway, management API and system modules |
| PostgreSQL | PostgreSQL / Amazon RDS | Persistent application data |
| Redis | Redis | Rate limiting and temporary state |
| Registered APIs | Node.js / Express | Demonstration upstream services |
| CloudWatch | AWS | Operational logs and infrastructure/application metrics |
| SNS | AWS | Alert notifications |

The Backend/Gateway remains one deployed application even though its internal responsibilities are logically divided into Control Plane and Data Plane.

---

# 5. C4 Level 3 — Component Diagram

The Level 3 diagram focuses on the internal components of the Backend/Gateway.

```
                  ┌──────────────────────────────────────┐
                  │          Backend / Gateway           │
                  │            Node.js + Express         │
                  │                                      │
                  │  ┌────────────────────────────────┐  │
                  │  │          Control Plane         │  │
                  │  │                                │  │
                  │  │ ┌──────────┐  ┌──────────────┐ │  │
                  │  │ │   Auth   │  │  User Mgmt   │ │  │
                  │  │ └──────────┘  └──────────────┘ │  │
                  │  │                                │  │
                  │  │ ┌────────────────────────────┐ │  │
                  │  │ │     API Management         │ │  │
                  │  │ │Registration & Configuration│ │  │
                  │  │ └────────────────────────────┘ │  │
                  │  │                                │  │
                  │  │ ┌────────────────────────────┐ │  │
                  │  │ │      Testing Engine        │ │  │
                  │  │ │   Requests + Assertions +  │ │  │
                  │  │ │        Test Results        │ │  │
                  │  │ └────────────────────────────┘ │  │
                  │  └────────────────────────────────┘  │
                  │                                      │
                  │  ┌────────────────────────────────┐  │
                  │  │           Data Plane           │  │
                  │  │                                │  │
                  │  │ ┌────────────────────────────┐ │  │
                  │  │ │      Gateway / Proxy       │ │  │
                  │  │ └─────────────┬──────────────┘ │  │
                  │  │               │                │  │
                  │  │ ┌─────────────▼──────────────┐ │  │
                  │  │ │    Authentication          │ │  │
                  │  │ └─────────────┬──────────────┘ │  │
                  │  │               ▼                │  │
                  │  │ ┌────────────────────────────┐ │  │
                  │  │ │      Rate Limiting         │ │  │
                  │  │ └─────────────┬──────────────┘ │  │
                  │  │               ▼                │  │
                  │  │ ┌────────────────────────────┐ │  │
                  │  │ │       Request Router       │ │  │
                  │  │ └─────────────┬──────────────┘ │  │
                  │  └───────────────┼────────────────┘  │
                  │                  │                   │
                  │  ┌───────────────▼────────────────┐  │
                  │  │ Monitoring / Logging           │  │
                  │  │ Health Checks / Alerting       │  │
                  │  └────────────────────────────────┘  │
                  └──────────────────────────────────────┘
```

### Backend Components

1. **Auth Module**
2. **User Management Module**
3. **API Management Module**
4. **Gateway / Proxy Engine**
5. **Authentication Middleware**
6. **Rate Limiting Module**
7. **Request Router**
8. **Monitoring / Logging Module**
9. **Health Monitoring Module**
10. **Testing Engine**
11. **Alerting Module**

These components are implemented as modules within the same backend application rather than as separate microservices.

---

# 6. System Components

GateWatch consists of the following major architectural components.

## 6.1 Frontend

The frontend provides the web dashboard through which developers interact with GateWatch.

Responsibilities include:

- User interface
- Authentication interface
- API registration
- API configuration
- Monitoring dashboards
- Test configuration
- Test result visualization
- Request history

Technology:

- React
- Vite
- Tailwind CSS
- shadcn/ui

---

## 6.2 Backend / Gateway

The backend is the core application of GateWatch.

It exposes:

- Management APIs
- Gateway routes
- Testing functionality
- Monitoring functionality

It also communicates with PostgreSQL, Redis, upstream APIs and AWS services.

---

## 6.3 Control Plane

The Control Plane handles configuration and management.

Major responsibilities:

- User management
- API registration
- API configuration
- Authentication configuration
- Rate-limit configuration
- Test configuration
- Monitoring configuration
- Dashboard data
- Test history

---

## 6.4 Data Plane

The Data Plane handles live API traffic.

Major responsibilities:

- Receive requests
- Identify registered APIs
- Authenticate requests
- Apply rate limits
- Route requests
- Record request activity
- Return upstream responses
- Handle gateway errors

---

## 6.5 PostgreSQL

PostgreSQL stores persistent GateWatch data.

Examples include:

- Users
- Registered APIs
- API configurations
- Authentication configuration
- Rate-limit configuration
- Tests
- Test results
- Structured request history

Production PostgreSQL is hosted through Amazon RDS.

---

## 6.6 Redis

Redis provides fast temporary state.

The primary MVP use case is rate limiting.

Example:

```
API Key / Client
      ↓
Redis Counter
      ↓
Requests within configured window
      ↓
Allow / Reject
```

Redis is preferred for this workload because rate-limit counters require fast access and expiration through TTL.

---

## 6.7 Testing Engine

The Testing Engine allows developers to execute API tests from inside GateWatch.

A test can define:

- HTTP method
- Endpoint
- Headers
- Request body
- Expected status code
- Expected latency
- Basic response assertions

The engine stores test results for later viewing.

---

## 6.8 Monitoring and Logging

GateWatch collects information about API traffic and system activity.

Application-level monitoring includes:

- Request count
- Status codes
- Latency
- API health
- Failure information
- Request history

AWS CloudWatch is used for operational logs and infrastructure/application monitoring.

---

## 6.9 Alerting

The alerting component evaluates selected monitoring conditions and can trigger AWS SNS notifications.

Example:

```
API Health Check
      ↓
Failure detected
      ↓
Alert Rule
      ↓
SNS
      ↓
Notification
```

---

# 7. Component Responsibilities

| Component | Primary Responsibility |
| --- | --- |
| Frontend | Dashboard and user interaction |
| Auth | User authentication and authorization |
| User Management | User-related operations |
| API Management | Register and configure APIs |
| Gateway / Proxy | Receive and forward API requests |
| Authentication Middleware | Validate API access credentials |
| Rate Limiting | Enforce configured request limits |
| Request Router | Determine upstream destination |
| Monitoring | Collect request and system information |
| Health Monitoring | Check registered API availability |
| Testing Engine | Execute API tests |
| Alerting | Generate notifications from configured conditions |
| PostgreSQL | Persistent data storage |
| Redis | Fast temporary state and rate-limit counters |
| CloudWatch | Operational logs and metrics |
| SNS | Notification delivery |

---

# 8. Communication Between Components

### Frontend → Backend

The frontend communicates with the backend through HTTP/HTTPS APIs.

```
React Dashboard
      │
      │ HTTPS
      ▼
GateWatch Backend
```

Examples:

```
GET    /api/apis
POST   /api/apis
GET    /api/apis/:id
POST   /api/tests
GET    /api/monitoring
```

---

### Gateway → Upstream API

Gateway requests are forwarded to the registered upstream API.

```
Client
  │
  ▼
GateWatch
  │
  │ HTTP/HTTPS
  ▼
Upstream API
```

---

### Backend → PostgreSQL

The backend uses Knex to communicate with PostgreSQL.

```
Backend
   │
   │ Knex
   ▼
PostgreSQL
```

---

### Backend → Redis

Redis is used for fast temporary state and rate-limit counters.

```
Gateway
   │
   ▼
Redis
```

---

### Backend → CloudWatch

Operational logs and relevant application/infrastructure information are sent to CloudWatch.

---

### Backend → SNS

Configured alert conditions can result in notification events being sent through SNS.

---

# 9. Data Flow

GateWatch has two major data flows.

## 9.1 Configuration Data Flow

```
Developer
    ↓
Frontend
    ↓
Backend
    ↓
Validation
    ↓
PostgreSQL
    ↓
API Configuration Stored
```

Example:

```
Developer registers Product API
        ↓
Base URL stored
        ↓
Gateway path stored
        ↓
Authentication configuration stored
        ↓
Rate-limit configuration stored
        ↓
API becomes available through Gateway
```

---

## 9.2 Runtime Request Data Flow

```
Client
  ↓
GateWatch Gateway
  ↓
Authentication
  ↓
Rate Limiting
  ↓
Request Routing
  ↓
Upstream API
  ↓
Response
  ↓
GateWatch
  ↓
Client
```

During this process, request metadata is recorded for monitoring and history.

---

# 10. Request Flow

A typical request passes through the following stages.

```
1. Client sends request
          ↓
2. Gateway receives request
          ↓
3. Identify configured API
          ↓
4. Validate authentication
          ↓
5. Check rate limit
          ↓
6. Determine upstream route
          ↓
7. Forward request
          ↓
8. Receive upstream response
          ↓
9. Record request metadata
          ↓
10. Return response to client
```

### Example

Registered API:

```
Name: Product API
Base URL: http://product-api:3001
Gateway Path: /api/products
```

Client request:

```
GET /api/products
```

GateWatch internally forwards:

```
GET http://product-api:3001/products
```

The response is then returned through the gateway.

---

# 11. Deployment Architecture

The production architecture uses AWS services together with Docker.

```
                         Internet
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
       ┌──────────────┐            ┌──────────────┐
       │ CloudFront   │            │    EC2       │
       │              │            │              │
       │ S3 Frontend  │            │ Docker       │
       └──────┬───────┘            │              │
              │                    │ ┌──────────┐ │
              │                    │ │ GateWatch│ │
              │                    │ └──────────┘ │
              │                    │ ┌──────────┐ │
              │                    │ │ Product  │ │
              │                    │ │ Order    │ │
              │                    │ │ User API │ │
              │                    │ └──────────┘ │
              │                    │ ┌──────────┐ │
              │                    │ │  Redis   │ │
              │                    │ └──────────┘ │
              │                    └──────┬───────┘
              │                           │
              │                           ▼
              │                    ┌──────────────┐
              │                    │ RDS PostgreSQL│
              │                    └──────────────┘
              │
              └───────────────────────────────┐
                                              │
                                    ┌─────────▼────────┐
                                    │ CloudWatch / SNS │
                                    └──────────────────┘
```

### Production Components

| Component | AWS / Technology |
| --- | --- |
| Frontend | S3 |
| CDN | CloudFront |
| Backend/Gateway | EC2 + Docker |
| Demo APIs | EC2 + Docker |
| Redis | Docker on EC2 |
| Database | Amazon RDS PostgreSQL |
| Monitoring | CloudWatch |
| Alerts | SNS |
| CI/CD | GitHub Actions |

---

# 12. Architectural Principles

## 12.1 Modular Design

The backend is organized by feature rather than by a large collection of unrelated global layers.

Example:

```
backend/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── apis/
│   ├── gateway/
│   ├── monitoring/
│   ├── testing/
│   └── alerts/
├── middleware/
├── database/
└── server.js
```

---

## 12.2 Logical Separation of Control and Data Plane

Control and Data Plane responsibilities are separated conceptually even though they share the same backend deployment.

This provides clearer architecture and allows future separation if required.

---

## 12.3 Stateless Gateway Processing

The gateway should avoid depending on local process memory for important persistent state.

Persistent configuration belongs in PostgreSQL, while temporary high-speed state belongs in Redis.

---

## 12.4 Configuration-Driven Routing

The gateway should determine routing behavior from registered API configuration rather than hard-coded upstream destinations.

---

## 12.5 Observability by Design

Logging and monitoring are treated as core system capabilities rather than features added after implementation.

---

## 12.6 Incremental Complexity

Only components that provide clear value to the current project are introduced.

For example:

- Redis → included
- CloudWatch → included
- SNS → included
- Prometheus/Grafana → deferred
- Kubernetes → deferred
- SQS → future/optional

---

# 13. Architectural Constraints

The architecture is subject to the following constraints:

### Team Size

The system is being developed by a three-member student team.

### Project Duration

The initial implementation is constrained by the semester timeline.

### Infrastructure Budget

AWS usage must remain controlled to avoid unnecessary cloud costs.

### Deployment Complexity

The system should remain deployable without requiring Kubernetes or a large distributed infrastructure.

### Learning Objectives

The architecture should provide practical exposure to:

- API gateways
- Cloud infrastructure
- Docker
- CI/CD
- Databases
- Redis
- Monitoring
- AWS

### Resource Constraints

The system is designed for demonstration, development and academic workloads rather than large-scale production traffic.

---

# 14. Architectural Trade-offs

## 14.1 Modular Monolith vs Microservices

### Selected

Modular monolith.

### Reason

A microservice architecture would introduce additional networking, deployment, service discovery and operational complexity.

The modular monolith still provides clear internal boundaries while allowing the team to focus on the actual gateway and monitoring functionality.

### Trade-off

The system has less independent scalability than a true microservice architecture.

---

## 14.2 Node.js Gateway vs Nginx

### Selected

Node.js/Express-based gateway initially.

### Reason

It allows the team to implement and understand gateway functionality directly in the application's programming environment.

### Trade-off

A custom Node-based proxy may require more implementation effort than using a mature reverse proxy.

Nginx can be introduced later if gateway routing requirements become more complex.

---

## 14.3 Redis vs PostgreSQL for Rate Limiting

### Selected

Redis.

### Reason

Rate limiting requires frequent counter operations and expiration.

Redis provides suitable low-latency operations and TTL-based state.

### Trade-off

The architecture introduces another infrastructure dependency.

---

## 14.4 S3 + CloudFront vs Frontend on EC2

### Selected

S3 + CloudFront.

### Reason

The React application is a static build and does not require a continuously running server.

This reduces the workload on EC2 and provides CDN delivery.

### Trade-off

The deployment architecture contains more AWS services.

---

## 14.5 Custom Monitoring vs Prometheus/Grafana

### Selected

GateWatch monitoring + CloudWatch for the initial implementation.

### Reason

Prometheus and Grafana would introduce additional infrastructure and configuration.

The project can demonstrate monitoring concepts without immediately adding another monitoring stack.

### Trade-off

The initial monitoring system will not provide the depth of a dedicated observability stack.

---

## 14.6 EC2 + Docker vs ECS/Kubernetes

### Selected

EC2 + Docker.

### Reason

It provides direct exposure to:

- Linux
- Docker
- networking
- deployment
- cloud compute

while keeping the infrastructure manageable.

### Trade-off

Scaling and orchestration are more manual.

---

# 15. Future Architecture

The current architecture provides a foundation for future evolution.

Possible future architecture changes include:

### 15.1 Separate Gateway/Data Plane

The gateway could eventually be deployed independently from the Control Plane.

```
Control Plane
      │
      │ Configuration
      ▼
Data Plane
      │
      ▼
Upstream APIs
```

This would allow independent scaling of API traffic processing.

---

### 15.2 Multiple Gateway Instances

Multiple gateway instances could be placed behind a load balancer.

```
                  Load Balancer
                 /      |      \
                ▼       ▼       ▼
             Gateway Gateway Gateway
                \       |       /
                 \      |      /
                    APIs
```

---

### 15.3 Container Orchestration

The system could later migrate from EC2 Docker to:

- Amazon ECS
- AWS Fargate
- Kubernetes
- Amazon EKS

---

### 15.4 Advanced Observability

Future versions could introduce:

- Prometheus
- Grafana
- OpenTelemetry
- Distributed tracing
- Advanced metrics
- Log aggregation

---

### 15.5 Asynchronous Processing

AWS SQS could be introduced for operations that do not need to block the request path.

Potential examples:

- Large-scale test execution
- Scheduled health checks
- Alert processing
- Analytics processing

---

### 15.6 Advanced Gateway Features

Potential future features include:

- Response caching
- Retry policies
- Circuit breakers
- Request transformation
- OpenAPI import
- OAuth/JWT authentication
- Advanced analytics
- API version management

The architecture should evolve incrementally rather than introducing these components into the initial MVP.