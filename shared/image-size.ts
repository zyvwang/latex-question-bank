export type QuestionImageSize = "s" | "m" | "l";

export interface ImageDimensions {
  width: number;
  height: number;
}

// 与 latex-renderer 中 \qimg 的 s/m/l 档位对应：小图不被放大到半栏，宽幅图给足宽度。
// 700px 约等于 s 档（0.3 栏宽）在 300 DPI 下的宽度。
export function suggestImageSize({ width, height }: ImageDimensions): QuestionImageSize {
  if (width < 700) return "s";
  if (width / height >= 2.2) return "l";
  return "m";
}
