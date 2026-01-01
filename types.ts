export interface AudioEngine {
  context: AudioContext;
  masterGain: GainNode;
}

export interface DeckState {
  id: 'A' | 'B';
  buffer: AudioBuffer | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  eq: {
    high: number; // -10 to 10 (dB mostly, but we map logic)
    mid: number;
    low: number;
  };
  gain: number; // 0 to 1
  fileName: string | null;
}

export interface DeckRefs {
  source: AudioBufferSourceNode | null;
  gainNode: GainNode; // Used for crossfader
  volumeNode: GainNode; // Used for channel volume
  highFilter: BiquadFilterNode;
  midFilter: BiquadFilterNode;
  lowFilter: BiquadFilterNode;
  analyser: AnalyserNode;
  startTime: number;
  pausedAt: number;
}