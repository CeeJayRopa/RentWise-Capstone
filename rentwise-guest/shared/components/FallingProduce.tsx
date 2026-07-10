import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

export interface ShieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProduceItem {
  emoji: string;
  size: number;
}

interface Props {
  items: readonly ProduceItem[];
  /** Bounding box (in the same coordinate space as this component) to keep items away from — the "shield". */
  shield: ShieldRect | null;
}

// Tuning constants for the hand-rolled circle physics below.
const GRAVITY = 0.32;
const RESTITUTION = 0.45;
const FRICTION = 0.985;
const SHIELD_PAD = 34;
const SPAWN_STAGGER_MS = 45;
const RESPAWN_STAGGER_MS = 45;

type Particle = {
  emoji: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  spawned: boolean;
  spawnAt: number;
  // Each item bounces off the floor exactly once, then keeps falling
  // through and loops back to the top — no pile ever forms.
  bounced: boolean;
};

function resetAbove(p: Particle, width: number, respawnAt: number) {
  p.x = p.radius + Math.random() * Math.max(1, width - p.radius * 2);
  p.y = -p.radius * 2;
  p.vx = (Math.random() - 0.5) * 1.5;
  p.vy = 0;
  p.rot = Math.random() * 360;
  p.bounced = false;
  p.spawned = false;
  p.spawnAt = respawnAt;
}

function makeParticles(items: readonly ProduceItem[], startDelay: number): Particle[] {
  return items.map((item, i) => ({
    emoji: item.emoji,
    radius: item.size / 2,
    x: 0,
    y: -item.size,
    vx: 0,
    vy: 0,
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 1.2,
    spawned: false,
    spawnAt: startDelay + i * SPAWN_STAGGER_MS,
    bounced: false,
  }));
}

function simulateParticle(
  p: Particle,
  list: Particle[],
  index: number,
  width: number,
  height: number,
  shield: ShieldRect | null,
  now: number
) {
  p.vy += GRAVITY;
  p.vx *= FRICTION;
  p.vy *= FRICTION;
  p.x += p.vx;
  p.y += p.vy;
  p.rot += p.vr;

  // Side walls
  if (p.x - p.radius < 0) {
    p.x = p.radius;
    p.vx = -p.vx * RESTITUTION;
  }
  if (p.x + p.radius > width) {
    p.x = width - p.radius;
    p.vx = -p.vx * RESTITUTION;
  }
  if (p.y - p.radius < 0) {
    p.y = p.radius;
    p.vy = Math.abs(p.vy) * RESTITUTION;
  }

  if (p.y + p.radius > height) {
    if (!p.bounced) {
      // First floor contact: bounce once.
      p.y = height - p.radius;
      p.vy = -p.vy * RESTITUTION;
      p.bounced = true;
    } else if (p.y - p.radius > height + p.radius * 3) {
      // Already bounced once and has now fallen well clear of the floor —
      // loop it back to the top instead of letting it pile up.
      resetAbove(p, width, now + RESPAWN_STAGGER_MS);
    }
    // Between those two cases: already bounced, still falling through —
    // let it keep going, no more clamping/bouncing off the floor.
  }

  // Invisible oval "shield" around the text — push the item back outside it.
  if (shield) {
    const cx = shield.x + shield.width / 2;
    const cy = shield.y + shield.height / 2;
    const rx = shield.width / 2 + SHIELD_PAD + p.radius;
    const ry = shield.height / 2 + SHIELD_PAD + p.radius;
    const dx = (p.x - cx) / rx;
    const dy = (p.y - cy) / ry;
    const distSq = dx * dx + dy * dy;
    if (distSq < 1) {
      const dist = Math.sqrt(distSq) || 0.0001;
      const nx = dx / dist;
      const ny = dy / dist;
      p.x = cx + nx * rx;
      p.y = cy + ny * ry;
      const vDotN = p.vx * nx + p.vy * ny;
      if (vDotN < 0) {
        p.vx -= (1 + RESTITUTION) * vDotN * nx;
        p.vy -= (1 + RESTITUTION) * vDotN * ny;
      }
    }
  }

  // Nudge apart from any other currently-falling item, so items don't
  // visibly overlap mid-air (nothing ever comes to rest, so this can't
  // produce a pile — just keeps the fall looking natural).
  for (let j = 0; j < list.length; j++) {
    if (j === index) continue;
    const other = list[j];
    if (!other.spawned) continue;
    const dx = p.x - other.x;
    const dy = p.y - other.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const minDist = p.radius + other.radius;
    if (dist < minDist) {
      const overlap = (minDist - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;
      p.x += nx * overlap;
      p.y += ny * overlap;
      other.x -= nx * overlap;
      other.y -= ny * overlap;

      const relVx = p.vx - other.vx;
      const relVy = p.vy - other.vy;
      const relDot = relVx * nx + relVy * ny;
      if (relDot < 0) {
        const impulse = (-(1 + RESTITUTION) * relDot) / 2;
        p.vx += impulse * nx;
        p.vy += impulse * ny;
        other.vx -= impulse * nx;
        other.vy -= impulse * ny;
      }
    }
  }
}

function writeTransform(node: any, p: Particle) {
  if (!node || !node.style) return;
  node.style.transform = `translate(${p.x - p.radius}px, ${p.y - p.radius}px) rotate(${p.rot}deg)`;
  node.style.opacity = p.spawned ? "1" : "0";
}

export default function FallingProduce({ items, shield }: Props) {
  const nodeRefs = useRef<any[]>([]);
  const particles = useRef<Particle[]>([]);
  const sizeRef = useRef({ width: 0, height: 0 });
  const shieldRef = useRef<ShieldRect | null>(shield);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    shieldRef.current = shield;
  }, [shield]);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    particles.current = makeParticles(items, performance.now() + 300);

    const step = (now: number) => {
      const { width, height } = sizeRef.current;
      const list = particles.current;

      if (width > 0 && height > 0) {
        list.forEach((p, i) => {
          if (!p.spawned) {
            if (now >= p.spawnAt) {
              p.spawned = true;
            } else {
              return;
            }
          }
          simulateParticle(p, list, i, width, height, shieldRef.current, now);
          writeTransform(nodeRefs.current[i], p);
        });
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  if (Platform.OS !== "web") return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        sizeRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
      }}
    >
      {items.map((item, i) => (
        <Text
          key={i}
          ref={(el) => {
            nodeRefs.current[i] = el;
          }}
          style={
            {
              position: "absolute",
              top: 0,
              left: 0,
              width: item.size,
              height: item.size,
              fontSize: item.size * 0.9,
              lineHeight: `${item.size}px`,
              textAlign: "center",
              opacity: 0,
            } as any
          }
        >
          {item.emoji}
        </Text>
      ))}
    </View>
  );
}
