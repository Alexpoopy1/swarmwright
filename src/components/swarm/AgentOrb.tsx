/**
 * AgentOrb — canvas-2D particle orb representing one agent (SPEC §6.2).
 *
 * 140 particles distributed on a sphere (Fibonacci lattice), orthographic
 * projection, continuous rotation. Behavior per status:
 *   idle      slow orbit
 *   active    rotation speed scales with `activity` (0–1)
 *   pulse     radius pulse 1.0 → 1.15 → 1.0 over 400ms (tool call)
 *   failed    particles scatter outward with jitter, reassemble on recovery
 *   completed gentle collapse + fade to 40% opacity
 *
 * requestAnimationFrame loop with cleanup, devicePixelRatio aware, pauses
 * when the tab is hidden, no shadows/blur (GPU-efficient). When effects are
 * disabled or prefers-reduced-motion is set, renders a static ring + status
 * dot instead of animating.
 */
"use client";

import { useEffect, useRef } from "react";
import type { AgentStatus } from "@/types";
import { AGENT_STATUS_META } from "@/components/swarm/shared";
import { shouldAnimate, useUiStore } from "@/lib/stores";

const PARTICLE_COUNT = 140;
const TWO_PI = Math.PI * 2;

/** Fibonacci lattice on the unit sphere — computed once, shared by all orbs. */
const SPHERE: Array<{ x: number; y: number; z: number }> = (() => {
  const pts: Array<{ x: number; y: number; z: number }> = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2; // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
})();

const TILT = 0.42; // fixed X-axis tilt for depth readability

export interface AgentOrbProps {
  status: AgentStatus;
  /** 0–1, drives rotation speed while active. */
  activity?: number;
  /** Rising edge triggers a 400ms radius pulse (wire to tool-call events). */
  pulse?: boolean;
  /** Square canvas edge in CSS pixels. */
  size?: number;
  className?: string;
}

export function AgentOrb({
  status,
  activity = 0.5,
  pulse = false,
  size = 64,
  className,
}: AgentOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectsEnabled = useUiStore((s) => s.effectsEnabled);
  const animate = shouldAnimate(effectsEnabled);

  // Mutable simulation state (never re-renders React).
  const sim = useRef({
    angle: 0,
    scatter: new Float32Array(PARTICLE_COUNT * 2), // per-particle x/y offsets
    scatterAmp: 0,
    collapse: 1,
    alpha: 1,
    pulseStart: -1,
    last: 0,
  });

  // Pulse rising edge.
  useEffect(() => {
    if (pulse) sim.current.pulseStart = performance.now();
  }, [pulse]);

  // Static fallback: effects off or reduced motion → ring + status dot.
  useEffect(() => {
    if (animate) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const c = size / 2;
    const r = size * 0.36;
    const color = AGENT_STATUS_META[status].hex;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TWO_PI);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(c, c, Math.max(2.5, size * 0.06), 0, TWO_PI);
    ctx.fill();
  }, [animate, status, size]);

  // Animated loop.
  useEffect(() => {
    if (!animate) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let raf = 0;
    const s = sim.current;
    s.last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - s.last) / 1000, 0.1);
      s.last = now;

      // ── Behavior per status ─────────────────────────────────
      let speed = 0.2; // idle: slow orbit
      if (status === "active") speed = 0.3 + Math.max(0, Math.min(1, activity)) * 1.6;
      else if (status === "waiting" || status === "paused") speed = 0.05;
      else if (status === "completed") speed = 0.1;
      else if (status === "failed") speed = 0.35;
      s.angle += speed * dt;

      // Pulse envelope: 1.0 → 1.15 → 1.0 over 400ms.
      let pulseK = 1;
      if (s.pulseStart >= 0) {
        const t = (now - s.pulseStart) / 400;
        if (t >= 1) s.pulseStart = -1;
        else pulseK = 1 + 0.15 * Math.sin(Math.PI * t);
      }

      // Collapse/fade on completion; scatter on failure (lerped both ways).
      const lerp = (cur: number, target: number, k: number) => cur + (target - cur) * k;
      s.collapse = lerp(s.collapse, status === "completed" ? 0.72 : 1, dt * 3);
      s.alpha = lerp(s.alpha, status === "completed" ? 0.4 : 1, dt * 3);
      s.scatterAmp = lerp(s.scatterAmp, status === "failed" ? 1 : 0, dt * 2.5);

      // ── Draw ────────────────────────────────────────────────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const baseR = size * 0.36 * pulseK * s.collapse;
      const color = AGENT_STATUS_META[status].hex;
      const cosA = Math.cos(s.angle);
      const sinA = Math.sin(s.angle);
      const cosT = Math.cos(TILT);
      const sinT = Math.sin(TILT);

      ctx.fillStyle = color;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = SPHERE[i];
        // Rotate around Y, then apply fixed X tilt.
        const x1 = p.x * cosA + p.z * sinA;
        const z1 = -p.x * sinA + p.z * cosA;
        const y1 = p.y * cosT - z1 * sinT;
        const z2 = p.y * sinT + z1 * cosT;

        // Scatter offsets: random-walk jitter while failed, ease back after.
        const si = i * 2;
        if (s.scatterAmp > 0.01 && status === "failed") {
          s.scatter[si] += (Math.random() - 0.5) * 30 * dt + x1 * 8 * dt;
          s.scatter[si + 1] += (Math.random() - 0.5) * 30 * dt + y1 * 8 * dt;
        } else if (s.scatter[si] !== 0 || s.scatter[si + 1] !== 0) {
          s.scatter[si] *= Math.max(0, 1 - dt * 3); // reassemble
          s.scatter[si + 1] *= Math.max(0, 1 - dt * 3);
        }

        const px = cx + x1 * baseR + s.scatter[si] * s.scatterAmp;
        const py = cy + y1 * baseR + s.scatter[si + 1] * s.scatterAmp;
        const depth = (z2 + 1) / 2; // 0 back → 1 front
        ctx.globalAlpha = s.alpha * (0.25 + 0.75 * depth);
        const dot = 0.8 + depth * (size > 40 ? 1.2 : 0.8);
        ctx.beginPath();
        ctx.arc(px, py, dot, 0, TWO_PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      s.last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [animate, status, activity, size]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`Agent status: ${AGENT_STATUS_META[status].label}`}
      style={{ width: size, height: size }}
      className={className}
    />
  );
}
