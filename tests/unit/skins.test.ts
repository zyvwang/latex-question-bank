import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { BUILTIN_SKINS } from "../../shared/builtin-skins.js";
import { contrastRatio, parseSkin, SKIN_JSON_SCHEMA, SKIN_MAX_BYTES, SKIN_TOKEN_NAMES, validateSkin, type Skin } from "../../shared/skins.js";
import { normalizeUiLayoutPreferences } from "../../shared/ui-layout-preferences.js";

function custom(): Skin { return { ...structuredClone(BUILTIN_SKINS[0]!), id: "my-skin" }; }
for (const builtin of BUILTIN_SKINS) {
  it(`${builtin.id} passes all validation`, () => {
    expect(validateSkin(builtin, { allowBuiltinId: true }).ok).toBe(true);
  });
}
it.each([
  ["unknown field", (s: Skin) => ({ ...s, css: "body {}" }), "SKIN_UNKNOWN_FIELD"],
  ["unknown token", (s: Skin) => ({ ...s, tokens: { ...s.tokens, url: "#FFFFFF" } }), "SKIN_UNKNOWN_FIELD"],
  ["unknown option", (s: Skin) => ({ ...s, options: { ...s.options, script: "x" } }), "SKIN_UNKNOWN_FIELD"],
  ["bad color", (s: Skin) => ({ ...s, tokens: { ...s.tokens, accent: "red" } }), "SKIN_COLOR"],
  ["missing token", (s: Skin) => ({ ...s, tokens: { ...s.tokens, field: undefined } }), "SKIN_COLOR"],
  ["contrast", (s: Skin) => ({ ...s, tokens: { ...s.tokens, text: s.tokens.surface } }), "SKIN_CONTRAST"],
  ["alpha", (s: Skin) => ({ ...s, tokens: { ...s.tokens, text: "#000000FF" } }), "SKIN_ALPHA"],
  ["version", (s: Skin) => ({ ...s, schemaVersion: 2 }), "SKIN_VERSION"],
  ["id", (s: Skin) => ({ ...s, id: "../escape" }), "SKIN_ID"],
  ["builtin", (s: Skin) => ({ ...s, id: "sheet" }), "SKIN_BUILTIN"],
  ["name", (s: Skin) => ({ ...s, name: "" }), "SKIN_NAME"],
  ["mode", (s: Skin) => ({ ...s, mode: "system" }), "SKIN_MODE"],
  ["radius", (s: Skin) => ({ ...s, options: { ...s.options, radius: 1.5 } }), "SKIN_OPTION"],
  ["option", (s: Skin) => ({ ...s, options: { ...s.options, nav: "other" } }), "SKIN_OPTION"],
  ["priority", (s: Skin) => ({ ...s, tokens: { ...s.tokens, recheck: s.tokens.skip.toLowerCase() } }), "SKIN_PRIORITY"]
])("rejects %s with a repair message", (_name, change, code) => {
  const result = validateSkin(change(custom()));
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code, field: expect.any(String), message: expect.stringContaining(":") }));
});
it("rejects malformed and oversized raw JSON including whitespace and UTF-8 bytes", () => {
  expect(parseSkin("{")).toMatchObject({ ok: false, errors: [{ code: "SKIN_JSON" }] });
  expect(parseSkin(" ".repeat(SKIN_MAX_BYTES) + JSON.stringify(custom()))).toMatchObject({ ok: false, errors: [{ code: "SKIN_TOO_LARGE" }] });
  expect(parseSkin("中".repeat(6000))).toMatchObject({ ok: false, errors: [{ code: "SKIN_TOO_LARGE" }] });
  expect(validateSkin({ ...custom(), name: "x".repeat(SKIN_MAX_BYTES) })).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.objectContaining({ code: "SKIN_TOO_LARGE" })]) });
});
it("keeps schema and runtime field sources identical", async () => {
  const schema = JSON.parse(await readFile("docs/skin.schema.json", "utf8"));
  expect(schema).toEqual(SKIN_JSON_SCHEMA);
  expect(Object.keys(schema.properties.tokens.properties)).toEqual([...SKIN_TOKEN_NAMES]);
  expect(schema.required).toEqual(Object.keys(custom()));
  expect(schema.properties.options.required.sort()).toEqual(Object.keys(custom().options).sort());
});
it("uses WCAG luminance and normalizes old preferences without writing", () => {
  expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
  expect(normalizeUiLayoutPreferences({})).toMatchObject({ skinMode: "light", lightSkinId: "sheet", darkSkinId: "darkroom" });
  expect(normalizeUiLayoutPreferences({ skinMode: "bad", lightSkinId: "../x", darkSkinId: null })).toMatchObject({ skinMode: "light", lightSkinId: "sheet", darkSkinId: "darkroom" });
  expect(normalizeUiLayoutPreferences({ skinMode: "dark", lightSkinId: "my-light", darkSkinId: "my-dark" })).toMatchObject({ skinMode: "dark", lightSkinId: "my-light", darkSkinId: "my-dark" });
});
