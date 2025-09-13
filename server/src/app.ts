import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import { setupGoogleStrategy } from './config/passport';
import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Application {
  const app = express();

  // Security middleware
  app.use(helmet() as any);
  app.use(compression() as any);
  app.use(morgan('dev') as any);

  // CORS configuration
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3002',
    credentials: true,
  }) as any);

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser() as any);

  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'nexus_mail_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax', // Allow cookies for OAuth redirect
    },
  }) as any);

  // Passport initialization
  app.use(passport.initialize() as any);
  app.use(passport.session() as any);
  setupGoogleStrategy();

  // Routes
  app.use('/auth', authRoutes);
  app.use('/api/emails', emailRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  // Error handling
  app.use(errorHandler as any);

  return app;
}