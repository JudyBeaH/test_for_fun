import type { SpeciesId } from "../../domain/types";

export const PLACEHOLDER_GLYPHS: Record<SpeciesId, { emoji: string; fallback: string }> = {
  hedgehog: { emoji: "🦔", fallback: "刺" },
  frog: { emoji: "🐸", fallback: "蛙" },
  mussel: { emoji: "🦪", fallback: "蚌" },
  swallow: { emoji: "🐦", fallback: "燕" },
  otter: { emoji: "🦦", fallback: "獭" },
  hare: { emoji: "🐇", fallback: "兔" },
  kingfisher: { emoji: "🐦", fallback: "翠" },
  carp: { emoji: "🐟", fallback: "鲫" },
  crow: { emoji: "🐦‍⬛", fallback: "乌" },
  pangolin: { emoji: "", fallback: "甲" },
  egret: { emoji: "🐦", fallback: "鹭" },
  weasel: { emoji: "", fallback: "鼬" },
};
