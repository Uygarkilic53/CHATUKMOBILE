jest.mock('../src/lib/auth-client', () => ({
  signIn: {
    email: jest.fn(),
    social: jest.fn(),
  },
  signUp: {
    email: jest.fn(),
  },
  useSession: () => ({
    data: null,
    isPending: false,
  }),
  authClient: {
    getSession: jest.fn(),
  },
}));

jest.unmock('expo-file-system/legacy');
import { runDbExclusive, getLocalDb } from '../src/e2ee/localDb';
import * as FileSystem from 'expo-file-system/legacy';
import { uuid } from 'expo-modules-core';

describe('FileSystem and LocalDb Verification', () => {
  describe('LocalDb runDbExclusive', () => {
    it('is exported and executes operations serially', async () => {
      expect(typeof runDbExclusive).toBe('function');

      const executionOrder: number[] = [];
      const op1 = runDbExclusive(async () => {
        await new Promise((r) => setTimeout(r, 20));
        executionOrder.push(1);
        return 'first';
      });

      const op2 = runDbExclusive(async () => {
        executionOrder.push(2);
        return 'second';
      });

      const [res1, res2] = await Promise.all([op1, op2]);
      expect(res1).toBe('first');
      expect(res2).toBe('second');
      expect(executionOrder).toEqual([1, 2]);
    });
  });

  describe('expo-modules-core uuid fallback', () => {
    it('generates valid v4 UUIDs without throwing', () => {
      expect(typeof uuid.v4).toBe('function');
      const id1 = uuid.v4();
      const id2 = uuid.v4();
      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('expo-file-system legacy network tasks and directory access', () => {
    it('creates UploadTask without crashing in constructor super() or uuid assignment', () => {
      class TestUploadTask extends FileSystem.UploadTask {
        public getTestUuid() {
          return this.uuid;
        }
      }
      const task = new TestUploadTask(
        'https://example.com/upload',
        'file:///path/to/file.png',
        { httpMethod: 'POST' },
        () => {}
      );
      expect(task).toBeInstanceOf(FileSystem.UploadTask);
      expect(typeof task.getTestUuid()).toBe('string');
      expect(task.getTestUuid().length).toBeGreaterThan(0);
    });

    it('creates DownloadResumable without crashing in constructor super() or uuid assignment', () => {
      class TestDownloadResumable extends FileSystem.DownloadResumable {
        public getTestUuid() {
          return this.uuid;
        }
      }
      const resumable = new TestDownloadResumable(
        'https://example.com/download.png',
        'file:///path/to/download.png'
      );
      expect(resumable).toBeInstanceOf(FileSystem.DownloadResumable);
      expect(typeof resumable.getTestUuid()).toBe('string');
      expect(resumable.getTestUuid().length).toBeGreaterThan(0);
    });

    it('handles task cancellation and subscription cleanup safely without crashing', async () => {
      class TestUploadTask extends FileSystem.UploadTask {
        public getCancelledStatus() {
          return this.isTaskCancelled();
        }
      }
      const task = new TestUploadTask(
        'https://example.com/upload',
        'file:///path/to/file.png'
      );

      // Should not throw even when running in environment with shimmed native modules
      await expect(task.cancelAsync()).resolves.not.toThrow();
      expect(task.getCancelledStatus()).toBe(true);
    });

    it('exposes safe directories and getInfoAsync without crashing', async () => {
      expect(FileSystem.documentDirectory === null || typeof FileSystem.documentDirectory === 'string').toBe(true);
      expect(FileSystem.cacheDirectory === null || typeof FileSystem.cacheDirectory === 'string').toBe(true);
      expect(FileSystem.bundleDirectory === null || typeof FileSystem.bundleDirectory === 'string').toBe(true);

      const info = await FileSystem.getInfoAsync('file:///dummy/path');
      expect(info).toBeDefined();
      expect(typeof info.exists).toBe('boolean');
    });
  });
});
