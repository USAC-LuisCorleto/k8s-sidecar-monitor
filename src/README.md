# src — Microservices

> TypeScript microservices with zero security code, structured JSON logging, and multi-stage Docker builds.

---

## Table of Contents

- [Overview](#overview)
- [Service-A (Gateway)](#service-a-gateway)
- [Service-B (Processor)](#service-b-processor)
- [Technology Stack](#technology-stack)
- [Design Decisions](#design-decisions)
- [Build Instructions](#build-instructions)
- [Local Development](#local-development)
- [Common Errors](#common-errors)
- [Success Criteria](#success-criteria)

---

## Overview

This directory contains two microservices implemented in **TypeScript** with **strict mode enabled**. They serve as the "business logic" workloads for validating the Sidecar security monitoring architecture.

**The Golden Rule**: These microservices contain **zero code related to security, monitoring, TLS, or network interception**. All of that is delegated to the Istio/Envoy sidecar injected by Kubernetes.

---

## Service-A (Gateway)

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

## Service-B (Processor)

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

## Technology Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20.x | Runtime environment |
| TypeScript | 5.x | Static typing with `strict: true` |
| Express.js | 4.x | HTTP server framework |
| Pino | 9.x | Structured JSON logging to stdout |
| ts-node | 10.x | TypeScript execution for local dev |

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

---

## Build Instructions

```powershell
# Build Service-A
docker build -t service-a:latest ./src/service-a

# Build Service-B
docker build -t service-b:latest ./src/service-b

# Load into Kind (required because Kind nodes don't have internet access)
kind load docker-image service-a:latest --name sidecar-thesis
kind load docker-image service-b:latest --name sidecar-thesis
```

---

## Local Development

If you want to run the services locally (without Kubernetes):

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

---

## Success Criteria

| Check | Verification |
|-------|-------------|
| TypeScript compiles without errors | `npm run build` exits with code 0 |
| No `any` types in source code | `grep -r "any" src/` should return nothing (except in `node_modules`) |
| JSON logs are emitted to stdout | `node dist/index.js` and `curl localhost:8080/health` should print JSON to terminal |
| Docker image builds successfully | `docker build -t service-a:latest ./src/service-a` completes without errors |
| Image is under 100 MB | `docker images | findstr service-a` should show < 100 MB |

---

## Related Documentation

- [Root README](../README.md) — Architecture overview
- [k8s/README.md](../k8s/README.md) — Kubernetes deployment manifests
- [wazuh/README.md](../wazuh/README.md) — SIEM log pipeline
