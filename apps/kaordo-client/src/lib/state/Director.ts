import type { AnyGState } from './GState';
import { GStateManager } from './GStateManager';

interface ManagedStateFamily {
  shutdown(): void;
}

declare const STATE_TYPE: unique symbol;

/** An explicit, nominal key for one state family. */
export class StateKey<TState extends AnyGState> {
  readonly name: string;
  readonly token: symbol;
  declare readonly [STATE_TYPE]: TState;

  constructor(name: string) {
    this.name = name.trim();
    if (!this.name) throw new Error('A state key must have a name.');
    this.token = Symbol(this.name);
  }
}

/** Registers state families and coordinates their lifetime. */
export class Director {
  readonly #managers = new Map<symbol, ManagedStateFamily>();
  readonly #registrationOrder: ManagedStateFamily[] = [];

  register<TState extends AnyGState>(key: StateKey<TState>): GStateManager<TState> {
    if (this.#managers.has(key.token)) {
      throw new Error(`A state manager for "${key.name}" is already registered.`);
    }

    const manager = new GStateManager<TState>(this);
    this.#managers.set(key.token, manager);
    this.#registrationOrder.push(manager);
    return manager;
  }

  get<TState extends AnyGState>(key: StateKey<TState>): GStateManager<TState> {
    const manager = this.#managers.get(key.token);
    if (!manager) {
      throw new Error(`The state manager for "${key.name}" is not registered.`);
    }
    return manager as GStateManager<TState>;
  }

  current<TState extends AnyGState>(key: StateKey<TState>): TState | null {
    return this.get(key).current;
  }

  shutdown(): void {
    for (let index = this.#registrationOrder.length - 1; index >= 0; index -= 1) {
      this.#registrationOrder[index]?.shutdown();
    }
    this.#registrationOrder.length = 0;
    this.#managers.clear();
  }
}
