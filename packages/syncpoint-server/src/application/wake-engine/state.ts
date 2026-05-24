import type { SyncPointEventData } from "../../event-bus.js";
import type { WakeEngineOptions, WakeEngineStats } from "./types.js";

export const wakeEngineState: {
  listener: ((data: SyncPointEventData) => void) | null;
  stats: WakeEngineStats;
  options: WakeEngineOptions;
  processing: boolean;
} = {
  listener: null,
  stats: {
    eventsProcessed: 0,
    wakeRequestsCreated: 0,
    wakeRequestsSkipped: 0,
    running: false,
  },
  options: { enabled: true, defaultRunnerMode: "manual" },
  processing: false,
};
