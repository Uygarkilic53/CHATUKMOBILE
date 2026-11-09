import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { auth, secondaryStorage } from '../auth.js';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name?: string;
    image?: string | null;
    avatarPublicId?: string | null;
    [key: string]: any;
  };
  session?: any;
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // 1. Try Better Auth's standard session retrieval
    if (auth?.api?.getSession) {
      try {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(req.headers),
        });
        if (session?.user) {
          req.user = {
            ...session.user,
            id: session.user.id?.toString(),
          };
          req.session = session.session;
          return next();
        }
      } catch (err) {
        // Fall back to direct DB check
      }
    }

    // 2. Fallback: extract token from Authorization header, x-session-token, or cookies
    const authHeader = req.headers.authorization;
    let token: string | null = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token && typeof req.headers['x-session-token'] === 'string') {
      token = req.headers['x-session-token'].trim();
    }

    if (!token && req.headers.cookie) {
      const cookieHeader = req.headers.cookie.trim();
      // Handle JSON-encoded cookie if sent by mobile client
      if (cookieHeader.startsWith('{')) {
        try {
          const parsed = JSON.parse(cookieHeader);
          token =
            parsed['better-auth.session_token']?.value ||
            parsed['chatuk.session_token']?.value ||
            null;
        } catch {}
      }

      if (!token) {
        const match =
          cookieHeader.match(/better-auth\.session_token=([^;]+)/) ||
          cookieHeader.match(/chatuk\.session_token=([^;]+)/);
        if (match && match[1]) {
          token = decodeURIComponent(match[1]);
        }
      }
    }

    // Clean token: strip signatures / prefix
    if (token) {
      if (token.startsWith('s:')) {
        token = token.slice(2);
      }
      token = (token.split('.')[0] || '').trim();
    }

    if (token && mongoose.connection.db) {
      const db = mongoose.connection.db;
      // Search session with matching token
      const sessionDoc = await db.collection('session').findOne({
        $or: [{ token }, { token: token.split('.')[0] || token }],
        expiresAt: { $gt: new Date() },
      });

      if (sessionDoc?.userId) {
        const userIdStr = sessionDoc.userId.toString();
        const userQuery: any = ObjectId.isValid(userIdStr)
          ? { $or: [{ _id: userIdStr }, { _id: new ObjectId(userIdStr) }] }
          : { _id: userIdStr };

        const userDoc = await db.collection('user').findOne(userQuery);
        if (userDoc) {
          req.user = {
            id: userDoc._id.toString(),
            email: userDoc.email,
            name: userDoc.name,
            image: userDoc.image || null,
            avatarPublicId: userDoc.avatarPublicId || null,
          };
          req.session = sessionDoc;

          // Backfill Redis RAM cache on miss so subsequent requests resolve in < 2ms
          try {
            const ttl = Math.ceil((new Date(sessionDoc.expiresAt).getTime() - Date.now()) / 1000);
            if (ttl > 0) {
              secondaryStorage.set(
                token,
                JSON.stringify({
                  session: {
                    ...sessionDoc,
                    id: sessionDoc._id.toString(),
                  },
                  user: {
                    ...userDoc,
                    id: userDoc._id.toString(),
                  },
                }),
                ttl
              ).catch(() => {});
            }
          } catch {
            // Silently ignore cache write errors
          }

          return next();
        }
      }
    }

    return res.status(401).json({
      error: 'Authentication required. Please sign in.',
      code: 'UNAUTHORIZED',
    });
  } catch (error: any) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Internal authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

