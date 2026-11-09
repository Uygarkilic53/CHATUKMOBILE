import { Redis } from 'ioredis';

let redisClient: Redis | null = null;
let isRedisReady = false;

export const initRedis = (): Redis | null => {
  if (redisClient && redisClient.status !== 'end') {
    return redisClient;
  }

  // If explicitly disabled via env, skip connection
  if (process.env.ENABLE_REDIS === 'false') {
    console.log('[Redis] Disabled via ENABLE_REDIS=false');
    return null;
  }

  let redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  // Auto-upgrade Upstash and cloud endpoints to TLS (rediss://) if mistakenly configured with redis://
  if (redisUrl.startsWith('redis://') && redisUrl.includes('upstash.io')) {
    redisUrl = redisUrl.replace(/^redis:\/\//i, 'rediss://');
  }

  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy(times) {
        if (times > 5) {
          console.warn('[Redis] Max reconnection attempts reached. Continuing with MongoDB fallback.');
          return null; // Stop retrying; fall back to Mongo
        }
        return Math.min(times * 200, 2000);
      },
      reconnectOnError(err) {
        return err.message.includes('READONLY');
      },
    });

    redisClient.on('ready', () => {
      isRedisReady = true;
      console.log('[Redis] Connected successfully and ready to serve secondaryStorage queries');
    });

    redisClient.on('error', (err) => {
      isRedisReady = false;
      console.warn('[Redis] Connection warning (fallback to MongoDB active):', err.message);
    });

    redisClient.on('close', () => {
      isRedisReady = false;
    });

    return redisClient;
  } catch (error) {
    console.warn('[Redis] Initialization error, falling back to MongoDB:', error);
    return null;
  }
};

export const getRedis = (): Redis | null => {
  if (isRedisReady && redisClient) {
    return redisClient;
  }
  return null;
};

export const isRedisAvailable = (): boolean => {
  return isRedisReady && redisClient !== null;
};

/**
 * Evicts all cached sessions for a user from Redis RAM when user profile
 * (name, bio, theme, avatar) changes in MongoDB.
 */
export const invalidateUserSessionCache = async (userId: string): Promise<void> => {
  const redis = getRedis();
  if (!redis || !userId) return;

  try {
    const listKey = `active-sessions-${userId}`;
    const listRaw = await redis.get(listKey);
    if (listRaw) {
      try {
        const parsed = JSON.parse(listRaw);
        if (Array.isArray(parsed)) {
          const pipeline = redis.multi();
          for (const item of parsed) {
            if (item?.token && typeof item.token === 'string') {
              pipeline.del(item.token);
            }
          }
          pipeline.del(listKey);
          await pipeline.exec();
          return;
        }
      } catch {
        // Fall through to single key deletion
      }
    }
    await redis.del(listKey);
  } catch (err) {
    console.warn('[Redis] Error invalidating user session cache:', err);
  }
};

export const closeRedis = async (): Promise<void> => {
  if (redisClient) {
    const client = redisClient;
    redisClient = null;
    isRedisReady = false;
    try {
      if (client.status === 'ready' || client.status === 'connect') {
        await Promise.race([
          client.quit(),
          new Promise((resolve) => setTimeout(resolve, 1000)).then(() => {
            try { client.disconnect(); } catch {}
          }),
        ]);
      } else {
        client.disconnect();
      }
    } catch {
      try { client.disconnect(); } catch {}
    }
  }
};

