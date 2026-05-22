const chalk = require('chalk');
const { spawnSync } = require('child_process');

// ─── Check functions ────────────────────────────────────────────────

const checkDocker = () => {
  try {
    spawnSync('docker', ['version'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
    return { ok: true, msg: 'Docker Desktop esta corriendo.' };
  } catch {
    return { ok: false, msg: 'Docker Desktop NO esta corriendo.' };
  }
};

const checkKindCluster = () => {
  const r = spawnSync('kind', ['get', 'clusters'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
  const clusters = r.stdout?.trim() || '';
  if (clusters.includes('sidecar-thesis')) {
    return { ok: true, msg: 'Cluster Kind "sidecar-thesis" ya existe.' };
  }
  return { ok: false, msg: 'Cluster Kind "sidecar-thesis" no encontrado.' };
};

const checkKubectlContext = () => {
  const r = spawnSync('kubectl', ['config', 'current-context'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
  const ctx = r.stdout?.trim() || '';
  if (ctx.includes('sidecar-thesis')) {
    return { ok: true, msg: `Contexto kubectl activo: ${ctx}` };
  }
  return { ok: false, msg: `Contexto kubectl: ${ctx || 'ninguno'}` };
};

const checkPods = () => {
  const r = spawnSync('kubectl', ['get', 'pods', '-n', 'default', '-o', 'jsonpath={.items[*].status.phase}'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
  const phases = r.stdout?.trim().split(' ').filter(Boolean) || [];
  const running = phases.filter(p => p === 'Running').length;
  if (phases.length >= 2 && running === phases.length) {
    return { ok: true, msg: `${running}/${phases.length} Pods en Running.` };
  }
  return { ok: false, msg: `${running}/${phases.length} Pods en Running (o no desplegados).` };
};

const checkWazuh = () => {
  const r = spawnSync('docker', ['ps', '--filter', 'name=wazuh-manager', '--format', '{{.Names}}'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
  if (r.stdout?.trim().includes('wazuh-manager')) {
    return { ok: true, msg: 'Wazuh Manager esta corriendo.' };
  }
  return { ok: false, msg: 'Wazuh Manager no esta corriendo.' };
};

const checkFluentBit = () => {
  const r = spawnSync('kubectl', ['get', 'pods', '-l', 'app=fluent-bit', '-n', 'default', '-o', 'jsonpath={.items[*].status.phase}'], { encoding: 'utf-8', shell: true, stdio: 'pipe' });
  const phases = r.stdout?.trim().split(' ').filter(Boolean) || [];
  const running = phases.filter(p => p === 'Running').length;
  if (running >= 1) {
    return { ok: true, msg: `${running} Pod(s) de Fluent Bit en Running.` };
  }
  return { ok: false, msg: 'Fluent Bit no desplegado.' };
};

const getFullStatus = () => ({
  docker: checkDocker(),
  kind: checkKindCluster(),
  kubectl: checkKubectlContext(),
  pods: checkPods(),
  wazuh: checkWazuh(),
  fluentbit: checkFluentBit(),
});

module.exports = {
  checkDocker,
  checkKindCluster,
  checkKubectlContext,
  checkPods,
  checkWazuh,
  checkFluentBit,
  getFullStatus,
};
