export type AdminUser = {
  activeSessions: number;
  createdAt: number;
  id: string;
  lastSeenAt: number;
  online: boolean;
  role: 'admin' | 'superadmin' | 'user';
  status: 'active' | 'disabled' | 'suspended' | 'erasing';
  username: string;
};

export type AdminDashboard = {
  capacity: {
    d1: {
      accountStorageBytes: number;
      databaseBytes: number;
      databases: number;
      rowsReadDaily: number;
      rowsWrittenDaily: number;
      timeTravelDays: number;
    };
    r2: {
      classAOperationsMonthly: number;
      classBOperationsMonthly: number;
      storageBytesMonthly: number;
    };
    turn: {
      egressBytesMonthly: number;
      overageUsdPerGb: number;
    };
    worker: {
      cpuMsPerRequest: number;
      cronTriggers: number;
      memoryBytes: number;
      requestsDaily: number;
      scripts: number;
      simultaneousConnections: number;
      startupMs: number;
      subrequestsPerRequest: number;
      workerBytes: number;
    };
  };
  generatedAt: number;
  usage: {
    activeSessions: number;
    cloudflare: CloudflareUsage | null;
    databaseBytes: number | null;
    onlineUsers: number;
    totalUsers: number;
  };
  users: AdminUser[];
};

export type AdminModerationResult = {
  ok: boolean;
  pendingJobs?: number;
  status: 'active' | 'suspended' | 'erasing' | 'erased';
};

export type AdminSeedResetResult = {
  ok: boolean;
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
  periods: { dailyResetAt: number; monthlyStartedAt: number };
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
