'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Type definition for canvas-confetti function
 * Matches the canvas-confetti library API
 */
type ConfettiFn = (options?: {
  particleCount?: number;
  spread?: number;
  origin?: { x: number; y: number };
  colors?: string[];
  scalar?: number;
  gravity?: number;
  drift?: number;
  shapes?: ('square' | 'circle')[];
  angle?: number;
  startVelocity?: number;
  ticks?: number;
}) => Promise<null> | null;

/**
 * Configuration options for confetti burst
 */
export interface ConfettiConfig {
  /** Number of confetti particles (default: 100) */
  particleCount?: number;
  /** Spread angle in degrees (default: 70) */
  spread?: number;
  /** Origin point { x: 0-1, y: 0-1 } (default: { x: 0.5, y: 0.6 }) */
  origin?: { x: number; y: number };
  /** Colors array (default: party colors) */
  colors?: string[];
  /** Scalar for particle size (default: 1) */
  scalar?: number;
  /** Gravity factor (default: 1) */
  gravity?: number;
  /** How fast particles fall (default: 0.9) */
  drift?: number;
  /** Particle shape: 'square' | 'circle' (default: mixed) */
  shapes?: ('square' | 'circle')[];
  /** Launch angle in degrees (default: 90 - straight up) */
  angle?: number;
  /** Initial velocity (default: 45) */
  startVelocity?: number;
  /** How many ticks before particles disappear (default: 200) */
  ticks?: number;
}

const DEFAULT_CONFIG: Required<ConfettiConfig> = {
  particleCount: 100,
  spread: 70,
  origin: { x: 0.5, y: 0.6 },
  colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#ff69b4'],
  scalar: 1,
  gravity: 1,
  drift: 0,
  shapes: ['square', 'circle'],
  angle: 90,
  startVelocity: 45,
  ticks: 200,
};

/**
 * Hook to trigger confetti celebrations
 * Uses canvas-confetti library if available, falls back to CSS animation
 */
export function useConfetti() {
  const confettiRef = useRef<ConfettiFn | null>(null);

  useEffect(() => {
    // Dynamically import canvas-confetti
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    import('canvas-confetti' as any)
      .then((module: { default: ConfettiFn }) => {
        confettiRef.current = module.default;
      })
      .catch(() => {
        console.warn('canvas-confetti not installed. Run: npm install canvas-confetti');
      });
  }, []);

  const fire = useCallback((config: ConfettiConfig = {}) => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (confettiRef.current) {
      confettiRef.current({
        particleCount: mergedConfig.particleCount,
        spread: mergedConfig.spread,
        origin: mergedConfig.origin,
        colors: mergedConfig.colors,
        scalar: mergedConfig.scalar,
        gravity: mergedConfig.gravity,
        drift: mergedConfig.drift,
        shapes: mergedConfig.shapes,
        angle: mergedConfig.angle,
        startVelocity: mergedConfig.startVelocity,
        ticks: mergedConfig.ticks,
      });
    } else {
      // Fallback: trigger CSS-based confetti animation
      triggerFallbackConfetti(mergedConfig);
    }
  }, []);

  /**
   * Fire a burst from both sides (celebration effect)
   */
  const fireSides = useCallback((config: ConfettiConfig = {}) => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (confettiRef.current) {
      // Left side
      confettiRef.current({
        ...mergedConfig,
        particleCount: Math.floor(mergedConfig.particleCount / 2),
        angle: 60,
        origin: { x: 0, y: 0.6 },
      });
      // Right side
      confettiRef.current({
        ...mergedConfig,
        particleCount: Math.floor(mergedConfig.particleCount / 2),
        angle: 120,
        origin: { x: 1, y: 0.6 },
      });
    } else {
      fire(config);
    }
  }, [fire]);

  /**
   * Fire confetti in a shower pattern
   */
  const fireShower = useCallback((config: ConfettiConfig = {}) => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    if (confettiRef.current) {
      const duration = 3000;
      const animationEnd = Date.now() + duration;
      const confetti = confettiRef.current;

      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0 },
          colors: mergedConfig.colors,
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0 },
          colors: mergedConfig.colors,
        });

        if (Date.now() < animationEnd) {
          requestAnimationFrame(frame);
        }
      };
      frame();
    } else {
      fire(config);
    }
  }, [fire]);

  return { fire, fireSides, fireShower };
}

/**
 * Fallback confetti using CSS animations when canvas-confetti is not available
 */
function triggerFallbackConfetti(config: Required<ConfettiConfig>) {
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
  `;
  document.body.appendChild(container);

  const originX = config.origin.x * window.innerWidth;
  const originY = config.origin.y * window.innerHeight;

  for (let i = 0; i < Math.min(config.particleCount, 50); i++) {
    const particle = document.createElement('div');
    const size = 8 + Math.random() * 8;
    const color = config.colors[Math.floor(Math.random() * config.colors.length)];
    const angle = ((config.angle - config.spread / 2) + Math.random() * config.spread) * (Math.PI / 180);
    const velocity = config.startVelocity * (0.5 + Math.random() * 0.5);
    const vx = Math.cos(angle) * velocity;
    const vy = -Math.sin(angle) * velocity;

    particle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${config.shapes.includes('circle') && Math.random() > 0.5 ? '50%' : '2px'};
      left: ${originX}px;
      top: ${originY}px;
      opacity: 1;
      transform: rotate(${Math.random() * 360}deg);
    `;

    container.appendChild(particle);

    // Animate with physics
    let x = originX;
    let y = originY;
    let velocityX = vx;
    let velocityY = vy;
    let opacity = 1;
    let rotation = Math.random() * 360;
    const rotationSpeed = (Math.random() - 0.5) * 20;

    const animate = () => {
      velocityY += config.gravity * 0.5;
      velocityX += config.drift * 0.1;
      x += velocityX;
      y += velocityY;
      rotation += rotationSpeed;
      opacity -= 0.01;

      if (opacity <= 0 || y > window.innerHeight) {
        particle.remove();
        return;
      }

      particle.style.left = `${x}px`;
      particle.style.top = `${y}px`;
      particle.style.opacity = String(opacity);
      particle.style.transform = `rotate(${rotation}deg)`;

      requestAnimationFrame(animate);
    };

    setTimeout(() => requestAnimationFrame(animate), i * 10);
  }

  // Cleanup container after animation
  setTimeout(() => container.remove(), 5000);
}

/**
 * Confetti component that can be triggered via ref or props
 */
interface ConfettiProps {
  /** Trigger confetti when this changes to true */
  trigger?: boolean;
  /** Configuration for the confetti burst */
  config?: ConfettiConfig;
  /** Callback when confetti has fired */
  onFired?: () => void;
  /** Type of confetti animation */
  type?: 'burst' | 'sides' | 'shower';
}

export function Confetti({ trigger, config, onFired, type = 'burst' }: ConfettiProps) {
  const { fire, fireSides, fireShower } = useConfetti();
  const hasFiredRef = useRef(false);

  useEffect(() => {
    if (trigger && !hasFiredRef.current) {
      hasFiredRef.current = true;

      switch (type) {
        case 'sides':
          fireSides(config);
          break;
        case 'shower':
          fireShower(config);
          break;
        default:
          fire(config);
      }

      onFired?.();
    } else if (!trigger) {
      hasFiredRef.current = false;
    }
  }, [trigger, config, onFired, type, fire, fireSides, fireShower]);

  return null;
}

export default Confetti;
