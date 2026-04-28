/**
 * SyncPoint internal event bus using Node EventEmitter.
 * Used to push real-time events to SSE clients.
 */

import { EventEmitter } from "node:events";

export interface SyncPointEventData {
  eventType: string;
  entityType: string;
  entityId: string;
  detail?: string;
}

class SyncPointEventBus extends EventEmitter {
  private static instance: SyncPointEventBus;

  private constructor() {
    super();
    this.setMaxListeners(50); // allow multiple SSE clients
  }

  static getInstance(): SyncPointEventBus {
    if (!SyncPointEventBus.instance) {
      SyncPointEventBus.instance = new SyncPointEventBus();
    }
    return SyncPointEventBus.instance;
  }
}

export { SyncPointEventBus };
