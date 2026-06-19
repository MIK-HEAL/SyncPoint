/**
 * SyncPoint internal event bus using Node EventEmitter.
 * Used to push real-time events to SSE clients.
 *
 * Features:
 *   - Monotonically increasing event sequence numbers
 *   - Heartbeat detection
 *   - SSE connection management
 *   - Last-Event-Seq support for reconnection replay
 *   - Event ring buffer for replay after reconnect
 *   - Prometheus-compatible metrics
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

/** SSE connection metrics snapshot. */
export interface SseMetrics {
  activeConnections: number;
  totalConnections: number;
  eventsPushed: number;
  reconnects: number;
  reconnectReplays: number;
}

const RING_BUFFER_SIZE = 1000;

class SyncPointEventBus extends EventEmitter {
  private _seq = 0;
  private _ring: SyncPointEventData[] = [];
  private _metrics: SseMetrics = {
    activeConnections: 0,
    totalConnections: 0,
    eventsPushed: 0,
    reconnects: 0,
    reconnectReplays: 0,
  };

  constructor() {
    super();
    this.setMaxListeners(200); // accommodate SSE + internal listeners
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

    // Store in ring buffer for replay
    if (this._ring.length >= RING_BUFFER_SIZE) {
      this._ring.shift();
    }
    this._ring.push(data);

    this._metrics.eventsPushed++;
    this.emit("event", data);
  }

  /** Current sequence number (for Last-Event-Seq handshake). */
  get currentSeq(): number {
    return this._seq;
  }

  /** Reset sequence counter (for testing). */
  resetSequence(): void {
    this._seq = 0;
    this._ring = [];
  }

  /**
   * Recover sequence counter from persisted state (e.g. after server restart).
   * Sets _seq to the given value so subsequent events continue from there.
   */
  recoverSeq(maxSeq: number): void {
    if (maxSeq > this._seq) {
      this._seq = maxSeq;
    }
  }

  /**
   * Replay events after a given sequence number.
   * Returns events with seq > lastSeq from the ring buffer.
   */
  replayAfter(lastSeq: number): SyncPointEventData[] {
    if (lastSeq <= 0) return [];
    const events = this._ring.filter(e => e.seq > lastSeq);
    this._metrics.reconnectReplays += events.length;
    return events;
  }

  // ── Connection metrics ──────────────────────────────

  /** Increment active connection count. */
  connectionOpened(): void {
    this._metrics.activeConnections++;
    this._metrics.totalConnections++;
  }

  /** Decrement active connection count. */
  connectionClosed(): void {
    this._metrics.activeConnections = Math.max(0, this._metrics.activeConnections - 1);
  }

  /** Increment reconnect counter. */
  reconnectDetected(): void {
    this._metrics.reconnects++;
  }

  /** Get current metrics snapshot. */
  getMetrics(): SseMetrics {
    return { ...this._metrics };
  }

  /** Reset metrics (for testing). */
  resetMetrics(): void {
    this._metrics = {
      activeConnections: 0,
      totalConnections: 0,
      eventsPushed: 0,
      reconnects: 0,
      reconnectReplays: 0,
    };
  }
}

// ── Factory & default singleton ────────────────────────

export function createEventBus(): SyncPointEventBus {
  return new SyncPointEventBus();
}

export { SyncPointEventBus };
