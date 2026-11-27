export function luminance(hex: string) {
  const rgb = hex.replace("#", "");
  if (!/^[\da-f]{6}$/i.test(rgb)) throw new Error("Expected a six-digit hex color");
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
    const channel = Number.parseInt(rgb.slice(i * 2, i * 2 + 2), 16) / 255;
    return (
      sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}
export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
export function composite(foreground: string, background: string, alpha: number) {
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(
        Number.parseInt(foreground.slice(1 + i * 2, 3 + i * 2), 16) * alpha +
          Number.parseInt(background.slice(1 + i * 2, 3 + i * 2), 16) * (1 - alpha),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
