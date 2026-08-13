export type OpenedMicrophone = {
  deviceId: string;
  label: string;
  stream: MediaStream;
};

export async function openMicrophone(deviceId: string): Promise<OpenedMicrophone> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported on this device.');
  }
  if (deviceId && !navigator.mediaDevices.getSupportedConstraints().deviceId) {
    throw new Error('This system cannot select an individual microphone.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: microphoneConstraints(deviceId),
    video: false,
  });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new Error('The selected microphone did not provide an audio track.');
  }
  try {
    if (deviceId && !matchesDevice(track, deviceId)) {
      await track.applyConstraints({ deviceId: { exact: deviceId } });
    }
  } catch (error) {
    stopStream(stream);
    throw error;
  }
  if (deviceId && !matchesDevice(track, deviceId)) {
    stopStream(stream);
    throw new Error(`The system opened “${track.label || 'System default'}” instead of the selected microphone.`);
  }
  return {
    deviceId: track.getSettings().deviceId ?? deviceId,
    label: track.label || 'System default',
    stream,
  };
}

export function microphoneConstraints(deviceId: string): MediaTrackConstraints {
  return {
    autoGainControl: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
  };
}

function matchesDevice(track: MediaStreamTrack, requestedId: string): boolean {
  if (requestedId === 'default') return true;
  const actualId = track.getSettings().deviceId;
  return !actualId || actualId === requestedId;
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}
