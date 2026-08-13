import { afterEach, describe, expect, it, vi } from 'vitest';
import { microphoneConstraints, openMicrophone } from './mediaDevices';

const originalMediaDevices = navigator.mediaDevices;

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: originalMediaDevices,
  });
});

describe('microphone device selection', () => {
  it('requires the exact selected device and verifies the opened track', async () => {
    let actualDeviceId = 'system-microphone';
    const applyConstraints = vi.fn(async () => { actualDeviceId = 'iphone-microphone'; });
    const stop = vi.fn();
    installMediaDevices({ actualDeviceId: () => actualDeviceId, applyConstraints, stop });

    const opened = await openMicrophone('iphone-microphone');

    expect(applyConstraints).toHaveBeenCalledWith({ deviceId: { exact: 'iphone-microphone' } });
    expect(opened.deviceId).toBe('iphone-microphone');
    expect(opened.label).toBe('iPhone Microphone');
    expect(stop).not.toHaveBeenCalled();
  });

  it('stops and rejects a stream when the system silently keeps the wrong microphone', async () => {
    const stop = vi.fn();
    installMediaDevices({
      actualDeviceId: () => 'system-microphone',
      applyConstraints: vi.fn(async () => undefined),
      stop,
    });

    await expect(openMicrophone('iphone-microphone')).rejects.toThrow(
      'instead of the selected microphone',
    );
    expect(stop).toHaveBeenCalledOnce();
  });

  it('builds mandatory device constraints only for an explicit choice', () => {
    expect(microphoneConstraints('')).not.toHaveProperty('deviceId');
    expect(microphoneConstraints('mic-2')).toMatchObject({
      deviceId: { exact: 'mic-2' },
      echoCancellation: true,
    });
  });
});

function installMediaDevices(input: {
  actualDeviceId: () => string;
  applyConstraints: (constraints: MediaTrackConstraints) => Promise<void>;
  stop: () => void;
}): void {
  const track = {
    applyConstraints: input.applyConstraints,
    getSettings: () => ({ deviceId: input.actualDeviceId() }),
    label: 'iPhone Microphone',
    stop: input.stop,
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getSupportedConstraints: () => ({ deviceId: true }),
      getUserMedia: vi.fn(async () => stream),
    },
  });
}
