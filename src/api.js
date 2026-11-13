import { start } from './runtime.js';

start('api').catch((error) => {
  console.error(`No se pudo iniciar la API: ${error.message}`);
  process.exitCode = 1;
});
