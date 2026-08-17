import WebSocket from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { DispatchEventPayload } from '../types/dispatch';
import { env } from '../config/env';
import { TokenClaims } from '../middleware/auth';
import { getUserStore } from '../services/userStore';

const clients = new Set<WebSocket>();

/**
 * Authenticates the upgrade request before the socket joins the broadcast set.
 * Browsers cannot set headers on a WebSocket handshake, so the token arrives as
 * a query parameter.
 */
async function authenticateUpgrade(url: string | undefined): Promise<boolean> {
  try {
    const token = new URL(url || '', 'http://localhost').searchParams.get('token');
    if (!token) return false;

    const claims = jwt.verify(token, env.jwtSecret) as TokenClaims;
    const user = await getUserStore().findById(claims.sub);

    return Boolean(
      user &&
      user.status === 'active' &&
      user.passwordVersion === claims.pv &&
      !user.mustChangePassword,
    );
  } catch {
    return false;
  }
}

export function createWebSocketServer(server: http.Server): void {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', async (socket, request) => {
    if (!(await authenticateUpgrade(request.url))) {
      socket.close(4401, 'Unauthorized');
      return;
    }

    clients.add(socket);
    socket.send(JSON.stringify({
      type: 'system',
      timestamp: new Date().toISOString(),
      data: { message: 'Connected to CAD live dispatch feed.' },
    }));

    socket.on('close', () => {
      clients.delete(socket);
    });
  });

  console.log('WebSocket server listening for CAD event dispatch.');

  globalThis.broadcastDispatch = (payload: DispatchEventPayload) => {
    const message = JSON.stringify(payload);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };
}
