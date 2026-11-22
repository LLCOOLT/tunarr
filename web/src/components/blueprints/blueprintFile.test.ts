import { NinetiesSitcomsBlueprint } from '@tunarr/shared/channel-templates';
import { describe, expect, test } from 'vitest';
import { blueprintFileName, readBlueprintFile } from './blueprintFile.ts';

describe('readBlueprintFile', () => {
  test('reads an exported blueprint back', () => {
    expect(
      readBlueprintFile(JSON.stringify(NinetiesSitcomsBlueprint, null, 2)),
    ).toEqual({ success: true, blueprint: NinetiesSitcomsBlueprint });
  });

  test('says when the file is not JSON', () => {
    expect(readBlueprintFile('{not json')).toEqual({
      success: false,
      message: 'This file is not valid JSON',
    });
  });

  test('names the version of a blueprint from a newer Tunarr', () => {
    const result = readBlueprintFile(
      JSON.stringify({ ...NinetiesSitcomsBlueprint, blueprintVersion: 3 }),
    );
    expect(result.success).toBe(false);
    expect(!result.success && result.message).toMatch(/version 3/);
  });
});

describe('blueprintFileName', () => {
  test('slugs the name', () => {
    expect(blueprintFileName('Movie Night at 8!')).toBe(
      'movie-night-at-8.tunarr-blueprint.json',
    );
  });

  test('falls back when nothing is left of the name', () => {
    expect(blueprintFileName('!!!')).toBe('blueprint.tunarr-blueprint.json');
  });
});
