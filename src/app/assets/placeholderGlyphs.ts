import { ANIMALS } from "../../content/animals";
import type { SpeciesId } from "../../domain/types";

export const PLACEHOLDER_GLYPHS: Record<SpeciesId, { emoji: string; fallback: string }> = Object.fromEntries(
  ANIMALS.map((animal) => [animal.id, { emoji: animal.visual.emoji, fallback: animal.visual.fallbackGlyph }]),
) as Record<SpeciesId, { emoji: string; fallback: string }>;
