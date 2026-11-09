import { Router } from 'express';
import { betterAuthHandler } from '../controllers/auth.controller.js';

const router = Router();

// Support /forget-password alias by forwarding to Better Auth's /request-password-reset
router.post('/forget-password', (req, res, next) => {
  req.url = '/request-password-reset';
  (req as any).originalUrl = (req.baseUrl || '/api/auth') + '/request-password-reset';
  betterAuthHandler(req, res, next);
});

// Redirect GET /api/auth/reset-password/:token directly to the reset password webpage
router.get('/reset-password/:token', (req, res, next) => {
  if (req.query.callbackURL) {
    return betterAuthHandler(req, res, next);
  }
  return res.redirect(`/reset-password?token=${encodeURIComponent(req.params.token)}`);
});

// Better Auth handles all auth routes internally
router.all('/*splat', betterAuthHandler);

export default router;
