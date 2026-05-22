const chalk = require('chalk');
const { Select } = require('enquirer');
const { banner, success, info, divider } = require('./lib/colors');
const { spawnSync } = require('child_process');

const run = (cmd, args = []) => {
  spawnSync(cmd, args, { encoding: 'utf-8', shell: true, stdio: 'inherit' });
};

const main = async () => {
  banner();
  console.log(chalk.white('  Bienvenido al gestor del laboratorio de monitoreo con Sidecar.\n'));
  info('Seleccione una opcion del menu para continuar.\n');

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
      console.log(chalk.blue.bold('\n  Estado del entorno:\n'));
      console.log(chalk.gray('  ── Docker ──'));
      spawnSync('docker', ['ps', '--format', 'table {{.Names}}\t{{.Status}}'], { shell: true, stdio: 'inherit' });
      console.log('');
      console.log(chalk.gray('  ── Kubernetes (Kind) ──'));
      spawnSync('kubectl', ['get', 'nodes'], { shell: true, stdio: 'inherit' });
      console.log('');
      spawnSync('kubectl', ['get', 'pods', '-n', 'default'], { shell: true, stdio: 'inherit' });
      console.log('');
      console.log(chalk.gray('  ── Clusters Kind ──'));
      spawnSync('kind', ['get', 'clusters'], { shell: true, stdio: 'inherit' });
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
