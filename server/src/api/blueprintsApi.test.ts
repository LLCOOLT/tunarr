import {
  BuiltInBlueprints,
  NinetiesSitcomsBlueprint,
} from '@tunarr/shared/channel-templates';
import type { Channel } from '@tunarr/types';
import type {
  BlueprintPreviewResponse,
  SavedBlueprint,
} from '@tunarr/types/api';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { describe, expect, test, vi } from 'vitest';
import type { BlueprintDB } from '../db/BlueprintDB.ts';
import type { ChannelDB } from '../db/ChannelDB.ts';
import type { SmartCollectionsDB } from '../db/SmartCollectionsDB.ts';
import type { TranscodeConfigDB } from '../db/TranscodeConfigDB.ts';
import type * as AutoChannelServiceModule from '../services/AutoChannelService.ts';
import type * as BlueprintServiceModule from '../services/BlueprintService.ts';
import type { BlueprintService } from '../services/BlueprintService.ts';
import type { MeilisearchService } from '../services/MeilisearchService.ts';
import { GenericBadRequestError } from '../types/errors.ts';
import { Result } from '../types/result.ts';
import type { ZodTypeProvider } from '../util/zod.ts';
import { BlueprintsApiController } from './blueprintsApi.ts';

// The real service modules pull in the DI container and the scheduler.
vi.mock('../services/BlueprintService.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof BlueprintServiceModule>();
  return {
    BlueprintService: class {},
    BlueprintNotFoundError: actual.BlueprintNotFoundError,
  };
});
vi.mock('../services/Scheduler.js', () => ({
  GlobalScheduler: {
    getScheduledJob: () => ({ runNow: () => Promise.resolve() }),
  },
}));

const { BlueprintNotFoundError } = await vi.importActual<
  typeof BlueprintServiceModule
>('../services/BlueprintService.ts');

const channel: Channel = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: '90s Sitcoms',
  number: 7,
  duration: 0,
  startTime: 0,
  groupTitle: 'Auto-Created',
  icon: { path: '', width: 0, duration: 0, position: 'bottom-right' },
  stealth: false,
  disableFillerOverlay: false,
  guideMinimumDuration: 30000,
  offline: { mode: 'pic' },
  onDemand: { enabled: false },
  programCount: 2,
  streamMode: 'hls',
  transcodeConfigId: '5f0e7c2a-3b1d-4e8f-9a6c-1d2b3c4d5e6f',
  subtitlesEnabled: false,
  useEtvNext: false,
  streamSelectionProfileId: null,
};

const preview: BlueprintPreviewResponse = {
  roles: [
    {
      role: 'sitcoms',
      label: 'Sitcoms',
      preview: {
        totalPrograms: 2,
        byType: {
          movie: 0,
          episode: 2,
          track: 0,
          music_video: 0,
          other_video: 0,
        },
        topShows: [],
        totalDurationMs: 3_600_000,
        sampleIds: ['p1', 'p2'],
      },
    },
  ],
};

const builtInList: SavedBlueprint[] = BuiltInBlueprints.map((blueprint) => ({
  id: blueprint.id,
  builtIn: true,
  blueprint,
}));

// Over HTTP the blueprint is JSON, so compare against its JSON form.
const sitcomsJson = JSON.parse(JSON.stringify(NinetiesSitcomsBlueprint)) as {
  id: string;
};

async function makeApp() {
  const service = {
    list: vi.fn(() => Promise.resolve(builtInList)),
    get: vi.fn((id: string) =>
      Promise.resolve(builtInList.find((b) => b.id === id)),
    ),
    preview: vi.fn(() => Promise.resolve(preview)),
    createChannel: vi.fn(() => Promise.resolve(channel)),
    importBlueprint: vi.fn((input: unknown) =>
      Promise.resolve({
        id: 'saved-1',
        builtIn: false,
        blueprint: input,
      } as SavedBlueprint),
    ),
    delete: vi.fn(() => Promise.resolve(true)),
    blueprintForChannel: vi.fn(() => Promise.resolve(NinetiesSitcomsBlueprint)),
  };

  const app = Fastify().withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(
    new BlueprintsApiController(service as unknown as BlueprintService).mount,
  );
  return { app, service };
}

describe('GET /blueprints', () => {
  test('lists the built-ins', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/blueprints' });
    expect(res.statusCode).toBe(200);
    expect(res.json<SavedBlueprint[]>().map((b) => b.id)).toEqual(
      BuiltInBlueprints.map((b) => b.id),
    );
  });
});

describe('POST /blueprints/preview', () => {
  test('returns the per-role preview', async () => {
    const { app, service } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/preview',
      payload: { blueprint: NinetiesSitcomsBlueprint, scope: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(preview);
    expect(service.preview).toHaveBeenCalledWith({
      blueprint: sitcomsJson,
      scope: {},
    });
  });

  test('rejects a body that is not a blueprint without previewing', async () => {
    const { app, service } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/preview',
      payload: { blueprint: { name: 'x' } },
    });
    expect(res.statusCode).toBe(400);
    expect(service.preview).not.toHaveBeenCalled();
  });
});

describe('POST /blueprints/create-channel', () => {
  test('answers 201 with the new channel', async () => {
    const { app, service } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/create-channel',
      payload: { blueprint: NinetiesSitcomsBlueprint, channelNumber: 7 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<Channel>().id).toBe(channel.id);
    expect(service.createChannel).toHaveBeenCalledWith({
      blueprint: sitcomsJson,
      channelNumber: 7,
    });
  });

  test('answers 400 with the reason for a bad request', async () => {
    const { app, service } = await makeApp();
    service.createChannel.mockRejectedValueOnce(
      new GenericBadRequestError('Channel with number 7 already exists'),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/create-channel',
      payload: { blueprint: NinetiesSitcomsBlueprint, channelNumber: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      message: 'Channel with number 7 already exists',
    });
  });

  test('answers 500 for any other failure', async () => {
    const { app, service } = await makeApp();
    service.createChannel.mockRejectedValueOnce(new Error('disk full'));
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/create-channel',
      payload: { blueprint: NinetiesSitcomsBlueprint },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: 'disk full' });
  });
});

describe('POST /blueprints/import', () => {
  test('answers 201 with the saved blueprint', async () => {
    const { app, service } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/import',
      payload: NinetiesSitcomsBlueprint,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<SavedBlueprint>().id).toBe('saved-1');
    expect(service.importBlueprint).toHaveBeenCalledWith(sitcomsJson);
  });

  test('passes the reason a file is refused', async () => {
    const { app, service } = await makeApp();
    service.importBlueprint.mockRejectedValueOnce(
      new GenericBadRequestError('This blueprint is version 2'),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/blueprints/import',
      payload: { ...NinetiesSitcomsBlueprint, blueprintVersion: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'This blueprint is version 2' });
  });
});

describe('GET /blueprints/:id/export', () => {
  test('sends the blueprint as a file', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/blueprints/90s-sitcoms/export',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="90s-sitcoms.tunarr-blueprint.json"',
    );
    expect(res.json()).toEqual(sitcomsJson);
  });

  test('answers 404 for an unknown id', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/blueprints/nope/export',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /blueprints/:id', () => {
  test('answers 204 when deleted', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'DELETE', url: '/blueprints/x' });
    expect(res.statusCode).toBe(204);
  });

  test('answers 404 when there was nothing to delete', async () => {
    const { app, service } = await makeApp();
    service.delete.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'DELETE', url: '/blueprints/x' });
    expect(res.statusCode).toBe(404);
  });

  test('answers 400 for a built-in', async () => {
    const { app, service } = await makeApp();
    service.delete.mockRejectedValueOnce(
      new GenericBadRequestError('Built-in blueprints cannot be deleted'),
    );
    const res = await app.inject({
      method: 'DELETE',
      url: '/blueprints/90s-sitcoms',
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /channels/:id/blueprint', () => {
  test('returns the channel as a blueprint', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/channels/${channel.id}/blueprint`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(sitcomsJson);
  });

  test('answers 404 for an unknown channel', async () => {
    const { app, service } = await makeApp();
    service.blueprintForChannel.mockRejectedValueOnce(
      new BlueprintNotFoundError('Channel x not found'),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/channels/x/blueprint',
    });
    expect(res.statusCode).toBe(404);
  });

  test('answers 422 with the slot that blocks it', async () => {
    const { app, service } = await makeApp();
    service.blueprintForChannel.mockRejectedValueOnce(
      new GenericBadRequestError('Slot 2 plays a show slot.'),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/channels/x/blueprint',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ message: 'Slot 2 plays a show slot.' });
  });
});

describe('BlueprintService with the real auto-channel service', () => {
  async function realService(options: { usedNumbers?: number[] } = {}) {
    const { AutoChannelService } = await vi.importActual<
      typeof AutoChannelServiceModule
    >('../services/AutoChannelService.ts');
    const { BlueprintService: RealBlueprintService } = await vi.importActual<
      typeof BlueprintServiceModule
    >('../services/BlueprintService.ts');

    let collection = 0;
    const smartCollectionsDB = {
      insert: vi.fn(() =>
        Promise.resolve(
          Result.success({
            uuid: `00000000-0000-4000-8000-00000000000${++collection}`,
          }),
        ),
      ),
      materializeSmartCollection: vi.fn(() =>
        Promise.resolve([{ id: `p${collection}` }]),
      ),
      delete: vi.fn(() => Promise.resolve()),
    };
    const savedChannels: { name: string; number: number }[] = [];
    const channelDB = {
      getAllChannels: () =>
        Promise.resolve(
          (options.usedNumbers ?? []).map((number) => ({ number })),
        ),
      saveChannel: vi.fn((data: { name: string; number: number }) => {
        savedChannels.push(data);
        return Promise.resolve({ channel: { uuid: channel.id } });
      }),
      updateLineup: vi.fn(() => Promise.resolve()),
      loadChannelAndLineupOrm: vi.fn(() => Promise.resolve(undefined)),
      deleteChannel: vi.fn(() => Promise.resolve()),
    };
    const auto = new AutoChannelService(
      {} as MeilisearchService,
      smartCollectionsDB as unknown as SmartCollectionsDB,
      channelDB as unknown as ChannelDB,
      {
        getDefaultConfig: () =>
          Promise.resolve({ uuid: channel.transcodeConfigId }),
      } as unknown as TranscodeConfigDB,
    );
    const cycleBoundary = {
      initializeChannel: vi.fn((_channelId: string) => Promise.resolve()),
    };
    const service = new RealBlueprintService(
      {} as BlueprintDB,
      auto,
      channelDB as unknown as ChannelDB,
      smartCollectionsDB as unknown as SmartCollectionsDB,
      cycleBoundary,
    );
    return {
      service,
      smartCollectionsDB,
      channelDB,
      savedChannels,
      cycleBoundary,
    };
  }

  test('makes one smart collection per role, named from the blueprint', async () => {
    const { service, smartCollectionsDB, channelDB, savedChannels } =
      await realService({ usedNumbers: [1] });

    // The lookup after creating is stubbed out, so the call fails at the very
    // end; everything that matters has been written by then.
    await expect(
      service.createChannel({
        blueprint: {
          ...NinetiesSitcomsBlueprint,
          channel: { namePattern: '{name} on {number}', numberHint: 1 },
        },
        scope: { libraryIds: ['lib-1'] },
      }),
    ).rejects.toThrow('could not be retrieved');

    expect(smartCollectionsDB.insert).toHaveBeenCalledTimes(1);
    expect(savedChannels[0]).toMatchObject({
      name: '90s Sitcoms on 2',
      number: 2,
    });
    const lineup = channelDB.updateLineup.mock.calls[0] as unknown[];
    expect(lineup[1]).toMatchObject({
      type: 'random',
      schedule: {
        slots: [
          {
            type: 'smart-collection',
            smartCollectionId: '00000000-0000-4000-8000-000000000001',
          },
        ],
      },
    });
  });

  test('a blueprint that rebuilds each cycle saves that and builds the first cycles', async () => {
    const { service, channelDB, cycleBoundary } = await realService();

    await expect(
      service.createChannel({
        blueprint: { ...NinetiesSitcomsBlueprint, rebuildEachCycle: true },
        scope: { libraryIds: ['lib-1'] },
      }),
    ).rejects.toThrow('could not be retrieved');

    const lineup = channelDB.updateLineup.mock.calls[0] as unknown[];
    expect(lineup[1]).toMatchObject({ rebuildEachCycle: true });
    expect(cycleBoundary.initializeChannel).toHaveBeenCalledExactlyOnceWith(
      channel.id,
    );
  });

  test('a blueprint that does not rebuild saves a fixed lineup', async () => {
    const { service, channelDB, cycleBoundary } = await realService();

    await expect(
      service.createChannel({
        blueprint: { ...NinetiesSitcomsBlueprint, rebuildEachCycle: false },
        scope: { libraryIds: ['lib-1'] },
      }),
    ).rejects.toThrow('could not be retrieved');

    const lineup = channelDB.updateLineup.mock.calls[0] as unknown[];
    expect(lineup[1]).toMatchObject({ rebuildEachCycle: false });
    expect(cycleBoundary.initializeChannel).not.toHaveBeenCalled();
  });

  test('a failed first cycle build rolls the channel back', async () => {
    const { service, channelDB, cycleBoundary } = await realService();
    cycleBoundary.initializeChannel.mockRejectedValueOnce(
      new Error('cycle build failed'),
    );

    await expect(
      service.createChannel({
        blueprint: { ...NinetiesSitcomsBlueprint, rebuildEachCycle: true },
        scope: { libraryIds: ['lib-1'] },
      }),
    ).rejects.toThrow('cycle build failed');
    expect(channelDB.deleteChannel).toHaveBeenCalled();
  });

  test('refuses a blueprint whose slots name a missing role', async () => {
    const { service, smartCollectionsDB } = await realService();
    const [sitcoms] = NinetiesSitcomsBlueprint.roles;
    if (!sitcoms) {
      throw new Error('expected a role');
    }
    await expect(
      service.createChannel({
        blueprint: {
          ...NinetiesSitcomsBlueprint,
          roles: [{ ...sitcoms, role: 'other' }],
        },
      }),
    ).rejects.toThrow(GenericBadRequestError);
    expect(smartCollectionsDB.insert).not.toHaveBeenCalled();
  });

  test('refuses to delete a built-in', async () => {
    const { service } = await realService();
    await expect(service.delete('90s-sitcoms')).rejects.toThrow(
      GenericBadRequestError,
    );
  });

  test('refuses an import from a newer version by name', async () => {
    const { service } = await realService();
    await expect(
      service.importBlueprint({
        ...NinetiesSitcomsBlueprint,
        blueprintVersion: 2,
      }),
    ).rejects.toThrow(/version 2/);
  });
});
