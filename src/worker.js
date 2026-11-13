import { start } from './runtime.js';

start('worker').catch((error) => {
  console.error(`No se pudo iniciar el worker: ${error.message}`);
  process.exitCode = 1;
});
