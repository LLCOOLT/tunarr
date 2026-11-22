import {
  BlueprintCreateChannelRequestSchema,
  BlueprintPreviewRequestSchema,
  BlueprintPreviewResponseSchema,
  BlueprintSchema,
  SavedBlueprintSchema,
} from '@tunarr/types/api';
import { ChannelSchema } from '@tunarr/types/schemas';
import type { FastifyReply } from 'fastify';
import { inject, injectable } from 'inversify';
import { z } from 'zod/v4';
import {
  BlueprintNotFoundError,
  BlueprintService,
} from '../services/BlueprintService.ts';
import { findBadRequestError } from '../types/errors.ts';
import type { RouterPluginAsyncCallback } from '../types/serverType.js';
import type { ApiController } from './ApiController.ts';

const MessageSchema = z.object({ message: z.string() });

function blueprintFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'blueprint'}.tunarr-blueprint.json`;
}

/**
 * Channel blueprints: shareable, rule-based channel recipes
 * (plans/channel-blueprints.md).
 */
@injectable()
export class BlueprintsApiController implements ApiController {
  constructor(
    @inject(BlueprintService) private blueprintService: BlueprintService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  mount: RouterPluginAsyncCallback = async (fastify) => {
    // A known bad request answers 400 with its reason; anything else is a
    // 500 whose message is still shown to the user.
    const sendError = (
      err: unknown,
      res: FastifyReply,
      log: { error: (e: unknown, msg: string) => void },
      what: string,
    ) => {
      const badRequest = findBadRequestError(err);
      if (badRequest) {
        return res.status(400).send({ message: badRequest.message });
      }
      log.error(err, what);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).send({ message });
    };

    fastify.get(
      '/blueprints',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'GetBlueprints',
          description: 'List the built-in and saved channel blueprints',
          response: { 200: SavedBlueprintSchema.array() },
        },
      },
      async (_req, res) => res.send(await this.blueprintService.list()),
    );

    fastify.post(
      '/blueprints/preview',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'PreviewBlueprint',
          description: 'Preview what each role of a blueprint would match',
          body: BlueprintPreviewRequestSchema,
          response: {
            200: BlueprintPreviewResponseSchema,
            400: MessageSchema,
            500: MessageSchema,
          },
        },
      },
      async (req, res) => {
        try {
          return res.send(await this.blueprintService.preview(req.body));
        } catch (err) {
          return sendError(err, res, req.log, 'Blueprint preview failed');
        }
      },
    );

    fastify.post(
      '/blueprints/create-channel',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'CreateChannelFromBlueprint',
          description: 'Create a channel from a blueprint',
          body: BlueprintCreateChannelRequestSchema,
          response: {
            201: ChannelSchema,
            400: MessageSchema,
            500: MessageSchema,
          },
        },
      },
      async (req, res) => {
        try {
          const channel = await this.blueprintService.createChannel(req.body);
          return res.status(201).send(channel);
        } catch (err) {
          return sendError(
            err,
            res,
            req.log,
            'Blueprint channel create failed',
          );
        }
      },
    );

    // The body is read as any JSON object and validated by the service, so a
    // blueprint from a newer Tunarr is refused by name, not as a schema error.
    fastify.post(
      '/blueprints/import',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'ImportBlueprint',
          description: 'Validate a blueprint file and save it',
          body: z.record(z.string(), z.unknown()),
          response: {
            201: SavedBlueprintSchema,
            400: MessageSchema,
            500: MessageSchema,
          },
        },
      },
      async (req, res) => {
        try {
          const saved = await this.blueprintService.importBlueprint(req.body);
          return res.status(201).send(saved);
        } catch (err) {
          return sendError(err, res, req.log, 'Blueprint import failed');
        }
      },
    );

    fastify.get(
      '/blueprints/:id/export',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'ExportBlueprint',
          description: 'Download a blueprint as a JSON file',
          params: z.object({ id: z.string() }),
          response: { 200: BlueprintSchema, 404: MessageSchema },
        },
      },
      async (req, res) => {
        const saved = await this.blueprintService.get(req.params.id);
        if (!saved) {
          return res.status(404).send({ message: 'Blueprint not found' });
        }
        return res
          .header(
            'content-disposition',
            `attachment; filename="${blueprintFileName(saved.blueprint.name)}"`,
          )
          .send(saved.blueprint);
      },
    );

    fastify.delete(
      '/blueprints/:id',
      {
        schema: {
          tags: ['Blueprints'],
          operationId: 'DeleteBlueprint',
          description: 'Delete a saved blueprint. Built-ins cannot be deleted.',
          params: z.object({ id: z.string() }),
          response: { 204: z.void(), 400: MessageSchema, 404: MessageSchema },
        },
      },
      async (req, res) => {
        try {
          const deleted = await this.blueprintService.delete(req.params.id);
          if (!deleted) {
            return res.status(404).send({ message: 'Blueprint not found' });
          }
          return res.status(204).send();
        } catch (err) {
          const badRequest = findBadRequestError(err);
          if (badRequest) {
            return res.status(400).send({ message: badRequest.message });
          }
          throw err;
        }
      },
    );

    fastify.get(
      '/channels/:id/blueprint',
      {
        schema: {
          tags: ['Blueprints', 'Channels'],
          operationId: 'GetChannelBlueprint',
          description:
            "Build a blueprint from a slot channel whose slots all play smart collections. Answers 422 with the reason when the channel's schedule cannot be expressed as one.",
          params: z.object({ id: z.string() }),
          response: {
            200: BlueprintSchema,
            404: MessageSchema,
            422: MessageSchema,
          },
        },
      },
      async (req, res) => {
        try {
          return res.send(
            await this.blueprintService.blueprintForChannel(req.params.id),
          );
        } catch (err) {
          if (err instanceof BlueprintNotFoundError) {
            return res.status(404).send({ message: err.message });
          }
          const badRequest = findBadRequestError(err);
          if (badRequest) {
            return res.status(422).send({ message: badRequest.message });
          }
          throw err;
        }
      },
    );
  };
}
