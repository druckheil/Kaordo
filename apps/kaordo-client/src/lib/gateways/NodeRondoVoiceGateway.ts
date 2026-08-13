import type { NodeRondoTransport } from './NodeRondoTransport';

export type RondoVoiceParticipant = {
  joinedAt: number;
  peerId: string;
  username: string;
};

export type RondoVoiceSignal = {
  fromPeerId: string;
  payload: string;
  sequence: number;
  type: 'answer' | 'ice' | 'offer';
};

export type RondoVoiceSync = {
  cursor: number;
  participants: RondoVoiceParticipant[];
  signals: RondoVoiceSignal[];
};

export interface RondoVoiceGateway {
  iceServers(): Promise<RTCIceServer[]>;
  join(spaceId: string, roomId: string, peerId: string): Promise<RondoVoiceSync>;
  leave(spaceId: string, roomId: string, peerId: string): Promise<void>;
  peek(spaceId: string, roomId: string): Promise<RondoVoiceSync>;
  signal(
    spaceId: string,
    roomId: string,
    input: { payload: string; peerId: string; toPeerId: string; type: RondoVoiceSignal['type'] },
  ): Promise<void>;
  sync(spaceId: string, roomId: string, peerId: string, after: number): Promise<RondoVoiceSync>;
}

export class NodeRondoVoiceGateway implements RondoVoiceGateway {
  #cachedIce: { expiresAt: number; iceServers: RTCIceServer[] } | null = null;

  constructor(private readonly transport: NodeRondoTransport) {}

  async iceServers(): Promise<RTCIceServer[]> {
    const now = Math.floor(Date.now() / 1_000);
    if (this.#cachedIce && this.#cachedIce.expiresAt - 43_200 > now) return this.#cachedIce.iceServers;
    const configuration = await this.transport.voiceIce();
    this.#cachedIce = configuration;
    return configuration.iceServers;
  }

  join(spaceId: string, roomId: string, peerId: string): Promise<RondoVoiceSync> {
    return this.request(spaceId, roomId, 'join', {
      body: JSON.stringify({ peerId }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  async leave(spaceId: string, roomId: string, peerId: string): Promise<void> {
    const query = new URLSearchParams({ peerId });
    await this.request(spaceId, roomId, `leave?${query}`, { method: 'DELETE' }).catch(() => undefined);
  }

  peek(spaceId: string, roomId: string): Promise<RondoVoiceSync> {
    return this.request(spaceId, roomId, 'peek');
  }

  async signal(
    spaceId: string,
    roomId: string,
    input: { payload: string; peerId: string; toPeerId: string; type: RondoVoiceSignal['type'] },
  ): Promise<void> {
    await this.request(spaceId, roomId, 'signals', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
  }

  sync(spaceId: string, roomId: string, peerId: string, after: number): Promise<RondoVoiceSync> {
    const query = new URLSearchParams({ after: String(after), peerId });
    return this.request(spaceId, roomId, `sync?${query}`);
  }

  private request<T = RondoVoiceSync>(
    spaceId: string,
    roomId: string,
    action: string,
    init: RequestInit = {},
  ): Promise<T> {
    return this.transport.request(
      spaceId,
      roomId,
      `/v1/rondo/spaces/${encodeURIComponent(spaceId)}/rooms/${encodeURIComponent(roomId)}/voice/${action}`,
      init,
      8_000,
    );
  }
}
