import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { DeckRefs } from '../types';

export interface DeckControls {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  buffer: AudioBuffer | null;
  bpm: number;
  playbackRate: number;
  cuePoints: number[]; // List of cue timestamps
  fileName: string | null;
  loadFile: (file: File) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  startScratch: () => void;
  stopScratch: () => void;
  addCuePoint: () => void;
  removeCuePoint: () => void;
  jumpToNextCue: () => void;
  setEQ: (type: 'low' | 'mid' | 'high', value: number) => void;
  setVolume: (value: number) => void;
  setPlaybackRate: (value: number) => void;
  setBpm: (value: number) => void;
  getGainNode: () => GainNode | undefined;
}

// Robust BPM Detection Algorithm using Autocorrelation
const analyzeBPM = async (buffer: AudioBuffer): Promise<number> => {
  try {
    const rawData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    
    // 1. Find the loudest 10-second segment (Energy-based Sampling)
    // Scanning the whole track to find where the beat is likely strongest (drop/chorus)
    const clipDuration = 10;
    const windowSize = sampleRate * clipDuration;
    
    // If track is shorter than 10s, use whole track
    if (buffer.duration < clipDuration) {
        // Fallback for short samples
        return 0;
    }

    let maxEnergy = 0;
    let bestOffset = 0;
    
    // Scan every 2 seconds to save CPU
    const scanStep = sampleRate * 2;
    
    for (let i = 0; i < rawData.length - windowSize; i += scanStep) {
        let sum = 0;
        // Calculate RMS estimation for this window (check every 100th sample for speed)
        for (let j = 0; j < windowSize; j += 100) {
            const val = rawData[i + j];
            sum += val * val;
        }
        if (sum > maxEnergy) {
            maxEnergy = sum;
            bestOffset = i;
        }
    }

    // 2. Pre-processing: Filter 40Hz - 150Hz using OfflineAudioContext
    const offlineCtx = new OfflineAudioContext(1, windowSize, sampleRate);
    const source = offlineCtx.createBufferSource();
    
    // Extract the loudest segment
    const segmentData = rawData.subarray(bestOffset, bestOffset + windowSize);
    const segmentBuffer = offlineCtx.createBuffer(1, windowSize, sampleRate);
    segmentBuffer.copyToChannel(segmentData, 0);
    source.buffer = segmentBuffer;

    // Highpass at 40Hz (Remove sub-bass rumble)
    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 40;
    highpass.Q.value = 1;

    // Lowpass at 150Hz (Isolate Kick/Bass)
    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 150;
    lowpass.Q.value = 1;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(offlineCtx.destination);
    
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const filteredData = renderedBuffer.getChannelData(0);

    // 3. Autocorrelation Algorithm
    // Downsample to ~6000Hz to make autocorrelation computationally feasible
    // 6000Hz gives enough resolution for rhythm (approx 0.16ms precision)
    const targetRate = 6000;
    const step = Math.floor(sampleRate / targetRate);
    const downsampled: number[] = [];
    
    // Rectify signal (take absolute value) effectively calculating the volume envelope
    // This makes beats stand out as positive peaks
    for (let i = 0; i < filteredData.length; i += step) {
        downsampled.push(Math.abs(filteredData[i]));
    }

    const effectiveRate = sampleRate / step;
    
    // Define search range: 70 BPM to 160 BPM
    const minBPM = 70;
    const maxBPM = 160;
    
    // Convert BPM to Lag (in samples)
    // Lag = SampleRate * (60 / BPM)
    const minLag = Math.floor(effectiveRate * (60 / maxBPM));
    const maxLag = Math.floor(effectiveRate * (60 / minBPM));

    let maxCorrelation = 0;
    let bestLag = 0;

    // Run Autocorrelation only for the target lag range
    for (let lag = minLag; lag <= maxLag; lag++) {
        let correlation = 0;
        // Sum products. Limiting length to ensure we don't go out of bounds.
        // We only need to check the first few seconds of the correlation to find the tempo.
        const limit = Math.min(downsampled.length - lag, downsampled.length);
        
        for (let i = 0; i < limit; i++) {
            correlation += downsampled[i] * downsampled[i + lag];
        }
        
        if (correlation > maxCorrelation) {
            maxCorrelation = correlation;
            bestLag = lag;
        }
    }

    if (bestLag === 0) return 0;

    // 4. Convert Lag to BPM and Normalize
    let calculatedBpm = 60 * effectiveRate / bestLag;

    // Round to 1 decimal place for stability
    calculatedBpm = Math.round(calculatedBpm * 10) / 10;

    // Enforce 70-160 Range (Double/Halve if necessary)
    while (calculatedBpm < 70) calculatedBpm *= 2;
    while (calculatedBpm > 160) calculatedBpm /= 2;

    return Math.round(calculatedBpm);

  } catch (e) {
    console.warn("BPM Analysis failed", e);
    return 0;
  }
};

export const useAudioDeck = (
  audioContext: AudioContext | null,
  deckId: string
): DeckControls => {
  const refs = useRef<DeckRefs | null>(null);
  
  // Scratching State
  const scratchState = useRef({
      isScratching: false,
      currentSample: 0, // The actual audio playhead position in samples
      targetSample: 0,  // The UI requested position in samples
      wasPlayingBeforeScratch: false,
      velocity: 0,
      processor: null as ScriptProcessorNode | null
  });
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [duration, setDuration] = useState(0);
  const [cuePoints, setCuePoints] = useState<number[]>([]); 
  const [fileName, setFileName] = useState<string | null>(null);
  
  const [bpm, setBpm] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    if (!audioContext || refs.current) return;

    const gainNode = audioContext.createGain();
    const volumeNode = audioContext.createGain();
    const highFilter = audioContext.createBiquadFilter();
    const midFilter = audioContext.createBiquadFilter();
    const lowFilter = audioContext.createBiquadFilter();
    const analyser = audioContext.createAnalyser();

    highFilter.type = 'highshelf';
    highFilter.frequency.value = 2500;
    midFilter.type = 'peaking';
    midFilter.frequency.value = 1000;
    midFilter.Q.value = 1.0;
    lowFilter.type = 'lowshelf';
    lowFilter.frequency.value = 250;

    lowFilter.connect(midFilter);
    midFilter.connect(highFilter);
    highFilter.connect(volumeNode);
    volumeNode.connect(gainNode);

    refs.current = {
      source: null,
      gainNode,
      volumeNode,
      highFilter,
      midFilter,
      lowFilter,
      analyser,
      startTime: 0,
      pausedAt: 0,
    };

    return () => {
      gainNode.disconnect();
      volumeNode.disconnect();
    };
  }, [audioContext]);

  // Main UI Update Loop
  useEffect(() => {
    let animationFrame: number;
    const update = () => {
      if (audioContext && refs.current) {
         if (scratchState.current.isScratching) {
             // In scratch mode, the UI follows the "currentSample" from the scratch engine
             if (buffer) {
                const time = scratchState.current.currentSample / buffer.sampleRate;
                setCurrentTime(Math.max(0, Math.min(time, buffer.duration)));
                refs.current.pausedAt = time; // Keep synced
             }
         } else if (isPlaying) {
             // Normal Playback
             if (refs.current.source) {
                 const calculatedTime = refs.current.pausedAt + (audioContext.currentTime - refs.current.startTime) * playbackRate;
                 if (calculatedTime >= duration && duration > 0) {
                     handlePause();
                     setCurrentTime(0);
                     refs.current.pausedAt = 0;
                 } else {
                     setCurrentTime(calculatedTime);
                 }
             }
         }
      }
      animationFrame = requestAnimationFrame(update);
    };
    
    // Always run update loop to catch scratch movements even if not "playing"
    animationFrame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, audioContext, duration, playbackRate, buffer]);

  useEffect(() => {
    if (refs.current?.source && !scratchState.current.isScratching) {
      refs.current.source.playbackRate.setValueAtTime(playbackRate, audioContext?.currentTime || 0);
    }
  }, [playbackRate, audioContext]);

  const loadFile = useCallback(async (file: File) => {
    if (!audioContext) return;
    
    setFileName(file.name);
    setIsPlaying(false);
    scratchState.current.isScratching = false;
    if (refs.current?.source) {
      refs.current.source.stop();
      refs.current.source = null;
    }

    const arrayBuffer = await file.arrayBuffer();
    try {
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      setBuffer(decodedBuffer);
      setDuration(decodedBuffer.duration);
      if (refs.current) refs.current.pausedAt = 0;
      setCurrentTime(0);
      setPlaybackRate(1);
      setCuePoints([]); 
      
      // Reset BPM to 0 while analyzing
      setBpm(0);
      
      analyzeBPM(decodedBuffer).then(detected => {
          setBpm(detected > 0 ? detected : 0);
      });
      
    } catch (e) {
      console.error("Error decoding audio", e);
      alert("Error loading audio file.");
    }
  }, [audioContext]);

  const handlePlay = useCallback(() => {
    if (!audioContext || !refs.current || !buffer) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    if (isPlaying) return;
    if (scratchState.current.isScratching) return; // Don't start standard playback if scratching

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(refs.current.lowFilter);
    
    const offset = refs.current.pausedAt; 
    
    // Loop/Finish check
    if (offset >= buffer.duration) {
        refs.current.pausedAt = 0;
        source.start(0, 0);
        setCurrentTime(0);
    } else {
        source.start(0, offset);
        setCurrentTime(offset);
    }
    
    refs.current.source = source;
    refs.current.startTime = audioContext.currentTime;
    setIsPlaying(true);
  }, [audioContext, buffer, isPlaying, playbackRate]);

  const handlePause = useCallback(() => {
    if (!audioContext || !refs.current || !isPlaying) return;
    
    if (refs.current.source) {
        const elapsed = (audioContext.currentTime - refs.current.startTime) * playbackRate;
        refs.current.pausedAt = Math.min(refs.current.pausedAt + elapsed, duration);
        try { refs.current.source.stop(); } catch(e) {}
        refs.current.source = null;
    }
    
    setCurrentTime(refs.current.pausedAt);
    setIsPlaying(false);
  }, [audioContext, isPlaying, duration, playbackRate]);

  // ---- SCRATCH ENGINE ----

  const startScratch = useCallback(() => {
      if (!audioContext || !buffer || !refs.current) return;
      if (audioContext.state === 'suspended') audioContext.resume();

      scratchState.current.wasPlayingBeforeScratch = isPlaying;
      scratchState.current.isScratching = true;

      // Stop normal playback if active
      if (isPlaying && refs.current.source) {
          try { refs.current.source.stop(); } catch(e) {}
          refs.current.source = null;
      }
      setIsPlaying(false);

      // Initialize scratch position
      const startSample = refs.current.pausedAt * buffer.sampleRate;
      scratchState.current.currentSample = startSample;
      scratchState.current.targetSample = startSample;

      // Create ScriptProcessor for variable speed playback
      // Buffer size 1024 ~ 23ms latency
      const processor = audioContext.createScriptProcessor(1024, 0, 2);
      scratchState.current.processor = processor;

      processor.onaudioprocess = (e) => {
          const outL = e.outputBuffer.getChannelData(0);
          const outR = e.outputBuffer.getChannelData(1);
          const chanL = buffer.getChannelData(0);
          const chanR = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : chanL;
          
          const maxSample = buffer.length - 1;

          for (let i = 0; i < outL.length; i++) {
              // Physics: Move current towards target
              const diff = scratchState.current.targetSample - scratchState.current.currentSample;
              
              // Tighter physics (0.5) for better visual sync while keeping audio smooth
              // 0.25 was too loose (rubber band), 1.0 is hard cut.
              const step = diff * 0.5; 
              
              scratchState.current.currentSample += step;
              
              const idx = scratchState.current.currentSample;
              
              // Boundary Check
              if (idx < 0 || idx > maxSample) {
                  outL[i] = 0;
                  outR[i] = 0;
                  continue;
              }

              // Linear Interpolation
              const idxFloor = Math.floor(idx);
              const frac = idx - idxFloor;
              const idxCeil = Math.min(idxFloor + 1, maxSample);

              const valL = chanL[idxFloor] * (1 - frac) + chanL[idxCeil] * frac;
              const valR = chanR[idxFloor] * (1 - frac) + chanR[idxCeil] * frac;

              outL[i] = valL;
              outR[i] = valR;
          }
      };

      processor.connect(refs.current.lowFilter);

  }, [audioContext, buffer, isPlaying]);

  const stopScratch = useCallback(() => {
      if (!scratchState.current.isScratching || !audioContext) return;

      if (scratchState.current.processor) {
          scratchState.current.processor.disconnect();
          scratchState.current.processor = null;
      }

      scratchState.current.isScratching = false;

      // Sync final position
      if (buffer) {
        refs.current!.pausedAt = scratchState.current.currentSample / buffer.sampleRate;
        setCurrentTime(refs.current!.pausedAt);
      }

      // Resume only if it was playing before
      if (scratchState.current.wasPlayingBeforeScratch) {
          handlePlay();
      }

  }, [audioContext, buffer, handlePlay]);

  const seek = useCallback((time: number) => {
      if (!refs.current || !buffer) return;

      const newTime = Math.max(0, Math.min(time, duration));
      
      if (scratchState.current.isScratching) {
          // In scratch mode, just update the target
          scratchState.current.targetSample = newTime * buffer.sampleRate;
          return;
      }
      
      // Normal Seek (Jump)
      setCurrentTime(newTime);
      refs.current.pausedAt = newTime;

      if (isPlaying && audioContext) {
          if (refs.current.source) {
              try { refs.current.source.stop(); } catch(e) {}
          }
          
          const source = audioContext.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = playbackRate;
          source.connect(refs.current.lowFilter);
          
          source.start(0, newTime);
          
          refs.current.source = source;
          refs.current.startTime = audioContext.currentTime;
      }
  }, [buffer, duration, isPlaying, audioContext, playbackRate]);

  // ---- CUE LOGIC ----

  const addCuePoint = useCallback(() => {
      const exists = cuePoints.some(c => Math.abs(c - currentTime) < 0.1);
      if (!exists) {
          setCuePoints(prev => [...prev, currentTime].sort((a,b) => a - b));
      }
  }, [cuePoints, currentTime]);

  const removeCuePoint = useCallback(() => {
      setCuePoints(prev => prev.filter(c => Math.abs(c - currentTime) >= 0.1));
  }, [currentTime]);

  const jumpToNextCue = useCallback(() => {
      let target = 0;
      if (cuePoints.length > 0) {
          const nextCue = cuePoints.find(c => c > currentTime + 0.05);
          target = nextCue !== undefined ? nextCue : cuePoints[0];
      }
      const wasScratching = scratchState.current.isScratching;
      if (wasScratching) stopScratch();
      seek(target);
  }, [cuePoints, currentTime, seek, stopScratch]);

  const setEQ = useCallback((type: 'low' | 'mid' | 'high', value: number) => {
      if(!refs.current) return;
      const db = (value - 0.5) * 30; 
      if (type === 'high') refs.current.highFilter.gain.value = db;
      if (type === 'mid') refs.current.midFilter.gain.value = db;
      if (type === 'low') refs.current.lowFilter.gain.value = db;
  }, []);

  const setVolume = useCallback((value: number) => {
    if (!refs.current) return;
    refs.current.volumeNode.gain.value = value;
  }, []);
  
  const setPlaybackRateFn = useCallback((value: number) => {
      setPlaybackRate(value);
  }, []);

  const setBpmFn = useCallback((value: number) => {
      setBpm(value);
  }, []);

  const getGainNode = useCallback(() => refs.current?.gainNode, []);

  return useMemo(() => ({
    isPlaying,
    currentTime,
    duration,
    buffer,
    bpm,
    playbackRate,
    cuePoints,
    fileName,
    loadFile,
    play: handlePlay,
    pause: handlePause,
    seek,
    startScratch,
    stopScratch,
    addCuePoint,
    removeCuePoint,
    jumpToNextCue,
    setEQ,
    setVolume,
    setPlaybackRate: setPlaybackRateFn,
    setBpm: setBpmFn,
    getGainNode
  }), [
    isPlaying,
    currentTime,
    duration,
    buffer,
    bpm,
    playbackRate,
    cuePoints,
    fileName,
    loadFile,
    handlePlay,
    handlePause,
    seek,
    startScratch,
    stopScratch,
    addCuePoint,
    removeCuePoint,
    jumpToNextCue,
    setEQ,
    setVolume,
    setPlaybackRateFn,
    setBpmFn,
    getGainNode
  ]);
};