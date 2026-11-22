import {
  BuiltInBlueprints,
  blueprintAssignments,
  blueprintChannelName,
  blueprintFromSchedule,
  blueprintRoleProblems,
  blueprintToPreset,
  getBuiltInBlueprint,
  parseBlueprintJson,
} from '@tunarr/shared/channel-templates';
import type { Channel } from '@tunarr/types';
import type {
  Blueprint,
  BlueprintCreateChannelRequest,
  BlueprintPreviewRequest,
  BlueprintPreviewResponse,
  SavedBlueprint,
} from '@tunarr/types/api';
import { inject, injectable } from 'inversify';
import { BlueprintDB } from '../db/BlueprintDB.ts';
import { ChannelDB } from '../db/ChannelDB.ts';
import { SmartCollectionsDB } from '../db/SmartCollectionsDB.ts';
import { GenericBadRequestError } from '../types/errors.ts';
import type { Maybe } from '../types/util.ts';
import { AutoChannelService } from './AutoChannelService.ts';

/** A request that names a channel or blueprint that does not exist. */
export class BlueprintNotFoundError extends Error {}

/**
 * Channel blueprints (plans/channel-blueprints.md): the built-ins, the saved
 * ones, and the bridge from a blueprint to the auto-channel machinery, which
 * does the creating.
 */
@injectable()
export class BlueprintService {
  constructor(
    @inject(BlueprintDB) private blueprintDB: BlueprintDB,
    @inject(AutoChannelService) private autoChannelService: AutoChannelService,
    @inject(ChannelDB) private channelDB: ChannelDB,
    @inject(SmartCollectionsDB) private smartCollectionsDB: SmartCollectionsDB,
  ) {}

  async list(): Promise<SavedBlueprint[]> {
    const builtIns = BuiltInBlueprints.map(
      (blueprint): SavedBlueprint => ({
        id: blueprint.id,
        builtIn: true,
        blueprint,
      }),
    );
    return builtIns.concat(await this.blueprintDB.getAll());
  }

  async get(id: string): Promise<Maybe<SavedBlueprint>> {
    const builtIn = getBuiltInBlueprint(id);
    if (builtIn) {
      return { id, builtIn: true, blueprint: builtIn };
    }
    return this.blueprintDB.getById(id);
  }

  /** Validates a blueprint file and saves it. */
  async importBlueprint(input: unknown): Promise<SavedBlueprint> {
    const parsed = parseBlueprintJson(input);
    if (!parsed.success) {
      throw new GenericBadRequestError(parsed.message);
    }
    return this.blueprintDB.insert(parsed.blueprint);
  }

  async delete(id: string): Promise<boolean> {
    if (getBuiltInBlueprint(id)) {
      throw new GenericBadRequestError('Built-in blueprints cannot be deleted');
    }
    return this.blueprintDB.delete(id);
  }

  async preview(
    request: BlueprintPreviewRequest,
  ): Promise<BlueprintPreviewResponse> {
    this.assertUsable(request.blueprint);
    const assignments = blueprintAssignments(request.blueprint, request.scope);
    const roles = await Promise.all(
      request.blueprint.roles.map(async (role) => ({
        role: role.role,
        label: role.label,
        preview: await this.autoChannelService.previewContent(
          assignments[role.role]?.query ?? role.query,
        ),
      })),
    );
    return { roles };
  }

  async createChannel(
    request: BlueprintCreateChannelRequest,
  ): Promise<Channel> {
    const { blueprint } = request;
    this.assertUsable(blueprint);
    const preset = blueprintToPreset(blueprint);
    return this.autoChannelService.createChannelFromPreset(
      preset,
      {
        presetId: preset.id,
        contentAssignments: blueprintAssignments(blueprint, request.scope),
        channelName: request.channelName,
        channelNumber: request.channelNumber,
        seed: request.seed,
      },
      {
        defaultName: (n) => blueprintChannelName(blueprint, n),
        preferredNumber: blueprint.channel.numberHint,
        iconPath: blueprint.channel.icon,
      },
    );
  }

  /**
   * Builds a blueprint from a channel's slot schedule. Throws
   * {@link BlueprintNotFoundError} when the channel does not exist, and a bad
   * request when it has no schedule or a slot that is not a smart collection.
   */
  async blueprintForChannel(channelId: string): Promise<Blueprint> {
    const channel = await this.channelDB.getChannel(channelId);
    if (!channel) {
      throw new BlueprintNotFoundError(`Channel ${channelId} not found`);
    }
    const lineup = await this.channelDB.loadLineup(channel.uuid);
    if (!lineup.schedule) {
      throw new GenericBadRequestError(
        'This channel has no time or random slot schedule, so it cannot be saved as a blueprint',
      );
    }

    const collections = Object.fromEntries(
      (await this.smartCollectionsDB.getAllRaw()).map((c) => [
        c.uuid,
        {
          name: c.name,
          filterString: c.filter ?? undefined,
          keywords: c.keywords ?? undefined,
        },
      ]),
    );

    const result = blueprintFromSchedule({
      name: channel.name,
      schedule: lineup.schedule,
      collections,
    });
    if (!result.success) {
      throw new GenericBadRequestError(result.message);
    }
    return result.blueprint;
  }

  private assertUsable(blueprint: Blueprint) {
    const problems = blueprintRoleProblems(blueprint);
    if (problems.length > 0) {
      throw new GenericBadRequestError(problems.join('; '));
    }
  }
}
