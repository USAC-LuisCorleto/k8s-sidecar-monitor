# scripts — Lab Lifecycle TUI

> Interactive command-line interface for managing the entire Sidecar monitoring lab environment. Provides guided setup, real-time status monitoring, and safe teardown.

---

## Table of Contents

- [Overview](#overview)
- [Files](#files)
- [Installation](#installation)
- [Usage](#usage)
  - [Interactive TUI](#interactive-tui)
  - [Setup Wizard](#setup-wizard)
  - [Cleanup](#cleanup)
- [Environment Checks](#environment-checks)
- [Common Errors](#common-errors)
- [Success Criteria](#success-criteria)

---

## Overview

The scripts in this directory provide a **Terminal User Interface (TUI)** for managing the complete lifecycle of the Sidecar monitoring lab. Instead of memorizing dozens of `kubectl`, `docker`, and `istioctl` commands, users can interactively set up, monitor, and tear down the entire environment through a menu-driven interface.

**Key features:**
- **Real-time status dashboard**: Shows health of Docker, Kind cluster, kubectl context, microservice Pods, Wazuh Manager, and Fluent Bit — all in one view.
- **Guided setup wizard**: 7-step interactive setup with validation at each step.
- **Safe cleanup**: Multiple confirmation levels to prevent accidental destruction.
- **Idempotent operations**: Safe to run setup multiple times; skips already-completed steps.

---

## Files

| File | Purpose |
|------|---------|
| `tui.js` | Main interactive menu. Launches the full TUI with status display and action selection. |
| `setup.js` | Guided 7-step setup wizard: checks environment, creates cluster, installs Istio, builds images, deploys microservices, starts Wazuh, deploys Fluent Bit. |
| `cleanup.js` | Safe teardown with confirmation prompts. Supports partial (cluster only) or full (cluster + Docker volumes + images) cleanup. |
| `lib/checks.js` | Reusable environment health check functions: `checkDocker`, `checkKindCluster`, `checkPods`, `checkWazuh`, `checkFluentBit`. |
| `lib/colors.js` | Terminal color and formatting helpers: `banner`, `success`, `error`, `info`, `warn`, `step`, `divider`. |
| `package.json` | NPM manifest with dependencies: `chalk`, `enquirer`, `ora`. |

---

## Installation

```powershell
cd scripts
npm install
```

Dependencies:
- `chalk` (^4.1.2) — Terminal string styling
- `enquirer` (^2.4.1) — Interactive prompts and menus
- `ora` (^5.4.1) — Elegant terminal spinners

---

## Usage

### Interactive TUI

```powershell
cd scripts
npm start
```

The TUI displays:
```
  K8S SIDECAR MONITOR — Lab Lifecycle Manager
  Arquitectura de Monitoreo No Intrusiva

  Estado del entorno:

  ●  Docker               Docker Desktop esta corriendo.
  ●  Kind Cluster         Cluster Kind "sidecar-thesis" ya existe.
  ●  kubectl Context      Contexto kubectl activo: kind-sidecar-thesis
  ●  Microservicios       6/6 Pods en Running.
  ●  Wazuh Manager        Wazuh Manager esta corriendo.
  ●  Fluent Bit           2 Pod(s) de Fluent Bit en Running.

  ✔  Todo el laboratorio esta levantado y operativo.

  Que desea hacer?
  > setup
    status
    cleanup
```

**Menu options:**
- **setup**: Runs the full 7-step guided setup wizard.
- **status**: Refreshes and displays the current environment status.
- **cleanup**: Launches the safe teardown process.

### Setup Wizard

```powershell
cd scripts
node setup.js
```

Steps (with validation at each):
1. **Check prerequisites**: Verifies Docker Desktop, Kind, kubectl, and istioctl are installed.
2. **Create Kind cluster**: Creates `sidecar-thesis` cluster with 1 control-plane + 2 workers (idempotent — skips if cluster exists).
3. **Install Istio**: Installs Istio 1.23.3 with `demo` profile and labels `default` namespace for auto-injection.
4. **Build Docker images**: Builds `service-a`, `service-b`, `dashboard-backend`, and `dashboard-frontend` images.
5. **Load images into Kind**: Pushes locally-built images into the Kind cluster nodes.
6. **Deploy microservices**: Applies all manifests in `k8s/` and waits for Pods to be Ready.
7. **Start Wazuh + Fluent Bit**: Starts Wazuh Manager via Docker Compose and deploys Fluent Bit DaemonSet.

Each step displays a spinner and color-coded success/error messages. If a step fails, the wizard stops and reports the error without continuing.

### Cleanup

```powershell
cd scripts
node cleanup.js
```

The cleanup script provides multiple confirmation levels:
1. **Warning**: Explains that cleanup will delete the cluster, containers, images, and volumes.
2. **Confirmation prompt**: Asks `Are you sure?` with `initial: false` to prevent accidental yes.
3. **Level selection**: Choose between:
   - **Partial**: Deletes Kind cluster and Kubernetes resources only.
   - **Full**: Deletes Kind cluster, Docker volumes, unused images, and prune networks.

**Non-interactive mode**: Set `NON_INTERACTIVE=1` environment variable to skip prompts (useful for CI/CD or automation):
```powershell
$env:NON_INTERACTIVE=1; node cleanup.js
```

---

## Environment Checks

The `lib/checks.js` module provides functions that verify the health of each lab component:

| Function | Checks |
|----------|--------|
| `checkDocker()` | `docker ps` returns successfully |
| `checkKindCluster(name)` | `kind get clusters` includes the named cluster |
| `checkKubectlContext()` | Current context is `kind-<cluster-name>` |
| `checkPods()` | All Pods in `default` namespace are `Running` |
| `checkWazuh()` | `wazuh-manager` container is running |
| `checkFluentBit()` | All `fluent-bit` Pods are `Running` |
| `getFullStatus()` | Returns structured object with all checks for TUI display |

These checks are used by both the TUI and the setup wizard to provide real-time feedback.

---

## Common Errors

### `chalk is not defined`
**Symptom**: Running `node cleanup.js` throws `ReferenceError: chalk is not defined`.
**Root Cause**: `cleanup.js` uses `chalk` in line 12 but forgot to import it.
**Fix**: Add `const chalk = require('chalk');` at the top of `cleanup.js`.

### `Cannot find module 'enquirer'`
**Symptom**: `Error: Cannot find module 'enquirer'` when running TUI.
**Root Cause**: Dependencies were not installed.
**Fix**: Run `npm install` in the `scripts/` directory.

### `kind-sidecar-thesis` context not found
**Symptom**: Setup wizard fails at kubectl context check.
**Root Cause**: The Kind cluster was created but `kubectl` is not pointing to it.
**Fix**: Run `kubectl config use-context kind-sidecar-thesis` or let the setup wizard handle it.

### Setup wizard stops at step 4 (Build Docker images)
**Symptom**: `docker build` fails with `Cannot find module 'express'`.
**Root Cause**: `node_modules` was deleted or never installed in the service directory.
**Fix**: Run `npm install` in `src/service-a/` and `src/service-b/` before building.

---

## Success Criteria

| Check | Verification |
|-------|-------------|
| `npm install` completes | `node -e "require('chalk')"` exits without error |
| TUI launches | `npm start` shows the interactive menu |
| Setup wizard runs | `node setup.js` completes all 7 steps with green checkmarks |
| Status is accurate | `node -e "require('./lib/checks').getFullStatus()"` returns correct environment state |
| Cleanup works | `node cleanup.js` removes the cluster and containers when confirmed |

---

## Related Documentation

- [Root README](../README.md) — Architecture overview and quick start
- [k8s/README.md](../k8s/README.md) — Kubernetes deployment manifests and security policies
- [wazuh/README.md](../wazuh/README.md) — SIEM log pipeline and load testing
- [src/README.md](../src/README.md) — Microservice and Dashboard code documentation
