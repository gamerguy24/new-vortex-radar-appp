import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { env } from './config/env';
import { createWebSocketServer } from './websocket/server';
import { syncDatabase, generateAIIncident, pushDispatchEvent } from './services/dispatchService';
import { initUserStore } from './services/userStore';
import { ensureBootstrapAdmin } from './services/bootstrap';
import { initMailer } from './services/mailer';
import { requireAuth, requireCurrentPassword } from './middleware/auth';
import { authRouter } from './routes/auth';
import { dispatchRouter } from './routes/dispatch';
import { unitsRouter } from './routes/units';
import { recordsRouter } from './routes/records';
import { adminRouter } from './routes/admin';

const app = express();
const server = http.createServer(app);

// Needed for accurate client IPs in login throttling when behind a proxy.
app.set('trust proxy', 1);

app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',').map((o) => o.trim()) }));
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cad-backend' });
});

// Public: login, registration, and the session endpoints (which guard themselves).
app.use('/api/auth', authRouter);

// Everything else requires an active account that is not pending a password change.
const protectedRoutes = [requireAuth, requireCurrentPassword];
app.use('/api/dispatch', protectedRoutes, dispatchRouter);
app.use('/api/units', protectedRoutes, unitsRouter);
app.use('/api/records', protectedRoutes, recordsRouter);
app.use('/api/admin', adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled request error:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

createWebSocketServer(server);

async function start(): Promise<void> {
  await initUserStore();
  initMailer();
  await ensureBootstrapAdmin();
  await syncDatabase();

  server.listen(env.port, () => {
    console.log(`CAD backend listening on port ${env.port}`);

    setInterval(() => {
      generateAIIncident((event) => {
        pushDispatchEvent(event, (payload) => {
          if (typeof globalThis.broadcastDispatch === 'function') {
            globalThis.broadcastDispatch(payload);
          }
        });
      });
    }, 35000);
  });
}

start().catch((err) => {
  console.error('Failed to start CAD backend:', err);
  process.exit(1);
});
