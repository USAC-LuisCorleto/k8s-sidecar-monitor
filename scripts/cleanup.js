const { spawnSync } = require('child_process');
const chalk = require('chalk');
const { banner, success, error, info, warn, divider } = require('./lib/colors');
const ora = require('ora');

const run = (cmd, args = [], opts = {}) => {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', shell: true, ...opts });
  return result;
};

const cleanup = async () => {
  banner();
  console.log(chalk.red.bold('  MODO LIMPIEZA COMPLETA\n'));
  warn('Esto eliminara el cluster Kind, contenedores Wazuh, imagenes Docker y volumenes.');
  console.log('');

  const { Confirm } = require('enquirer');
  const confirm = new Confirm({
    name: 'proceed',
    message: '  ¿Estas seguro de que deseas continuar?',
    initial: false
  });

  const answer = await confirm.run();
  if (!answer) {
    info('Operacion cancelada.');
    return;
  }

  divider();

  // 1. Eliminar deployments en Kubernetes
  const spinner1 = ora('  Eliminando recursos de Kubernetes...').start();
  run('kubectl', ['delete', '-f', '../k8s/', '--ignore-not-found=true']);
  run('kubectl', ['delete', '-f', '../wazuh/fluent-bit-daemonset.yaml', '--ignore-not-found=true']);
  run('kubectl', ['delete', '-f', '../wazuh/fluent-bit-configmap.yaml', '--ignore-not-found=true']);
  run('kubectl', ['delete', 'namespace', 'no-istio', '--ignore-not-found=true']);
  spinner1.succeed('Recursos de Kubernetes eliminados.');

  // 2. Eliminar cluster Kind
  const spinner2 = ora('  Eliminando cluster Kind...').start();
  run('kind', ['delete', 'cluster', '--name', 'sidecar-thesis']);
  spinner2.succeed('Cluster Kind eliminado.');

  // 3. Detener Wazuh
  const spinner3 = ora('  Deteniendo Wazuh Manager...').start();
  run('docker', ['compose', '-f', '../wazuh/docker-compose.yml', 'down', '-v'], { cwd: '../wazuh' });
  spinner3.succeed('Wazuh Manager detenido y volumenes eliminados.');

  // 4. Limpiar imagenes Docker locales de los microservicios
  const spinner4 = ora('  Eliminando imagenes Docker locales...').start();
  run('docker', ['rmi', 'service-a:latest', 'service-b:latest', '--force']);
  spinner4.succeed('Imagenes locales eliminadas.');

  // 5. Limpiar cache de Docker (opcional)
  const { Select } = require('enquirer');
  const pruneChoice = new Select({
    name: 'prune',
    message: '  ¿Deseas liberar espacio adicional eliminando imagenes, contenedores y redes no utilizados?',
    choices: ['No, gracias', 'Si, limpiar sistema Docker', 'Si, limpiar TODO (incluyendo volumenes)'],
    initial: 0
  });

  const prune = await pruneChoice.run();
  if (prune.includes('sistema Docker')) {
    const spinner5 = ora('  Ejecutando docker system prune...').start();
    run('docker', ['system', 'prune', '-f']);
    spinner5.succeed('Sistema Docker limpiado.');
  } else if (prune.includes('TODO')) {
    const spinner5 = ora('  Ejecutando docker system prune -a --volumes...').start();
    run('docker', ['system', 'prune', '-a', '--volumes', '-f']);
    spinner5.succeed('Sistema Docker y volumenes limpiados.');
  }

  divider();
  success('Limpieza completada. El entorno ha sido restaurado a su estado inicial.');
  info('Puedes verificar con: docker ps | findstr wazuh ; kind get clusters');
};

cleanup().catch(err => {
  error(err.message);
  process.exit(1);
});
