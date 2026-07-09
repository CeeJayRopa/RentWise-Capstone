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
const DRAIN_GRAVITY = 0.45;
const RESTITUTION = 0.45;
const FRICTION = 0.985;
const SETTLE_SPEED = 0.06;
const SHIELD_PAD = 34;
const FILL_PAUSE_MS = 500;
const EMPTY_PAUSE_MS = 900;
const SPAWN_STAGGER_MS = 45;
const DRAIN_STAGGER_MS = 14;
// Once every item has spawned, wait for (nearly) all of them to actually
// come to rest before draining — otherwise the drain can kick in while a
// visible chunk of the pile is still mid-bounce. MAX_SETTLE_WAIT_MS is a
// safety cap so the cycle can't stall forever if a couple of particles never
// quite settle (e.g. stuck oscillating against the shield).
const SETTLE_FRACTION = 0.94;
const MAX_SETTLE_WAIT_MS = 7000;

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
  settled: boolean;
  spawnAt: number;
  released: boolean;
  releaseAt: number;
};

type Phase = "filling" | "waiting" | "draining" | "empty";

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
    settled: false,
    spawnAt: startDelay + i * SPAWN_STAGGER_MS,
    released: false,
    releaseAt: 0,
  }));
}

function simulateParticle(
  p: Particle,
  list: Particle[],
  index: number,
  width: number,
  height: number,
  shield: ShieldRect | null
) {
  p.vy += GRAVITY;
  p.vx *= FRICTION;
  p.vy *= FRICTION;
  p.x += p.vx;
  p.y += p.vy;
  p.rot += p.vr;

  // Container walls
  if (p.x - p.radius < 0) {
    p.x = p.radius;
    p.vx = -p.vx * RESTITUTION;
  }
  if (p.x + p.radius > width) {
    p.x = width - p.radius;
    p.vx = -p.vx * RESTITUTION;
  }
  if (p.y + p.radius > height) {
    p.y = height - p.radius;
    p.vy = -p.vy * RESTITUTION;
  }
  if (p.y - p.radius < 0) {
    p.y = p.radius;
    p.vy = Math.abs(p.vy) * RESTITUTION;
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

  // Bounce off any other spawned item
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
        other.settled = false;
      }
    }
  }

  const speed = Math.abs(p.vx) + Math.abs(p.vy);
  const onFloor = p.y + p.radius >= height - 0.5;
  if (speed < SETTLE_SPEED && onFloor) {
    p.vx = 0;
    p.vy = 0;
    p.settled = true;
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
  const phaseRef = useRef<Phase>("filling");
  const phaseUntil = useRef(0);
  const filledAt = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    shieldRef.current = shield;
  }, [shield]);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    particles.current = makeParticles(items, performance.now() + 300);
    phaseRef.current = "filling";

    const step = (now: number) => {
      const { width, height } = sizeRef.current;
      const list = particles.current;

      if (width > 0 && height > 0) {
        const phase = phaseRef.current;

        if (phase === "filling") {
          let allSpawned = true;
          let settledCount = 0;
          list.forEach((p, i) => {
            if (!p.spawned) {
              if (now >= p.spawnAt) {
                p.spawned = true;
                p.x = p.radius + Math.random() * Math.max(1, width - p.radius * 2);
                p.y = -p.radius * 2;
                p.vx = (Math.random() - 0.5) * 1.5;
                p.vy = 0;
              } else {
                allSpawned = false;
              }
            }
            if (p.spawned && !p.settled) {
              simulateParticle(p, list, i, width, height, shieldRef.current);
            }
            if (p.settled) settledCount++;
            writeTransform(nodeRefs.current[i], p);
          });

          // Once every item is on the board, wait for (nearly) all of them
          // to actually be at rest — not just a fixed timer — before moving
          // on, so the drain never starts while the pile is still visibly
          // falling. MAX_SETTLE_WAIT_MS is a fallback in case a few particles
          // never fully settle.
          if (allSpawned) {
            if (filledAt.current === null) filledAt.current = now;
            const elapsed = now - filledAt.current;
            const settledFraction = settledCount / list.length;
            if (settledFraction >= SETTLE_FRACTION || elapsed >= MAX_SETTLE_WAIT_MS) {
              filledAt.current = null;
              phaseRef.current = "waiting";
              phaseUntil.current = now + FILL_PAUSE_MS;
            }
          } else {
            filledAt.current = null;
          }
        } else if (phase === "waiting") {
          if (now >= phaseUntil.current) {
            phaseRef.current = "draining";
            // Shuffle the release order so the wave doesn't always sweep
            // left-to-right in the same sequence as spawn order.
            const order = list.map((_, i) => i);
            for (let i = order.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [order[i], order[j]] = [order[j], order[i]];
            }
            order.forEach((particleIndex, orderIndex) => {
              const p = list[particleIndex];
              p.settled = false;
              p.released = false;
              p.releaseAt = now + orderIndex * DRAIN_STAGGER_MS;
            });
          }
        } else if (phase === "draining") {
          let allGone = true;
          list.forEach((p, i) => {
            if (!p.released) {
              if (now >= p.releaseAt) {
                p.released = true;
                p.vx += (Math.random() - 0.5) * 2;
                p.vy -= Math.random() * 1.5;
              } else {
                allGone = false;
                writeTransform(nodeRefs.current[i], p);
                return;
              }
            }
            p.vy += DRAIN_GRAVITY;
            p.x += p.vx;
            p.y += p.vy;
            p.rot += p.vr * 2;
            if (p.y < height + p.radius * 4) allGone = false;
            writeTransform(nodeRefs.current[i], p);
          });
          if (allGone) {
            phaseRef.current = "empty";
            phaseUntil.current = now + EMPTY_PAUSE_MS;
          }
        } else if (phase === "empty") {
          if (now >= phaseUntil.current) {
            particles.current = makeParticles(items, now);
            phaseRef.current = "filling";
          }
        }
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
