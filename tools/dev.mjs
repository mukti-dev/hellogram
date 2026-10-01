// `pnpm dev`: every app, plus the local TURN relay that voice calls need.
// Calls are relay-only (nobody's IP is exposed), so without the relay a call never connects.
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const TURN_PORT = 3478;
const children = [];

const portInUse = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

const run = (command, args, stdio = 'inherit') => {
  const child = spawn(command, args, { stdio });
  children.push(child);
  return child;
};

if (await portInUse(TURN_PORT)) {
  console.log(`[dev] TURN relay already running on :${TURN_PORT}`);
} else if (spawnSync('turnserver', ['--version'], { stdio: 'ignore' }).error) {
  console.warn(
    '[dev] coturn is not installed, so voice calls will not connect.\n' +
      '      Install it with `brew install coturn`, or run\n' +
      '      `docker compose -f infra/docker-compose.yml --profile calls up -d coturn`.',
  );
} else {
  console.log(`[dev] starting TURN relay on 127.0.0.1:${TURN_PORT}`);
  // Its per-packet log is noisy; errors still show through the exit code below.
  run('turnserver', ['-c', 'infra/coturn/turnserver.local.conf'], 'ignore').on('exit', (code) => {
    if (code) console.warn(`[dev] TURN relay stopped (exit ${code}) — voice calls will not connect.`);
  });
}

const turbo = run('pnpm', ['exec', 'turbo', 'run', 'dev', '--parallel']);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
turbo.on('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
