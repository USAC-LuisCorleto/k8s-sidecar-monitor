# wazuh — SIEM Integration & Log Pipeline

> End-to-end log pipeline: Fluent Bit DaemonSet collects Kubernetes container logs and forwards them to Wazuh Manager via syslog RFC5424. Includes configurable load testing for empirical sidecar overhead measurement.

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
- [Empirical Results](#empirical-results)
- [Validation](#validation)
- [Success Criteria](#success-criteria)
- [Operational Commands](#operational-commands)

---

## Overview

This directory contains everything needed to establish a **centralized security event pipeline** from the Kubernetes cluster to Wazuh SIEM, plus the infrastructure for measuring the computational overhead of the Sidecar pattern under controlled load.

The pipeline consists of:

1. **Fluent Bit** (inside the cluster): DaemonSet that reads container logs from `/var/log/pods/`, parses CRI format, enriches with Kubernetes metadata, and forwards via syslog UDP.
2. **Wazuh Manager** (outside the cluster): Standalone SIEM receiving syslog on port 514, archiving events to `/var/ossec/logs/archives/archives.log`.
3. **Load Test Jobs** (inside the cluster): Kubernetes Jobs that generate synthetic HTTP traffic at three intensity levels to measure sidecar overhead against a control group.

**Key constraint**: The full Wazuh stack (Manager + Indexer + Dashboard) requires TLS certificates for inter-component communication. To avoid certificate complexity in a lab environment, only the **Manager** is deployed. This is a valid simplification for academic purposes; production deployments would add the Indexer and Dashboard.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              Kubernetes Cluster (Kind)                      │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐   │
│  │ Service-A   │    │ Service-B   │    │ Load Test    │   │
│  │ + Envoy     │    │ + Envoy     │    │ Jobs         │   │
│  │ (stdout)    │    │ (stdout)    │    │              │   │
│  └──────┬──────┘    └──────┬──────┘    └──────┬───────┘   │
│         │                  │                    │            │
│         └────────┬─────────┘────────────────────┘            │
│                  │                                           │
│         ┌────────▼────────┐                                 │
│         │  Fluent Bit     │  DaemonSet (1 per node)         │
│         │  - tail input   │  Reads /var/log/pods/           │
│         │  - cri parser   │  Parses containerd CRI format   │
│         │  - syslog output│  Sends to Wazuh                 │
│         └────────┬────────┘                                 │
└──────────────────┼───────────────────────────────────────────┘
                   │ Syslog RFC5424 UDP 514
                   ▼
        ┌──────────────────────┐
        │   Wazuh Manager      │  Docker Compose (standalone)
        │   - wazuh-remoted    │  Listens UDP 514
        │   - wazuh-analysisd  │  Analyzes with rules
        │   - archives.log     │  Stores all received logs
        └──────────────────────┘
                   │
                   │ docker exec tail -n 5000
                   ▼
        ┌──────────────────────┐
        │  Dashboard Backend   │  Node.js/Express (Docker host)
        │  - Parse syslog      │  Reads archives.log
        │  - Paginate          │  Serves REST API
        │  - Filter            │
        └──────────────────────┘
```

---

## Files

### SIEM & Collection

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Wazuh Manager standalone container with port mappings |
| `fluent-bit-configmap.yaml` | Fluent Bit configuration: CRI parser, syslog output, Parsers_File |
| `fluent-bit-daemonset.yaml` | DaemonSet manifest mounting host logs and ConfigMap |

### Load Testing

| File | Purpose |
|------|---------|
| `load-test-configmap.yaml` | Node.js load test script as ConfigMap |
| `load-test-light.yaml` | Job: 10 concurrent connections, 10 seconds |
| `load-test-medium.yaml` | Job: 50 concurrent connections, 20 seconds |
| `load-test-heavy.yaml` | Job: 100 concurrent connections, 30 seconds |
| `load-test-light-no-istio.yaml` | Job targeting `no-istio` namespace (control group) |
| `load-test-medium-no-istio.yaml` | Job targeting `no-istio` namespace (control group) |
| `load-test-heavy-no-istio.yaml` | Job targeting `no-istio` namespace (control group) |
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

### Error 7: Dashboard backend returns empty `data` array
**Symptom**: `GET /api/logs` returns `{ "data": [], "total": 0 }`.
**Root Cause**: `child_process.exec` default buffer is 1MB. Istio access logs in `archives.log` are very large and exceed this buffer, causing `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`.
**Fix**: Increase `maxBuffer` to 10MB in the backend's `wazuh-reader.ts`:
```javascript
const { stdout } = await execAsync(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
```

### Error 8: Dashboard backend `docker: not found`
**Symptom**: Backend container cannot execute `docker exec`.
**Root Cause**: The Alpine-based Node.js image does not include the Docker CLI.
**Fix**: Install `docker-cli` in the Dockerfile runtime stage:
```dockerfile
RUN apk add --no-cache docker-cli
```

---

## Load Testing

Three Kubernetes Jobs are provided to generate controlled traffic and measure sidecar overhead. Additional Jobs target the `no-istio` namespace for baseline comparison.

| Job | Concurrency | Duration | Target | Purpose |
|-----|-------------|----------|--------|---------|
| `load-test-light.yaml` | 10 | 10s | `service-a:8080/health` | Baseline throughput |
| `load-test-medium.yaml` | 50 | 20s | `service-a:8080/health` | Medium load, CPU scaling |
| `load-test-heavy.yaml` | 100 | 30s | `service-a:8080/health` | Stress test, overhead measurement |
| `load-test-light-no-istio.yaml` | 10 | 10s | `service-a.no-istio.svc.cluster.local:8080/health` | Baseline without sidecar |
| `load-test-medium-no-istio.yaml` | 50 | 20s | `service-a.no-istio.svc.cluster.local:8080/health` | Medium load without sidecar |
| `load-test-heavy-no-istio.yaml` | 100 | 30s | `service-a.no-istio.svc.cluster.local:8080/health` | Stress test without sidecar |

### Running a Load Test (With Sidecar)

```powershell
kubectl apply -f wazuh/load-test-heavy.yaml
kubectl wait --for=condition=complete job/load-test-heavy --timeout=120s
kubectl logs job/load-test-heavy -c load-test
```

### Running a Load Test (Control Group — Without Sidecar)

```powershell
kubectl apply -f wazuh/load-test-heavy-no-istio.yaml
kubectl wait --for=condition=complete job/load-test-heavy-no-istio --timeout=120s
kubectl logs job/load-test-heavy-no-istio -c load-test
```

### Example Results (Heavy Load, With Sidecar)

```json
{
  "target": "http://service-a:8080/health",
  "duration_ms": 30000,
  "concurrency": 100,
  "totalRequests": 141600,
  "errors": 0,
  "throughput_rps": 2704,
  "latency_ms": {
    "avg": 37.16,
    "p50": 35,
    "p95": 89,
    "p99": 102
  }
}
```

---

## Empirical Results

### Comparative Performance (Heavy Load)

| Metric | With Sidecar (Istio) | Without Sidecar (Baseline) | Overhead |
|--------|----------------------|---------------------------|----------|
| Throughput | 2,704 r/s | 2,779 r/s | **-2.7%** |
| Avg Latency | 37.16 ms | 35.82 ms | **+3.7%** |
| P99 Latency | 102 ms | 96 ms | **+6.3%** |
| Pod CPU (total) | ~1,550 m | ~480 m | **+213%** |
| Pod Memory (total) | ~115 Mi | ~70 Mi | ~+35 Mi |

### Resource Breakdown (With Sidecar, Heavy Load)

| Container | Baseline CPU | Heavy Load CPU | Baseline Memory | Heavy Load Memory |
|-----------|-------------|----------------|-----------------|-------------------|
| service-a (app) | 3m | 516m | 70 Mi | 77 Mi |
| service-a (istio-proxy) | ~1m | **1,042m** | ~30 Mi | 37 Mi |
| service-b (app) | 3m | 6m | 69 Mi | 68 Mi |
| service-b (istio-proxy) | ~1m | ~4m | ~30 Mi | ~30 Mi |
| Fluent Bit | 3m | 223m | 31 Mi | 38 Mi |

**Key finding**: The `istio-proxy` sidecar consumes **twice the CPU** of the application container under heavy load (1,042m vs 516m), demonstrating the measurable computational tradeoff of the Sidecar pattern. Network latency impact is minimal (~3-6%).

### Multi-Level Load Results (With Sidecar)

| Test Level | Concurrency | Throughput (r/s) | Avg Latency (ms) | P99 Latency (ms) |
|------------|-------------|------------------|------------------|------------------|
| Light | 10 | 2,168 | 4.58 | 12 |
| Medium | 50 | 2,942 | 16.94 | 56 |
| Heavy | 100 | 2,704 | 37.16 | 102 |

**Observation**: Throughput scales sub-linearly with concurrency. The system reaches saturation around medium load; heavy load shows slightly lower throughput due to increased context switching and Envoy connection management overhead.

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

### Verify Log Volume Under Load

```powershell
# Before load test
wc -l /var/ossec/logs/archives/archives.log

# After load test
docker exec wazuh-manager wc -l /var/ossec/logs/archives/archives.log
# Should show significant increase (3,000+ new lines for heavy load)
```

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
| 7 | Load test completes without errors | `kubectl logs job/load-test-heavy -c load-test` shows `errors: 0` |
| 8 | Sidecar overhead is measurable | `kubectl top pods` shows `istio-proxy` consuming more CPU than app container |

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

# Run a quick load test
kubectl apply -f wazuh/load-test-light.yaml
kubectl wait --for=condition=complete job/load-test-light --timeout=60s
kubectl logs job/load-test-light -c load-test

# Stop everything
docker compose down          # Stops Wazuh
kubectl delete -f wazuh/     # Removes Fluent Bit
kubectl delete -f k8s/       # Removes microservices

# Complete cleanup (including volumes)
docker compose down -v
```

---

## Related Documentation

- [Root README](../README.md) — Architecture overview, empirical results, and quick start
- [k8s/README.md](../k8s/README.md) — Kubernetes deployment manifests and security policies
- [src/README.md](../src/README.md) — Microservice and Dashboard code documentation
- [scripts/README.md](../scripts/README.md) — Lab lifecycle TUI
