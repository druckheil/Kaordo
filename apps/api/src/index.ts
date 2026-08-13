import { handleRequest } from './app';
import { deleteExpiredSessions } from './auth/database';
import type { Env } from './env';
import { deleteExpiredNodeAccessTickets } from './nodes/routes';
import {
  clearExpiredPublicReservations,
  retireOfflinePublicNodes,
} from './fluo/public-storage';

export { LigoLiveSession } from './ligo/live';

export default {
  fetch: handleRequest,
  async scheduled(_controller, env): Promise<void> {
    const now = Math.floor(Date.now() / 1_000);
    await Promise.all([
      deleteExpiredSessions(env.DB, now),
      deleteExpiredNodeAccessTickets(env, now),
      clearExpiredPublicReservations(env, now),
      retireOfflinePublicNodes(env, now),
    ]);
  },
} satisfies ExportedHandler<Env>;
