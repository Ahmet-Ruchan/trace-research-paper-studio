/** Bağımlılıksız SVG grafik yardımcıları — d3 yok, sadece saf matematik. */

export type Scale = (value: number) => number;

export function makeScale(
  domain: [number, number],
  range: [number, number],
  kind: "linear" | "log" = "linear",
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;

  if (kind === "log") {
    // Log ölçekte tanım kümesi pozitif olmak zorunda; değilse doğrusala düş.
    const safeD0 = d0 > 0 ? d0 : 1e-9;
    const safeD1 = d1 > 0 ? d1 : safeD0 * 10;
    const l0 = Math.log10(safeD0);
    const l1 = Math.log10(safeD1);
    const span = l1 - l0 || 1;
    return (value) => {
      if (!(value > 0)) return r0;
      return r0 + ((Math.log10(value) - l0) / span) * (r1 - r0);
    };
  }

  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

export type Point = { x: number; y: number };

/**
 * Sonlu olmayan noktaları atarak SVG path üretir. Tanımsız bir bölge çizgiyi
 * kırar (birleştirmez) — böylece kullanıcı hesabın nerede tanımsız olduğunu
 * görür, uydurma bir doğru parçası görmez.
 */
export function toPath(points: Point[], sx: Scale, sy: Scale): string {
  let path = "";
  let penDown = false;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      penDown = false;
      continue;
    }
    const x = sx(point.x);
    const y = sy(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    penDown = true;
  }
  return path.trim();
}

export function extent(values: number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return [0, 1];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? [min - 1, max + 1] : [min, max];
}

/** Okunabilir eksen etiketleri: 1e-9 → "1e-9", 28.4 → "28.4", 23000000 → "2.3e7". */
export function formatNumber(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return "—";
  if (precision !== undefined) return value.toFixed(precision);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e6 || magnitude < 1e-3)) {
    return value.toExponential(2).replace("e+", "e");
  }
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(magnitude < 1 ? 4 : 2);
}

/** Eksen için ~n adet düzgün tik üretir. */
export function ticks(domain: [number, number], count = 4): number[] {
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, index) => min + step * index);
}
