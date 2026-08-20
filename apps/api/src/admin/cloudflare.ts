import type { Env } from '../env';

const ANALYTICS_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const CACHE_MILLISECONDS = 60_000;

type Numeric = number | null | undefined;

type AnalyticsGroup = {
  avg?: { concurrentConnectionsFiveMinutes?: Numeric };
  dimensions?: { actionType?: string; bucketName?: string; databaseId?: string };
  max?: {
    databaseSizeBytes?: Numeric;
    metadataSize?: Numeric;
    objectCount?: Numeric;
    payloadSize?: Numeric;
    uploadCount?: Numeric;
  };
  quantiles?: { cpuTimeP50?: Numeric; cpuTimeP99?: Numeric; queryBatchTimeMsP90?: Numeric };
  sum?: {
    egressBytes?: Numeric;
    errors?: Numeric;
    ingressBytes?: Numeric;
    queryBatchResponseBytes?: Numeric;
    readQueries?: Numeric;
    requests?: Numeric;
    rowsRead?: Numeric;
    rowsWritten?: Numeric;
    subrequests?: Numeric;
    writeQueries?: Numeric;
  };
};

type AnalyticsResponse = {
  data?: { viewer?: { accounts?: Array<{
    callsTurnUsageAdaptiveGroups?: AnalyticsGroup[];
    d1AnalyticsAdaptiveGroups?: AnalyticsGroup[];
    d1StorageAdaptiveGroups?: AnalyticsGroup[];
    r2OperationsAdaptiveGroups?: AnalyticsGroup[];
    r2StorageAdaptiveGroups?: AnalyticsGroup[];
    workersInvocationsAdaptive?: AnalyticsGroup[];
  }> } };
  errors?: unknown[];
};

export type CloudflareUsage = {
  d1: {
    databaseCount: number;
    queryLatencyP90Ms: number;
    readQueriesToday: number;
    responseBytesToday: number;
    rowsReadToday: number;
    rowsWrittenToday: number;
    storageBytes: number;
    writeQueriesToday: number;
  };
  periods: {
    dailyResetAt: number;
    monthlyStartedAt: number;
  };
  r2: {
    bucketCount: number;
    classAOperationsThisMonth: number;
    classBOperationsThisMonth: number;
    objectCount: number;
    storageBytes: number;
    unclassifiedOperationsThisMonth: number;
  };
  sampledAt: number;
  turn: {
    averageConcurrentConnections: number;
    egressBytesThisMonth: number;
    ingressBytesThisMonth: number;
  };
  worker: {
    cpuTimeP50Ms: number;
    cpuTimeP99Ms: number;
    errorsToday: number;
    requestsToday: number;
    subrequestsToday: number;
  };
};

let cached: { accountId: string; expiresAt: number; usage: CloudflareUsage } | null = null;
let inFlight: { accountId: string; promise: Promise<CloudflareUsage | null> } | null = null;

export async function cloudflareUsage(
  env: Env,
  forceRefresh = false,
): Promise<CloudflareUsage | null> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_ACCOUNT_TOKEN) return null;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const now = Date.now();
  if (!forceRefresh && cached?.accountId === accountId && cached.expiresAt > now) return cached.usage;
  if (inFlight?.accountId === accountId) return inFlight.promise;

  const promise = queryAnalytics(accountId, env.CLOUDFLARE_ACCOUNT_TOKEN, new Date(now))
    .then((usage) => {
      cached = { accountId, expiresAt: Date.now() + CACHE_MILLISECONDS, usage };
      return usage;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
  inFlight = { accountId, promise };
  return promise;
}

async function queryAnalytics(
  accountId: string,
  token: string,
  now: Date,
): Promise<CloudflareUsage> {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const response = await fetch(ANALYTICS_ENDPOINT, {
    body: JSON.stringify({
      query: ANALYTICS_QUERY,
      variables: {
        account: accountId,
        day: isoDate(dayStart),
        dayStart: dayStart.toISOString(),
        month: isoDate(monthStart),
        monthStart: monthStart.toISOString(),
        now: now.toISOString(),
      },
    }),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Cloudflare Analytics rejected the request.');
  const payload = await response.json<AnalyticsResponse>();
  if (payload.errors?.length) throw new Error('Cloudflare Analytics returned an error.');
  const account = payload.data?.viewer?.accounts?.[0];
  if (!account) throw new Error('Cloudflare Analytics account data is unavailable.');

  const workers = sumGroups(account.workersInvocationsAdaptive);
  const d1 = sumGroups(account.d1AnalyticsAdaptiveGroups);
  const d1Storage = latestResourceTotals(account.d1StorageAdaptiveGroups, 'databaseId');
  const r2Storage = latestResourceTotals(account.r2StorageAdaptiveGroups, 'bucketName');
  const r2Operations = classifyR2Operations(account.r2OperationsAdaptiveGroups);
  const turn = sumGroups(account.callsTurnUsageAdaptiveGroups);
  const turnAverages = firstAverages(account.callsTurnUsageAdaptiveGroups);
  const workerQuantiles = firstQuantiles(account.workersInvocationsAdaptive);
  const d1Quantiles = firstQuantiles(account.d1AnalyticsAdaptiveGroups);

  return {
    d1: {
      databaseCount: d1Storage.resources,
      queryLatencyP90Ms: number(d1Quantiles.queryBatchTimeMsP90),
      readQueriesToday: number(d1.readQueries),
      responseBytesToday: number(d1.queryBatchResponseBytes),
      rowsReadToday: number(d1.rowsRead),
      rowsWrittenToday: number(d1.rowsWritten),
      storageBytes: d1Storage.databaseBytes,
      writeQueriesToday: number(d1.writeQueries),
    },
    periods: {
      dailyResetAt: Math.floor(nextDay.getTime() / 1_000),
      monthlyStartedAt: Math.floor(monthStart.getTime() / 1_000),
    },
    r2: {
      bucketCount: r2Storage.resources,
      classAOperationsThisMonth: r2Operations.classA,
      classBOperationsThisMonth: r2Operations.classB,
      objectCount: r2Storage.objects,
      storageBytes: r2Storage.r2Bytes,
      unclassifiedOperationsThisMonth: r2Operations.unclassified,
    },
    sampledAt: Math.floor(now.getTime() / 1_000),
    turn: {
      averageConcurrentConnections: number(turnAverages.concurrentConnectionsFiveMinutes),
      egressBytesThisMonth: number(turn.egressBytes),
      ingressBytesThisMonth: number(turn.ingressBytes),
    },
    worker: {
      cpuTimeP50Ms: number(workerQuantiles.cpuTimeP50),
      cpuTimeP99Ms: number(workerQuantiles.cpuTimeP99),
      errorsToday: number(workers.errors),
      requestsToday: number(workers.requests),
      subrequestsToday: number(workers.subrequests),
    },
  };
}

function firstAverages(groups: AnalyticsGroup[] | undefined): NonNullable<AnalyticsGroup['avg']> {
  return groups?.[0]?.avg ?? {};
}

function sumGroups(groups: AnalyticsGroup[] | undefined): NonNullable<AnalyticsGroup['sum']> {
  const total: Record<string, number> = {};
  for (const group of groups ?? []) {
    for (const [key, value] of Object.entries(group.sum ?? {})) {
      total[key] = (total[key] ?? 0) + number(value);
    }
  }
  return total;
}

function firstQuantiles(groups: AnalyticsGroup[] | undefined): NonNullable<AnalyticsGroup['quantiles']> {
  return groups?.[0]?.quantiles ?? {};
}

function latestResourceTotals(
  groups: AnalyticsGroup[] | undefined,
  resourceKey: 'bucketName' | 'databaseId',
): { databaseBytes: number; objects: number; r2Bytes: number; resources: number } {
  const seen = new Set<string>();
  let databaseBytes = 0;
  let objects = 0;
  let r2Bytes = 0;
  for (const group of groups ?? []) {
    const resource = group.dimensions?.[resourceKey];
    if (!resource || seen.has(resource)) continue;
    seen.add(resource);
    databaseBytes += number(group.max?.databaseSizeBytes);
    objects += number(group.max?.objectCount);
    r2Bytes += number(group.max?.payloadSize) + number(group.max?.metadataSize);
  }
  return { databaseBytes, objects, r2Bytes, resources: seen.size };
}

function classifyR2Operations(groups: AnalyticsGroup[] | undefined) {
  let classA = 0;
  let classB = 0;
  let unclassified = 0;
  for (const group of groups ?? []) {
    const operations = number(group.sum?.requests);
    const action = normalizeAction(group.dimensions?.actionType);
    if (R2_CLASS_A.has(action)) classA += operations;
    else if (R2_CLASS_B.has(action)) classB += operations;
    else unclassified += operations;
  }
  return { classA, classB, unclassified };
}

function normalizeAction(action: string | undefined): string {
  return (action ?? '').replaceAll(/[^a-z]/giu, '').toLowerCase();
}

function number(value: Numeric): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const R2_CLASS_A = new Set([
  'listbuckets', 'putbucket', 'listobjects', 'putobject', 'copyobject',
  'completemultipartupload', 'createmultipartupload', 'lifecyclestoragetiertransition',
  'listmultipartuploads', 'uploadpart', 'uploadpartcopy', 'listparts',
  'putbucketencryption', 'putbucketcors', 'putbucketlifecycleconfiguration',
]);

const R2_CLASS_B = new Set([
  'headbucket', 'headobject', 'getobject', 'usagesummary', 'getbucketencryption',
  'getbucketlocation', 'getbucketcors', 'getbucketlifecycleconfiguration',
]);

const ANALYTICS_QUERY = `
  query RegadoUsage(
    $account: String!
    $day: Date!
    $dayStart: Time!
    $month: Date!
    $monthStart: Time!
    $now: Time!
  ) {
    viewer {
      accounts(filter: { accountTag: $account }) {
        callsTurnUsageAdaptiveGroups(
          limit: 1
          filter: { date_geq: $month, date_leq: $day }
        ) {
          sum { egressBytes ingressBytes }
          avg { concurrentConnectionsFiveMinutes }
        }
        workersInvocationsAdaptive(
          limit: 10000
          filter: { datetime_geq: $dayStart, datetime_leq: $now }
        ) {
          sum { requests errors subrequests }
          quantiles { cpuTimeP50 cpuTimeP99 }
        }
        d1AnalyticsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $day, date_leq: $day }
        ) {
          sum {
            readQueries writeQueries rowsRead rowsWritten queryBatchResponseBytes
          }
          quantiles { queryBatchTimeMsP90 }
        }
        d1StorageAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $day, date_leq: $day }
          orderBy: [date_DESC]
        ) {
          max { databaseSizeBytes }
          dimensions { date databaseId }
        }
        r2OperationsAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $monthStart, datetime_leq: $now }
        ) {
          sum { requests }
          dimensions { actionType }
        }
        r2StorageAdaptiveGroups(
          limit: 10000
          filter: { datetime_geq: $monthStart, datetime_leq: $now }
          orderBy: [datetime_DESC]
        ) {
          max { objectCount uploadCount payloadSize metadataSize }
          dimensions { datetime bucketName }
        }
      }
    }
  }
`;
