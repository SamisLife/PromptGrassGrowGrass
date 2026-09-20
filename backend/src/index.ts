import { SoilApp } from './app.js';
import { env, loadEnv } from './env.js';
import { scanBoards } from './hardware.js';
import { listenHttp } from './http.js';

loadEnv();

if (process.argv.includes('--scan')) {
  await scanBoards();
  process.exit(0);
}

const app = new SoilApp(env());
await app.start();
const server = await listenHttp(app);

const shutdown = async () => {
  server.close();
  await app.stop();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
