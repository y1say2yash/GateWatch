# GateWatch — Development Guide

## 1. Purpose

This document defines the standard development environment, repository structure, local setup, development workflow, Git workflow, coding conventions, debugging practices, and AWS review workflow for GateWatch.

Local development is the default development environment. AWS infrastructure is used primarily for staging, review, testing, and final demonstration.

---

# 2. Prerequisites

The following tools are required for GateWatch development:

- Git
- Docker Desktop
- Docker Compose
- Node.js LTS
- npm
- VS Code
- GitHub account
- AWS CLI for AWS/staging/deployment work
- Appropriate AWS access for the GateWatch project

Node.js dependencies should use the current compatible versions available through npm when dependencies are added.

### AWS Access

The project has AWS access for:

- EC2
- RDS PostgreSQL
- S3
- CloudFront
- CloudWatch
- SNS

Actual AWS usernames, passwords, access keys, and secret keys must never be committed to the repository or documented in project files.

---

# 3. Repository Structure

GateWatch uses a monorepo structure.

```
gatewatch/
├── frontend/
├── backend/
├── services/
│   ├── product-api/
│   ├── order-api/
│   └── user-api/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── scripts/
├── infrastructure/
│   ├── docker/
│   ├── aws/
│   └── nginx/
├── tests/
├── scripts/
├── docs/
├── .github/
│   └── workflows/
├── docker-compose.yml
├── .env
├── .env.example
├── .gitignore
├── LICENSE
└── README.md
```

The repository contains the application, supporting demo APIs, database management, infrastructure configuration, scripts, tests, and documentation in one project.

---

## 3.1 Frontend Structure

```
frontend/
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   └── common/
│   ├── features/
│   │   ├── auth/
│   │   ├── projects/
│   │   ├── apis/
│   │   ├── gateway/
│   │   ├── monitoring/
│   │   ├── testing/
│   │   ├── alerts/
│   │   └── settings/
│   ├── pages/
│   ├── hooks/
│   ├── lib/
│   ├── services/
│   ├── types/
│   ├── routes/
│   ├── App.tsx
│   └── main.tsx
├── public/
├── Dockerfile
├── package.json
└── ...
```

The frontend follows a feature-oriented structure.

Feature-specific UI, logic, types, and supporting code should remain within the appropriate feature module where practical.

Reusable components belong in `components/`.

---

## 3.2 Backend Structure

GateWatch uses a modular monolith architecture.

```
backend/
├── src/
│   ├── auth/
│   ├── users/
│   ├── projects/
│   ├── apis/
│   ├── gateway/
│   ├── routes/
│   ├── rate-limiting/
│   ├── tests/
│   ├── monitoring/
│   ├── health/
│   ├── alerts/
│   ├── logs/
│   ├── admin/
│   ├── config/
│   ├── database/
│   ├── middleware/
│   ├── utils/
│   ├── app.ts
│   └── server.ts
├── tests/
├── Dockerfile
├── package.json
└── ...
```

Each major backend feature should remain logically separated even though all modules run within the same backend application.

### Feature Module Structure

Where applicable, backend modules should follow a consistent structure:

```
apis/
├── api.controller.ts
├── api.service.ts
├── api.repository.ts
├── api.routes.ts
├── api.validation.ts
└── api.types.ts
```

Not every module must contain every file. The structure should reflect the actual responsibilities of the module.

---

# 4. Local Development Environment

Docker Compose is the official GateWatch development environment.

The local architecture is:

```
Browser
   ↓
Nginx
   ├──→ Frontend
   └──→ Backend
          ├──→ PostgreSQL
          ├──→ Redis
          └──→ GitHub API

Backend / Gateway
   ↓
Demo APIs
```

The MVP local environment contains:

```
nginx
frontend
backend
postgres
redis
product-api
order-api
user-api
```

No additional application services are required for the MVP.

---

# 5. Local URLs

The standard local endpoints are:

```
GateWatch:
<http://localhost>

Backend API:
<http://localhost/api>

GitHub OAuth callback:
<http://localhost/api/v1/auth/github/callback>
```

Demo APIs use separate local ports:

```
Product API:
<http://localhost:3001>

Order API:
<http://localhost:3002>

User API:
<http://localhost:3003>
```

The exact demo API endpoints may evolve during implementation, but their purpose remains to provide controlled upstream APIs for gateway, testing, monitoring, and failure scenarios.

---

# 6. Environment Variables

GateWatch uses a root `.env` file for local environment configuration.

The repository contains:

```
.env
.env.example
```

### `.env`

Contains local development configuration and secrets.

It must:

- Remain local.
- Never be committed.
- Never contain production credentials in committed documentation.
- Never be pushed to GitHub.

### `.env.example`

Contains variable names and safe placeholder values.

It is committed to the repository so that developers can understand the required configuration.

### Environment Variable Categories

Variables should be organized according to their purpose, including:

```
Application
Database
Redis
GitHub OAuth
AWS
Notifications
```

Actual secret values must never be placed in `.env.example`.

---

# 7. Dependency Installation

Frontend and backend dependencies use npm.

After cloning the repository:

```bash
cd frontend
npm install
```

```bash
cd ../backend
npm install
```

The corresponding `package-lock.json` files must be committed to Git.

Dependencies should be added using npm rather than manually editing package manifests whenever possible.

---

# 8. Running the Project

Docker Compose is the standard way to run GateWatch locally.

Build and start the complete development environment:

```bash
docker compose up --build
```

After the environment is running:

```
<http://localhost>
```

can be used to access GateWatch.

To stop the development environment:

```bash
docker compose down
```

### Removing Persistent Volumes

```bash
docker compose down -v
```

This removes Docker volumes associated with the Compose environment and can destroy persisted local PostgreSQL data.

Use this command deliberately.

---

# 9. Running Individual Services

Individual services can be started through Docker Compose when needed.

Examples:

```bash
docker compose up frontend
```

```bash
docker compose up backend
```

```bash
docker compose up postgres
```

```bash
docker compose up redis
```

```bash
docker compose up product-api
```

```bash
docker compose up order-api
```

```bash
docker compose up user-api
```

```bash
docker compose up nginx
```

Multiple services can also be started together when required.

Docker Compose remains the documented standard.

Running Node.js directly on the host is allowed for troubleshooting or isolated debugging when necessary, but it is not the standard development workflow.

---

# 10. Live Reload

Frontend and backend development containers support live reload.

The standard development workflow is:

```
Edit Source Code
      ↓
Source Mounted into Container
      ↓
Development Server Detects Change
      ↓
Application Reloads
```

Normal source-code changes should therefore not require repeatedly stopping and rebuilding the entire Docker environment.

A full rebuild should be performed when required by changes such as:

- Dependency changes
- Dockerfile changes
- Compose configuration changes
- Base image changes
- Other container-level configuration changes

---

# 11. Database Setup

GateWatch uses PostgreSQL for persistent application data.

### Local Environment

```
Backend
   ↓
Local PostgreSQL Docker Container
```

### AWS Environment

```
Backend on EC2
   ↓
RDS PostgreSQL
```

Local PostgreSQL and AWS RDS PostgreSQL are separate environments.

There is no automatic synchronization or migration of development data from local PostgreSQL to RDS.

Database migrations must be applied independently to each environment.

---

# 12. Migrations

GateWatch uses Knex migrations.

Database schema changes must be implemented through migrations.

Standard commands:

```bash
npm run db:migrate
```

```bash
npm run db:rollback
```

```bash
npm run db:status
```

Migrations should:

- Be deterministic.
- Be committed to Git.
- Follow migration ordering.
- Avoid modifying migrations that have already been applied.
- Be tested locally before being applied to another environment.

A migration that changes an existing database contract should be reviewed alongside the affected system design and API requirements.

---

# 13. Seed Data

Development seeds are used only for controlled development and demonstration data.

Seed data may include:

- Demo projects
- Demo APIs
- Demo routes
- Demo rate-limit configuration
- Demo health-check configuration
- Demo tests
- Other data required for controlled demo APIs

Seeds must not create fake GateWatch users.

GateWatch users authenticate through GitHub OAuth.

The initial Admin is established through a controlled configuration based on the designated GitHub identity. The exact bootstrap mechanism is finalized during implementation.

Seeds must never contain:

- Real production credentials
- Real API keys
- Real access tokens
- Real user sessions
- AWS secret credentials

---

# 14. Docker Setup

Docker is the standard local development runtime.

Docker Compose manages:

- Service startup
- Service networking
- Environment configuration
- Persistent PostgreSQL storage
- Redis
- Development dependencies
- Local demo APIs

Common commands:

```bash
docker compose up --build
```

```bash
docker compose down
```

```bash
docker compose ps
```

```bash
docker compose logs -f <service>
```

Example:

```bash
docker compose logs -f backend
```

```bash
docker compose logs -f frontend
```

```bash
docker compose logs -f postgres
```

---

# 15. Development Workflow

The standard feature-development workflow is:

```
Understand Requirement
        ↓
Check Existing Architecture and Documentation
        ↓
Create Feature Branch
        ↓
Implement Feature
        ↓
Run Locally
        ↓
Run Lint / Format Checks
        ↓
Run Tests
        ↓
Verify Database Migrations if Applicable
        ↓
Review Git Diff
        ↓
Commit Changes
        ↓
Push Branch
        ↓
Open Pull Request
        ↓
Code Review
        ↓
Approval
        ↓
Merge into main
```

Development should normally happen locally.

AWS should only be used when required for staging, review, deployment testing, or final demonstration.

---

# 16. Git Workflow

GateWatch uses branch-based development.

Direct development on `main` is not permitted.

Every feature, fix, documentation change, or other meaningful change should be developed in its own branch.

### Standard Workflow

```bash
git checkout main
git pull
```

Create a branch:

```bash
git checkout -b feature/api-registration
```

Make changes and review them:

```bash
git status
git diff
```

Commit:

```bash
git add .
git commit -m "feat: add API registration"
```

Push:

```bash
git push -u origin feature/api-registration
```

Then create a Pull Request into `main`.

---

# 17. Branching Strategy

The repository uses a simple branch model:

```
main
  └── feature/*
```

No long-lived `develop` branch is required.

Examples:

```
feature/api-registration
feature/gateway-routing
feature/rate-limiting
feature/monitoring-dashboard
fix/upstream-timeout
fix/oauth-callback
docs/development-guide
```

Branches should be focused on a specific change rather than containing unrelated work.

---

# 18. Protected Main Branch

`main` is the shared stable branch.

Team members should not directly push changes to `main`.

Changes should follow:

```
Feature Branch
      ↓
Pull Request
      ↓
Code Review
      ↓
Approval
      ↓
Merge
      ↓
main
```

At least one teammate approval should be required before merging.

Repository maintainers should control the final merge permission.

This ensures that the team develops independently while maintaining a reviewed `main` branch.

---

# 19. Commit Conventions

GateWatch uses Conventional Commits.

Examples:

```
feat: add API registration
```

```
fix: handle upstream timeout
```

```
refactor: simplify route resolver
```

```
docs: update development guide
```

```
test: add gateway route tests
```

```
chore: update dependencies
```

Common commit types:

```
feat
fix
refactor
docs
test
chore
```

Commits should describe one logical change whenever practical.

---

# 20. Pull Request Guidelines

Every Pull Request should include:

- Clear title.
- Description of what changed.
- Important implementation decisions.
- Testing performed.
- Relevant database changes.
- Relevant documentation changes.
- Any known limitations or follow-up work.

Before requesting review:

```
[ ] Feature works locally
[ ] Tests pass
[ ] Lint / format checks pass
[ ] Database migrations verified
[ ] No secrets committed
[ ] No unnecessary debug code
[ ] Git diff reviewed
[ ] Documentation updated where required
```

Reviewers should verify that the implementation follows the existing architecture and system specification.

---

# 21. Code Style

GateWatch uses:

- TypeScript
- ESLint
- Prettier

Frontend and backend code should follow the configured linting and formatting rules.

Formatting should be automated where possible rather than manually maintained.

Code should prioritize:

- Clear responsibilities
- Small focused modules
- Consistent error handling
- Reusable logic
- Explicit validation
- Existing architectural boundaries

---

# 22. Naming Conventions

### TypeScript

Variables and functions:

```
camelCase
```

Examples:

```
projectId
getProject()
createApi()
```

Types, interfaces, classes, and React components:

```
PascalCase
```

Examples:

```
Project
ApiConfiguration
GatewayService
ProjectCard
```

Constants that represent fixed configuration values may use:

```
UPPER_SNAKE_CASE
```

Example:

```
DEFAULT_TIMEOUT_MS
```

### Database

Tables:

```
snake_case
```

and plural where appropriate.

Examples:

```
users
projects
api_routes
request_history
```

Columns:

```
snake_case
```

Examples:

```
user_id
created_at
health_status
```

### React

React components use PascalCase.

Examples:

```
Dashboard
ApiDetails
ProjectCard
RouteForm
```

### API Routes

API paths should follow the conventions defined in `07-api-design.md`.

---

# 23. Debugging

### Frontend

Use browser developer tools for:

- Console errors
- Network requests
- Request/response inspection
- Authentication/session issues
- Frontend state problems

### Backend

Use:

```bash
docker compose logs -f backend
```

for live backend logs.

Backend debugging should also use:

- Application logs
- Request information
- Error stack traces in development
- Debugger when necessary

### Database

Useful checks include:

- PostgreSQL container logs
- Knex migration status
- SQL inspection
- Database client tools when required

### Redis

Use:

```bash
docker compose logs -f redis
```

and Redis CLI when required.

### Docker

Useful commands:

```bash
docker compose ps
```

```bash
docker compose logs -f <service>
```

```bash
docker inspect <container>
```

---

# 24. Common Development Problems

The following are general GateWatch troubleshooting cases.

### Port Already in Use

Check which service is using the required port and stop the conflicting process or change the local configuration where appropriate.

### Container Fails to Start

Check:

```bash
docker compose ps
```

and:

```bash
docker compose logs -f <service>
```

### PostgreSQL Unavailable

Verify that the PostgreSQL container is running:

```bash
docker compose ps postgres
```

Then inspect:

```bash
docker compose logs -f postgres
```

### Redis Unavailable

Verify:

```bash
docker compose ps redis
```

and:

```bash
docker compose logs -f redis
```

### Migration Failure

Check:

- Database connectivity
- Migration ordering
- Migration status
- Previous migration state
- Migration SQL

Do not modify an already-applied migration to correct a production/staging schema. Create a new migration where appropriate.

### Missing Environment Variable

Compare `.env` against `.env.example`.

Do not copy real secrets into `.env.example`.

### GitHub OAuth Callback Failure

Verify:

- GitHub OAuth application configuration
- Callback URL
- Local environment variables
- Backend route
- Browser session configuration

### Docker Compose Networking Issue

Verify:

```bash
docker compose ps
```

and ensure services use the appropriate Compose service names rather than incorrectly assuming host-local networking.

### Frontend Cannot Reach Backend

Check:

- Nginx configuration
- Backend container status
- Backend logs
- Browser Network tab
- API URL configuration

### AWS CLI Authentication Failure

Verify:

```bash
aws sts get-caller-identity --profile gatewatch
```

Then verify:

- AWS CLI profile
- Access permissions
- Region
- Credential validity

---

# 25. Adding a New Feature

New features should follow the existing system specification and architecture.

```
Understand Requirement
        ↓
Check Existing Architecture / Documentation
        ↓
Determine Required Design Changes
        ↓
Update Specification if Required
        ↓
Create Database Migration if Required
        ↓
Implement Backend
        ↓
Implement Frontend
        ↓
Add / Update Tests
        ↓
Run Locally
        ↓
Update Documentation if Required
        ↓
Review Git Diff
        ↓
Commit
```

If implementation changes an already-defined contract, the relevant specification must be updated before or alongside the implementation.

The specification should not be left describing behavior that the implementation no longer follows.

Examples of contracts that may require specification updates:

- API endpoints
- Request/response formats
- Database entities
- Resource lifecycle
- Authentication behavior
- Gateway routing behavior
- Error behavior
- User flows

---

# 26. Definition of Done

A feature is considered complete when:

- [ ]  Requirement is implemented.
- [ ]  Existing architecture and design are followed.
- [ ]  Database changes are migrated if required.
- [ ]  API behavior is implemented.
- [ ]  Frontend behavior is implemented where applicable.
- [ ]  Validation and error handling are implemented.
- [ ]  Tests are added or updated where applicable.
- [ ]  Local Docker environment is verified.
- [ ]  No secrets or unnecessary debug code are committed.
- [ ]  Lint and format checks pass.
- [ ]  Git diff has been reviewed.
- [ ]  Documentation is updated if behavior changed.
- [ ]  Conventional Commit is created.
- [ ]  Pull Request is opened.
- [ ]  Required code review is completed.
- [ ]  PR is approved before merging into `main`.

---

# 27. AWS Development and Review Environments

Local development is the default environment.

AWS is used when the project needs to demonstrate or verify cloud deployment and AWS integrations.

The project uses three environment configurations:

```
local
staging
deployment
```

### Local

Used for normal development.

```
Docker Compose
    ↓
Local Services
```

### Staging

AWS-based environment used for development/review testing before final demonstration.

```
AWS Infrastructure
    ↓
Staging GateWatch
```

### Deployment

AWS environment used for the final demonstrated deployment.

```
AWS Infrastructure
    ↓
Final GateWatch Deployment
```

The exact resource configuration may differ between staging and deployment while following the same overall architecture.

---

# 28. AWS Architecture for Review

The AWS deployment follows the system architecture defined in `02-system-architecture.md`.

### Frontend

```
Frontend
   ↓
S3
   ↓
CloudFront
   ↓
Browser
```

### Backend

```
Backend
   ↓
EC2
```

### Database

```
EC2
   ↓
RDS PostgreSQL
```

### Runtime / Monitoring

```
EC2
 ├── Redis
 ├── CloudWatch
 └── SNS
```

CloudFront provides the public frontend distribution and routes API requests toward the backend infrastructure according to the deployment configuration.

---

# 29. AWS CLI Configuration

AWS operations should use the AWS CLI with a dedicated local profile.

Example:

```bash
aws configure --profile gatewatch
```

The project uses the profile:

```
gatewatch
```

The profile is a local AWS CLI configuration and is not an AWS account username.

AWS credentials should never be committed to Git.

Verify the configured identity with:

```bash
aws sts get-caller-identity --profile gatewatch
```

AWS commands should explicitly use the GateWatch profile where appropriate:

```bash
aws <service> <command> --profile gatewatch
```

The configured region for GateWatch is:

```
ap-south-1
```

---

# 30. AWS Resource Access

The development/review AWS credentials have access to the services required by the project:

```
EC2
RDS PostgreSQL
S3
CloudFront
CloudWatch
SNS
```

The development guide documents the services and their intended purpose, but never stores the actual account credentials.

Access should follow the permissions provided by the AWS account administrator.

---

# 31. AWS Lifecycle Management

AWS is not intended to run continuously during normal GateWatch development.

The AWS lifecycle scripts are intended to minimize ongoing AWS costs by stopping, disabling, or removing resources that incur runtime charges when they are not required.

AWS services have different lifecycle and billing models, so resources must be handled individually rather than assuming every service can simply be stopped.

Resource-specific cleanup procedures should therefore be used.

The intended lifecycle is:

```
Normal Development
        ↓
Local Docker Environment
        ↓
AWS Required for Review
        ↓
Prepare Review Environment
        ↓
Deploy + Verify
        ↓
Conduct Review
        ↓
Resource-Specific Cleanup
        ↓
Verify Ongoing Costs Are Minimized
```

---

# 32. AWS Lifecycle Scripts

AWS lifecycle operations will be centralized through:

```
scripts/aws.sh
```

The planned commands are:

```bash
./scripts/aws.sh start
```

Prepares the required AWS review environment.

```bash
./scripts/aws.sh review
```

Deploys and verifies the review environment once deployment automation is implemented.

```bash
./scripts/aws.sh status
```

Checks the state of relevant AWS resources.

```bash
./scripts/aws.sh stop
```

Stops, disables, or removes resources where appropriate and verifies that ongoing-cost resources are minimized.

```
./scripts/aws.sh start
        ↓
Prepare review environment

./scripts/aws.sh review
        ↓
Deploy + verify review environment

./scripts/aws.sh status
        ↓
Check resource state

./scripts/aws.sh stop
        ↓
Stop/remove resources where appropriate
        ↓
Verify ongoing-cost resources are minimized
```

The scripts must use resource-specific operations.

For example:

- EC2 instances can be stopped when not required.
- RDS can be handled using its supported stop/lifecycle mechanisms.
- S3 requires storage/data cleanup or other cost-control actions where applicable.
- CloudFront requires its own resource/billing considerations.
- CloudWatch and SNS should be managed according to their usage and associated costs.

The scripts must not assume that a generic `stop` operation exists for every AWS service.

---

# 33. AWS Review Workflow

Before a review:

```
Check Local Implementation
        ↓
Run Tests
        ↓
Verify AWS CLI
        ↓
./scripts/aws.sh start
        ↓
Prepare Review Environment
        ↓
./scripts/aws.sh review
        ↓
Deploy + Verify
        ↓
Run AWS Integration Tests
        ↓
Conduct Review
```

After the review:

```
./scripts/aws.sh status
        ↓
Review Resource State
        ↓
./scripts/aws.sh stop
        ↓
Resource-Specific Cleanup
        ↓
./scripts/aws.sh status
        ↓
Verify Ongoing-Cost Resources Are Minimized
```

AWS should be brought online shortly before required testing/review rather than being used as the normal development environment.

---

# 34. AWS Database Workflow

Local and AWS databases are separate.

```
Local Development
    ↓
Local PostgreSQL
```

```
Staging / Deployment
    ↓
RDS PostgreSQL
```

There is no automatic synchronization between them.

Database migrations must be applied independently:

```
Local PostgreSQL
    ↓
Run migrations locally

RDS PostgreSQL
    ↓
Run migrations independently
```

Development seed data should not be treated as a mechanism for transferring local application state into RDS.

---

# 35. AWS Frontend Deployment

The AWS frontend deployment follows:

```
React / Vite Build
        ↓
Static Build Output
        ↓
S3
        ↓
CloudFront
        ↓
Browser
```

The frontend should be built for the appropriate staging or deployment configuration before being uploaded to S3.

CloudFront provides the public distribution layer.

---

# 36. AWS Backend Deployment

The backend deployment runs on EC2.

```
Backend
   ↓
EC2
   ↓
RDS PostgreSQL
   ↓
Redis
```

The backend should use the appropriate environment configuration for staging or deployment.

AWS deployment automation will be introduced progressively.

---

# 37. AWS Verification Checklist

Before an AWS review, verify:

```
[ ] AWS CLI profile works
[ ] Correct AWS region is configured
[ ] Required AWS resources are available
[ ] EC2 is running
[ ] RDS PostgreSQL is available
[ ] Redis is available on the review infrastructure
[ ] Frontend is available through S3 / CloudFront
[ ] Backend is available through EC2
[ ] Database connectivity works
[ ] CloudWatch logging is visible
[ ] SNS notification path is configured
[ ] Demo APIs are reachable
[ ] Gateway routing works
[ ] Authentication works
[ ] Rate limiting works
[ ] Health checks work
[ ] Request history is recorded
[ ] Tests execute successfully
[ ] Alerts can trigger
[ ] Recovery behavior is verified
```

---

# 38. Review Environment Cleanup Checklist

After an AWS review:

```
[ ] Review is complete
[ ] Required logs/results have been captured
[ ] Application state required for documentation is preserved where appropriate
[ ] EC2 is stopped when no longer required
[ ] RDS is handled using the appropriate cost-control procedure
[ ] S3 resources are reviewed
[ ] CloudFront resources are reviewed
[ ] CloudWatch usage is reviewed
[ ] SNS usage is reviewed
[ ] Demo resources are reviewed
[ ] ./scripts/aws.sh status executed
[ ] Ongoing-cost resources are minimized
```

Cleanup must be performed according to the lifecycle and billing behavior of each AWS service.

---

# 39. Development Principles

GateWatch development follows these principles:

1. **Local-first development**
    
    Normal development happens locally using Docker Compose.
    
2. **Specification-driven implementation**
    
    Existing system specifications define the expected behavior.
    
3. **Branch-based collaboration**
    
    Team members develop in branches and merge through Pull Requests.
    
4. **Reviewed changes**
    
    Changes to `main` require Pull Request review and approval.
    
5. **Explicit database changes**
    
    Schema changes use versioned Knex migrations.
    
6. **No automatic database initialization in containers**
    
    Migrations and seeds are run explicitly.
    
7. **Environment separation**
    
    Local PostgreSQL and AWS RDS are separate environments.
    
8. **No secret credentials in Git**
    
    Secrets remain in local/environment-specific configuration.
    
9. **AWS only when required**
    
    AWS is primarily used for staging, review, testing, and final deployment.
    
10. **Resource-specific AWS cleanup**
    
    AWS resources are stopped, disabled, or removed according to their individual lifecycle and billing behavior.
    
11. **Documentation follows implementation**
    
    If implementation changes an existing system contract, the specification is updated before or alongside the implementation.
    
12. **Small, reviewable changes**
    
    Features and fixes should be developed as focused changes that can be independently reviewed and merged.