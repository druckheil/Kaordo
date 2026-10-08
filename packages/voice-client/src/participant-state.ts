// Projects LiveKit participants and published videos into view-independent snapshots
import { Track, type Participant, type Room } from 'livekit-client';
import type { VoiceParticipant, VoiceSnapshot, VoiceVideo } from './model.js';

const videoSources = [
  ['camera', Track.Source.Camera],
  ['screen', Track.Source.ScreenShare]
] as const;

export function participantSnapshots(room: Room, includeParticipants: boolean): Pick<VoiceSnapshot, 'participants' | 'videos'> {
  const participants: VoiceParticipant[] = [];
  const videos: VoiceVideo[] = [];
  if (includeParticipants) {
    appendParticipant(room.localParticipant, true, participants, videos);
    for (const participant of room.remoteParticipants.values()) {
      appendParticipant(participant, false, participants, videos);
    }
  }
  return { participants, videos };
}

function appendParticipant(participant: Participant, local: boolean, participants: VoiceParticipant[], videos: VoiceVideo[]): void {
  const name = participant.name || participant.identity;
  participants.push({
    id: participant.identity, name, speaking: participant.isSpeaking,
    microphoneEnabled: participant.isMicrophoneEnabled, cameraEnabled: participant.isCameraEnabled,
    screenShareEnabled: participant.isScreenShareEnabled, local
  });
  for (const [source, trackSource] of videoSources) {
    const publication = participant.getTrackPublication(trackSource);
    if (!publication?.videoTrack || publication.isMuted) continue;
    videos.push({
      id: `${participant.identity}:${source}:${publication.trackSid}`,
      participantId: participant.identity, name, source, local, trackSid: publication.trackSid
    });
  }
}
