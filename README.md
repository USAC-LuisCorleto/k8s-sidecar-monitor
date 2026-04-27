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
  - [`/src` — Microservices (TypeScript + Node.js)](#src--microservices-typescript--nodejs)
  - [`/k8s` — Kubernetes Manifests](#k8s--kubernetes-manifests)
  - [`/wazuh` — SIEM Integration (Wazuh + Fluent Bit)](#wazuh--siem-integration-wazuh--fluent-bit)
- [Common Errors & Troubleshooting](#common-errors--troubleshooting)
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

### High-Level Data Flow

```
User/Client
    |
    | HTTP/HTTPS
    v
Istio Ingress Gateway (Norte-Sur)
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
```

---

## Repository Structure

```
.
├── kind-config.yaml              # Kind cluster topology (1 CP + 2 Workers)
├── tsconfig.json                 # Root TypeScript strict mode config
├── .gitignore                    # Excludes node_modules, docs/, evidence/, history/
│
├── src/                          # Business logic microservices
│   ├── service-a/                # Gateway microservice (Node.js + Express + Pino)
│   └── service-b/                # Processor microservice (Node.js + Express + Pino)
│
├── k8s/                          # Kubernetes declarative manifests
│   ├── service-a-deployment.yaml
│   ├── service-a-service.yaml
│   ├── service-b-deployment.yaml
│   └── service-b-service.yaml
│
├── wazuh/                        # SIEM stack and log collection
│   ├── docker-compose.yml        # Wazuh Manager standalone
│   ├── fluent-bit-configmap.yaml # Fluent Bit config (CRI parser, syslog output)
│   ├── fluent-bit-daemonset.yaml # DaemonSet for per-node log collection
│   ├── load-test-*.yaml          # Load test Jobs (light, medium, heavy)
│   └── wazuh-agent-daemonset.yaml # Legacy: Wazuh agent (not used in final arch)
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

# 7. Verify everything
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
| PowerShell | 5.1+ | Shell for Windows commands |

> **Note**: Istio 1.24.0 was initially attempted but discarded due to a critical Helm packaging bug that prevented `demo` profile installation. Version 1.23.3 (LTS) was used instead.

---

## Project Modules

### `/src` — Microservices (TypeScript + Node.js)

Two lightweight, security-agnostic microservices built with strict TypeScript and structured logging.

**Key design decisions:**
- **TypeScript `strict: true`**: Enforces static typing, explicit API contracts, and zero `any` usage.
- **Pino logger**: Ultra-fast JSON logger writing to `stdout`. Kubernetes captures this automatically.
- **Zero security code**: No TLS, no auth, no monitoring SDKs. All security is delegated to the sidecar.
- **Multi-stage Docker builds**: Builder stage compiles TypeScript; production stage runs only compiled JS.

See [`src/README.md`](src/README.md) for detailed code documentation.

---

### `/k8s` — Kubernetes Manifests

Declarative YAML manifests for deploying microservices with health checks, resource limits, and Istio sidecar injection.

**Key design decisions:**
- **ClusterIP Services**: Internal-only exposure. No direct external access to microservices.
- **Readiness/Liveness Probes**: Self-healing via Kubernetes.
- **`imagePullPolicy: Never`**: Uses locally-built images loaded into Kind nodes.
- **No sidecar references**: Istio injects `istio-proxy` automatically via Mutating Webhook.

See [`k8s/README.md`](k8s/README.md) for manifest documentation and troubleshooting.

---

### `/wazuh` — SIEM Integration (Wazuh + Fluent Bit)

Complete log pipeline from Kubernetes nodes to Wazuh Manager.

**Key design decisions:**
- **Fluent Bit over Wazuh Agent**: `wazuh/wazuh-agent:4.9.0` does not exist on Docker Hub. Fluent Bit (CNCF standard) is lighter and purpose-built for Kubernetes.
- **CRI parser**: Kind uses containerd, which writes logs in CRI format (`timestamp stdout F JSON`), incompatible with Docker JSON parser.
- **Standalone Manager**: Full Wazuh stack (Manager + Indexer + Dashboard) requires TLS certificates. For the lab environment, only the Manager is deployed, receiving syslog UDP directly.
- **`syslog_message_key`**: Fluent Bit requires this property to send the actual log body (not just headers).

See [`wazuh/README.md`](wazuh/README.md) for deployment steps, error analysis, and validation.

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

For exhaustive error documentation, see `history/fase-05-siem/errores-y-soluciones.md`.

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

---

## Academic Context

This repository supports the implementation chapter of an undergraduate thesis in Computer Engineering. The thesis proposes a decentralized, non-intrusive security monitoring architecture based on the Sidecar pattern for microservices in Kubernetes.

**Core thesis claims validated by this repo:**
1. The Sidecar pattern enables zero-code security observability.
2. A Service Mesh (Istio) can transparently intercept 100% of East-West and North-South traffic.
3. A SIEM (Wazuh) can centralize security events without requiring agents inside application containers.
4. The computational overhead of the sidecar is measurable and quantifiable (see load test results in `wazuh/README.md`).

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

For the full reference list, see `docs/material/references/`.

---

> **Maintained by:** [Your Name]  
> **License:** MIT (Academic Use)  
> **Last Updated:** 2026-04-26
