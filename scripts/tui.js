const chalk = require('chalk');
const { Select } = require('enquirer');
const { banner, success, info, divider } = require('./lib/colors');
const { getFullStatus } = require('./lib/checks');
const { spawnSync } = require('child_process');

const run = (cmd, args = []) => {
  spawnSync(cmd, args, { encoding: 'utf-8', shell: true, stdio: 'inherit' });
};

const printStatus = () => {
  const s = getFullStatus();
  console.log(chalk.blue.bold('\n  Estado del entorno:\n'));

  const fmt = (label, check) => {
    const icon = check.ok ? chalk.green('●') : chalk.red('●');
    const color = check.ok ? chalk.green : chalk.gray;
    console.log(`  ${icon}  ${label.padEnd(20)} ${color(check.msg)}`);
  };

  fmt('Docker', s.docker);
  fmt('Kind Cluster', s.kind);
  fmt('kubectl Context', s.kubectl);
  fmt('Microservicios', s.pods);
  fmt('Wazuh Manager', s.wazuh);
  fmt('Fluent Bit', s.fluentbit);
  console.log('');

  const allOk = s.docker.ok && s.kind.ok && s.pods.ok && s.wazuh.ok && s.fluentbit.ok;
  if (allOk) {
    success('Todo el laboratorio esta levantado y operativo.\n');
  } else if (s.kind.ok && s.pods.ok && !s.wazuh.ok) {
    warn('El cluster Kubernetes esta listo. Falta Wazuh Manager (o aun no inicia).\n');
  } else if (!s.kind.ok) {
    info('El cluster no existe. Ejecute "Levantar laboratorio completo" para iniciar.\n');
  }
};

const main = async () => {
  banner();
  console.log(chalk.white('  Bienvenido al gestor del laboratorio de monitoreo con Sidecar.\n'));

  printStatus();

  const menu = new Select({
    name: 'action',
    message: '  ¿Que desea hacer?',
    choices: [
      { name: 'setup',   message: '🚀  Levantar laboratorio completo (setup)', value: 'setup' },
      { name: 'cleanup', message: '🧹  Apagar y limpiar TODO (cleanup)', value: 'cleanup' },
      { name: 'check',   message: '🔍  Verificar estado actual', value: 'check' },
      { name: 'exit',    message: '👋  Salir', value: 'exit' }
    ],
    pointer: '  >',
    highlight: chalk.cyan,
    result() { return this.focused.value; }
  });

  const choice = await menu.run();

  divider();

  switch (choice) {
    case 'setup':
      run('node', ['setup.js']);
      break;
    case 'cleanup':
      run('node', ['cleanup.js']);
      break;
    case 'check':
      printStatus();
      divider();
      break;
    case 'exit':
      success('Hasta pronto. Recuerde guardar sus screenshots en evidence/.\n');
      break;
  }
};

main().catch(err => {
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
});
