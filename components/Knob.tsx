import React, { useState, useRef, useEffect, useCallback } from 'react';

interface KnobProps {
  value: number; // 0 to 1
  onChange: (value: number) => void;
  color?: string; // Optional accent override
  label: string;
  min?: number;
  max?: number;
  defaultValue?: number;
}

export const Knob: React.FC<KnobProps> = ({ value, onChange, label, min = 0, max = 1, defaultValue = 0.5 }) => {
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startValueRef = useRef<number>(0);
  const lastTapRef = useRef<number>(0);

  // Normalize value to 0-1
  const normalizedValue = (value - min) / (max - min);
  // Rotation: -135deg to +135deg
  const rotation = normalizedValue * 270 - 135;

  const handleStart = (clientY: number) => {
    setIsDragging(true);
    startYRef.current = clientY;
    startValueRef.current = value;
  };

  const handleReset = useCallback(() => {
    onChange(defaultValue);
  }, [onChange, defaultValue]);

  const handleTouchStart = (e: React.TouchEvent) => {
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
          e.preventDefault();
          handleReset();
      } else {
          handleStart(e.touches[0].clientY);
      }
      lastTapRef.current = now;
  };

  const handleMove = useCallback((clientY: number) => {
    if (!isDragging) return;
    const deltaY = startYRef.current - clientY;
    const change = (deltaY / 200) * (max - min);
    let newValue = startValueRef.current + change;
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(newValue);
  }, [isDragging, max, min, onChange, value]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      const onTouchMove = (e: TouchEvent) => handleMove(e.touches[0].clientY);
      const onMouseMove = (e: MouseEvent) => handleMove(e.clientY);
      const onEnd = () => handleEnd();

      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onEnd);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onEnd);

      return () => {
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onEnd);
      };
    }
  }, [isDragging, handleMove, handleEnd]);

  return (
    <div className="flex flex-col items-center gap-1 lg:gap-2 w-full no-select touch-none group">
      <div
        className="relative w-10 h-10 lg:w-14 lg:h-14 xl:w-16 xl:h-16 cursor-ns-resize"
        onMouseDown={(e) => handleStart(e.clientY)}
        onTouchStart={handleTouchStart}
        onDoubleClick={handleReset}
      >
        {/* Knob Body (Cylinder top view) */}
        <div className="absolute inset-0 rounded-full bg-braun-panel border border-braun-border shadow-[0_2px_4px_rgba(0,0,0,0.3)] transition-colors group-hover:border-braun-muted" />
        
        {/* Indicator Line */}
        <div
          className="absolute top-0 left-0 w-full h-full rounded-full transition-transform duration-75 ease-out"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* The white marker line */}
          <div className="w-0.5 lg:w-1 h-3 lg:h-5 xl:h-6 mx-auto mt-1 lg:mt-1.5 xl:mt-2 bg-braun-indicator rounded-full shadow-[0_0_2px_rgba(255,255,255,0.5)]" />
        </div>
      </div>
      <span className="text-[9px] lg:text-[11px] font-medium text-braun-muted uppercase tracking-widest pointer-events-none">{label}</span>
    </div>
  );
};