# GateWatch — Technology Stack

## 1. Technology Summary

GateWatch uses a modern web and cloud-native technology stack focused on API gateway development, observability, containerization, CI/CD and AWS infrastructure.

| Layer | Technology |
| --- | --- |
| Frontend | React |
| Frontend Build Tool | Vite |
| UI Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Backend | Node.js + Express |
| API Gateway | Node.js HTTP proxy mechanism |
| Database | PostgreSQL |
| Database Access | Knex |
| Rate Limiting / Temporary State | Redis |
| Containerization | Docker |
| Local Orchestration | Docker Compose |
| Source Control | Git + GitHub |
| CI/CD | GitHub Actions |
| Cloud Compute | AWS EC2 |
| Production Database | Amazon RDS for PostgreSQL |
| Frontend Hosting | Amazon S3 |
| CDN | Amazon CloudFront |
| Monitoring | AWS CloudWatch |
| Notifications | AWS SNS |
| Async Processing | AWS SQS — Future/Optional |
| Reverse Proxy | Nginx — Optional/Future |

---

# 2. Frontend

## React

React is used to build the GateWatch dashboard.

Responsibilities include:

- User authentication interface
- API registration
- API configuration
- Monitoring dashboards
- Request history
- Test configuration
- Test results
- Alert configuration

React is suitable because the dashboard contains multiple interactive views and dynamically changing data.

---

## Vite

Vite is used as the frontend build tool.

Development:

```
React Source
     ↓
Vite Development Server
```

Production:

```
React Source
     ↓
npm run build
     ↓
dist/
     ↓
S3
     ↓
CloudFront
```

The production environment does not need to run the React development server.

---

## Tailwind CSS

Tailwind CSS provides utility-based styling for the dashboard.

It allows the interface to be developed without maintaining a large collection of custom CSS files.

---

## shadcn/ui

shadcn/ui is used for reusable interface components.

Potential components include:

- Buttons
- Forms
- Dialogs
- Tables
- Cards
- Tabs
- Dropdowns
- Alerts
- Navigation components

It is particularly useful for creating the administration and monitoring dashboard.

---

# 3. Backend API

## Node.js

Node.js is the runtime environment for the GateWatch backend.

It is used for:

- Management APIs
- Gateway request handling
- API routing
- Authentication
- Testing
- Monitoring
- Database interaction
- Redis interaction

Node.js is also used for the demonstration upstream APIs.

---

## Express

Express provides the HTTP application framework.

The backend is structured as a feature-based modular monolith.

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

This structure keeps related functionality together and allows individual modules to evolve independently within the same application.

---

## Gateway / Proxy

The gateway initially uses Node.js-based HTTP proxy functionality.

The gateway is responsible for:

- Receiving client requests
- Identifying the configured API
- Authentication
- Rate limiting
- Routing
- Forwarding requests
- Returning upstream responses
- Recording request information

Nginx remains an optional technology if the gateway later requires a dedicated reverse-proxy layer.

---

# 4. Database

## PostgreSQL

PostgreSQL is the primary relational database.

It stores persistent GateWatch state such as:

- Users
- Registered APIs
- API configurations
- Authentication configuration
- Rate-limit configuration
- Test definitions
- Test results
- Structured request history

Example request history structure:

```
id
api_id
method
route
status_code
latency_ms
timestamp
client_identifier
result
```

Full request and response bodies are not stored by default.

---

## Knex

Knex is used as the database query and migration layer.

Responsibilities include:

- SQL query construction
- Database migrations
- Seed data
- Transactions
- Database connection management

Knex is preferred for the project because it provides SQL-oriented control while remaining familiar to the development team.

---

## Amazon RDS for PostgreSQL

Production PostgreSQL is hosted on Amazon RDS.

The initial deployment is intended to use a small Single-AZ configuration suitable for development and demonstration workloads.

The architecture does not require:

- Multi-AZ deployment
- Provisioned IOPS
- Large storage capacity

Cost control is an important consideration when using RDS.

---

# 5. Container Runtime

## Docker

Docker is used to package GateWatch and its supporting applications into reproducible containers.

The local environment can contain:

```
Docker
├── GateWatch Backend
├── Product API
├── Order API
├── User API
├── Redis
└── PostgreSQL
```

Production EC2 can run:

```
Docker
├── GateWatch Backend
├── Product API
├── Order API
├── User API
└── Redis
```

PostgreSQL is moved to Amazon RDS in the production architecture.

---

## Docker Compose

Docker Compose is used for local multi-container development.

Example conceptual setup:

```
docker compose up

        │
        ├── gatewatch
        ├── product-api
        ├── order-api
        ├── user-api
        ├── redis
        └── postgres
```

This provides a reproducible development environment for the entire team.

---

# 6. Networking

## HTTP / HTTPS

HTTP and HTTPS are the primary communication protocols.

Examples:

```
Frontend → Backend
Gateway → Upstream API
Backend → AWS services
Backend → Database
```

HTTPS should be used for external production traffic.

---

## Gateway Routing

GateWatch exposes gateway routes that map public paths to registered upstream APIs.

Example:

```
/api/products
        ↓
Product API

/api/orders
        ↓
Order API

/api/users
        ↓
User API
```

The upstream destination is determined from API configuration stored by GateWatch.

---

## Internal Docker Networking

During local development and EC2 deployment, Docker networking allows containers to communicate using service/container names.

Example:

```
GateWatch
    │
    ├── http://product-api:3001
    ├── http://order-api:3002
    ├── http://user-api:3003
    └── redis:6379
```

---

# 7. External Integrations

## GitHub

GitHub provides:

- Source code hosting
- Version control
- Pull requests
- Collaboration
- Repository management

---

## GitHub Actions

GitHub Actions provides CI/CD automation.

The initial CI pipeline can perform:

```
Git Push
   ↓
GitHub Actions
   ├── Install dependencies
   ├── Lint
   ├── Unit Tests
   ├── Build
   ├── Docker Build
   └── API Tests
```

Deployment automation can be added after the core CI pipeline is stable.

---

## AWS CloudWatch

CloudWatch is used for operational monitoring.

Potential data includes:

- Application logs
- Gateway operational logs
- Application errors
- Infrastructure metrics
- Container/runtime information

GateWatch's PostgreSQL database and CloudWatch serve different purposes.

### PostgreSQL

Answers:

> What does GateWatch know about?
> 

Examples:

- Request history
- Registered APIs
- Tests
- Users

### CloudWatch

Answers:

> What is happening inside the running system?
> 

Examples:

- Runtime errors
- Application logs
- Infrastructure problems
- Operational events

---

## AWS SNS

SNS is used for alert notifications.

Example:

```
API health check fails
        ↓
GateWatch detects condition
        ↓
Alert rule triggered
        ↓
SNS
        ↓
Configured notification
```

The initial implementation focuses on simple alerting rather than a complex notification platform.

---

## AWS SQS

SQS is considered a future/optional integration.

It can later be used for asynchronous operations such as:

- Scheduled API testing
- Large-scale test execution
- Alert processing
- Analytics jobs

It is not required for the initial request path.

---

# 8. Authentication

GateWatch initially supports simple API authentication mechanisms.

## API Key Authentication

API keys can be used for gateway-protected APIs.

Example:

```
X-API-Key: <key>
```

GateWatch validates the key before forwarding the request.

Authentication configuration is associated with the registered API.

---

## Future Authentication

Future versions may support:

- JWT
- OAuth 2.0
- OpenID Connect
- More advanced API credential management

These are not required for the initial MVP.

---

# 9. Infrastructure

## AWS EC2

EC2 provides compute infrastructure for:

- GateWatch backend
- Gateway
- Demonstration APIs
- Redis

Docker runs on the EC2 instance.

The initial deployment intentionally uses a simple EC2-based architecture rather than Kubernetes or ECS.

---

## Amazon RDS

RDS hosts the production PostgreSQL database.

Advantages for this project include:

- Managed PostgreSQL
- Automated infrastructure management
- Separation from the EC2 host
- Easier database lifecycle management

The initial configuration prioritizes low cost over high availability.

---

## Amazon S3

S3 hosts the compiled React frontend.

Deployment:

```
npm run build
      ↓
dist/
      ↓
S3 Bucket
```

---

## Amazon CloudFront

CloudFront delivers the frontend through a CDN.

```
User
  ↓
CloudFront
  ↓
S3
```

This keeps the static frontend separate from the backend compute infrastructure.

---

## AWS CloudWatch

CloudWatch provides operational monitoring and logs.

---

## AWS SNS

SNS provides alert notification delivery.

---

# 10. Development Environment

The local development environment should closely reproduce the application's production dependencies without requiring every AWS service locally.

### Local Architecture

```
Developer Machine
        │
        ▼
Docker Compose
        │
        ├── React/Vite
        ├── GateWatch Backend
        ├── Product API
        ├── Order API
        ├── User API
        ├── Redis
        └── PostgreSQL
```

The frontend may also be run directly using the Vite development server during UI development.

---

# 11. Development Tools

## Git

Git provides version control.

---

## GitHub

GitHub provides:

- Repository hosting
- Branch management
- Pull requests
- Code review
- Issue tracking
- GitHub Actions

---

## GitHub Actions

Used for automated validation and CI/CD workflows.

---

## Postman

Postman can be used during development to manually test:

- Gateway routes
- Management APIs
- Authentication
- Error responses
- Upstream routing

GateWatch's own Testing Engine remains part of the actual project functionality and is not intended to simply replace Postman.

---

## Docker Desktop

Docker Desktop can be used during local development to run the containerized stack.

---

## VS Code

Visual Studio Code can be used as the primary development environment.

---

# 12. Future Technologies

The following technologies are potential future additions rather than MVP requirements.

## Prometheus

Could provide dedicated metrics collection.

## Grafana

Could provide advanced monitoring dashboards.

## OpenTelemetry

Could provide distributed tracing and standardized telemetry.

## AWS SQS

Could provide asynchronous processing.

## ECS / Fargate

Could replace direct EC2 container management.

## Kubernetes / EKS

Could be considered for large-scale orchestration.

## Nginx

Could be introduced as a dedicated reverse proxy or edge layer.

## OpenAPI

Could be integrated for API import, validation and documentation.

## OAuth / JWT

Could provide more advanced authentication options.

---

# 13. Technology Selection Philosophy

Technology selection follows five principles.

## 13.1 Simplicity

The project should not introduce infrastructure that does not provide meaningful value.

---

## 13.2 Learning Value

Technologies should expose the team to concepts relevant to the project's objectives:

- Cloud computing
- API gateways
- Containerization
- Databases
- Redis
- CI/CD
- Monitoring
- AWS

---

## 13.3 Practicality

The selected technologies should be realistic enough to demonstrate an actual deployable system while remaining achievable within the semester.

---

## 13.4 Clear Responsibility

Each technology should have a defined purpose.

For example:

```
PostgreSQL → Persistent application data
Redis      → Fast temporary state
CloudWatch → Operational monitoring
SNS        → Notifications
S3         → Static frontend hosting
CloudFront → CDN delivery
EC2        → Application compute
Docker     → Containerization
```

---

## 13.5 Future Extensibility

The initial stack should not prevent future migration to more advanced infrastructure.

For example:

```
EC2 + Docker
      ↓
ECS / Fargate
      ↓
Kubernetes / EKS
```

The initial architecture therefore prioritizes a stable foundation rather than premature infrastructure complexity.

---

# 14. Technology Alternatives Considered

| Area | Selected | Alternative | Reason for Selection |
| --- | --- | --- | --- |
| Frontend | React | Vue / Angular | Familiar ecosystem and suitable for dashboards |
| Build Tool | Vite | Webpack | Simpler modern frontend workflow |
| Styling | Tailwind CSS | Bootstrap | Flexible utility-based styling |
| UI Components | shadcn/ui | Material UI | Preferred control over dashboard components |
| Backend | Node.js + Express | FastAPI / Spring Boot | Team familiarity and JavaScript ecosystem |
| Database | PostgreSQL | MySQL | Strong relational features and existing familiarity |
| Query Layer | Knex | Prisma | More direct SQL/query control and team familiarity |
| Temporary State | Redis | PostgreSQL | Better suited to high-frequency counters and TTL |
| Gateway | Node Proxy | Nginx | Greater implementation control and learning value initially |
| Containers | Docker | Direct deployment | Reproducibility and deployment consistency |
| Local Orchestration | Docker Compose | Kubernetes | Lower complexity for local development |
| Compute | EC2 | ECS / EKS | Simpler initial cloud deployment |
| Database Hosting | RDS | PostgreSQL on EC2 | Managed database and reduced DB administration |
| Frontend Hosting | S3 + CloudFront | EC2 | Static hosting and CDN delivery |
| Monitoring | CloudWatch + GateWatch | Prometheus + Grafana | Lower initial infrastructure complexity |
| Alerts | SNS | Custom notification service | Managed AWS notification capability |
| CI/CD | GitHub Actions | Jenkins | Integrated with GitHub and easier to manage |
| Async Processing | SQS — Future | Immediate processing | Not required for MVP |

---

# Final Stack

The initial GateWatch stack can therefore be summarized as:

```
                    ┌───────────────────────────┐
                    │         Frontend           │
                    │ React + Vite              │
                    │ Tailwind + shadcn/ui      │
                    └─────────────┬─────────────┘
                                  │
                         S3 + CloudFront
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │       GateWatch Backend    │
                    │ Node.js + Express          │
                    │                            │
                    │ API Gateway                │
                    │ Control Plane               │
                    │ Data Plane                  │
                    │ Testing Engine              │
                    │ Monitoring                  │
                    └───────┬─────────┬──────────┘
                            │         │
                     ┌──────▼───┐ ┌──▼───────┐
                     │PostgreSQL│ │  Redis   │
                     │  RDS     │ │          │
                     └──────────┘ └──────────┘

                         AWS EC2 + Docker

                    ┌───────────────────────────┐
                    │       AWS Services        │
                    │                           │
                    │ CloudWatch → Monitoring   │
                    │ SNS        → Alerts       │
                    │ SQS        → Future       │
                    └───────────────────────────┘

                    GitHub + GitHub Actions
                           ↓
                    CI/CD Automation
```

This stack intentionally keeps the MVP relatively compact while giving GateWatch exposure to **API gateway architecture, cloud infrastructure, containerization, CI/CD, databases, caching/rate limiting, monitoring and AWS services**.