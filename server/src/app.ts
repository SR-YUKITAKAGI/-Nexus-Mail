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
import contactRoutes from './routes/contacts';
import purchaseRoutes from './routes/purchases';
import folderRoutes from './routes/folders';
import calendarRoutes from './routes/calendar';
import analyzeRoutes from './routes/analyze';
import testRoutes from './routes/test';
import replyRoutes from './routes/reply';
import newsletterRoutes from './routes/newsletters';
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

  // Body parsing with increased limit for large email batches
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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
  app.use('/api/contacts', contactRoutes);
  app.use('/api/purchases', purchaseRoutes);
  app.use('/api/folders', folderRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/analysis', analyzeRoutes);
  app.use('/api/test', testRoutes);
  app.use('/api/reply', replyRoutes);
  app.use('/api/newsletters', newsletterRoutes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  // Error handling
  app.use(errorHandler as any);

  return app;
}