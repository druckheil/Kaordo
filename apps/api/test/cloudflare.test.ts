import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflareUsage } from '../src/admin/cloudflare';
import type { Env } from '../src/env';
import { createRondoIceConfiguration } from '../src/rondo/turn';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Cloudflare account telemetry', () => {
  it('aggregates Workers, D1, and R2 usage without exposing credentials', async () => {
    const request = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      data: {
        viewer: {
          accounts: [{
            callsTurnUsageAdaptiveGroups: [{
              avg: { concurrentConnectionsFiveMinutes: 1.25 },
              sum: { egressBytes: 75_000_000, ingressBytes: 12_000_000 },
            }],
            d1AnalyticsAdaptiveGroups: [{
              quantiles: { queryBatchTimeMsP90: 1.5 },
              sum: {
                queryBatchResponseBytes: 2_048,
                readQueries: 11,
                rowsRead: 120,
                rowsWritten: 7,
                writeQueries: 3,
              },
            }],
            d1StorageAdaptiveGroups: [{
              dimensions: { databaseId: 'database-1' },
              max: { databaseSizeBytes: 45_056 },
            }],
            r2OperationsAdaptiveGroups: [
              { dimensions: { actionType: 'PutObject' }, sum: { requests: 4 } },
              { dimensions: { actionType: 'GetObject' }, sum: { requests: 9 } },
            ],
            r2StorageAdaptiveGroups: [{
              dimensions: { bucketName: 'assets' },
              max: { metadataSize: 20, objectCount: 2, payloadSize: 1_000 },
            }],
            workersInvocationsAdaptive: [{
              quantiles: { cpuTimeP50: 0.4, cpuTimeP99: 2.1 },
              sum: { errors: 2, requests: 340, subrequests: 30 },
            }],
          }],
        },
      },
    }), { headers: { 'content-type': 'application/json' }, status: 200 }));
    vi.stubGlobal('fetch', request);

    const result = await cloudflareUsage({
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ACCOUNT_TOKEN: 'sensitive-token',
    } as Env);

    expect(result).toMatchObject({
      d1: { databaseCount: 1, rowsReadToday: 120, rowsWrittenToday: 7, storageBytes: 45_056 },
      r2: { bucketCount: 1, classAOperationsThisMonth: 4, classBOperationsThisMonth: 9, objectCount: 2, storageBytes: 1_020 },
      turn: { averageConcurrentConnections: 1.25, egressBytesThisMonth: 75_000_000, ingressBytesThisMonth: 12_000_000 },
      worker: { cpuTimeP99Ms: 2.1, errorsToday: 2, requestsToday: 340 },
    });
    const init = request.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sensitive-token' });
    expect(JSON.stringify(result)).not.toContain('sensitive-token');
  });
});

describe('Cloudflare TURN credentials', () => {
  it('returns short-lived ICE servers without exposing the long-lived API token', async () => {
    const request = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(JSON.stringify({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          credential: 'temporary-credential',
          urls: [
            'turn:turn.cloudflare.com:53?transport=udp',
            'turn:turn.cloudflare.com:3478?transport=udp',
          ],
          username: 'temporary-user',
        },
      ],
    }), { headers: { 'content-type': 'application/json' }, status: 200 }));
    vi.stubGlobal('fetch', request);

    const result = await createRondoIceConfiguration({
      TURN_KEY_API_TOKEN: 'long-lived-secret',
      TURN_KEY_ID: 'turn-key-id',
    }, 1_000);

    expect(result).toEqual({
      expiresAt: 87_400,
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          credential: 'temporary-credential',
          urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
          username: 'temporary-user',
        },
      ],
    });
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer long-lived-secret',
    });
    expect(JSON.stringify(result)).not.toContain('long-lived-secret');
  });

  it('keeps voice usable through Cloudflare STUN when TURN is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));

    await expect(createRondoIceConfiguration({
      TURN_KEY_API_TOKEN: 'token',
      TURN_KEY_ID: 'key',
    }, 5)).resolves.toEqual({
      expiresAt: 86_405,
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    });
  });
});
