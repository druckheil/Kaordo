import type { Env } from '../env';
import { json } from '../http/json';

export async function health(env: Env): Promise<Response> {
  try {
    const result = await env.DB.prepare('SELECT 1 AS ready').first<number>('ready');
    if (result !== 1) throw new Error('D1 returned an unexpected health result.');

    return json({
      database: 'ready',
      service: 'kaordo-api',
      status: 'ok',
    });
  } catch (error) {
    console.error('Health check failed.', error);
    return json({ status: 'unavailable' }, 503);
  }
}
