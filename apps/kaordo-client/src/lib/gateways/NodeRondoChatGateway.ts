import type { RondoMessage, RondoMessagePage } from '../domain/rondo';
import type { NodeRondoTransport } from './NodeRondoTransport';

export interface RondoChatGateway {
  createMessage(spaceId: string, roomId: string, body: string): Promise<RondoMessage>;
  deleteMessage(spaceId: string, roomId: string, messageId: string): Promise<void>;
  listMessages(
    spaceId: string,
    roomId: string,
    cursor: string | null,
    limit: number,
  ): Promise<RondoMessagePage>;
  reset(): void;
}

export class NodeRondoChatGateway implements RondoChatGateway {
  constructor(private readonly transport: NodeRondoTransport) {}

  reset(): void {
    this.transport.reset();
  }

  async listMessages(
    spaceId: string,
    roomId: string,
    cursor: string | null,
    limit: number,
  ): Promise<RondoMessagePage> {
    const query = new URLSearchParams({ limit: String(Math.max(1, Math.min(50, limit))) });
    if (cursor) query.set('cursor', cursor);
    return this.request(spaceId, roomId, `?${query}`);
  }

  async createMessage(spaceId: string, roomId: string, body: string): Promise<RondoMessage> {
    const created = await this.request<{ message: RondoMessage }>(spaceId, roomId, '', {
      body: JSON.stringify({ body }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    return created.message;
  }

  async deleteMessage(spaceId: string, roomId: string, messageId: string): Promise<void> {
    await this.request(spaceId, roomId, `/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }

  private async request<T = RondoMessagePage>(
    spaceId: string,
    roomId: string,
    suffix: string,
    init: RequestInit = {},
  ): Promise<T> {
    try {
      return await this.transport.request<T>(spaceId, roomId,
        `/v1/rondo/spaces/${encodeURIComponent(spaceId)}/rooms/${encodeURIComponent(roomId)}/messages${suffix}`,
        init,
      );
    } catch (error) {
      throw error instanceof Error
        ? new Error(`Room messages could not reach their Nodo. ${error.message}`)
        : new Error('Room messages could not reach their Nodo.');
    }
  }

}
