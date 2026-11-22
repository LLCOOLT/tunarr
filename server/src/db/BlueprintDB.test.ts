import { NinetiesSitcomsBlueprint } from '@tunarr/shared/channel-templates';
import tmp from 'tmp-promise';
import { test as baseTest } from 'vitest';
import { bootstrapTunarr } from '../bootstrap.ts';
import { setGlobalOptions } from '../globals.ts';
import { copyPreMigratedDb } from '../testing/testDbFactory.ts';
import { BlueprintDB } from './BlueprintDB.ts';
import { DBAccess } from './DBAccess.ts';
import { ChannelBlueprint } from './schema/ChannelBlueprint.ts';
import type { DrizzleDBAccess } from './schema/index.ts';

type Fixture = {
  db: string;
  drizzle: DrizzleDBAccess;
  blueprintDB: BlueprintDB;
};

const test = baseTest.extend<Fixture>({
  db: async ({}, use) => {
    const dbResult = await tmp.dir({ unsafeCleanup: true });
    await copyPreMigratedDb(dbResult.path);
    setGlobalOptions({
      database: dbResult.path,
      log_level: 'info',
      verbose: 0,
    });
    await bootstrapTunarr();
    await use(dbResult.path);
    await DBAccess.instance.closeConnection(`${dbResult.path}/db.db`);
    await dbResult.cleanup();
  },
  drizzle: async ({ db: _ }, use) => {
    const drizzle = DBAccess.instance.drizzle;
    if (!drizzle) {
      throw new Error('The test database did not open');
    }
    await use(drizzle);
  },
  blueprintDB: async ({ drizzle }, use) => {
    await use(new BlueprintDB(drizzle));
  },
});

describe('BlueprintDB', () => {
  test('saves a blueprint under a new id and reads it back', async ({
    blueprintDB,
  }) => {
    const saved = await blueprintDB.insert(NinetiesSitcomsBlueprint);
    expect(saved.id).not.toBe(NinetiesSitcomsBlueprint.id);
    expect(saved.blueprint).toEqual({
      ...NinetiesSitcomsBlueprint,
      id: saved.id,
    });

    expect(await blueprintDB.getById(saved.id)).toEqual(saved);
    expect((await blueprintDB.getAll()).map((b) => b.id)).toEqual([saved.id]);
  });

  test('deletes, and says whether anything was deleted', async ({
    blueprintDB,
  }) => {
    const saved = await blueprintDB.insert(NinetiesSitcomsBlueprint);
    expect(await blueprintDB.delete(saved.id)).toBe(true);
    expect(await blueprintDB.delete(saved.id)).toBe(false);
    expect(await blueprintDB.getById(saved.id)).toBeUndefined();
  });

  test('skips a stored row that no longer parses', async ({
    blueprintDB,
    drizzle,
  }) => {
    await drizzle.insert(ChannelBlueprint).values({
      uuid: 'broken',
      name: 'Broken',
      body: { blueprintVersion: 99 },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const saved = await blueprintDB.insert(NinetiesSitcomsBlueprint);
    expect((await blueprintDB.getAll()).map((b) => b.id)).toEqual([saved.id]);
    expect(await blueprintDB.getById('broken')).toBeUndefined();
  });
});
