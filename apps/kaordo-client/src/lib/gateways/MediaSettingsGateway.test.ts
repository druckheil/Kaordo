import { describe, expect, it } from 'vitest';
import { WebMediaSettingsGateway } from './WebMediaSettingsGateway';

describe('media settings gateway', () => {
  it('persists call devices and levels', async () => {
    const storage = new MemoryStorage();
    const gateway = new WebMediaSettingsGateway(storage);

    expect(gateway.load()).toEqual({
      microphoneId: '',
      microphoneVolume: 100,
      speakerId: '',
      speakerVolume: 100,
    });
    await gateway.save({
      microphoneId: 'mic-1',
      microphoneVolume: 135,
      speakerId: 'speaker-1',
      speakerVolume: 65,
    });

    expect(new WebMediaSettingsGateway(storage).load()).toEqual({
      microphoneId: 'mic-1',
      microphoneVolume: 135,
      speakerId: 'speaker-1',
      speakerVolume: 65,
    });
  });

  it('normalizes corrupt values to safe call defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem('kaordo.media.v1', JSON.stringify({
      microphoneId: 4,
      microphoneVolume: 900,
      speakerId: null,
      speakerVolume: -20,
    }));

    expect(new WebMediaSettingsGateway(storage).load()).toEqual({
      microphoneId: '',
      microphoneVolume: 200,
      speakerId: '',
      speakerVolume: 0,
    });
  });

  it('moves pre-Kaordo device settings to the current key', () => {
    const storage = new MemoryStorage();
    const legacyKey = ['veri', 'dimensio.media.v1'].join('');
    storage.setItem(legacyKey, JSON.stringify({
      microphoneId: 'legacy-mic',
      microphoneVolume: 80,
      speakerId: 'legacy-speaker',
      speakerVolume: 75,
    }));

    expect(new WebMediaSettingsGateway(storage).load()).toMatchObject({
      microphoneId: 'legacy-mic',
      speakerId: 'legacy-speaker',
    });
    expect(storage.getItem('kaordo.media.v1')).not.toBeNull();
    expect(storage.getItem(legacyKey)).toBeNull();
  });
});

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
