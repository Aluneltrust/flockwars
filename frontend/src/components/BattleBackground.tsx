// ============================================================================
// BATTLE BACKGROUND — Rising particles with dark-center horizon gradient
// Pure Canvas2D — no WebGL needed, works everywhere
// ============================================================================

import React, { useRef, useEffect } from 'react';

interface BattleBackgroundProps {
  /** 'player' = green tint, 'opponent' = red tint, 'idle' = neutral */
  mood?: 'player' | 'opponent' | 'idle';
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  drift: number;
  pulse: number;
  pulseSpeed: number;
  hue: number;
}

export default function BattleBackground({ mood = 'idle' }: BattleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const moodRef = useRef(mood);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => { moodRef.current = mood; }, [mood]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const W = () => window.innerWidth;
    const H = () => window.innerHeight;

    // Init particles
    const PARTICLE_COUNT = 80;
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * W(),
        y: Math.random() * H(),
        size: 1 + Math.random() * 2.5,
        speed: 0.15 + Math.random() * 0.6,
        opacity: 0.15 + Math.random() * 0.5,
        drift: (Math.random() - 0.5) * 0.3,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: 0.5 + Math.random() * 1.5,
        hue: 160 + Math.random() * 40, // teal-green range
      });
    }
    particlesRef.current = particles;

    // Mood color lerp
    let tintR = 0, tintG = 0, tintB = 0;
    let tintTargetR = 0, tintTargetG = 0, tintTargetB = 0;

    const animate = () => {
      const w = W();
      const h = H();
      const t = performance.now() / 1000;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = Math.min(window.devicePixelRatio, 2);
      ctx.scale(dpr, dpr);

      // === BACKGROUND GRADIENT ===
      // Dark band at center (horizon), lighter at top and bottom
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      
      // Mood tint targets
      const m = moodRef.current;
      if (m === 'player') {
        tintTargetR = 0; tintTargetG = 4; tintTargetB = 2;
      } else if (m === 'opponent') {
        tintTargetR = 4; tintTargetG = 0; tintTargetB = 0;
      } else {
        tintTargetR = 0; tintTargetG = 1; tintTargetB = 3;
      }
      tintR += (tintTargetR - tintR) * 0.02;
      tintG += (tintTargetG - tintG) * 0.02;
      tintB += (tintTargetB - tintB) * 0.02;

      const tr = Math.round(tintR);
      const tg = Math.round(tintG);
      const tb = Math.round(tintB);

      // Top: slightly lighter
      grad.addColorStop(0,    `rgb(${8 + tr}, ${12 + tg}, ${24 + tb})`);
      // Upper mid
      grad.addColorStop(0.3,  `rgb(${4 + tr}, ${6 + tg}, ${14 + tb})`);
      // Center horizon: darkest
      grad.addColorStop(0.5,  `rgb(${2 + tr}, ${3 + tg}, ${8 + tb})`);
      // Lower mid
      grad.addColorStop(0.7,  `rgb(${4 + tr}, ${6 + tg}, ${14 + tb})`);
      // Bottom: slightly lighter
      grad.addColorStop(1,    `rgb(${8 + tr}, ${12 + tg}, ${24 + tb})`);

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // === SUBTLE HORIZON GLOW ===
      const glowGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
      if (m === 'player') {
        glowGrad.addColorStop(0, 'rgba(40, 180, 80, 0.02)');
      } else if (m === 'opponent') {
        glowGrad.addColorStop(0, 'rgba(180, 40, 40, 0.02)');
      } else {
        glowGrad.addColorStop(0, 'rgba(60, 100, 140, 0.02)');
      }
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // === RISING PARTICLES ===
      for (const p of particles) {
        // Move upward
        p.y -= p.speed;
        p.x += p.drift + Math.sin(t * 0.5 + p.pulse) * 0.15;
        p.pulse += 0.01;

        // Wrap around
        if (p.y < -10) {
          p.y = h + 10;
          p.x = Math.random() * w;
        }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        // Pulsing opacity
        const pulseOpacity = p.opacity * (0.6 + 0.4 * Math.sin(t * p.pulseSpeed + p.pulse));

        // Color based on mood
        let r: number, g: number, b: number;
        if (m === 'player') {
          r = 80; g = 220; b = 120;
        } else if (m === 'opponent') {
          r = 220; g = 80; b = 60;
        } else {
          r = 100 + Math.sin(p.hue * 0.02) * 40;
          g = 180 + Math.sin(p.hue * 0.03) * 30;
          b = 200 + Math.cos(p.hue * 0.02) * 30;
        }

        // Draw particle with glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pulseOpacity})`;
        ctx.fill();

        // Soft glow around larger particles
        if (p.size > 1.5) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${pulseOpacity * 0.08})`;
          ctx.fill();
        }
      }

      // === FAINT STAR FIELD (static dots) ===
      // Seed-based so they don't flicker
      const starSeed = 42;
      for (let i = 0; i < 50; i++) {
        const sx = ((starSeed * (i + 1) * 7919) % 10000) / 10000 * w;
        const sy = ((starSeed * (i + 1) * 104729) % 10000) / 10000 * h;
        const sSize = 0.5 + ((i * 31) % 10) / 10;
        const sOpacity = 0.1 + 0.15 * Math.sin(t * 0.3 + i * 0.7);

        ctx.beginPath();
        ctx.arc(sx, sy, sSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 220, 255, ${sOpacity})`;
        ctx.fill();
      }

      // === VIGNETTE ===
      const vigGrad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
      vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      ctx.fillStyle = vigGrad;
      ctx.fillRect(0, 0, w, h);

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}