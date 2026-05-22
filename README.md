# k8s-sidecar-monitor

> Decentralized Security Monitoring Architecture using the Sidecar Pattern in Kubernetes.
> This repository contains the complete implementation of a non-intrusive, infrastructure-based security monitoring system for cloud-native microservices.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Project Modules](#project-modules)
  - [`/src` — Microservices & Dashboard](#src--microservices--dashboard)
  - [`/k8s` — Kubernetes Manifests](#k8s--kubernetes-manifests)
  - [`/wazuh` — SIEM Integration (Wazuh + Fluent Bit)](#wazuh--siem-integration-wazuh--fluent-bit)
  - [`/scripts` — Lab Lifecycle TUI](#scripts--lab-lifecycle-tui)
- [Common Errors & Troubleshooting](#common-errors--troubleshooting)
- [Empirical Results](#empirical-results)
- [Success Criteria](#success-criteria)
- [Academic Context](#academic-context)
- [References](#references)

---

## Architecture Overview

This project implements a **Sidecar-based Security Monitoring Architecture** where observability and security are completely decoupled from application code.

### Key Principles

1. **Zero Intrusion**: Microservices contain NO security, monitoring, or TLS code. They only implement business logic and emit structured JSON logs to `stdout`.
2. **Transparent Interception**: Istio/Envoy sidecars automatically intercept 100% of ingress and egress traffic via iptables redirection within the Pod's Network Namespace.
3. **Decentralized Collection**: Fluent Bit runs as a DaemonSet on every Kubernetes node, reading container logs from `/var/log/pods/` and forwarding them to Wazuh SIEM via syslog.
4. **Centralized Analysis**: Wazuh Manager receives, archives, and analyzes security events without requiring any agent inside the application containers.
5. **Zero-Trust Policy Enforcement**: Istio's `PeerAuthentication` (mTLS STRICT) and `AuthorizationPolicy` enforce security policies at the mesh level without application code changes.

### High-Level Data Flow

```
User/Client
    |
    | HTTP/HTTPS
    v
Istio Ingress Gateway (North-South)
    |
    v
Pod [App Container + Envoy Sidecar] (localhost)
    |                    |
    | stdout/logs        | access logs
    v                    v
/var/log/pods/      /var/log/pods/
    |                    |
    +---------> Fluent Bit DaemonSet
                    |
                    | Syslog RFC5424 UDP 514
                    v
            Wazuh Manager (SIEM)
                    |
                    | REST API
                    v
            Dashboard (Angular)
```

---

## Repository Structure

```
.
├── kind-config.yaml              # Kind cluster topology (1 CP + 2 Workers)
├── tsconfig.json                 # Root TypeScript strict mode config
├── .gitignore                    # Excludes node_modules, docs/, evidence/, history/
│
├── src/                          # Business logic microservices & Dashboard
│   ├── service-a/                # Gateway microservice (TypeScript + Express + Pino)
│   ├── service-b/                # Processor microservice (TypeScript + Express + Pino)
│   ├── dashboard-backend/        # Node.js API for reading Wazuh archives.log
│   └── dashboard-frontend/       # Angular 17 Standalone + Signals + Material
│
├── k8s/                          # Kubernetes declarative manifests
│   ├── service-a-deployment.yaml
│   ├── service-a-service.yaml
│   ├── service-b-deployment.yaml
│   ├── service-b-service.yaml
│   ├── peer-authentication.yaml    # mTLS STRICT policy
│   ├── authorization-policy.yaml     # DENY external access to /internal/process
│   └── dashboard/                  # Dashboard frontend deployment
│       ├── frontend-deployment.yaml
│       └── frontend-service.yaml
│
├── k8s-no-istio/                 # Control group: microservices WITHOUT sidecar
│   ├── service-a-deployment.yaml
│   ├── service-b-deployment.yaml
│   └── ...
│
├── wazuh/                        # SIEM stack and log collection
│   ├── docker-compose.yml          # Wazuh Manager standalone
│   ├── fluent-bit-configmap.yaml   # Fluent Bit config (CRI parser, syslog output)
│   ├── fluent-bit-daemonset.yaml   # DaemonSet for per-node log collection
│   ├── load-test-*.yaml            # Load test Jobs (light, medium, heavy)
│   └── load-test-*-no-istio.yaml   # Load tests targeting no-istio namespace
│
├── scripts/                      # TUI scripts for lab lifecycle management
│   ├── tui.js                    # Interactive menu (setup, status, cleanup)
│   ├── setup.js                    # Guided 7-step setup
│   ├── cleanup.js                  # Safe teardown with confirmations
│   └── lib/                        # Shared utilities
│       ├── checks.js               # Environment health checks
│       └── colors.js               # Terminal color helpers
│
├── docs/                         # AI context, architecture docs, references (not in repo)
├── evidence/                     # Screenshots and visual evidence (not in repo)
└── history/                      # Detailed session logs and error analysis (not in repo)
```

---

## Quick Start

```powershell
# 1. Create the Kind cluster
kind create cluster --config kind-config.yaml --name sidecar-thesis

# 2. Install Istio
istioctl install --set profile=demo -y
kubectl label namespace default istio-injection=enabled

# 3. Build and load microservice images
docker build -t service-a:latest ./src/service-a
docker build -t service-b:latest ./src/service-b
kind load docker-image service-a:latest --name sidecar-thesis
kind load docker-image service-b:latest --name sidecar-thesis

# 4. Deploy microservices
kubectl apply -f k8s/

# 5. Start Wazuh Manager
cd wazuh && docker compose up -d

# 6. Deploy Fluent Bit
kubectl apply -f wazuh/fluent-bit-configmap.yaml
kubectl apply -f wazuh/fluent-bit-daemonset.yaml

# 7. (Optional) Deploy Dashboard
docker build -t dashboard-backend:latest ./src/dashboard-backend
docker build -t dashboard-frontend:latest ./src/dashboard-frontend
kind load docker-image dashboard-frontend:latest --name sidecar-thesis
kubectl apply -f k8s/dashboard/

# 8. (Optional) Apply security policies
kubectl apply -f k8s/peer-authentication.yaml
kubectl apply -f k8s/authorization-policy.yaml

# 9. Verify everything
kubectl get pods                          # READY should show 2/2
kubectl get pods -l app=fluent-bit        # Should show Running
docker compose ps                         # wazuh-manager should be running
```

**Expected result**: `service-a` and `service-b` Pods show `READY 2/2`, and Wazuh `archives.log` contains JSON logs from the microservices.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker Desktop | 4.30+ | Container runtime (WSL2 backend recommended) |
| Kind | 0.31.0 | Local Kubernetes cluster |
| kubectl | 1.32.2 | Kubernetes CLI |
| istioctl | 1.23.3 | Istio Service Mesh CLI (LTS) |
| Node.js | 20.x | Microservice runtime |
| Angular CLI | 17+ | Dashboard frontend build |
| PowerShell | 5.1+ | Shell for Windows commands |

> **Note**: Istio 1.24.0 was initially attempted but discarded due to a critical Helm packaging bug that prevented `demo` profile installation. Version 1.23.3 (LTS) was used instead.

---

## Project Modules

### `/src` — Microservices & Dashboard

Two lightweight, security-agnostic microservices plus a real-time log Dashboard.

**Microservices:**
- **Service-A (Gateway)**: Public-facing entry point, forwards to Service-B.
- **Service-B (Processor)**: Internal business logic, only accessible from Service-A.

**Dashboard:**
- **Backend (Node.js/Express)**: Parses Wazuh `archives.log` via `docker exec`, serves REST API with pagination, filtering, and newest-first ordering.
- **Frontend (Angular 17 Standalone + Signals + Material)**: Real-time log viewer with service/level filters, search, pagination, and auto-refresh every 10 seconds. Runs in Kubernetes with Nginx proxy to backend.

**Key design decisions:**
- **TypeScript `strict: true`**: Enforces static typing, explicit API contracts, and zero `any` usage.
- **Pino logger**: Ultra-fast JSON logger writing to `stdout`. Kubernetes captures this automatically.
- **Zero security code**: No TLS, no auth, no monitoring SDKs. All security is delegated to the sidecar.
- **Multi-stage Docker builds**: Builder stage compiles TypeScript; production stage runs only compiled JS.

See [`src/README.md`](src/README.md) for detailed code documentation.

---

### `/k8s` — Kubernetes Manifests

Declarative YAML manifests for deploying microservices, Istio security policies, and the Dashboard with health checks, resource limits, and automatic sidecar injection.

**Key design decisions:**
- **ClusterIP Services**: Internal-only exposure. No direct external access to microservices.
- **Readiness/Liveness Probes**: Self-healing via Kubernetes.
- **`imagePullPolicy: Never`**: Uses locally-built images loaded into Kind nodes.
- **No sidecar references**: Istio injects `istio-proxy` automatically via Mutating Webhook.
- **Security Policies**: `PeerAuthentication` enforces mTLS STRICT; `AuthorizationPolicy` blocks external access to sensitive endpoints.
- **Control Group**: `k8s-no-istio/` namespace deploys identical microservices WITHOUT sidecar for empirical baseline comparison.

See [`k8s/README.md`](k8s/README.md) for manifest documentation and troubleshooting.

---

### `/wazuh` — SIEM Integration (Wazuh + Fluent Bit)

Complete log pipeline from Kubernetes nodes to Wazuh Manager, including load testing infrastructure.

**Key design decisions:**
- **Fluent Bit over Wazuh Agent**: `wazuh/wazuh-agent:4.9.0` does not exist on Docker Hub. Fluent Bit (CNCF standard) is lighter and purpose-built for Kubernetes.
- **CRI parser**: Kind uses containerd, which writes logs in CRI format (`timestamp stdout F JSON`), incompatible with Docker JSON parser.
- **Standalone Manager**: Full Wazuh stack (Manager + Indexer + Dashboard) requires TLS certificates. For the lab environment, only the Manager is deployed, receiving syslog UDP directly.
- **`syslog_message_key`**: Fluent Bit requires this property to send the actual log body (not just headers).
- **Load Tests**: Three Jobs (`load-test-{light,medium,heavy}.yaml`) generate controlled HTTP traffic. Additional Jobs (`load-test-*-no-istio.yaml`) target the control group namespace.

See [`wazuh/README.md`](wazuh/README.md) for deployment steps, error analysis, and validation.

---

### `/scripts` — Lab Lifecycle TUI

Interactive command-line interface for managing the entire lab environment.

**Files:**
- **`tui.js`**: Main interactive menu. Shows real-time environment status (Docker, Kind, kubectl, Pods, Wazuh, Fluent Bit) and provides actions: setup, status, logs, cleanup.
- **`setup.js`**: Guided 7-step setup wizard with health checks at each step. Idempotent — safe to run multiple times.
- **`cleanup.js`**: Safe teardown with multiple confirmation levels. Supports partial cleanup (cluster only) or full cleanup (cluster + Docker volumes + images).
- **`lib/checks.js`**: Reusable environment health check functions.
- **`lib/colors.js`**: Terminal color and formatting helpers.

```powershell
cd scripts
npm install
npm start        # Launch interactive TUI
```

---

## Common Errors & Troubleshooting

### 1. Istio `demo` profile fails with `helm render: load chart`
**Cause**: Istio 1.24.0 has a packaging bug in the Windows release ZIP.
**Fix**: Use Istio 1.23.3 LTS.

### 2. `ErrImagePull` on Wazuh Agent
**Cause**: `wazuh/wazuh-agent:4.9.0` does not exist on Docker Hub.
**Fix**: Use Fluent Bit instead. See `wazuh/fluent-bit-daemonset.yaml`.

### 3. Fluent Bit `parser 'cri' is not registered`
**Cause**: `parsers.conf` was mounted from a non-existent ConfigMap (`fluent-bit-parsers`).
**Fix**: Consolidate `parsers.conf` into the `fluent-bit-config` ConfigMap and update the DaemonSet volume reference.

### 4. Wazuh Manager does not listen on UDP 514
**Cause**: Wazuh `wazuh-remoted` disables syslog listener if `<allowed-ips>` is missing.
**Fix**: Add `<allowed-ips>0.0.0.0/0</allowed-ips>` to `<remote>` section in `ossec.conf`.

### 5. `Invalid option <queue_size> for Syslog remote connection`
**Cause**: `<queue_size>` is only valid in `secure` (agent) mode, not `syslog` mode.
**Fix**: Remove `<queue_size>` when using `<connection>syslog</connection>`.

### 6. Logs arrive at Wazuh but only show headers (no JSON body)
**Cause**: Fluent Bit syslog output needs `syslog_message_key message` to know which record field to send.
**Fix**: Add `syslog_message_key message` to the `[OUTPUT]` section.

### 7. Dashboard backend returns empty `data` array
**Cause**: `child_process.exec` default buffer is 1MB; Istio access logs exceed this.
**Fix**: Increase `maxBuffer` to 10MB in the backend's `wazuh-reader.ts`.

### 8. `chalk is not defined` in scripts
**Cause**: `cleanup.js` uses `chalk` without importing it.
**Fix**: Add `const chalk = require('chalk');` at the top of `cleanup.js`.

For exhaustive error documentation, see `history/fase-05-siem/errores-y-soluciones.md` (local, not in repo).

---

## Empirical Results

This architecture was validated through controlled load testing with a control group (microservices without sidecar).

### Load Test Configuration

| Test | Concurrency | Duration | Target |
|------|-------------|----------|--------|
| Light | 10 | 10s | `service-a:8080/health` |
| Medium | 50 | 20s | `service-a:8080/health` |
| Heavy | 100 | 30s | `service-a:8080/health` |

### Comparative Performance (Heavy Load)

| Metric | With Sidecar (Istio) | Without Sidecar (Baseline) | Overhead |
|--------|----------------------|---------------------------|----------|
| Throughput | 2,704 r/s | 2,779 r/s | **-2.7%** |
| Avg Latency | 37.16 ms | 35.82 ms | **+3.7%** |
| P99 Latency | 102 ms | 96 ms | **+6.3%** |
| Pod CPU (total) | ~1,550 m | ~480 m | **+213%** |
| Pod Memory (total) | ~115 Mi | ~70 Mi | ~+35 Mi |

### Resource Breakdown (With Sidecar)

| Container | Baseline CPU | Heavy Load CPU | Baseline Memory | Heavy Load Memory |
|-----------|-------------|----------------|-----------------|-------------------|
| service-a (app) | 3m | 516m | 70 Mi | 77 Mi |
| service-a (istio-proxy) | ~1m | **1,042m** | ~30 Mi | 37 Mi |
| service-b (app) | 3m | 6m | 69 Mi | 68 Mi |
| service-b (istio-proxy) | ~1m | ~4m | ~30 Mi | ~30 Mi |
| Fluent Bit | 3m | 223m | 31 Mi | 38 Mi |

**Key finding**: The `istio-proxy` sidecar consumes **twice the CPU** of the application container under heavy load (1,042m vs 516m), demonstrating the measurable computational tradeoff of the Sidecar pattern. Network latency impact is minimal (~3-6%).

### Security Policy Validation

| Policy | Test | Result |
|--------|------|--------|
| `PeerAuthentication` STRICT | Access from no-istio namespace | Connection reset (no mTLS cert) |
| `AuthorizationPolicy` DENY | Access `/internal/process` from no-istio | **HTTP 403 Forbidden** |
| Combined | Access from within mesh | **HTTP 200 OK** |

### Dashboard Validation

- **3,100+ logs** centralized from `service-a` and `service-b`.
- **Auto-refresh** every 10 seconds with RxJS intervals.
- **Newest-first ordering** (reverse chronological).
- **Real-time statistics**: total count, per-service count, per-level count via Angular Signals `computed()`.

---

## Success Criteria

The architecture is considered successfully implemented when ALL the following conditions are met:

| # | Criterion | Verification Command |
|---|-----------|---------------------|
| 1 | Cluster has 3 nodes Ready | `kubectl get nodes` |
| 2 | Istio pods are Running | `kubectl get pods -n istio-system` |
| 3 | `default` namespace has `istio-injection=enabled` | `kubectl get namespace -L istio-injection` |
| 4 | Microservice Pods show `READY 2/2` | `kubectl get pods` |
| 5 | Fluent Bit pods are Running on all workers | `kubectl get pods -l app=fluent-bit` |
| 6 | Wazuh Manager container is running | `docker compose ps` (in `wazuh/` dir) |
| 7 | Wazuh `archives.log` contains JSON logs with `method`, `url`, `msg` | `docker exec wazuh-manager grep 'Peticion recibida' /var/ossec/logs/archives/archives.log` |
| 8 | mTLS STRICT is enforced | `kubectl get peerauthentication -n default` |
| 9 | Dashboard shows live logs | `curl http://localhost:3000/api/logs?page=1&limit=5` |

---

## Academic Context

This repository supports the implementation chapter of an undergraduate thesis in Computer Engineering. The thesis proposes a decentralized, non-intrusive security monitoring architecture based on the Sidecar pattern for microservices in Kubernetes.

**Core thesis claims validated by this repo:**
1. The Sidecar pattern enables zero-code security observability.
2. A Service Mesh (Istio) can transparently intercept 100% of East-West and North-South traffic.
3. A SIEM (Wazuh) can centralize security events without requiring agents inside application containers.
4. The computational overhead of the sidecar is measurable and quantifiable (see [Empirical Results](#empirical-results)).
5. Zero-trust security policies (mTLS + AuthorizationPolicy) can be enforced at the mesh level without application code changes.

**Excluded from this repo** (per project rules):
- `docs/` — Academic thesis document, figures, and references.
- `evidence/` — Screenshots and visual artifacts.
- `history/` — Session logs, error analysis, and detailed explanations.

---

## References

Key academic and technical references used in this project:

- Chandramouli, R., & Butcher, M. (2020). *Security for Container-Based Microservices with Service Mesh*. NIST.
- Maia, R., & Correia, M. (2022). *Securing Microservices with Service Mesh: A Systematic Mapping Study*.
- Meadows, D., et al. (2023). *Security-Aware Route Planning in Sidecar-Based Microservices*.
- Salcedo-Navarro, S., et al. (2025). *Securing Microservices in Kubernetes: A Comprehensive Review*.
- The Linux Foundation. (2024). *Kubernetes Documentation*.
- Koneru, S. (2025). *Centralized Logging and Security Monitoring in Kubernetes with Wazuh*.

For the full reference list, see `docs/material/references/` (local directory, not in repo).

---

> **Maintained by:** Luis Carlos Corleto Marroquin
> **License:** MIT (Academic Use)
> **Last Updated:** 2026-05-22
