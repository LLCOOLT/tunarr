import { parseBlueprintJson } from '@tunarr/shared/channel-templates';
import type { Blueprint } from '@tunarr/types/api';

export type BlueprintFileResult =
  | { success: true; blueprint: Blueprint }
  | { success: false; message: string };

/**
 * Reads a blueprint file's text. The server validates again on import; this
 * check gives the reason before anything is sent.
 */
export function readBlueprintFile(text: string): BlueprintFileResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { success: false, message: 'This file is not valid JSON' };
  }
  return parseBlueprintJson(json);
}

/** The file name an exported blueprint is saved under. */
export function blueprintFileName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'blueprint'}.tunarr-blueprint.json`;
}

/** Saves `blueprint` as a JSON file through the browser. */
export function downloadBlueprint(blueprint: Blueprint) {
  const blob = new Blob([JSON.stringify(blueprint, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = blueprintFileName(blueprint.name);
  link.click();
  URL.revokeObjectURL(url);
}
