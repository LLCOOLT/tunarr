import { z } from 'zod/v4';
import { ContentProgramTypeSchema } from '../schemas/utilSchemas.js';
import {
  ChannelPresetCategorySchema,
  ContentPreviewResponseSchema,
  ContentQuerySchema,
  ScheduleSkeletonSchema,
} from './AutoChannel.js';

// A blueprint is a channel recipe that names rules, not programs, so it fits
// any library (plans/channel-blueprints.md). Creating a channel from one runs
// the auto-channel machinery: each role becomes a smart collection and the
// schedule skeleton becomes a slot schedule over those collections.

export const CurrentBlueprintVersion = 1;

// The search DSL has no escapes inside a quoted string, so a value may not
// hold a quote, a backslash or a brace (`shared/src/util/searchUtil.ts`).
const DslStringValueSchema = z
  .string()
  .min(1)
  .regex(/^[^"\\{]+$/, 'May not contain ", \\ or {');

//
// Structured content rules. The editor reads and writes these; the compiled
// `query.filterString` is what runs.
//
export const BlueprintRulesSchema = z.object({
  programTypes: ContentProgramTypeSchema.array().optional(),
  genres: DslStringValueSchema.array()
    .optional()
    .describe('Program or show genres'),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  minMinutes: z.number().nonnegative().optional(),
  maxMinutes: z.number().nonnegative().optional(),
  contentRatings: DslStringValueSchema.array().optional(),
  studios: DslStringValueSchema.array()
    .optional()
    .describe('Program studios, or the show network for episodes'),
});

export type BlueprintRules = z.infer<typeof BlueprintRulesSchema>;

// Library, media source and grouping ids only mean something on one install,
// so a blueprint never carries them. The create dialog asks for a scope.
export const PortableContentQuerySchema = ContentQuerySchema.pick({
  filterString: true,
  keywords: true,
  programTypes: true,
});

export type PortableContentQuery = z.infer<typeof PortableContentQuerySchema>;

export const BlueprintRoleSchema = z.object({
  role: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  rules: BlueprintRulesSchema.optional(),
  query: PortableContentQuerySchema,
  minPrograms: z.number().int().min(0),
});

export type BlueprintRole = z.infer<typeof BlueprintRoleSchema>;

export const BlueprintChannelDefaultsSchema = z.object({
  namePattern: z
    .string()
    .optional()
    .describe('Channel name; {name} and {number} are replaced'),
  numberHint: z.number().int().positive().optional(),
  icon: z.string().optional().describe('Icon URL'),
});

export type BlueprintChannelDefaults = z.infer<
  typeof BlueprintChannelDefaultsSchema
>;

export const BlueprintSchema = z.object({
  blueprintVersion: z.literal(CurrentBlueprintVersion),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  category: ChannelPresetCategorySchema,
  channel: BlueprintChannelDefaultsSchema.default({}),
  roles: BlueprintRoleSchema.array().min(1),
  schedule: ScheduleSkeletonSchema,
  rebuildEachCycle: z
    .boolean()
    .optional()
    .describe(
      'Rebuild the schedule each cycle where the server supports it; ignored otherwise',
    ),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;

export const BlueprintScopeSchema = z.object({
  libraryIds: z.string().array().optional(),
  mediaSourceIds: z.string().array().optional(),
});

export type BlueprintScope = z.infer<typeof BlueprintScopeSchema>;

//
// API shapes
//
export const SavedBlueprintSchema = z.object({
  id: z.string(),
  builtIn: z.boolean(),
  blueprint: BlueprintSchema,
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export type SavedBlueprint = z.infer<typeof SavedBlueprintSchema>;

export const BlueprintPreviewRequestSchema = z.object({
  blueprint: BlueprintSchema,
  scope: BlueprintScopeSchema.optional(),
});

export type BlueprintPreviewRequest = z.infer<
  typeof BlueprintPreviewRequestSchema
>;

export const BlueprintPreviewResponseSchema = z.object({
  roles: z.array(
    z.object({
      role: z.string(),
      label: z.string(),
      preview: ContentPreviewResponseSchema,
    }),
  ),
});

export type BlueprintPreviewResponse = z.infer<
  typeof BlueprintPreviewResponseSchema
>;

export const BlueprintCreateChannelRequestSchema = z.object({
  blueprint: BlueprintSchema,
  scope: BlueprintScopeSchema.optional(),
  channelName: z.string().min(1).optional(),
  channelNumber: z.number().int().positive().optional(),
  seed: z.number().optional(),
});

export type BlueprintCreateChannelRequest = z.infer<
  typeof BlueprintCreateChannelRequestSchema
>;
