'use client';

import { Children, cloneElement, isValidElement, ReactNode, useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedContainerProps {
  children: ReactNode;
  delay?: number;
  staggerDelay?: number;
  className?: string;
  animation?: 'fade-up' | 'fade-in' | 'scale-in' | 'slide-left' | 'slide-right';
  once?: boolean;
}

export function AnimatedContainer({
  children,
  delay = 0,
  staggerDelay = 50,
  className,
  animation = 'fade-up',
  once = true,
}: AnimatedContainerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (once && hasAnimated.current) return;

          // Add initial delay before starting animations
          setTimeout(() => {
            setIsVisible(true);
            hasAnimated.current = true;
          }, delay);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [delay, once]);

  const animationClass = {
    'fade-up': 'animate-fade-up',
    'fade-in': 'animate-fade-in',
    'scale-in': 'animate-scale-in',
    'slide-left': 'animate-slide-left',
    'slide-right': 'animate-slide-right',
  }[animation];

  const staggeredChildren = Children.map(children, (child, index) => {
    if (!isValidElement(child)) return child;

    return cloneElement(child as React.ReactElement<{ style?: React.CSSProperties; className?: string }>, {
      style: {
        ...((child.props as { style?: React.CSSProperties }).style || {}),
        animationDelay: `${index * staggerDelay}ms`,
        animationFillMode: 'both',
      },
      className: cn(
        (child.props as { className?: string }).className,
        isVisible ? animationClass : 'opacity-0'
      ),
    });
  });

  return (
    <div ref={containerRef} className={cn('animate-container', className)}>
      {staggeredChildren}
    </div>
  );
}

// Single element animation wrapper
interface AnimatedProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  animation?: 'fade-up' | 'fade-in' | 'scale-in' | 'slide-left' | 'slide-right';
  once?: boolean;
}

export function Animated({
  children,
  delay = 0,
  className,
  animation = 'fade-up',
  once = true,
}: AnimatedProps) {
  const [isVisible, setIsVisible] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (once && hasAnimated.current) return;

          setTimeout(() => {
            setIsVisible(true);
            hasAnimated.current = true;
          }, delay);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    if (elementRef.current) {
      observer.observe(elementRef.current);
    }

    return () => observer.disconnect();
  }, [delay, once]);

  const animationClass = {
    'fade-up': 'animate-fade-up',
    'fade-in': 'animate-fade-in',
    'scale-in': 'animate-scale-in',
    'slide-left': 'animate-slide-left',
    'slide-right': 'animate-slide-right',
  }[animation];

  return (
    <div
      ref={elementRef}
      className={cn(
        className,
        isVisible ? animationClass : 'opacity-0 translate-y-4'
      )}
      style={{ animationFillMode: 'both' }}
    >
      {children}
    </div>
  );
}

// Hero section animation - fades in immediately on mount
interface HeroAnimatedProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function HeroAnimated({ children, className, delay = 0 }: HeroAnimatedProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={cn(
        className,
        'transition-all duration-700 ease-out',
        mounted
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-6'
      )}
    >
      {children}
    </div>
  );
}

// Stats animation container with counting effect trigger
interface StatsContainerProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

export function StatsContainer({ children, className, staggerDelay = 50 }: StatsContainerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.2 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={cn('stats-container', className)}>
      {Children.map(children, (child, index) => {
        if (!isValidElement(child)) return child;

        return (
          <div
            key={index}
            className={cn(
              'transition-all duration-500 ease-out',
              isVisible
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 translate-y-8 scale-95'
            )}
            style={{
              transitionDelay: `${index * staggerDelay}ms`,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
