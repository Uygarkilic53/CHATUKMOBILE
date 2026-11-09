import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import routes from './routes/index.js';
import { swaggerSpec, swaggerUiOptions } from './docs/swagger.js';
import { resetPasswordWebController } from './controllers/auth.controller.js';

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));

// Parse JSON bodies with error handling for malformed JSON
app.use((req: Request, res: Response, next: NextFunction) => {
  express.json({ limit: '15mb' })(req, res, (err: any) => {
    if (err) {
      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({ 
          error: 'Invalid JSON payload. Please verify request body formatting.', 
          code: 'BAD_JSON_SYNTAX' 
        });
      }
      return next(err);
    }
    next();
  });
});
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// API Routes
app.use('/api', routes);

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Password Reset Webpage
app.get('/reset-password', resetPasswordWebController);

// Basic route to test server
app.get('/', (req: Request, res: Response) => {
  res.send('ChatUK API is running...');
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    code: err.code || 'SERVER_ERROR'
  });
});

export default app;
