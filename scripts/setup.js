const { spawnSync } = require('child_process');
const { banner, success, error, info, warn, step, divider } = require('./lib/colors');
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

const setup = async () => {
  banner();
  console.log(chalk.green.bold('  MODO CONFIGURACION COMPLETA DEL LABORATORIO\n'));
  info('Este script guiara el despliegue paso a paso del entorno.');
  divider();

  // Paso 0: Verificar Docker
  step(0, 'Verificando Docker Desktop');
  try {
    run('docker', ['version']);
    success('Docker Desktop esta corriendo.');
  } catch {
    error('Docker Desktop NO esta corriendo. Por favor, inicielo y vuelva a ejecutar.');
    process.exit(1);
  }

  // Paso 1: Crear cluster Kind
  step(1, 'Creando cluster Kind (1 Control Plane + 2 Workers)');
  const spinner1 = ora('  Ejecutando kind create cluster...').start();
  try {
    runWithOutput('kind', ['create', 'cluster', '--config', '../kind-config.yaml', '--name', 'sidecar-thesis']);
    spinner1.succeed('Cluster Kind creado exitosamente.');
  } catch {
    spinner1.fail('El cluster ya podria existir o hubo un error.');
    warn('Intentando continuar...');
  }

  // Paso 2: Instalar Istio
  step(2, 'Instalando Istio 1.23.3 (perfil demo)');
  const spinner2 = ora('  Ejecutando istioctl install...').start();
  try {
    runWithOutput('istioctl', ['install', '--set', 'profile=demo', '-y']);
    spinner2.succeed('Istio instalado.');
  } catch {
    spinner2.fail('Error instalando Istio. Verifique que istioctl v1.23.3 esta en PATH.');
    throw new Error('Istio installation failed');
  }

  // Paso 3: Etiquetar namespace
  step(3, 'Configurando namespace default para inyeccion de sidecars');
  run('kubectl', ['label', 'namespace', 'default', 'istio-injection=enabled', '--overwrite']);
  success('Namespace default etiquetado con istio-injection=enabled.');

  // Paso 4: Build y carga de imagenes
  step(4, 'Construyendo imagenes Docker y cargandolas al cluster');
  const spinner4 = ora('  Building service-a...').start();
  runWithOutput('docker', ['build', '-t', 'service-a:latest', '../src/service-a']);
  spinner4.text = '  Building service-b...';
  runWithOutput('docker', ['build', '-t', 'service-b:latest', '../src/service-b']);
  spinner4.text = '  Cargando imagenes a Kind...';
  runWithOutput('kind', ['load', 'docker-image', 'service-a:latest', '--name', 'sidecar-thesis']);
  runWithOutput('kind', ['load', 'docker-image', 'service-b:latest', '--name', 'sidecar-thesis']);
  spinner4.succeed('Imagenes construidas y cargadas.');

  // Paso 5: Desplegar microservicios
  step(5, 'Desplegando microservicios en Kubernetes');
  runWithOutput('kubectl', ['apply', '-f', '../k8s/']);
  success('Manifiestos aplicados.');

  const spinner5 = ora('  Esperando que los Pods esten Ready...').start();
  let attempts = 0;
  while (attempts < 30) {
    const pods = run('kubectl', ['get', 'pods', '-n', 'default', '-o', 'jsonpath={.items[*].status.phase}']);
    if (pods.split(' ').every(p => p === 'Running')) {
      spinner5.succeed('Pods en estado Running.');
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }
  if (attempts >= 30) {
    spinner5.warn('Timeout esperando Pods. Verifique manualmente con kubectl get pods.');
  }

  // Paso 6: Desplegar Wazuh
  step(6, 'Levantando Wazuh Manager (standalone)');
  const spinner6 = ora('  Iniciando Wazuh via Docker Compose...').start();
  runWithOutput('docker', ['compose', '-f', '../wazuh/docker-compose.yml', 'up', '-d'], { cwd: '../wazuh' });
  spinner6.succeed('Wazuh Manager iniciado.');
  info('Espere 2-3 minutos para que Wazuh complete su inicializacion.');

  // Paso 7: Desplegar Fluent Bit
  step(7, 'Desplegando Fluent Bit DaemonSet');
  runWithOutput('kubectl', ['apply', '-f', '../wazuh/fluent-bit-configmap.yaml']);
  runWithOutput('kubectl', ['apply', '-f', '../wazuh/fluent-bit-daemonset.yaml']);
  success('Fluent Bit desplegado.');

  divider();
  success('¡LABORATORIO COMPLETAMENTE CONFIGURADO!');
  info('Comandos utiles:');
  console.log(chalk.gray('    kubectl get pods'));
  console.log(chalk.gray('    docker compose -f wazuh/docker-compose.yml ps'));
  console.log(chalk.gray('    docker exec wazuh-manager tail -f /var/ossec/logs/archives/archives.log'));
  console.log('');
  warn('Recuerde: Fluent Bit requiere la IP correcta de Wazuh en fluent-bit-configmap.yaml');
  warn('y Wazuh requiere configuracion de ossec.conf para escuchar syslog en UDP 514.');
};

setup().catch(err => {
  error(err.message);
  process.exit(1);
});
