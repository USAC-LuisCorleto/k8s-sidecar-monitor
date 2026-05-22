const chalk = require('chalk');

const banner = () => {
  console.log(
    chalk.cyan.bold(`
  ╔══════════════════════════════════════════════════════════════╗
  ║     K8S SIDECAR MONITOR — Lab Lifecycle Manager              ║
  ║     Arquitectura de Monitoreo No Intrusiva                   ║
  ╚══════════════════════════════════════════════════════════════╝
  `)
  );
};

const success = (msg) => console.log(chalk.green('  ✔ '), msg);
const error = (msg) => console.log(chalk.red('  ✖ '), msg);
const info = (msg) => console.log(chalk.blue('  ℹ '), msg);
const warn = (msg) => console.log(chalk.yellow('  ⚠ '), msg);
const step = (num, msg) => console.log(chalk.magenta.bold(`\n  [${num}/7] ${msg}`));
const divider = () => console.log(chalk.gray('  ──────────────────────────────────────────────────────────────'));

module.exports = { banner, success, error, info, warn, step, divider };
