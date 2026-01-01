import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CrossfaderProps {
  value: number; // 0 (Deck A) to 1 (Deck B)
  onChange: (value: number) => void;
}

export const Crossfader: React.FC<CrossfaderProps> = ({ value, onChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMove = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    let newValue = x / rect.width;
    newValue = Math.max(0, Math.min(1, newValue));
    onChange(newValue);
  }, [onChange]);

  useEffect(() => {
    if (isDragging) {
      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); handleMove(e.touches[0].clientX); }
      const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
      const onEnd = () => setIsDragging(false);

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
  }, [isDragging, handleMove]);

  // Visual calculations
  // Center is 0.5
  // If value < 0.5, fill is from value to 0.5 (so left = value*100%, width = (0.5-value)*100%)
  // If value > 0.5, fill is from 0.5 to value (so left = 50%, width = (value-0.5)*100%)
  const fillLeft = value < 0.5 ? `${value * 100}%` : '50%';
  const fillWidth = `${Math.abs(value - 0.5) * 100}%`;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 touch-none select-none">
      {/* Slider Container (Box style like Tempo) */}
      <div 
        ref={trackRef}
        className="relative w-full h-8 lg:h-10 bg-braun-surface rounded border border-braun-border shadow-inner flex items-center cursor-ew-resize group"
        onMouseDown={(e) => { setIsDragging(true); handleMove(e.clientX); }}
        onTouchStart={(e) => { setIsDragging(true); handleMove(e.touches[0].clientX); }}
      >
        {/* Track Line */}
        <div className="absolute left-3 right-3 h-0.5 bg-braun-muted/30 rounded-full" />
        
        {/* Center Marker */}
        <div className="absolute left-1/2 top-2 bottom-2 w-0.5 bg-braun-muted/50 -translate-x-1/2" />

        {/* Fill Line */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 h-0.5 bg-braun-text/60 pointer-events-none"
          style={{
            left: fillLeft,
            width: fillWidth
          }}
        />

        {/* Thumb */}
        <div 
          className="absolute top-0 bottom-0 w-8 flex items-center justify-center -translate-x-1/2 z-10"
          style={{ 
            left: `${value * 100}%`,
            transition: isDragging ? 'none' : 'left 0.1s ease-out'
          }}
        >
          {/* Vertical Bar Handle */}
          <div className="h-4 lg:h-5 w-1.5 lg:w-2 bg-braun-text rounded-sm shadow-[0_1px_3px_rgba(0,0,0,0.5)]"></div>
        </div>
      </div>
      
      {/* Labels */}
      <div className="w-full flex justify-between px-1">
         <span className="text-[9px] lg:text-[11px] font-medium text-braun-muted uppercase tracking-widest">A</span>
         <span className="text-[9px] lg:text-[11px] font-medium text-braun-muted uppercase tracking-widest">CROSSFADER</span>
         <span className="text-[9px] lg:text-[11px] font-medium text-braun-muted uppercase tracking-widest">B</span>
      </div>
    </div>
  );
};