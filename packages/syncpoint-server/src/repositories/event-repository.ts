/**
 * Event repository.
 */

import { desc } from "drizzle-orm";
import * as s from "../schema.js";
import type { Event } from "syncpoint-core";
import { _getDb } from "./_shared.js";

export function listEvents(limit = 100): Event[] {
  return _getDb().select().from(s.events).orderBy(desc(s.events.createdAt)).limit(limit).all() as unknown as Event[];
}
