# k8s — Kubernetes Manifests

> Declarative manifests for deploying microservices with automatic Istio sidecar injection, zero-trust security policies, and a real-time log Dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Files](#files)
- [Design Decisions](#design-decisions)
- [Deployment Order](#deployment-order)
- [Security Policies](#security-policies)
- [Control Group (no-istio)](#control-group-no-istio)
- [Dashboard Deployment](#dashboard-deployment)
- [Validation](#validation)
- [Common Errors](#common-errors)
- [Success Criteria](#success-criteria)

---

## Overview

This directory contains all Kubernetes manifests required to deploy the `service-a` (Gateway) and `service-b` (Processor) microservices, the Istio security policies, and the Dashboard frontend. The manifests are designed to work with Istio's automatic sidecar injection, meaning **no sidecar references exist in the microservice YAML files** — Istio adds the `istio-proxy` container automatically via Mutating Webhook when the Pod is created in the `default` namespace (which must be labeled `istio-injection=enabled`).

Additionally, this directory contains **security policy manifests** (`PeerAuthentication`, `AuthorizationPolicy`) that enforce zero-trust communication within the mesh, and a **control group namespace** (`no-istio`) for empirical baseline testing.

---

## Files

### Microservices

| File | Resource Type | Description |
|------|---------------|-------------|
| `service-a-deployment.yaml` | Deployment | Defines Service-A Gateway: 1 replica, Node.js image, port 8080, health probes, env var pointing to Service-B |
| `service-a-service.yaml` | Service (ClusterIP) | Exposes Service-A internally on port 8080 via DNS `service-a:8080` |
| `service-b-deployment.yaml` | Deployment | Defines Service-B Processor: 1 replica, Node.js image, port 8080, health probes |
| `service-b-service.yaml` | Service (ClusterIP) | Exposes Service-B internally on port 8080 via DNS `service-b:8080` |

### Security Policies

| File | Resource Type | Description |
|------|---------------|-------------|
| `peer-authentication.yaml` | PeerAuthentication | Enforces mTLS STRICT for all workloads in the `default` namespace |
| `authorization-policy.yaml` | AuthorizationPolicy | Denies access to `/internal/process` from outside the `default` namespace |

### Dashboard

| File | Resource Type | Description |
|------|---------------|-------------|
| `dashboard/frontend-deployment.yaml` | Deployment | Angular 17 SPA served by Nginx, proxying `/api` to backend |
| `dashboard/frontend-service.yaml` | Service (NodePort) | Exposes Dashboard on port 80 (or NodePort for local access) |

---

## Design Decisions

### Why ClusterIP?

Both Services use `type: ClusterIP`, which means they are **only accessible from within the cluster**. This is intentional:

- **Service-A** (Gateway) receives external traffic through the Istio Ingress Gateway, not directly.
- **Service-B** (Processor) is an internal-only service; only Service-A should call it.

This minimizes the attack surface and follows the zero-trust principle: no service is exposed more than necessary.

### Why `imagePullPolicy: Never`?

The images `service-a:latest`, `service-b:latest`, and `dashboard-frontend:latest` are built locally and loaded into Kind nodes via `kind load docker-image`. The `Never` policy tells Kubernetes to **not attempt to pull from Docker Hub**, avoiding `ImagePullBackOff` errors.

### Health Probes

Both Deployments define:

- **Readiness Probe** (`/health`, every 5s): Kubernetes only routes traffic to the Pod when this passes.
- **Liveness Probe** (`/health`, every 10s, 10s initial delay): Kubernetes restarts the Pod if the app stops responding.

This provides **self-healing**: if a microservice crashes or deadlocks, Kubernetes automatically recreates it.

### Resource Limits

While not strictly required for a local lab, the manifests can be extended with `resources.requests` and `resources.limits` to simulate production-grade resource management. Example:

```yaml
resources:
  requests:
    memory: "64Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

---

## Deployment Order

The manifests are independent and can be applied in any order, but the recommended flow is:

```powershell
# 1. Ensure Istio is installed and namespace is labeled
kubectl label namespace default istio-injection=enabled --overwrite

# 2. Apply microservices
kubectl apply -f k8s/service-a-deployment.yaml
kubectl apply -f k8s/service-a-service.yaml
kubectl apply -f k8s/service-b-deployment.yaml
kubectl apply -f k8s/service-b-service.yaml

# 3. Apply security policies (optional, for zero-trust validation)
kubectl apply -f k8s/peer-authentication.yaml
kubectl apply -f k8s/authorization-policy.yaml

# 4. Apply Dashboard (optional, for observability)
kubectl apply -f k8s/dashboard/

# 5. Verify
kubectl get pods
# Expected: service-a-xxxxx  2/2 Running
#           service-b-xxxxx  2/2 Running
#           dashboard-frontend-xxxxx  2/2 Running

kubectl get svc
# Expected: service-a  ClusterIP  10.96.x.x  <none>  8080/TCP
#           service-b  ClusterIP  10.96.x.x  <none>  8080/TCP
```

---

## Security Policies

### PeerAuthentication (mTLS STRICT)

File: `k8s/peer-authentication.yaml`

```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: default
spec:
  mtls:
    mode: STRICT
```

**Effect**: All traffic within the `default` namespace **requires** mutual TLS certificates. Connections without a valid mTLS certificate are rejected at the TCP level (connection reset).

**Validation**:
```powershell
# From within the mesh (should succeed)
kubectl exec deploy/service-a -c service-a -- wget -qO- http://service-b:8080/internal/process
# Output: HTTP 200 OK with JSON payload

# From outside the mesh (should fail)
kubectl run test-outside -n no-istio --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://service-b.default.svc.cluster.local:8080/internal/process
# Output: Connection reset by peer
```

### AuthorizationPolicy (DENY External Access)

File: `k8s/authorization-policy.yaml`

```yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: deny-external-access
  namespace: default
spec:
  selector:
    matchLabels:
      app: service-b
  action: DENY
  rules:
    - from:
        - source:
            notNamespaces: ["default"]
      to:
        - operation:
            methods: ["GET"]
            paths: ["/internal/process"]
```

**Effect**: The endpoint `/internal/process` of `service-b` is **blocked** for any origin that is NOT in the `default` namespace. The response is HTTP 403 Forbidden.

**Validation**:
```powershell
# Temporarily remove PeerAuthentication to test only AuthorizationPolicy
kubectl delete peerauthentication default -n default

# From outside the mesh (should get 403)
kubectl run test-403 -n no-istio --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://service-b.default.svc.cluster.local:8080/internal/process
# Output: wget: server returned error: HTTP/1.1 403 Forbidden

# Restore mTLS STRICT
kubectl apply -f k8s/peer-authentication.yaml
```

**Combined Effect**: The two policies provide **defense in depth**:
- `PeerAuthentication` STRICT blocks plaintext connections at TCP level.
- `AuthorizationPolicy` blocks unauthorized namespaces at HTTP level.
- Together they implement a **zero-trust** posture within the Service Mesh.

---

## Control Group (no-istio)

For empirical baseline comparison, an identical set of microservices is deployed in the `no-istio` namespace **without** sidecar injection. This isolates the overhead attributable to the Sidecar pattern.

```powershell
# Deploy control group
kubectl apply -f k8s-no-istio/

# Verify: Pods should show READY 1/1 (no sidecar)
kubectl get pods -n no-istio
```

**Manifests in `k8s-no-istio/`:**
- `service-a-deployment.yaml` — Same as default but no Istio labels
- `service-b-deployment.yaml` — Same as default but no Istio labels
- `service-a-service.yaml` — DNS: `service-a.no-istio.svc.cluster.local`
- `service-b-service.yaml` — DNS: `service-b.no-istio.svc.cluster.local`

---

## Dashboard Deployment

The Dashboard frontend runs in Kubernetes and proxies API requests to the backend running on the Docker host.

### Architecture

```
Browser
  |
  | kubectl port-forward svc/dashboard-frontend 8888:80
  v
Nginx (Pod in Kubernetes)
  |-- /api/*  --> proxy_pass http://host.docker.internal:3000
  |-- /*      --> try_files /index.html (Angular SPA)
```

**Why `host.docker.internal`?** The backend cannot run inside Kind because it needs access to the host Docker socket to execute `docker exec` on the Wazuh container. Kind nodes are isolated containers without the host socket.

### Access

```powershell
# Port-forward from Kubernetes to localhost
kubectl port-forward svc/dashboard-frontend 8888:80 -n default

# Open browser
# http://localhost:8888
```

---

## Validation

### Check Pod Status

```powershell
kubectl get pods
```

**Expected output:**
```
NAME                         READY   STATUS    RESTARTS   AGE
service-a-6464d655cd-7kwn4   2/2     Running   0          30s
service-b-f44b46bb9-d94pm    2/2     Running   0          30s
```

The `2/2` in the `READY` column is the **single most important validation** of this entire architecture. It proves that Istio injected the sidecar successfully.

### Describe the Pod (Technical Evidence)

```powershell
kubectl describe pod -l app=service-a
```

Look for:
- **Init Containers**: `istio-init` with state `Terminated: Completed`
- **Containers**: `service-a` (Running) and `istio-proxy` (Running)
- **Annotations**: `sidecar.istio.io/status` confirming injection
- **Labels**: `security.istio.io/tlsMode: istio` confirming mesh membership

### Test Internal Communication

```powershell
# From inside the service-a Pod
kubectl exec deploy/service-a -c service-a -- wget -qO- http://service-b:8080/health
```

Expected: `{"status":"ok"}` or similar JSON response.

### Test Security Policies

```powershell
# Verify mTLS STRICT is applied
kubectl get peerauthentication -n default -o yaml

# Verify AuthorizationPolicy exists
kubectl get authorizationpolicy -n default

# Test from within mesh (should pass)
kubectl exec deploy/service-a -c service-a -- wget -qO- http://service-b:8080/internal/process

# Test from outside mesh (should fail with 403 or connection reset)
kubectl run test-deny -n no-istio --image=busybox:1.36 --rm -i --restart=Never -- wget -qO- http://service-b.default.svc.cluster.local:8080/internal/process
```

---

## Common Errors

### `ImagePullBackOff` or `ErrImagePull`
**Cause**: Kubernetes is trying to pull `service-a:latest` from Docker Hub, but it doesn't exist there.
**Fix**: Build the image locally and load it into Kind:
```powershell
docker build -t service-a:latest ./src/service-a
kind load docker-image service-a:latest --name sidecar-thesis
```

### `CrashLoopBackOff`
**Cause**: The application is crashing on startup. Common causes: missing environment variables, port conflicts, or TypeScript compilation errors.
**Fix**: Check logs:
```powershell
kubectl logs deploy/service-a -c service-a
```

### Pod shows `1/1` instead of `2/2`
**Cause**: Istio injection is not enabled on the namespace.
**Fix**:
```powershell
kubectl label namespace default istio-injection=enabled
kubectl delete pod -l app=service-a  # Force recreation
```

### `connection refused` when calling Service-B from Service-A
**Cause**: Service-B Pod is not ready, or the Service selector doesn't match the Pod labels.
**Fix**:
```powershell
kubectl get endpoints service-b
# Should show the Pod IP. If empty, check labels.
```

### Dashboard frontend shows blank page after refresh
**Cause**: Angular is a Single Page Application (SPA). Direct access to `/logs` or `/filter` routes returns 404 from Nginx.
**Fix**: The Nginx config must include `try_files $uri $uri/ /index.html;` for all non-API routes. Already present in `src/dashboard-frontend/nginx.conf`.

---

## Success Criteria

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Pods are Running with 2/2 containers | `kubectl get pods` | Both Pods show `2/2 Running` |
| Services are created | `kubectl get svc` | `service-a` and `service-b` exist with ClusterIP |
| DNS resolution works | `nslookup service-b` from inside service-a Pod | Resolves to ClusterIP |
| Sidecar is injected | `kubectl describe pod -l app=service-a` | Shows `istio-proxy` container and `istio-init` init container |
| No `ImagePullBackOff` | `kubectl get pods` | No Pods in `ImagePullBackOff` or `ErrImagePull` |
| mTLS STRICT is enforced | `kubectl get peerauthentication -n default` | Shows `mtls.mode: STRICT` |
| AuthorizationPolicy is active | `kubectl get authorizationpolicy -n default` | Shows `deny-external-access` policy |
| Dashboard frontend is accessible | `kubectl port-forward svc/dashboard-frontend 8888:80` | Opens on `localhost:8888` |

---

## Related Documentation

- [Root README](../README.md) — Architecture overview, empirical results, and quick start
- [wazuh/README.md](../wazuh/README.md) — SIEM integration, log pipeline, and load testing
- [src/README.md](../src/README.md) — Microservice and Dashboard code documentation
- [scripts/README.md](../scripts/README.md) — Lab lifecycle TUI
