# src — Microservices & Dashboard

> TypeScript microservices with zero security code, structured JSON logging, multi-stage Docker builds, and an Angular 17 real-time log Dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Microservices](#microservices)
  - [Service-A (Gateway)](#service-a-gateway)
  - [Service-B (Processor)](#service-b-processor)
- [Dashboard](#dashboard)
  - [Backend (Node.js/Express)](#backend-nodejsexpress)
  - [Frontend (Angular 17 Standalone + Signals)](#frontend-angular-17-standalone--signals)
- [Technology Stack](#technology-stack)
- [Design Decisions](#design-decisions)
- [Build Instructions](#build-instructions)
- [Local Development](#local-development)
- [Common Errors](#common-errors)
- [Success Criteria](#success-criteria)

---

## Overview

This directory contains two microservices implemented in **TypeScript** with **strict mode enabled**, plus a real-time log Dashboard for visualizing centralized security events. They serve as the workloads for validating the Sidecar security monitoring architecture.

**The Golden Rule**: The microservices contain **zero code related to security, monitoring, TLS, or network interception**. All of that is delegated to the Istio/Envoy sidecar injected by Kubernetes.

**The Dashboard** demonstrates observability: it reads logs from the SIEM (Wazuh) and visualizes them in real time, proving that the sidecar-based log pipeline works end-to-end.

---

## Microservices

### Service-A (Gateway)

**Role**: Public-facing entry point. Receives external HTTP requests and forwards them to Service-B for processing.

**File**: `src/service-a/`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check used by Kubernetes probes |
| `GET` | `/api/data` | Receives client request, calls Service-B, combines responses |

**Dependencies:**
- `express` — HTTP server framework
- `pino` — Ultra-fast JSON logger to stdout

**Key code characteristics:**
- Imports **no security libraries**
- Logs every request as structured JSON to `stdout`
- Uses `SERVICE_B_URL` env var to discover Service-B via Kubernetes DNS

---

### Service-B (Processor)

**Role**: Internal business logic processor. Only accessible from Service-A.

**File**: `src/service-b/`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check used by Kubernetes probes |
| `GET` | `/internal/process` | Simulates business processing and returns data |

**Dependencies:**
- `express` — HTTP server framework
- `pino` — Ultra-fast JSON logger to stdout

**Key code characteristics:**
- Imports **no security libraries**
- Logs every request as structured JSON to `stdout`
- Never exposed directly to external traffic

---

## Dashboard

### Backend (Node.js/Express)

**Role**: API server that reads Wazuh `archives.log` via `docker exec` and serves paginated, filterable JSON.

**File**: `src/dashboard-backend/`

**API Endpoints:**

| Method | Path | Query Params | Description |
|--------|------|--------------|-------------|
| `GET` | `/api/logs` | `page`, `limit`, `service`, `level`, `search` | Returns paginated logs from Wazuh |
| `GET` | `/api/health` | — | Health check |

**Key design decisions:**
- **Syslog + Pino parser**: `archives.log` has a syslog RFC5424 prefix followed by JSON. The parser extracts JSON between the first `{` and last `}`.
- **Hostname inference**: Pino logs use `hostname` (not `service`). The parser falls back to pattern matching on `hostname` to determine `service-a` vs `service-b`.
- **Newest-first**: The backend reverses the array before pagination so the most recent logs appear first.
- **Large buffer**: `maxBuffer: 10 * 1024 * 1024` (10MB) because Istio access logs are very large and exceed the default 1MB `child_process.exec` buffer.
- **Docker socket mount**: The backend runs in Docker host (not Kubernetes) because it needs access to the Docker socket to execute `docker exec` on the Wazuh container.

**Dockerfile**: Multi-stage build with `docker-cli` installed in the runtime stage (Alpine `apk add docker-cli`).

---

### Frontend (Angular 17 Standalone + Signals)

**Role**: Real-time web UI for browsing, filtering, and analyzing centralized security logs.

**File**: `src/dashboard-frontend/`

**Features:**

| Feature | Implementation |
|---------|---------------|
| **Standalone components** | Angular 17+ without `NgModule` |
| **Signals** | `signal()`, `computed()`, `effect()` for reactive state |
| **Material Design** | Toolbar, Cards, Table, Paginator, Form Field, Select, Icons |
| **Auto-refresh** | `interval(10000)` with `switchMap` for live updates every 10s |
| **Filters** | By service (dropdown with colored dots), by level (INFO/WARN/ERROR badges), by free-text search |
| **Newest-first** | Logs displayed in reverse chronological order |
| **Statistics** | Real-time counters: total logs, Service A count, Service B count, Info count via `computed()` Signals |
| **Pagination** | MatPaginator with page size options [10, 25, 50, 100] |
| **Clear filters** | One-click reset of all filters |
| **SPA routing** | Nginx `try_files` fallback for Angular routes |

**Architecture:**

```
Browser
  |
  | http://localhost:8888
  v
Nginx (in Kubernetes Pod)
  |-- /api/*  --> proxy to host.docker.internal:3000 (backend on Docker host)
  |-- /*      --> serve Angular static files (browser/)
```

**Why host.docker.internal?** The backend cannot run inside Kind because Kind nodes are containers without access to the host Docker socket. The backend runs on the Docker host; the frontend (in Kubernetes) proxies `/api` requests to `host.docker.internal:3000`.

**Build**: `npx ng build --configuration production` generates static assets in `dist/dashboard-frontend/browser/`, copied to Nginx's `/usr/share/nginx/html`.

---

## Technology Stack

### Microservices

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x | Runtime environment |
| TypeScript | 5.x | Static typing with `strict: true` |
| Express.js | 4.x | HTTP server framework |
| Pino | 9.x | Structured JSON logging to stdout |
| ts-node | 10.x | TypeScript execution for local dev |

### Dashboard

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x | Backend runtime |
| Express | 4.x | Backend API framework |
| TypeScript | 5.x | Backend strict typing |
| Angular | 17+ | Frontend framework |
| Angular Material | 17+ | UI component library |
| RxJS | 7.x | Reactive streams (auto-refresh) |
| Nginx | alpine | Static file server + API proxy |

---

## Design Decisions

### Strict TypeScript (`strict: true`, no `any`)

The root `tsconfig.json` enables:
- `strict: true` — All strict type-checking options
- `noImplicitAny: true` — Prohibits implicit `any`
- `strictNullChecks: true` — Forces null/undefined handling

**Why this matters for distributed systems**: In a microservices architecture, the contract between Service-A and Service-B is an HTTP API. TypeScript's strict typing ensures this contract is explicit and verifiable at compile time, preventing runtime errors due to mismatched request/response shapes.

### Pino Logger (JSON to stdout)

Both services use `pino`, a logger optimized for speed:

```typescript
import pino from 'pino';
const logger = pino({ level: 'info' });

logger.info({ method: req.method, url: req.url }, 'Peticion recibida');
```

**Output example:**
```json
{"level":"info","time":1777243142557,"pid":1,"hostname":"service-a-6464d655cd-7kwn4","method":"GET","url":"/health","timestamp":"2026-04-26T22:39:02.556Z","msg":"Peticion recibida"}
```

**Why stdout?** Kubernetes automatically captures all container stdout/stderr and persists it to `/var/log/pods/` on the host node. No file management, log rotation, or volume mounts are needed inside the container.

### Multi-Stage Docker Builds

Each Dockerfile has two stages:

1. **Builder stage**: Installs all dependencies (including devDependencies like `typescript`), compiles `.ts` to `.js` in `dist/`.
2. **Production stage**: Starts from a clean `node:20-alpine` image, copies only `dist/` and `node_modules/` (production deps), runs as non-root user.

**Result**: Final image is ~50-70 MB instead of ~200+ MB, and contains zero build tools.

### Dashboard Design — Professional UI

- **Header**: Dark navy (`#0f172a`) with shield logo, live status badge with pulsing green dot, and timestamp.
- **Stats Cards**: Four cards with hover effects and semantic colors (blue for total, purple for Service A, teal for Service B, green for Info).
- **Filter Bar**: White card with outline form fields, service dots, level badges, clear/refresh buttons.
- **Log Table**: Sticky header, level badges with icons (info/warning/error), monospace timestamps, truncated messages with tooltips.
- **Empty State**: Friendly message with icon when filters return no results.

---

## Build Instructions

### Microservices

```powershell
# Build Service-A
docker build -t service-a:latest ./src/service-a

# Build Service-B
docker build -t service-b:latest ./src/service-b

# Load into Kind (required because Kind nodes don't have internet access)
kind load docker-image service-a:latest --name sidecar-thesis
kind load docker-image service-b:latest --name sidecar-thesis
```

### Dashboard Backend

```powershell
docker build -t dashboard-backend:latest ./src/dashboard-backend
# Runs on Docker host (not Kubernetes) with socket mount:
docker run -d --name dashboard-backend -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --restart unless-stopped dashboard-backend:latest
```

### Dashboard Frontend

```powershell
docker build -t dashboard-frontend:latest ./src/dashboard-frontend
kind load docker-image dashboard-frontend:latest --name sidecar-thesis
kubectl apply -f k8s/dashboard/
```

---

## Local Development

### Microservices (without Kubernetes)

```powershell
cd src/service-a
npm install
npm run dev   # Uses ts-node to run TypeScript directly
```

Then in another terminal:
```powershell
cd src/service-b
npm install
npm run dev
```

Service-A will be on `http://localhost:8080` and Service-B on `http://localhost:8081`.

### Dashboard Frontend (without Kubernetes)

```powershell
cd src/dashboard-frontend
npm install
npx ng serve
# Opens on http://localhost:4200
```

> Note: The frontend will try to connect to `http://localhost:3000/api` for the backend. Ensure the backend is running first.

### Dashboard Backend (without Kubernetes)

```powershell
cd src/dashboard-backend
npm install
npm run dev
# Runs on http://localhost:3000
```

---

## Common Errors

### `Cannot find module 'express'` during build
**Cause**: `npm install` was not run before `docker build`.
**Fix**: Ensure `node_modules` exists locally, or let Docker install it in the builder stage.

### TypeScript compilation errors
**Cause**: `strict: true` catches type errors that JavaScript would ignore.
**Fix**: Check the error message and add explicit types. Never use `any`.

### `EACCES: permission denied` when running container
**Cause**: The production stage runs as a non-root user (`node`), but the file permissions are wrong.
**Fix**: Ensure the Dockerfile sets correct ownership:
```dockerfile
USER node
```

### Pino logs not showing in Kubernetes
**Cause**: Pino writes to stdout, but if the log level is `info` and you're looking for `debug` logs, they won't appear.
**Fix**: Check the `level` configuration in `server.ts`.

### Dashboard backend: `docker: not found`
**Cause**: The backend container doesn't have the Docker CLI installed.
**Fix**: The Dockerfile must include `apk add --no-cache docker-cli` in the runtime stage.

### Dashboard backend: `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`
**Cause**: `child_process.exec` default buffer is 1MB. Istio access logs are huge.
**Fix**: Increase `maxBuffer` in `wazuh-reader.ts`: `execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 })`.

### Dashboard frontend: `ngClass` not recognized on `mat-chip`
**Cause**: `CommonModule` (which provides `NgClass`) was not imported in the standalone component.
**Fix**: Add `CommonModule` to the `imports` array of `LogTableComponent`.

---

## Success Criteria

| Check | Verification |
|-------|-------------|
| TypeScript compiles without errors | `npm run build` exits with code 0 |
| No `any` types in source code | `grep -r "any" src/` should return nothing (except in `node_modules`) |
| JSON logs are emitted to stdout | `node dist/index.js` and `curl localhost:8080/health` should print JSON to terminal |
| Docker image builds successfully | `docker build -t service-a:latest ./src/service-a` completes without errors |
| Image is under 100 MB | `docker images | findstr service-a` should show < 100 MB |
| Dashboard backend responds | `curl http://localhost:3000/api/health` returns `{"status":"ok"}` |
| Dashboard frontend builds | `cd src/dashboard-frontend && npx ng build --configuration production` succeeds |

---

## Related Documentation

- [Root README](../README.md) — Architecture overview and empirical results
- [k8s/README.md](../k8s/README.md) — Kubernetes deployment manifests and security policies
- [wazuh/README.md](../wazuh/README.md) — SIEM log pipeline and load testing
- [scripts/README.md](../scripts/README.md) — Lab lifecycle TUI
