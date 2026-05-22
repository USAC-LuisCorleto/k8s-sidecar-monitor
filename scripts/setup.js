const { spawnSync } = require('child_process');
const { banner, success, error, info, warn, step, divider } = require('./lib/colors');
const { checkDocker, checkKindCluster, checkKubectlContext, checkPods, checkWazuh, checkFluentBit } = require('./lib/checks');
const ora = require('ora');
const { Confirm } = require('enquirer');

const run = (cmd, args = [], opts = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, stdio: 'pipe', ...opts });
  if (result.error) throw result.error;
  return result.stdout?.trim() || '';
};

const runWithOutput = (cmd, args = [], opts = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, stdio: 'inherit', ...opts });
  if (result.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const setup = async () => {
  banner();
  console.log(chalk.green.bold('  MODO CONFIGURACION COMPLETA DEL LABORATORIO\n'));

  // ─── Paso 0: Verificar Docker ──────────────────────────────────
  step(0, 'Verificando Docker Desktop');
  const dockerStatus = checkDocker();
  if (!dockerStatus.ok) {
    error(dockerStatus.msg);
    error('Por favor, inicie Docker Desktop y vuelva a ejecutar.');
    process.exit(1);
  }
  success(dockerStatus.msg);

  // ─── Paso 1: Kind Cluster ──────────────────────────────────────
  step(1, 'Cluster Kind (1 Control Plane + 2 Workers)');
  const kindStatus = checkKindCluster();
  if (kindStatus.ok) {
    warn(kindStatus.msg + ' Se omite la creacion.');
  } else {
    info(kindStatus.msg + ' Creando cluster...');
    const spinner1 = ora('  Ejecutando kind create cluster...').start();
    try {
      runWithOutput('kind', ['create', 'cluster', '--config', '../kind-config.yaml', '--name', 'sidecar-thesis']);
      spinner1.succeed('Cluster Kind creado exitosamente.');
    } catch (e) {
      spinner1.fail('Error creando cluster. Verifique kind-config.yaml y que Kind tenga acceso a Docker.');
      throw e;
    }
  }

  // ─── Paso 2: Istio ─────────────────────────────────────────────
  step(2, 'Istio 1.23.3 (perfil demo)');
  const kubectlStatus = checkKubectlContext();
  if (!kubectlStatus.ok) {
    info('Configurando contexto kubectl para Kind...');
    run('kubectl', ['config', 'use-context', 'kind-sidecar-thesis']);
  }
  const spinner2 = ora('  Verificando Istio...').start();
  const istiodCheck = run('kubectl', ['get', 'pods', '-n', 'istio-system', '-l', 'app=istiod', '-o', 'jsonpath={.items[*].status.phase}']);
  if (istiodCheck.includes('Running')) {
    spinner2.succeed('Istio ya esta instalado y corriendo.');
  } else {
    spinner2.text = '  Instalando Istio 1.23.3 con perfil demo...';
    try {
      runWithOutput('istioctl', ['install', '--set', 'profile=demo', '-y']);
      spinner2.succeed('Istio instalado correctamente.');
    } catch (e) {
      spinner2.fail('Error instalando Istio. Verifique que istioctl v1.23.3 esta en PATH.');
      throw e;
    }
  }

  // ─── Paso 3: Namespace label ───────────────────────────────────
  step(3, 'Configurando namespace default para inyeccion de sidecars');
  const label = run('kubectl', ['get', 'namespace', 'default', '-o', 'jsonpath={.metadata.labels.istio-injection}']);
  if (label === 'enabled') {
    success('Namespace default ya tiene istio-injection=enabled.');
  } else {
    run('kubectl', ['label', 'namespace', 'default', 'istio-injection=enabled', '--overwrite']);
    success('Namespace default etiquetado con istio-injection=enabled.');
  }

  // ─── Paso 4: Build + Load ──────────────────────────────────────
  step(4, 'Construyendo imagenes Docker y cargandolas al cluster');
  const imgA = run('docker', ['images', '-q', 'service-a:latest']);
  const imgB = run('docker', ['images', '-q', 'service-b:latest']);
  if (imgA && imgB) {
    warn('Imagenes service-a:latest y service-b:latest ya existen localmente.');
    const forceRebuild = new Confirm({
      name: 'rebuild',
      message: '  ¿Desea reconstruirlas de todos modos?',
      initial: false
    });
    if (await forceRebuild.run()) {
      const spinner4 = ora('  Reconstruyendo imagenes...').start();
      runWithOutput('docker', ['build', '-t', 'service-a:latest', '../src/service-a']);
      runWithOutput('docker', ['build', '-t', 'service-b:latest', '../src/service-b']);
      spinner4.text = '  Cargando imagenes a Kind...';
      runWithOutput('kind', ['load', 'docker-image', 'service-a:latest', '--name', 'sidecar-thesis']);
      runWithOutput('kind', ['load', 'docker-image', 'service-b:latest', '--name', 'sidecar-thesis']);
      spinner4.succeed('Imagenes reconstruidas y cargadas.');
    } else {
      info('Usando imagenes existentes. Cargando a Kind...');
      runWithOutput('kind', ['load', 'docker-image', 'service-a:latest', '--name', 'sidecar-thesis']);
      runWithOutput('kind', ['load', 'docker-image', 'service-b:latest', '--name', 'sidecar-thesis']);
      success('Imagenes cargadas al cluster.');
    }
  } else {
    const spinner4 = ora('  Building service-a y service-b...').start();
    runWithOutput('docker', ['build', '-t', 'service-a:latest', '../src/service-a']);
    runWithOutput('docker', ['build', '-t', 'service-b:latest', '../src/service-b']);
    spinner4.text = '  Cargando imagenes a Kind...';
    runWithOutput('kind', ['load', 'docker-image', 'service-a:latest', '--name', 'sidecar-thesis']);
    runWithOutput('kind', ['load', 'docker-image', 'service-b:latest', '--name', 'sidecar-thesis']);
    spinner4.succeed('Imagenes construidas y cargadas.');
  }

  // ─── Paso 5: Desplegar microservicios ──────────────────────────
  step(5, 'Desplegando microservicios en Kubernetes');
  const podStatus = checkPods();
  if (podStatus.ok) {
    warn(podStatus.msg + ' Los manifiestos se aplicaran para asegurar estado deseado.');
  }
  runWithOutput('kubectl', ['apply', '-f', '../k8s/']);
  success('Manifiestos aplicados.');

  const spinner5 = ora('  Esperando que los Pods esten Ready (2/2)...').start();
  let attempts = 0;
  while (attempts < 30) {
    const r = run('kubectl', ['get', 'pods', '-n', 'default', '-o', 'jsonpath={.items[*].status.containerStatuses[*].ready}']);
    const readyArr = r.split(' ').filter(Boolean);
    const allReady = readyArr.every(v => v === 'true');
    if (allReady && readyArr.length >= 2) {
      spinner5.succeed(`Pods en estado Ready (${readyArr.length} contenedores).`);
      break;
    }
    await sleep(2000);
    attempts++;
  }
  if (attempts >= 30) {
    spinner5.warn('Timeout esperando Pods. Verifique manualmente con kubectl get pods.');
  }

  // ─── Paso 6: Wazuh ─────────────────────────────────────────────
  step(6, 'Levantando Wazuh Manager (standalone)');
  const wazuhStatus = checkWazuh();
  if (wazuhStatus.ok) {
    warn(wazuhStatus.msg + ' Se omite el despliegue.');
  } else {
    const spinner6 = ora('  Iniciando Wazuh via Docker Compose...').start();
    runWithOutput('docker', ['compose', '-f', '../wazuh/docker-compose.yml', 'up', '-d'], { cwd: '../wazuh' });
    spinner6.succeed('Wazuh Manager iniciado.');
    info('Espere 2-3 minutos para que Wazuh complete su inicializacion.');
  }

  // ─── Paso 7: Fluent Bit ────────────────────────────────────────
  step(7, 'Desplegando Fluent Bit DaemonSet');
  const fbStatus = checkFluentBit();
  if (fbStatus.ok) {
    warn(fbStatus.msg + ' Se omite el despliegue.');
  } else {
    runWithOutput('kubectl', ['apply', '-f', '../wazuh/fluent-bit-configmap.yaml']);
    runWithOutput('kubectl', ['apply', '-f', '../wazuh/fluent-bit-daemonset.yaml']);
    success('Fluent Bit desplegado.');
  }

  divider();
  success('¡LABORATORIO COMPLETAMENTE CONFIGURADO!');
  console.log('');
  info('IMPORTANTE — Configuracion manual requerida en Wazuh:');
  console.log(chalk.yellow('  Wazuh Manager NO escucha syslog UDP 514 por defecto.'));
  console.log(chalk.yellow('  Debe ejecutar los siguientes comandos manualmente:'));
  console.log('');
  console.log(chalk.cyan('    docker exec -it wazuh-manager bash'));
  console.log(chalk.cyan('    # Editar /var/ossec/etc/ossec.conf:'));
  console.log(chalk.cyan('    # Reemplazar la seccion <remote> por:'));
  console.log(chalk.gray('    <remote>'));
  console.log(chalk.gray('      <connection>syslog</connection>'));
  console.log(chalk.gray('      <port>514</port>'));
  console.log(chalk.gray('      <protocol>udp</protocol>'));
  console.log(chalk.gray('      <allowed-ips>0.0.0.0/0</allowed-ips>'));
  console.log(chalk.gray('    </remote>'));
  console.log('');
  console.log(chalk.cyan('    /var/ossec/bin/wazuh-control restart'));
  console.log('');
  console.log(chalk.yellow('  Motivo: Wazuh deshabilita el listener syslog si <allowed-ips> no esta presente.'));
  console.log(chalk.yellow('  Ademas, <queue_size> es invalido en modo syslog y debe eliminarse.'));
  console.log('');
  info('Comandos utiles:');
  console.log(chalk.gray('    kubectl get pods'));
  console.log(chalk.gray('    docker compose -f wazuh/docker-compose.yml ps'));
  console.log(chalk.gray('    docker exec wazuh-manager tail -f /var/ossec/logs/archives/archives.log'));
};

setup().catch(err => {
  error(err.message);
  process.exit(1);
});
