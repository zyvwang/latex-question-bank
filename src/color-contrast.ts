export function contrastRatio(left: string, right: string): number {
  const first = relativeLuminance(left);
  const second = relativeLuminance(right);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function bestTextColor(background: string): "#FFFFFF" | "#1F2926" {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, "#1F2926")
    ? "#FFFFFF"
    : "#1F2926";
}

export function hasLowSurfaceContrast(color: string): boolean {
  return contrastRatio(color, "#FCFBF8") < 3;
}

function relativeLuminance(color: string): number {
  const channels = [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
