import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const checkRedisRunning = (port = 6379, host = '127.0.0.1') => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
};

export async function ensureRedisRunning() {
  const isRunning = await checkRedisRunning();
  if (isRunning) {
    console.log('[Redis] Server is already running on 127.0.0.1:6379');
    return null;
  }

  const redisExe = path.resolve(__dirname, '../.redis/redis-server.exe');
  const redisConf = path.resolve(__dirname, '../.redis/redis.windows.conf');

  if (!fs.existsSync(redisExe)) {
    console.warn('[Redis] redis-server.exe not found at', redisExe);
    return null;
  }

  console.log('[Redis] Starting redis-server in background...');
  const isWin = process.platform === 'win32';
  let child = null;
  try {
    child = spawn(redisExe, [redisConf], {
      detached: true,
      stdio: 'ignore',
      shell: isWin,
      windowsHide: true,
    });
    child.on('error', (err) => {
      console.warn('[Redis] Process error from redis-server:', err.message);
    });
    child.unref();
  } catch (err) {
    console.warn('[Redis] Failed to spawn redis-server:', err.message);
    return null;
  }

  // Wait up to 5 seconds for it to start listening
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkRedisRunning()) {
      console.log('[Redis] redis-server started successfully on 127.0.0.1:6379');
      return child;
    }
  }

  console.warn('[Redis] Timed out waiting for Redis to start');
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureRedisRunning().then(() => process.exit(0));
}
