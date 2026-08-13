import type { RondoIceConfiguration, RondoMessageRoute } from '../domain/rondo';
import type { NodoGateway } from './NodoGateway';
import { NodeConnection } from './NodeFluoGateway';
import type { RondoGateway } from './RondoGateway';

const WIRE_RONDO_ROOM_HEADER = ['x-veri', 'dimensio-rondo-room'].join('');
const WIRE_RONDO_SPACE_HEADER = ['x-veri', 'dimensio-rondo-space'].join('');

export class NodeRondoTransport {
  readonly #connections = new Map<string, Promise<NodeConnection>>();
  readonly #routes = new Map<string, Promise<RondoMessageRoute>>();

  constructor(
    private readonly rondo: RondoGateway,
    private readonly nodes: NodoGateway,
  ) {}

  reset(): void {
    this.#connections.clear();
    this.#routes.clear();
  }

  voiceIce(): Promise<RondoIceConfiguration> {
    return this.rondo.voiceIce();
  }

  async request<T>(
    spaceId: string,
    roomId: string,
    path: string,
    init: RequestInit = {},
    timeout = 15_000,
  ): Promise<T> {
    const key = `${spaceId}:${roomId}`;
    let nodeId: string | null = null;
    try {
      const route = await this.route(key, spaceId, roomId);
      nodeId = route.nodeId;
      const connection = await this.connection(route.nodeId);
      return await connection.json<T>(path, {
        ...init,
        headers: {
          ...init.headers,
          [WIRE_RONDO_ROOM_HEADER]: roomId,
          [WIRE_RONDO_SPACE_HEADER]: spaceId,
        },
      }, timeout);
    } catch (error) {
      if (nodeId) this.#connections.delete(nodeId);
      this.#routes.delete(key);
      throw error;
    }
  }

  private route(key: string, spaceId: string, roomId: string): Promise<RondoMessageRoute> {
    const cached = this.#routes.get(key);
    if (cached) return cached;
    const route = this.rondo.messageRoute(spaceId, roomId);
    this.#routes.set(key, route);
    route.catch(() => { if (this.#routes.get(key) === route) this.#routes.delete(key); });
    return route;
  }

  private connection(nodeId: string): Promise<NodeConnection> {
    const cached = this.#connections.get(nodeId);
    if (cached) return cached;
    const connection = NodeConnection.open(this.nodes, nodeId);
    this.#connections.set(nodeId, connection);
    connection.catch(() => {
      if (this.#connections.get(nodeId) === connection) this.#connections.delete(nodeId);
    });
    return connection;
  }
}
