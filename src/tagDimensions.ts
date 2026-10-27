// 标签没有独立字段，「考点·」「考法·」「题型·」前缀就是三个维度的界线。
// 这里只负责按前缀分组显示和筛选；数据仍是普通标签，应用不强制必须使用这些前缀。
export type TagDimensionKey = "topic" | "method" | "type";

export interface TagDimension {
  key: TagDimensionKey;
  prefix: string;
  label: string;
}

export const TAG_DIMENSIONS: readonly TagDimension[] = [
  { key: "topic", prefix: "考点·", label: "考点" },
  { key: "method", prefix: "考法·", label: "考法" },
  { key: "type", prefix: "题型·", label: "题型" }
];

export function tagDimensionOf(tag: string): TagDimension | null {
  return TAG_DIMENSIONS.find((dimension) => tag.startsWith(dimension.prefix)) ?? null;
}

export function stripTagPrefix(tag: string): string {
  const dimension = tagDimensionOf(tag);
  return dimension ? tag.slice(dimension.prefix.length) : tag;
}

export interface GroupedTags {
  byDimension: Record<TagDimensionKey, string[]>;
  other: string[];
}

export function groupTagsByDimension(tags: readonly string[]): GroupedTags {
  const grouped: GroupedTags = {
    byDimension: { topic: [], method: [], type: [] },
    other: []
  };
  for (const tag of tags) {
    const dimension = tagDimensionOf(tag);
    if (dimension) grouped.byDimension[dimension.key].push(tag);
    else grouped.other.push(tag);
  }
  return grouped;
}

// 只替换某一维度（或 null 表示无前缀的其他标签）的标签，其余标签保持原有顺序。
export function replaceTagGroup(
  allTags: readonly string[],
  group: TagDimensionKey | null,
  nextGroupTags: readonly string[]
): string[] {
  const inGroup = (tag: string) => (tagDimensionOf(tag)?.key ?? null) === group;
  const kept = allTags.filter((tag) => !inGroup(tag) || nextGroupTags.includes(tag));
  const added = nextGroupTags.filter((tag) => !allTags.includes(tag));
  return [...kept, ...added];
}
