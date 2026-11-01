export const SKIN_MAX_BYTES = 16 * 1024;
export const SKIN_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,39}$";
export const SKIN_COLOR_PATTERN = "^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$";
export const BUILTIN_SKIN_IDS = ["sheet", "porcelain", "darkroom", "pine"] as const;
export const SKIN_TOKEN_NAMES = [
  "surface", "chrome", "text", "dim", "border", "borderStrong", "accent", "onAccent",
  "active", "activeLine", "field", "well", "raised", "raisedSolid", "scrim", "codeBg",
  "syntax", "previewBg", "page", "pageInk", "must", "onMust", "recheck", "recheckSoft",
  "skip", "unset", "unsetLine", "danger", "success", "warning"
] as const;
export const SKIN_OPTION_VALUES = {
  nav: ["rail", "railIcons", "top", "topCentered"],
  preview: ["flat", "sheet", "paper"],
  density: ["comfortable", "compact"],
  headingFont: ["sans", "book"]
} as const;
export interface Skin {
  schemaVersion: 1;
  id: string;
  name: string;
  mode: "light" | "dark";
  tokens: Record<typeof SKIN_TOKEN_NAMES[number], string>;
  options: {
    nav: typeof SKIN_OPTION_VALUES.nav[number];
    preview: typeof SKIN_OPTION_VALUES.preview[number];
    radius: number;
    density: typeof SKIN_OPTION_VALUES.density[number];
    headingFont: typeof SKIN_OPTION_VALUES.headingFont[number];
  };
}
export interface SkinIssue { code: `SKIN_${string}`; field: string; message: string }
export type SkinValidation = { ok: true; value: Skin } | { ok: false; errors: SkinIssue[] };
export interface SkinList { skins: Skin[]; errors: Array<SkinIssue & { file: string }> }
export const SKIN_CONTRAST_PAIRS = [
  ["text", "surface"], ["text", "chrome"], ["dim", "surface"], ["dim", "chrome"],
  ["onAccent", "accent"], ["onMust", "must"], ["pageInk", "page"]
] as const;
export function isSkinId(value: unknown): value is string {
  return typeof value === "string" && new RegExp(SKIN_ID_PATTERN).test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function validateSkin(input: unknown, options: { allowBuiltinId?: boolean } = {}): SkinValidation {
  const errors: SkinIssue[] = [];
  const issue = (code: SkinIssue["code"], field: string, fix: string) => errors.push({ code, field, message: `${field}: ${fix}` });
  const keys = (value: Record<string, unknown>, allowed: readonly string[], prefix: string) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) issue("SKIN_UNKNOWN_FIELD", `${prefix}${key}`, "删除未知字段。");
  };
  if (!record(input)) return { ok: false, errors: [{ code: "SKIN_INVALID", field: "skin", message: "skin: 请提供 JSON 对象。" }] };
  if (new TextEncoder().encode(JSON.stringify(input)).length > SKIN_MAX_BYTES) issue("SKIN_TOO_LARGE", "skin", "缩减文件到 16 KiB 以内。");
  keys(input, ["schemaVersion", "id", "name", "mode", "tokens", "options"], "");
  if (input.schemaVersion !== 1) issue("SKIN_VERSION", "schemaVersion", "使用版本 1。");
  if (!isSkinId(input.id)) issue("SKIN_ID", "id", `使用 ${SKIN_ID_PATTERN} 格式。`);
  else if (!options.allowBuiltinId && (BUILTIN_SKIN_IDS as readonly string[]).includes(input.id)) issue("SKIN_BUILTIN", "id", "换一个非内置皮肤 id。");
  if (typeof input.name !== "string" || [...input.name].length < 1 || [...input.name].length > 40) issue("SKIN_NAME", "name", "填写 1 到 40 个字符。");
  if (input.mode !== "light" && input.mode !== "dark") issue("SKIN_MODE", "mode", "使用 light 或 dark。");
  if (!record(input.tokens)) issue("SKIN_TOKENS", "tokens", "提供全部颜色 token。");
  else {
    keys(input.tokens, SKIN_TOKEN_NAMES, "tokens.");
    for (const key of SKIN_TOKEN_NAMES) if (typeof input.tokens[key] !== "string" || !new RegExp(SKIN_COLOR_PATTERN).test(input.tokens[key])) issue("SKIN_COLOR", `tokens.${key}`, "填写 #RRGGBB 或 #RRGGBBAA 颜色。");
    for (const [fg, bg] of SKIN_CONTRAST_PAIRS) {
      const a = input.tokens[fg], b = input.tokens[bg];
      if (typeof a !== "string" || typeof b !== "string" || !new RegExp(SKIN_COLOR_PATTERN).test(a) || !new RegExp(SKIN_COLOR_PATTERN).test(b)) continue;
      if (a.length !== 7 || b.length !== 7) issue("SKIN_ALPHA", `tokens.${fg}/${bg}`, "对比度配对必须使用无透明度的 #RRGGBB。");
      else {
        const ratio = contrastRatio(a, b);
        if (ratio < 4.5) issue("SKIN_CONTRAST", `tokens.${fg}/${bg}`, `实际 ${ratio.toFixed(4)}:1；调整这两个颜色使对比度至少 4.5:1。`);
      }
    }
    const priorities = [input.tokens.must, input.tokens.recheck, input.tokens.skip].map((v) => typeof v === "string" ? v.toLowerCase() : v);
    if (new Set(priorities).size !== 3) issue("SKIN_PRIORITY", "tokens.must/recheck/skip", "三个颜色必须两两不同。");
  }
  if (!record(input.options)) issue("SKIN_OPTIONS", "options", "填写全部布局选项。");
  else {
    keys(input.options, [...Object.keys(SKIN_OPTION_VALUES), "radius"], "options.");
    for (const [key, values] of Object.entries(SKIN_OPTION_VALUES)) if (!(values as readonly unknown[]).includes(input.options[key])) issue("SKIN_OPTION", `options.${key}`, `使用 ${values.join("、")}。`);
    if (!Number.isInteger(input.options.radius) || Number(input.options.radius) < 0 || Number(input.options.radius) > 10) issue("SKIN_OPTION", "options.radius", "使用 0 到 10 的整数。");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as Skin };
}
export function parseSkin(text: string, options: { allowBuiltinId?: boolean } = {}): SkinValidation {
  if (new TextEncoder().encode(text).length > SKIN_MAX_BYTES) return { ok: false, errors: [{ code: "SKIN_TOO_LARGE", field: "skin", message: "skin: 缩减文件到 16 KiB 以内。" }] };
  try { return validateSkin(JSON.parse(text), options); }
  catch { return { ok: false, errors: [{ code: "SKIN_JSON", field: "skin", message: "skin: 修复 JSON 语法。" }] }; }
}

export const SKIN_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "LaTeX Question Bank skin v1",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "id", "name", "mode", "tokens", "options"],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: "string", pattern: SKIN_ID_PATTERN, not: { enum: BUILTIN_SKIN_IDS } },
    name: { type: "string", minLength: 1, maxLength: 40 },
    mode: { enum: ["light", "dark"] },
    tokens: { type: "object", additionalProperties: false, required: SKIN_TOKEN_NAMES, properties: Object.fromEntries(SKIN_TOKEN_NAMES.map((key) => [key, { type: "string", pattern: SKIN_COLOR_PATTERN }])) },
    options: { type: "object", additionalProperties: false, required: [...Object.keys(SKIN_OPTION_VALUES), "radius"], properties: { ...Object.fromEntries(Object.entries(SKIN_OPTION_VALUES).map(([key, values]) => [key, { enum: values }])), radius: { type: "integer", minimum: 0, maximum: 10 } } }
  }
};
