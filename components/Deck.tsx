import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Waveform } from './Waveform';
import { DeckControls } from '../hooks/useAudioDeck';
import { Play, Pause, Upload } from 'lucide-react';

interface DeckProps {
  id: 'A' | 'B';
  controls: DeckControls;
  color: string;
}

export const Deck: React.FC<DeckProps> = ({ id, controls, color }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Refs for rotation logic
  const lpRef = useRef<HTMLDivElement>(null);
  const lastAngleRef = useRef<number>(0);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Refs for Tempo Slider logic
  const tempoRef = useRef<HTMLDivElement>(null);
  const [isTempoDragging, setIsTempoDragging] = useState(false);

  // Constants
  const SECONDS_PER_REVOLUTION = 1.8;
  const currentRotation = (controls.currentTime / SECONDS_PER_REVOLUTION) * 360;
  
  // PITCH RANGE CONFIGURATION
  // 0.08 means +/- 8% range (Standard DJ pitch range)
  const PITCH_RANGE = 0.08; 

  // Timer for CUE button logic
  const cueTimerRef = useRef<number | null>(null);
  const [cueFeedback, setCueFeedback] = useState<string | null>(null);

  // Tap BPM Logic
  const tapTimesRef = useRef<number[]>([]);
  const [isBpmFlashing, setIsBpmFlashing] = useState(false);

  // Current BPM Calculation
  const effectiveBpm = controls.bpm ? controls.bpm * controls.playbackRate : 0;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      controls.loadFile(e.target.files[0]);
    }
  };

  // --- LP / SCRATCH LOGIC ---
  const getAngle = (clientX: number, clientY: number) => {
    if (!lpRef.current) return 0;
    const rect = lpRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return Math.atan2(clientY - centerY, clientX - centerX);
  };

  const handleLpDown = (clientX: number, clientY: number) => {
    if(!controls.buffer) return;
    setIsScrubbing(true);
    controls.startScratch(); 
    lastAngleRef.current = getAngle(clientX, clientY);
  };

  const handleLpMove = useCallback((clientX: number, clientY: number) => {
    if (!isScrubbing || !controls.buffer) return;

    const currentAngle = getAngle(clientX, clientY);
    let delta = currentAngle - lastAngleRef.current;
    
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    
    lastAngleRef.current = currentAngle;
    const timeDelta = (delta / (2 * Math.PI)) * SECONDS_PER_REVOLUTION;
    controls.seek(controls.currentTime + timeDelta);
  }, [isScrubbing, controls, SECONDS_PER_REVOLUTION]);

  const handleLpUp = useCallback(() => {
    setIsScrubbing(false);
    controls.stopScratch();
  }, [controls]);

  useEffect(() => {
    if (isScrubbing) {
      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); handleLpMove(e.touches[0].clientX, e.touches[0].clientY); };
      const onMouseMove = (e: MouseEvent) => { e.preventDefault(); handleLpMove(e.clientX, e.clientY); };
      const onEnd = () => handleLpUp();

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
  }, [isScrubbing, handleLpMove, handleLpUp]);

  // --- TEMPO SLIDER LOGIC ---
  const handleTempoMove = useCallback((clientX: number, clientY: number) => {
    if (!tempoRef.current) return;
    const rect = tempoRef.current.getBoundingClientRect();
    // Normalized 0 to 1 (Top to Bottom)
    const relativeY = clientY - rect.top;
    let normalized = relativeY / rect.height;
    normalized = Math.max(0, Math.min(1, normalized));
    
    // Logic Update: Use PITCH_RANGE
    // Top (0) = 1 + PITCH_RANGE (Fastest)
    // Bottom (1) = 1 - PITCH_RANGE (Slowest)
    const rangeSpan = PITCH_RANGE * 2;
    const newRate = (1 + PITCH_RANGE) - (normalized * rangeSpan);

    controls.setPlaybackRate(newRate);
  }, [controls, PITCH_RANGE]);

  useEffect(() => {
    if (isTempoDragging) {
      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); handleTempoMove(e.touches[0].clientX, e.touches[0].clientY); };
      const onMouseMove = (e: MouseEvent) => { e.preventDefault(); handleTempoMove(e.clientX, e.clientY); };
      const onEnd = () => setIsTempoDragging(false);

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
  }, [isTempoDragging, handleTempoMove]);


  // --- CUE LOGIC ---
  const handleCueDown = (e: React.SyntheticEvent) => {
      e.preventDefault(); 
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);

      cueTimerRef.current = window.setTimeout(() => {
          const isNearCue = controls.cuePoints.some(c => Math.abs(c - controls.currentTime) < 0.1);
          if (!controls.isPlaying && isNearCue) {
              controls.removeCuePoint();
              showFeedback("CUE DELETED");
          } else {
              controls.addCuePoint();
              showFeedback("CUE SET");
          }
          cueTimerRef.current = null;
      }, 500); 
  };

  const handleCueUp = (e: React.SyntheticEvent) => {
      e.preventDefault();
      if (cueTimerRef.current) {
          clearTimeout(cueTimerRef.current);
          cueTimerRef.current = null;
          controls.jumpToNextCue();
      }
  };

  // --- TAP BPM LOGIC ---
  const handleTap = (e: React.SyntheticEvent) => {
    e.preventDefault();
    
    const now = Date.now();
    const times = tapTimesRef.current;
    
    // Debounce
    if (times.length > 0 && now - times[times.length - 1] < 100) {
        return;
    }

    // Trigger Flash
    setIsBpmFlashing(true);
    setTimeout(() => setIsBpmFlashing(false), 25);
    
    // Reset if too long has passed (2 seconds)
    if (times.length > 0 && now - times[times.length - 1] > 2000) {
        times.length = 0;
    }
    
    times.push(now);
    // Keep last 5 taps
    if (times.length > 5) times.shift(); 
    
    if (times.length > 1) {
        let sum = 0;
        for (let i = 1; i < times.length; i++) {
            sum += times[i] - times[i-1];
        }
        const avg = sum / (times.length - 1);
        const measuredBpm = 60000 / avg;
        
        // Update the BASE BPM
        const baseBpm = measuredBpm / controls.playbackRate;
        controls.setBpm(baseBpm);
    }
  };

  const showFeedback = (msg: string) => {
      setCueFeedback(msg);
      setTimeout(() => setCueFeedback(null), 1000);
  };
  
  // Calculate slider position percentage (0 to 100)
  // Updated Calculation for PITCH_RANGE
  const sliderRangeSpan = PITCH_RANGE * 2;
  const sliderPercent = (((1 + PITCH_RANGE) - controls.playbackRate) / sliderRangeSpan) * 100;

  const handlePitchReset = () => {
    controls.setPlaybackRate(1);
  };

  const togglePlay = () => {
    if (controls.isPlaying) controls.pause();
    else controls.play();
  };

  // Common button style
  const buttonStyle = "w-16 h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 rounded-full bg-braun-panel border border-braun-border shadow-md active:shadow-inner active:bg-braun-surface transition-all flex items-center justify-center group";

  return (
    <div className="flex flex-col h-full w-full px-2 py-2 md:px-3 md:py-3 lg:px-4 lg:py-4 gap-2 lg:gap-4 bg-braun-bg overflow-hidden">
      
      {/* Top: Display Area (Inset look) */}
      <div className="h-[20%] md:h-[18%] lg:h-[20%] min-h-[70px] md:min-h-[85px] lg:min-h-[100px] flex-shrink-0 w-full bg-black rounded border border-braun-border shadow-inner p-2 lg:p-3 flex flex-col relative overflow-hidden">
        <div className="flex justify-between items-start w-full z-10 mb-1">
             <div className="flex flex-col">
                <span className="text-[9px] lg:text-[11px] tracking-widest text-braun-muted font-medium uppercase">TRACK</span>
                <span className="text-[10px] lg:text-sm text-braun-text truncate max-w-[120px] lg:max-w-xs">
                  {controls.fileName || "NO TRACK LOADED"}
                </span>
             </div>
             <div className="flex flex-col items-end">
                <span 
                    className={`text-[9px] lg:text-[11px] tracking-widest font-medium uppercase ${
                        isBpmFlashing 
                            ? 'text-white drop-shadow-[0_0_5px_rgba(255,255,255,0.8)] transition-none' 
                            : 'text-braun-muted transition-all duration-300'
                    }`}
                >
                    BPM
                </span>
                <span className="text-xs lg:text-base font-mono text-braun-text">
                  {effectiveBpm > 0 ? Math.round(effectiveBpm) : '--'}
                </span>
             </div>
        </div>
        <div className="flex-1 w-full relative rounded border border-braun-surface overflow-hidden">
            <Waveform 
                buffer={controls.buffer} 
                currentTime={controls.currentTime} 
                cuePoints={controls.cuePoints} 
                color={color}
                onSeek={controls.seek} 
            />
        </div>
        
        {/* Notification Overlay */}
        {cueFeedback && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-braun-accent text-white px-3 py-1 lg:px-4 lg:py-2 rounded-sm text-xs lg:text-sm font-bold tracking-widest pointer-events-none z-20 shadow-lg uppercase">
                {cueFeedback}
            </div>
        )}
      </div>

      {/* Middle: Jog Wheel & Pitch Wrapper */}
      {/* Wrapper to center controls and prevent them from splitting too far on desktop */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden py-1">
        <div className="flex flex-row items-stretch justify-center w-full max-w-[400px] md:max-w-[500px] xl:max-w-[600px] gap-2 md:gap-4 lg:gap-6 h-full">
            
            {/* Jog Wheel Container - Fixed Aspect Ratio */}
            <div className="flex-1 h-full flex items-center justify-center relative touch-none min-w-0">
               <div className="relative max-w-full max-h-full aspect-square flex items-center justify-center">
                  {/* Layout Strut: Forces square aspect ratio within constraints */}
                  <svg 
                    viewBox="0 0 100 100" 
                    className="max-w-full max-h-full block opacity-0 pointer-events-none"
                    style={{ width: '1000px', height: '1000px' }} 
                    aria-hidden="true"
                  >
                    <rect width="100" height="100" />
                  </svg>
                  
                  {/* Actual Interactive Disc */}
                  <div className="absolute inset-0 p-1">
                      <div 
                          ref={lpRef}
                          className="w-full h-full rounded-full border border-braun-border shadow-2xl relative cursor-grab active:cursor-grabbing bg-braun-surface"
                          onMouseDown={(e) => handleLpDown(e.clientX, e.clientY)}
                          onTouchStart={(e) => handleLpDown(e.touches[0].clientX, e.touches[0].clientY)}
                      >
                        {/* Spinning Platter with Texture */}
                        <div 
                          className="absolute inset-1 rounded-full vinyl-groove transition-transform duration-0 will-change-transform shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]"
                          style={{ transform: `rotate(${currentRotation}deg)` }}
                        >
                            {/* Center Hub */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30%] h-[30%] bg-braun-panel rounded-full border border-braun-border flex items-center justify-center shadow-lg">
                                <button 
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onTouchStart={(e) => e.stopPropagation()}
                                  onClick={() => fileInputRef.current?.click()}
                                  className="w-full h-full rounded-full flex flex-col items-center justify-center active:scale-95 transition-transform group"
                                >
                                  <Upload className="w-3 h-3 lg:w-6 lg:h-6 text-braun-muted group-hover:text-braun-text transition-colors" />
                                  <span className="text-[8px] lg:text-[10px] font-medium text-braun-muted mt-0.5 uppercase">Load</span>
                                </button>
                            </div>
                            
                            {/* Rotation Marker (Dot) */}
                            <div className="absolute top-[8%] left-1/2 -translate-x-1/2 w-[4%] h-[4%] bg-braun-indicator rounded-full shadow-md"></div>
                        </div>
                      </div>
                  </div>
              </div>

              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="audio/*" 
                className="hidden" 
              />
            </div>

            {/* Custom Tempo Slider */}
            <div className="w-10 lg:w-16 h-full flex flex-col items-center justify-center py-1 relative touch-none select-none">
              {/* Slider Wrapper: Flex grow to fill height */}
              <div 
                  ref={tempoRef}
                  className="flex-1 w-8 lg:w-10 bg-braun-surface rounded border border-braun-border relative flex justify-center shadow-inner cursor-ns-resize min-h-0"
                  onMouseDown={(e) => { setIsTempoDragging(true); handleTempoMove(e.clientX, e.clientY); }}
                  onTouchStart={(e) => { setIsTempoDragging(true); handleTempoMove(e.touches[0].clientX, e.touches[0].clientY); }}
                  onDoubleClick={handlePitchReset}
              >
                  {/* Track Line */}
                  <div className="absolute top-2 bottom-2 w-0.5 bg-braun-muted/30 rounded-full left-1/2 -translate-x-1/2"></div>
                  
                  {/* Center Marker */}
                  <div className="absolute top-1/2 w-4 lg:w-5 h-0.5 bg-braun-muted/50 -translate-y-1/2 left-1/2 -translate-x-1/2"></div>
                  
                  {/* Fill Line */}
                  <div 
                    className="absolute left-1/2 -translate-x-1/2 w-0.5 opacity-60"
                    style={{
                      backgroundColor: color,
                      top: sliderPercent > 50 ? '50%' : `${sliderPercent}%`,
                      height: `${Math.abs(sliderPercent - 50)}%`
                    }}
                  ></div>

                  {/* Thumb */}
                  <div 
                    className="absolute left-0 w-full h-4 lg:h-6 flex items-center justify-center z-10"
                    style={{ 
                      top: `${sliderPercent}%`,
                      transform: 'translateY(-50%)',
                      transition: isTempoDragging ? 'none' : 'top 0.1s ease-out'
                    }}
                  >
                      <div 
                        className="w-full mx-1 h-1.5 lg:h-2 rounded-sm shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                        style={{ backgroundColor: color }}
                      ></div>
                  </div>
              </div>
              {/* Horizontal TEMPO Text */}
              <div className="w-full text-center mt-2 shrink-0">
                  <span className="text-[8px] lg:text-[10px] font-medium tracking-widest text-braun-muted uppercase">TEMPO</span>
              </div>
            </div>
        </div>
      </div>

      {/* Bottom: Transport Controls - Fixed height to ensure visibility */}
      {/* Gap reduced to 4, Height slightly adjusted to fit bigger buttons */}
      <div className="h-[75px] md:h-[90px] lg:h-[110px] flex-shrink-0 flex items-center justify-center gap-4 lg:gap-8 pb-2">
        {/* CUE Button */}
        <div className="flex flex-col items-center gap-1">
          <button 
            onMouseDown={handleCueDown}
            onMouseUp={handleCueUp}
            onTouchStart={handleCueDown}
            onTouchEnd={handleCueUp}
            onMouseLeave={handleCueUp}
            className={buttonStyle}
          >
            <span className="text-braun-text font-bold text-sm lg:text-lg tracking-wider">CUE</span>
          </button>
        </div>

        {/* PLAY/PAUSE Button */}
        <div className="flex flex-col items-center gap-1">
          <button 
            onClick={togglePlay}
            className={buttonStyle}
          >
            {controls.isPlaying ? (
                <Pause className="text-braun-text fill-current w-5 h-5 lg:w-8 lg:h-8" />
            ) : (
                <Play className="text-braun-text fill-current ml-0.5 w-5 h-5 lg:w-8 lg:h-8" />
            )}
          </button>
        </div>

        {/* TAP Button (Replaces Sync) */}
        <div className="flex flex-col items-center gap-1">
           <button 
            onMouseDown={handleTap}
            onTouchStart={handleTap}
            className={buttonStyle}
          >
             <span className="text-braun-text font-bold text-sm lg:text-lg tracking-wider">TAP</span>
          </button>
        </div>
      </div>
    </div>
  );
};