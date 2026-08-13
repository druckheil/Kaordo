import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { base64Url, randomBytes, utf8 } from '../auth/encoding';
import { authenticate, unixNow } from '../auth/session';
import { json } from '../http/json';

const USER_KEY = /^[A-Za-z0-9_-]{22}$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const TICKET_LIFETIME_SECONDS = 45;
const MAX_CONNECTIONS_PER_USER = 16;
const INTERNAL_TICKET_HEADER = 'x-kaordo-ligo-live-ticket';

export class LigoLiveSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS live_tickets (
        hash TEXT PRIMARY KEY NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS live_tickets_expiry_idx
        ON live_tickets(expires_at);
    `);
  }

  async issueTicket(userKey: string, now = unixNow()): Promise<string> {
    if (!USER_KEY.test(userKey)) throw new Error('Invalid Ligo live user key.');
    const secret = base64Url(randomBytes(32));
    const hash = await ticketHash(secret);
    this.ctx.storage.sql.exec('DELETE FROM live_tickets WHERE expires_at <= ?', now);
    this.ctx.storage.sql.exec(
      'INSERT INTO live_tickets(hash, expires_at) VALUES (?, ?)',
      hash,
      now + TICKET_LIFETIME_SECONDS,
    );
    return `${userKey}.${secret}`;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required.', { status: 426 });
    }
    const ticket = request.headers.get(INTERNAL_TICKET_HEADER);
    const parsed = parseTicket(ticket);
    if (!parsed) return new Response('Invalid live ticket.', { status: 401 });

    const hash = await ticketHash(parsed.secret);
    const now = unixNow();
    const stored = this.ctx.storage.sql.exec<{ expires_at: number }>(
      'SELECT expires_at FROM live_tickets WHERE hash = ? LIMIT 1',
      hash,
    ).toArray()[0];
    this.ctx.storage.sql.exec('DELETE FROM live_tickets WHERE hash = ? OR expires_at <= ?', hash, now);
    if (!stored || stored.expires_at <= now) {
      return new Response('Expired live ticket.', { status: 401 });
    }
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS_PER_USER) {
      return new Response('Too many live connections.', { status: 429 });
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  notify(messageId: string): void {
    const payload = JSON.stringify({ messageId, type: 'inbox' });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, 'Live delivery failed.');
      }
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === 'ping') socket.send('{"type":"pong"}');
  }

  webSocketError(socket: WebSocket): void {
    socket.close(1011, 'Live connection failed.');
  }
}

export async function createLigoLiveTicket(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env);
  if (!session) return json({ error: 'Authentication required.' }, 401);
  const userKey = base64Url(session.userId);
  const ticket = await env.LIGO_LIVE.getByName(userKey).issueTicket(userKey);
  const url = new URL('/api/ligo/live', request.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return json({ url: url.toString() }, 201, { 'cache-control': 'no-store' });
}

export async function openLigoLive(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade required.', { status: 426 });
  }
  const ticket = new URL(request.url).searchParams.get('ticket');
  const parsed = parseTicket(ticket);
  if (!parsed) return new Response('Invalid live ticket.', { status: 401 });
  const headers = new Headers({
    [INTERNAL_TICKET_HEADER]: ticket!,
    upgrade: 'websocket',
  });
  return env.LIGO_LIVE.getByName(parsed.userKey).fetch(new Request(request.url, { headers }));
}

function parseTicket(ticket: string | null): { secret: string; userKey: string } | null {
  if (!ticket) return null;
  const separator = ticket.indexOf('.');
  if (separator < 0 || ticket.indexOf('.', separator + 1) >= 0) return null;
  const userKey = ticket.slice(0, separator);
  const secret = ticket.slice(separator + 1);
  return USER_KEY.test(userKey) && SECRET.test(secret) ? { secret, userKey } : null;
}

async function ticketHash(secret: string): Promise<string> {
  return base64Url(await crypto.subtle.digest('SHA-256', utf8(secret)));
}
