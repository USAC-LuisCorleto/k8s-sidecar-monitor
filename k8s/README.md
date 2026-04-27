# k8s — Kubernetes Manifests

> Declarative manifests for deploying microservices with automatic Istio sidecar injection.

---

## Table of Contents

- [Overview](#overview)
- [Files](#files)
- [Design Decisions](#design-decisions)
- [Deployment Order](#deployment-order)
- [Validation](#validation)
- [Common Errors](#common-errors)
- [Success Criteria](#success-criteria)

---

## Overview

This directory contains all Kubernetes manifests required to deploy the `service-a` (Gateway) and `service-b` (Processor) microservices. The manifests are designed to work with Istio's automatic sidecar injection, meaning **no sidecar references exist in these files** — Istio adds the `istio-proxy` container automatically via Mutating Webhook when the Pod is created in the `default` namespace (which must be labeled `istio-injection=enabled`).

---

## Files

| File | Resource Type | Description |
|------|---------------|-------------|
| `service-a-deployment.yaml` | Deployment | Defines Service-A Gateway: 1 replica, Node.js image, port 8080, health probes, env var pointing to Service-B |
| `service-a-service.yaml` | Service (ClusterIP) | Exposes Service-A internally on port 8080 via DNS `service-a:8080` |
| `service-b-deployment.yaml` | Deployment | Defines Service-B Processor: 1 replica, Node.js image, port 8080, health probes |
| `service-b-service.yaml` | Service (ClusterIP) | Exposes Service-B internally on port 8080 via DNS `service-b:8080` |

---

## Design Decisions

### Why ClusterIP?

Both Services use `type: ClusterIP`, which means they are **only accessible from within the cluster**. This is intentional:

- **Service-A** (Gateway) receives external traffic through the Istio Ingress Gateway, not directly.
- **Service-B** (Processor) is an internal-only service; only Service-A should call it.

This minimizes the attack surface and follows the zero-trust principle: no service is exposed more than necessary.

### Why `imagePullPolicy: Never`?

The images `service-a:latest` and `service-b:latest` are built locally and loaded into Kind nodes via `kind load docker-image`. The `Never` policy tells Kubernetes to **not attempt to pull from Docker Hub**, avoiding `ImagePullBackOff` errors.

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

# 2. Apply all manifests
kubectl apply -f k8s/

# 3. Verify
kubectl get pods
# Expected: service-a-xxxxx  2/2 Running
#           service-b-xxxxx  2/2 Running

kubectl get svc
# Expected: service-a  ClusterIP  10.96.x.x  <none>  8080/TCP
#           service-b  ClusterIP  10.96.x.x  <none>  8080/TCP
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
kubectl exec -it deploy/service-a -c service-a -- sh
wget -qO- http://service-b:8080/health
```

Expected: `{"status":"ok"}` or similar JSON response.

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

---

## Success Criteria

| Check | Command | Expected Result |
|-------|---------|-----------------|
| Pods are Running with 2/2 containers | `kubectl get pods` | Both Pods show `2/2 Running` |
| Services are created | `kubectl get svc` | `service-a` and `service-b` exist with ClusterIP |
| DNS resolution works | `nslookup service-b` from inside service-a Pod | Resolves to ClusterIP |
| Sidecar is injected | `kubectl describe pod -l app=service-a` | Shows `istio-proxy` container and `istio-init` init container |
| No `ImagePullBackOff` | `kubectl get pods` | No Pods in `ImagePullBackOff` or `ErrImagePull` |

---

## Related Documentation

- [Root README](../README.md) — Architecture overview and quick start
- [wazuh/README.md](../wazuh/README.md) — SIEM integration and log pipeline
- [src/README.md](../src/README.md) — Microservice code documentation
