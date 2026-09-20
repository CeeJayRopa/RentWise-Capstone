import { normalizeStallName, StallHotspot } from "./marketLayout";

export interface MapStall {
  name?: string;
  buildingNumber?: string;
  spaceId?: string;
}

function stallKey(building: unknown, space: unknown): string | null {
  const buildingMatch = String(building ?? "").trim().match(/^(?:b(?:uilding)?\s*[- ]?\s*)?(\d+)$/i);
  const spaceMatch = String(space ?? "").trim().match(/^(?:stall\s*)?([a-z])\s*[- ]?\s*(\d+)$/i);
  if (!buildingMatch || !spaceMatch) return null;
  return `${Number(buildingMatch[1])}:${spaceMatch[1].toUpperCase()}:${Number(spaceMatch[2])}`;
}

function nameKey(name: string): string | null {
  const match = name.trim().match(/^b\s*(\d+)\s+stall\s+([a-z])\s*[- ]?\s*(\d+)$/i);
  return match ? stallKey(`B${match[1]}`, `${match[2]}-${match[3]}`) : null;
}

export function matchMapStalls<T extends MapStall>(stalls: T[], hotspots: StallHotspot[]): Map<string, T> {
  const byName = new Map<string, T>();
  const bySpace = new Map<string, T>();
  for (const stall of stalls) {
    if (stall.name) byName.set(normalizeStallName(stall.name), stall);
    const key = stallKey(stall.buildingNumber, stall.spaceId) ?? nameKey(stall.name ?? "");
    if (key) bySpace.set(key, stall);
  }
  return new Map(hotspots.flatMap((hotspot) => {
    const stall = bySpace.get(nameKey(hotspot.name) ?? "") ?? byName.get(normalizeStallName(hotspot.name));
    return stall ? [[hotspot.name, stall] as const] : [];
  }));
}
