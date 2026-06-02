/**
 * SyncPoint internal event bus using Node EventEmitter.
 * Used to push real-time events to SSE clients.
 *
 * Features:
 *   - Monotonically increasing event sequence numbers
 *   - Heartbeat detection
 *   - SSE connection management
 *   - Last-Event-Seq support for reconnection replay
 */

import { EventEmitter } from "node:events";

export interface SyncPointEventData {
  /** Monotonically increasing sequence number. Clients track this for replay. */
  seq: number;
  eventType: string;
  entityType: string;
  entityId: string;
  detail?: string;
  timestamp: string;
}

class SyncPointEventBus extends EventEmitter {
  private static instance: SyncPointEventBus;
  private _seq = 0;

  private constructor() {
    super();
    this.setMaxListeners(200); // accommodate SSE + internal listeners
  }

  static getInstance(): SyncPointEventBus {
    if (!SyncPointEventBus.instance) {
      SyncPointEventBus.instance = new SyncPointEventBus();
    }
    return SyncPointEventBus.instance;
  }

  /** Emit an event with an auto-incremented sequence number. */
  emitEvent(
    eventType: string,
    entityType: string,
    entityId: string,
    detail?: string,
  ): void {
    this._seq++;
    const data: SyncPointEventData = {
      seq: this._seq,
      eventType,
      entityType,
      entityId,
      detail,
      timestamp: new Date().toISOString(),
    };
    this.emit("event", data);
  }

  /** Current sequence number (for Last-Event-Seq handshake). */
  get currentSeq(): number {
    return this._seq;
  }

  /** Reset sequence counter (for testing). */
  resetSequence(): void {
    this._seq = 0;
  }
}

export { SyncPointEventBus };
