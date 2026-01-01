import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';

interface WaveformProps {
  buffer: AudioBuffer | null;
  currentTime: number;
  cuePoints?: number[];
  color: string;
  onSeek?: (time: number) => void;
}

const ZOOM_LEVELS = [5, 10, 30, 60, Infinity]; 

export const Waveform: React.FC<WaveformProps> = ({ buffer, currentTime, cuePoints = [], color, onSeek }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIndex, setZoomIndex] = useState(0); 
  const [isDragging, setIsDragging] = useState(false);
  const lastXRef = useRef<number>(0);

  useEffect(() => {
      if (buffer) setZoomIndex(0); 
  }, [buffer]);

  const handleZoomIn = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoomIndex(prev => Math.max(0, prev - 1));
  };
  
  const handleZoomOut = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoomIndex(prev => Math.min(ZOOM_LEVELS.length - 1, prev + 1));
  };

  const getWindowParams = useCallback(() => {
      const windowSize = ZOOM_LEVELS[zoomIndex];
      const duration = buffer ? buffer.duration : 1;
      let startTime = 0;
      let endTime = duration;

      if (windowSize !== Infinity) {
        const halfWindow = windowSize / 2;
        startTime = currentTime - halfWindow;
        endTime = currentTime + halfWindow;
        if (startTime < 0) { startTime = 0; endTime = windowSize; }
        if (endTime > duration) { endTime = duration; startTime = Math.max(0, duration - windowSize); }
      }
      return { startTime, endTime, windowSize, duration };
  }, [zoomIndex, currentTime, buffer]);

  const handleDragStart = (clientX: number) => {
      if (!buffer) return;
      setIsDragging(true);
      lastXRef.current = clientX;
  };

  const handleDragMove = useCallback((clientX: number) => {
      if (!isDragging || !buffer || !onSeek || !canvasRef.current) return;
      const width = canvasRef.current.width;
      const deltaX = lastXRef.current - clientX; 
      lastXRef.current = clientX;
      const { windowSize, duration } = getWindowParams();
      const effectiveWindow = windowSize === Infinity ? duration : windowSize;
      const timeDelta = (deltaX / width) * effectiveWindow;
      const newTime = Math.max(0, Math.min(duration, currentTime + timeDelta));
      onSeek(newTime);
  }, [isDragging, buffer, onSeek, getWindowParams, currentTime]);

  const handleDragEnd = () => { setIsDragging(false); };

  useEffect(() => {
    if (isDragging) {
      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); handleDragMove(e.touches[0].clientX); };
      const onMouseMove = (e: MouseEvent) => { e.preventDefault(); handleDragMove(e.clientX); };
      const onEnd = () => handleDragEnd();

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
  }, [isDragging, handleDragMove]);


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;

    // Clear with transparent background (handled by CSS)
    ctx.clearRect(0, 0, width, height);

    if (!buffer) {
      // Empty State Line
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = '#333'; 
      ctx.lineWidth = 1;
      ctx.stroke();
      return;
    }

    const { startTime, endTime } = getWindowParams();
    const timeToX = (t: number) => {
        const range = endTime - startTime;
        if (range <= 0) return 0;
        return ((t - startTime) / range) * width;
    };

    const data = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.min(data.length, Math.floor(endTime * sampleRate));
    const totalSamples = endSample - startSample;
    
    if (totalSamples > 0) {
        ctx.fillStyle = color;
        ctx.beginPath();
        const step = Math.max(1, Math.ceil(totalSamples / width));
        
        for (let i = 0; i < width; i++) {
            const currentSampleIndex = startSample + (i * step);
            if (currentSampleIndex >= data.length) break;
            let min = 1.0; let max = -1.0;
            const chunkEnd = Math.min(data.length, currentSampleIndex + step);
            for (let j = currentSampleIndex; j < chunkEnd; j++) {
                const val = data[j];
                if (val < min) min = val;
                if (val > max) max = val;
            }
            if (min > max) { min = 0; max = 0; }
            const amp = height / 2;
            const y = (1 + min) * amp;
            const h = Math.max(1, (max - min) * amp);
            ctx.fillRect(i, y, 1, h);
        }
    }

    // Cue Points
    if (cuePoints.length > 0) {
        ctx.fillStyle = '#ea580c'; // Braun Orange
        cuePoints.forEach(cueTime => {
            if (cueTime >= startTime && cueTime <= endTime) {
                const cueX = timeToX(cueTime);
                ctx.fillRect(cueX, 0, 1, height);
                ctx.beginPath();
                ctx.moveTo(cueX - 4, height);
                ctx.lineTo(cueX + 4, height);
                ctx.lineTo(cueX, height - 8);
                ctx.fill();
            }
        });
    }

    // Playhead (Center if windowed, moving if Full)
    if (currentTime >= startTime && currentTime <= endTime) {
        const playheadX = timeToX(currentTime);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(playheadX, 0, 1.5, height);
        
        // Progress Overlay
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, playheadX, height);
    }

  }, [buffer, currentTime, cuePoints, color, zoomIndex, getWindowParams]);

  return (
    <div className="w-full h-full bg-black relative group select-none cursor-ew-resize">
      <canvas 
        ref={canvasRef} 
        width={600} 
        height={120} 
        className="w-full h-full block touch-none"
        onMouseDown={(e) => handleDragStart(e.clientX)}
        onTouchStart={(e) => handleDragStart(e.touches[0].clientX)}
      />
      {!buffer && (
        <div className="absolute inset-0 flex items-center justify-center text-braun-muted font-medium text-[10px] tracking-widest pointer-events-none">
          NO DATA
        </div>
      )}

      {/* Minimal Zoom Controls */}
      {buffer && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
               <div className="flex bg-braun-surface rounded border border-braun-border overflow-hidden pointer-events-auto">
                   <button 
                    onClick={handleZoomIn}
                    disabled={zoomIndex === 0}
                    className="p-1 hover:bg-braun-panel text-braun-text disabled:opacity-30 transition-colors border-r border-braun-border"
                   >
                       <Plus size={12} />
                   </button>
                   <button 
                    onClick={handleZoomOut}
                    disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                    className="p-1 hover:bg-braun-panel text-braun-text disabled:opacity-30 transition-colors"
                   >
                       <Minus size={12} />
                   </button>
               </div>
          </div>
      )}
    </div>
  );
};