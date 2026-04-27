# wazuh — SIEM Integration & Log Pipeline

> End-to-end log pipeline: Fluent Bit DaemonSet collects Kubernetes container logs and forwards them to Wazuh Manager via syslog RFC5424.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Files](#files)
- [Why Fluent Bit Instead of Wazuh Agent?](#why-fluent-bit-instead-of-wazuh-agent)
- [Deployment Steps](#deployment-steps)
- [Configuration Deep Dive](#configuration-deep-dive)
- [Common Errors & Resolution](#common-errors--resolution)
- [Load Testing](#load-testing)
- [Validation](#validation)
- [Success Criteria](#success-criteria)
- [Operational Commands](#operational-commands)

---

## Overview

This directory contains everything needed to establish a **centralized security event pipeline** from the Kubernetes cluster to Wazuh SIEM. The pipeline consists of:

1. **Fluent Bit** (inside the cluster): DaemonSet that reads container logs from `/var/log/pods/`, parses CRI format, enriches with Kubernetes metadata, and forwards via syslog UDP.
2. **Wazuh Manager** (outside the cluster): Standalone SIEM receiving syslog on port 514, archiving events to `/var/ossec/logs/archives/archives.log`.

**Key constraint**: The full Wazuh stack (Manager + Indexer + Dashboard) requires TLS certificates for inter-component communication. To avoid certificate complexity in a lab environment, only the **Manager** is deployed. This is a valid simplification for academic purposes; production deployments would add the Indexer and Dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Kubernetes Cluster (Kind)                      │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │ Service-A   │    │ Service-B   │                        │
│  │ + Envoy     │    │ + Envoy     │                        │
│  │ (stdout)    │    │ (stdout)    │                        │
│  └──────┬──────┘    └──────┬──────┘                        │
│         │                  │                                │
│         └────────┬─────────┘                                │
│                  │                                          │
│         ┌────────▼────────┐                                │
│         │  Fluent Bit     │  DaemonSet (1 per node)        │
│         │  - tail input   │  Reads /var/log/pods/          │
│         │  - cri parser   │  Parses containerd CRI format  │
│         │  - syslog output│  Sends to Wazuh                │
│         └────────┬────────┘                                │
└──────────────────┼──────────────────────────────────────────┘
                   │ Syslog RFC5424 UDP 514
                   ▼
        ┌──────────────────────┐
        │   Wazuh Manager      │  Docker Compose (standalone)
        │   - wazuh-remoted    │  Listens UDP 514
        │   - wazuh-analysisd  │  Analyzes with rules
        │   - archives.log     │  Stores all received logs
        └──────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Wazuh Manager standalone container with port mappings |
| `fluent-bit-configmap.yaml` | Fluent Bit configuration: CRI parser, syslog output, Parsers_File |
| `fluent-bit-daemonset.yaml` | DaemonSet manifest mounting host logs and ConfigMap |
| `load-test-configmap.yaml` | Node.js load test script as ConfigMap |
| `load-test-light.yaml` | Job: 10 concurrent connections, 10 seconds |
| `load-test-medium.yaml` | Job: 50 concurrent connections, 20 seconds |
| `load-test-heavy.yaml` | Job: 100 concurrent connections, 30 seconds |
| `load-test-script.js` | Standalone Node.js load test script (for local use) |
| `wazuh-agent-daemonset.yaml` | Legacy: attempted Wazuh agent deployment (not used) |

---

## Why Fluent Bit Instead of Wazuh Agent?

Initially, the plan was to deploy the official `wazuh/wazuh-agent` as a DaemonSet. However:

| Issue | Detail |
|-------|--------|
| Image not found | `docker pull wazuh/wazuh-agent:4.9.0` returned `not found` on Docker Hub |
| Alternative versions | `4.9.1` and `4.8.2` were also unavailable at the time of implementation |
| Strategic pivot | Fluent Bit is the CNCF standard for Kubernetes log collection, lighter (~50 MB vs ~200 MB), and purpose-built for `/var/log/pods/` |

Fluent Bit also provides Kubernetes metadata enrichment (Pod name, namespace, labels) natively, which the Wazuh agent would require additional configuration to achieve.

---

## Deployment Steps

### Step 1: Start Wazuh Manager

```powershell
cd wazuh
docker compose up -d
```

Wait 2-3 minutes for the Manager to fully initialize.

### Step 2: Configure Wazuh for Syslog Reception

By default, Wazuh does **not** listen for remote syslog. You must modify `ossec.conf` inside the container:

```powershell
# 1. Enter the container
docker exec -it wazuh-manager bash

# 2. Edit the remote section in /var/ossec/etc/ossec.conf
# Replace the existing <remote> block with:
<remote>
  <connection>syslog</connection>
  <port>514</port>
  <protocol>udp</protocol>
  <allowed-ips>0.0.0.0/0</allowed-ips>
</remote>

# 3. Restart Wazuh
/var/ossec/bin/wazuh-control restart
```

**Critical**: Do NOT include `<queue_size>` in syslog mode — it is only valid for `secure` (agent) connections.

### Step 3: Deploy Fluent Bit

```powershell
kubectl apply -f wazuh/fluent-bit-configmap.yaml
kubectl apply -f wazuh/fluent-bit-daemonset.yaml
```

### Step 4: Verify Fluent Bit Pods

```powershell
kubectl get pods -l app=fluent-bit
# Expected: 2 Pods Running (one per worker node)
```

### Step 5: Verify Log Reception

```powershell
# Check Wazuh archives
docker exec wazuh-manager tail -f /var/ossec/logs/archives/archives.log

# Look for entries like:
# 2026 Apr 26 22:39:03 wazuh-manager->172.21.0.3 ... {"level":"info",...,"msg":"Peticion recibida"}
```

---

## Configuration Deep Dive

### Fluent Bit ConfigMap

The ConfigMap contains two files:

1. **`fluent-bit.conf`** — Main configuration
2. **`parsers.conf`** — Custom CRI parser definition

#### CRI Parser (Critical for Kind)

Kind uses **containerd**, which writes logs in CRI format:

```
2026-04-26T08:34:46.391056549Z stdout F {"level":"info","msg":"Peticion recibida"}
```

The default `docker` parser expects Docker JSON format and **cannot parse CRI lines**. The custom parser uses regex:

```ini
[PARSER]
    Name        cri
    Format      regex
    Regex       ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>[^ ]*) (?<message>.*)$
    Time_Key    time
    Time_Format %Y-%m-%dT%H:%M:%S.%L%z
    Time_Keep   On
```

#### Syslog Output Configuration

```ini
[OUTPUT]
    Name                  syslog
    Match                 *
    Host                  172.21.0.5    # Wazuh Manager IP on kind network
    Port                  514
    Mode                  udp
    syslog_format         rfc5424
    syslog_hostname_preset kubernetes-cluster
    syslog_appname_preset  fluent-bit
    syslog_facility_preset user
    syslog_message_key    message       # <-- CRITICAL: sends the log body
```

**Without `syslog_message_key`**, Fluent Bit only sends syslog headers (timestamp, hostname, appname) and the actual JSON log content is lost.

#### DaemonSet Volume Mounts

The DaemonSet mounts:
- `/var/log/pods` from the host → Fluent Bit can read all container logs
- `/var/lib/docker/containers` → Backup input for Docker logs
- `fluent-bit-config` ConfigMap → `fluent-bit.conf`
- `fluent-bit-config` ConfigMap → `parsers.conf` (same ConfigMap, different subPath)

**Important**: The original DaemonSet referenced a non-existent ConfigMap `fluent-bit-parsers` for `parsers.conf`. This was corrected to use the same `fluent-bit-config` ConfigMap.

---

## Common Errors & Resolution

### Error 1: `ErrImagePull` on Wazuh Agent
**Symptom**: `kubectl get pods` shows `ErrImagePull` for `wazuh-agent` Pods.
**Root Cause**: `wazuh/wazuh-agent:4.9.0` does not exist on Docker Hub.
**Fix**: Use Fluent Bit instead. See `fluent-bit-daemonset.yaml`.

### Error 2: `parser 'cri' is not registered`
**Symptom**: Fluent Bit logs show `parser 'cri' is not registered`.
**Root Cause**: `parsers.conf` was mounted from a non-existent ConfigMap (`fluent-bit-parsers`).
**Fix**: Update `fluent-bit-daemonset.yaml` to mount `parsers.conf` from `fluent-bit-config` ConfigMap.

### Error 3: Wazuh Manager does not listen on UDP 514
**Symptom**: `netstat` shows no listener on port 514.
**Root Cause**: `<connection>syslog</connection>` requires `<allowed-ips>` or Wazuh silently disables the listener.
**Fix**: Add `<allowed-ips>0.0.0.0/0</allowed-ips>` to `<remote>` in `ossec.conf` and restart.

### Error 4: `Invalid option <queue_size> for Syslog remote connection`
**Symptom**: Wazuh fails to start after editing `ossec.conf`.
**Root Cause**: `<queue_size>` is invalid in `syslog` mode (only valid in `secure` mode).
**Fix**: Remove `<queue_size>` from the `<remote>` section.

### Error 5: Logs arrive at Wazuh but only show metadata (no JSON body)
**Symptom**: `archives.log` shows `fluent-bit - - - - - -` with no payload.
**Root Cause**: Fluent Bit syslog output does not know which record field to send as the message body.
**Fix**: Add `syslog_message_key message` to the `[OUTPUT]` section.

### Error 6: `host.docker.internal` does not resolve from Kind nodes
**Symptom**: Fluent Bit cannot connect to Wazuh.
**Root Cause**: Kind nodes run in isolated Docker containers; `host.docker.internal` is not available.
**Fix**: Connect Wazuh container to the `kind` network and use its IP (e.g., `172.21.0.5`).

---

## Load Testing

Three Kubernetes Jobs are provided to generate controlled traffic and measure sidecar overhead.

| Job | Concurrency | Duration | Purpose |
|-----|-------------|----------|---------|
| `load-test-light.yaml` | 10 | 10s | Baseline throughput measurement |
| `load-test-medium.yaml` | 50 | 20s | Medium load, observe CPU scaling |
| `load-test-heavy.yaml` | 100 | 30s | Stress test, measure sidecar overhead |

### Running a Load Test

```powershell
kubectl apply -f wazuh/load-test-light.yaml
kubectl wait --for=condition=complete job/load-test-light --timeout=60s
kubectl logs job/load-test-light -c load-test
```

### Example Results (Heavy Load)

```json
{
  "target": "http://service-a:8080/health",
  "duration_ms": 30000,
  "concurrency": 100,
  "totalRequests": 141600,
  "errors": 0,
  "throughput_rps": 4720,
  "latency_ms": {
    "avg": 21.06,
    "p50": 18,
    "p95": 43,
    "p99": 56
  }
}
```

### Resource Consumption Under Load

| Container | Baseline CPU | Heavy Load CPU | Baseline Memory | Heavy Load Memory |
|-----------|-------------|----------------|-----------------|-------------------|
| service-a (app) | 3m | 516m | 70 Mi | 77 Mi |
| service-a (istio-proxy) | ~1m | **1,042m** | ~30 Mi | 37 Mi |

**Key finding**: The `istio-proxy` sidecar consumes **twice the CPU** of the application container under heavy load, demonstrating the measurable overhead of the Sidecar pattern.

---

## Validation

### Verify Fluent Bit is Reading Pod Logs

```powershell
kubectl logs -l app=fluent-bit --tail=20
```

Look for lines like:
```
[inotify_fs_add]: inode=602129 name=/var/log/pods/default_service-a-.../service-a/0.log
```

### Verify Wazuh Receives Logs

```powershell
docker exec wazuh-manager tail -n 50 /var/ossec/logs/archives/archives.log
```

Expected: Lines containing `172.21.0.2` or `172.21.0.3` with JSON payloads.

### Verify Specific Service Logs

```powershell
docker exec wazuh-manager bash -c "grep 'Peticion recibida' /var/ossec/logs/archives/archives.log | tail -n 5"
```

Expected: JSON log entries from `service-a` and `service-b`.

---

## Success Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Wazuh Manager container is running | `docker compose ps` shows `wazuh-manager` in `running` state |
| 2 | Fluent Bit Pods are Running | `kubectl get pods -l app=fluent-bit` shows all Pods `Running` |
| 3 | Wazuh listens on UDP 514 | `docker exec wazuh-manager ss -ulnp | grep 514` shows listener |
| 4 | `archives.log` contains entries | `wc -l /var/ossec/logs/archives/archives.log` shows > 1000 lines |
| 5 | JSON payload is complete | `grep -i 'method.*GET' archives.log` shows JSON with HTTP fields |
| 6 | Logs come from both nodes | `grep '172.21.0.2' archives.log` and `grep '172.21.0.3' archives.log` both return results |

---

## Operational Commands

```powershell
# Restart Wazuh Manager
docker compose restart

# View Wazuh Manager logs in real-time
docker logs -f wazuh-manager

# Restart Fluent Bit
kubectl rollout restart daemonset fluent-bit

# Check Fluent Bit logs for errors
kubectl logs -l app=fluent-bit --tail=50

# Stop everything
docker compose down          # Stops Wazuh
kubectl delete -f wazuh/     # Removes Fluent Bit
kubectl delete -f k8s/       # Removes microservices

# Complete cleanup (including volumes)
docker compose down -v
```

---

## Related Documentation

- [Root README](../README.md) — Architecture overview and quick start
- [k8s/README.md](../k8s/README.md) — Kubernetes deployment manifests
- [src/README.md](../src/README.md) — Microservice code documentation
