export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(Math.max(n, min), max);
