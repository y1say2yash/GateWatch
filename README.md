# GateWatch

> **An API Gateway and Monitoring Platform that sits between clients and APIs to control, secure, observe, and validate API traffic.**

GateWatch is a lightweight, self-hosted API Gateway and Monitoring Platform designed to provide a centralized layer for managing, routing, securing, testing, and monitoring APIs.

The project is being developed as a semester-long team project with a focus on **API gateway architecture, cloud computing, containerization, CI/CD, monitoring, and AWS infrastructure**.

---

## Overview

Modern applications often expose multiple APIs that need common capabilities such as:

* Authentication
* Rate limiting
* Request routing
* Health checks
* Request logging
* Monitoring
* API testing
* Alerting

Instead of implementing these capabilities independently for every API, GateWatch provides a centralized layer between clients and upstream APIs.

```text
Client
   │
   ▼
┌──────────────────────────┐
│        GateWatch         │
│                          │
│ API Gateway              │
│ Authentication           │
│ Rate Limiting            │
│ Monitoring               │
│ Testing                  │
│ Health Checks            │
│ Alerting                 │
└────────────┬─────────────┘
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
   Product Order  User
     API    API   API
```

---

# Core Features

The initial MVP focuses on the following capabilities:

### API Gateway

* Register existing APIs
* Configure gateway routes
* Route incoming requests to upstream APIs
* Centralize API access

### Authentication

* API key-based authentication
* Configurable authentication requirements for registered APIs

### Rate Limiting

* Per-API rate-limit configuration
* Redis-backed request counters
* Protection against excessive requests

### Monitoring

* Request history
* Response status tracking
* Request latency
* API health monitoring
* Gateway activity

### API Testing

* Execute API requests
* Configure basic assertions
* Validate status codes
* Validate response latency
* Inspect test results
* Maintain test history

### Alerting

* Detect configured monitoring conditions
* Send notifications using AWS SNS

### DevOps & Cloud

* Docker-based development and deployment
* GitHub Actions CI/CD
* AWS EC2
* Amazon RDS PostgreSQL
* Amazon S3
* Amazon CloudFront
* AWS CloudWatch
* AWS SNS

---

# Architecture

GateWatch follows a **modular monolith architecture** with a conceptual separation between the **Control Plane** and **Data Plane**.

```text
                    ┌──────────────────────┐
                    │      Developer       │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │    GateWatch UI      │
                    │ React + Vite         │
                    └──────────┬───────────┘
                               │
                               ▼
             ┌─────────────────────────────────┐
             │        GateWatch Backend        │
             │                                 │
             │  ┌────────────┐ ┌────────────┐ │
             │  │ Control    │ │ Data       │ │
             │  │ Plane      │ │ Plane      │ │
             │  │            │ │            │ │
             │  │ API Config │ │ Gateway    │ │
             │  │ Users      │ │ Auth       │ │
             │  │ Testing    │ │ Rate Limit │ │
             │  │ Monitoring │ │ Routing    │ │
             │  └────────────┘ └─────┬──────┘ │
             └──────────────┬────────┼────────┘
                            │        │
                       ┌────┘        └──────────┐
                       ▼                         ▼
                PostgreSQL                    Redis
                    RDS
                                                │
                                                ▼
                                      ┌──────────────────┐
                                      │  Registered APIs │
                                      │                  │
                                      │ Product / Order  │
                                      │ / User           │
                                      └──────────────────┘
```

The Control Plane and Data Plane are **logical boundaries within the same backend application**. They are not separate microservices in the initial architecture.

---

# Technology Stack

| Layer               | Technology                |
| ------------------- | ------------------------- |
| Frontend            | React                     |
| Build Tool          | Vite                      |
| Styling             | Tailwind CSS              |
| UI Components       | shadcn/ui                 |
| Backend             | Node.js + Express         |
| Database            | PostgreSQL                |
| Database Layer      | Knex                      |
| Rate Limiting       | Redis                     |
| Containerization    | Docker                    |
| Local Orchestration | Docker Compose            |
| Source Control      | Git + GitHub              |
| CI/CD               | GitHub Actions            |
| Cloud Compute       | AWS EC2                   |
| Production Database | Amazon RDS PostgreSQL     |
| Frontend Hosting    | Amazon S3                 |
| CDN                 | Amazon CloudFront         |
| Monitoring          | AWS CloudWatch            |
| Alerts              | AWS SNS                   |
| Async Processing    | AWS SQS — Future/Optional |

---

# Repository Structure

```text
gatewatch/
│
├── docs/                 # Project documentation
│
├── frontend/             # React frontend
│
├── backend/              # GateWatch backend and gateway
│
├── services/             # Lightweight demo upstream APIs
│   ├── product-api/
│   ├── order-api/
│   └── user-api/
│
├── database/             # Database migrations, seeds and scripts
│
├── infrastructure/       # Deployment and infrastructure configuration
│   ├── docker/
│   ├── aws/
│   └── nginx/
│
├── tests/                # Integration and end-to-end tests
│
├── scripts/              # Development/automation scripts
│
├── .github/              # GitHub Actions and repository configuration
│
├── docker-compose.yml     # Local development environment
├── .env.example           # Environment variable template
├── .gitignore
├── LICENSE
└── README.md
```

---

# Documentation

The project documentation is maintained separately from the implementation and acts as the project's architectural source of truth.

See:

**[`docs/`](./docs/)**

Documentation is organized into four phases:

### 🟢 Phase 1 — Project Foundation

Project identity and architectural foundation.

* Project Vision
* Project Scope
* System Architecture
* Technology Stack

### 🔵 Phase 2 — System Specification

Detailed system behavior and contracts.

* Functional Requirements
* System Design
* Data Model
* API Design
* User Flows

### 🟡 Phase 3 — Engineering Documentation

Development and operational practices.

* Development Guide
* Security
* Testing Strategy
* Deployment
* Observability

### 🟣 Phase 4 — Project Memory & Evolution

Long-term project knowledge.

* Architecture Decisions
* Project Roadmap
* Known Issues
* Future Enhancements
* Research Notes
* Glossary

---

# Development Philosophy

GateWatch prioritizes **practicality, simplicity, and incremental complexity**.

The project intentionally avoids introducing infrastructure that is not required by the current scope.

For example:

* Modular monolith instead of microservices
* EC2 + Docker instead of Kubernetes
* CloudWatch instead of a dedicated Prometheus/Grafana stack initially
* Redis only where fast temporary state is required
* RDS for managed production PostgreSQL
* SQS as a future/optional component

The architecture can evolve as the project grows.

---

# Local Development

The local environment is designed around Docker.

The intended local stack includes:

```text
Docker Compose
│
├── GateWatch Backend
├── React Frontend
├── Product API
├── Order API
├── User API
├── Redis
└── PostgreSQL
```

Detailed setup instructions will be added to the project documentation as development begins.

---

# CI/CD

GitHub Actions will be used to automate project validation and CI/CD.

The initial pipeline is expected to include:

```text
Git Push
   │
   ▼
GitHub Actions
   ├── Install Dependencies
   ├── Lint
   ├── Unit Tests
   ├── Build
   ├── Docker Build
   └── API / Integration Tests
```

Deployment automation will be introduced after the core application and CI pipeline are stable.

---

# Project Boundaries

GateWatch is **not intended to be**:

* A replacement for AWS API Gateway
* A full enterprise API management platform
* A Postman replacement
* A PaaS
* A Kubernetes management platform
* An API marketplace
* An API monetization platform
* A source-code hosting/build platform

The project focuses specifically on combining **API gateway functionality, monitoring, testing, security controls, and cloud deployment** into a manageable platform.

---

# Project Status

**Current Stage:** Project Foundation

The initial project documentation has been completed:

* [x] Project Vision
* [x] Project Scope
* [x] System Architecture
* [x] Technology Stack

The next stage is **System Specification**, where the functional requirements, data model, API contracts, and user flows will be defined before major implementation begins.

---

# Team

GateWatch is developed as a collaborative academic project.

Team members, responsibilities, and contribution details can be added here once finalized.

---

# License

This project is licensed under the **MIT License**.

See [`LICENSE`](./LICENSE) for details.
