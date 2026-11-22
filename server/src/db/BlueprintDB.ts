import type { Blueprint, SavedBlueprint } from '@tunarr/types/api';
import { BlueprintSchema } from '@tunarr/types/api';
import { eq } from 'drizzle-orm';
import { inject, injectable } from 'inversify';
import { v4 } from 'uuid';
import { KEYS } from '../types/inject.ts';
import type { Maybe } from '../types/util.ts';
import { InjectLogger } from '../util/inject.ts';
import type { Logger } from '../util/logging/LoggerFactory.ts';
import { ChannelBlueprint } from './schema/ChannelBlueprint.ts';
import type { DrizzleDBAccess } from './schema/index.ts';

/** Saved channel blueprints. Built-ins live in code, not here. */
@injectable()
export class BlueprintDB {
  @InjectLogger() declare private readonly logger: Logger;

  constructor(@inject(KEYS.DrizzleDB) private db: DrizzleDBAccess) {}

  async getAll(): Promise<SavedBlueprint[]> {
    const rows = await this.db.query.channelBlueprint.findMany({
      orderBy: (fields, { asc }) => asc(fields.name),
    });
    const out: SavedBlueprint[] = [];
    for (const row of rows) {
      const saved = this.toSaved(row);
      if (saved) {
        out.push(saved);
      }
    }
    return out;
  }

  async getById(id: string): Promise<Maybe<SavedBlueprint>> {
    const row = await this.db.query.channelBlueprint.findFirst({
      where: (fields, { eq }) => eq(fields.uuid, id),
    });
    return row ? this.toSaved(row) : undefined;
  }

  /**
   * Saves a blueprint under a new id. The stored body carries that id, so an
   * export reads back as the same saved blueprint.
   */
  async insert(blueprint: Blueprint): Promise<SavedBlueprint> {
    const id = v4();
    const now = new Date();
    const body: Blueprint = { ...blueprint, id };
    await this.db.insert(ChannelBlueprint).values({
      uuid: id,
      name: body.name,
      body,
      createdAt: now,
      updatedAt: now,
    });
    return {
      id,
      builtIn: false,
      blueprint: body,
      createdAt: +now,
      updatedAt: +now,
    };
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(ChannelBlueprint)
      .where(eq(ChannelBlueprint.uuid, id))
      .returning({ uuid: ChannelBlueprint.uuid });
    return result.length > 0;
  }

  // A row that no longer parses (hand-edited, or written by a newer build) is
  // skipped and logged rather than failing the whole list.
  private toSaved(row: ChannelBlueprint): Maybe<SavedBlueprint> {
    const parsed = BlueprintSchema.safeParse(row.body);
    if (!parsed.success) {
      this.logger.warn(
        'Skipping saved blueprint %s: %s',
        row.uuid,
        parsed.error.message,
      );
      return;
    }
    return {
      id: row.uuid,
      builtIn: false,
      blueprint: parsed.data,
      createdAt: +row.createdAt,
      updatedAt: +row.updatedAt,
    };
  }
}
