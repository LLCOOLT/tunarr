import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// A saved channel blueprint (plans/channel-blueprints.md). `body` is the
// blueprint JSON as BlueprintSchema parses it; `name` is a copy for listing.
// Built-in blueprints ship in code and are never stored.
export const ChannelBlueprint = sqliteTable('channel_blueprint', {
  uuid: text().primaryKey(),
  name: text().notNull(),
  body: text({ mode: 'json' }).notNull(),
  createdAt: integer({ mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer({ mode: 'timestamp_ms' }).notNull(),
});

export type ChannelBlueprint = InferSelectModel<typeof ChannelBlueprint>;
export type NewChannelBlueprint = InferInsertModel<typeof ChannelBlueprint>;
