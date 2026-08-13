import { describe, expect, it, vi } from 'vitest';
import type { NodoNode } from '../domain/nodo';
import { NodoRegistry } from './NodoRegistry';

describe('NodoRegistry', () => {
  it('deduplicates by canonical ID and rejects stale reappearance after deletion', () => {
    const registry = new NodoRegistry();
    const subscriber = vi.fn();
    registry.subscribe(subscriber);
    registry.replace([
      { ...NODE, lastSeenAt: 100 },
      { ...NODE, lastSeenAt: 200, usedBytes: 42 },
    ]);

    expect(registry.nodes).toHaveLength(1);
    expect(registry.nodes[0]?.usedBytes).toBe(42);

    registry.remove(NODE.id);
    registry.replace([{ ...NODE, lastSeenAt: 150 }]);

    expect(registry.nodes).toEqual([]);
    registry.replace([{ ...NODE, lastSeenAt: 201 }]);
    expect(registry.nodes).toEqual([{ ...NODE, lastSeenAt: 201 }]);
    expect(subscriber).toHaveBeenCalled();
  });
});

const NODE: NodoNode = {
  createdAt: 1,
  deviceName: 'Tablet',
  diagnostics: { completedAt: null, requestedAt: null, running: false },
  id: '123e4567-e89b-42d3-a456-426614174000',
  lastSeenAt: 1,
  localAddresses: ['192.168.1.44'],
  metrics: {
    androidSdk: 31, appVersion: '0.5.0', batteryPercent: 80, charging: true,
    coordinatorLatencyMs: 20, diskReadBps: null, diskWriteBps: null,
    memoryAvailableBytes: null, memoryTotalBytes: null, networkMetered: false,
    networkDownBps: null, networkType: 'wifi', networkUpBps: null,
    storageAvailableBytes: null,
  },
  observedAddress: null,
  online: true,
  policy: { allowDownloads: true, allowUploads: true, chargingOnly: false, ownerOnly: true, wifiOnly: true },
  port: 49_321,
  protocol: 'tus/1.0.0',
  quotaBytes: 1_000,
  spaces: {
    private: { quotaBytes: 1_000, usedBytes: 0 },
    public: { quotaBytes: 0, usedBytes: 0 },
  },
  usedBytes: 0,
};
