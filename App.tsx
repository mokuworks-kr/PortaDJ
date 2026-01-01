import React, { useState, useEffect, useRef } from 'react';
import { Deck } from './components/Deck';
import { Crossfader } from './components/Crossfader';
import { Knob } from './components/Knob';
import { AudioEngine } from './types';
import { useAudioDeck } from './hooks/useAudioDeck';

const App: React.FC = () => {
  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [crossfaderValue, setCrossfaderValue] = useState(0.5);

  // EQ States
  const [eqA, setEqA] = useState({ high: 0.5, mid: 0.5, low: 0.5 });
  const [eqB, setEqB] = useState({ high: 0.5, mid: 0.5, low: 0.5 });
  
  // Volume States (Default 0.75 = Unity Gain)
  const [volA, setVolA] = useState(0.75);
  const [volB, setVolB] = useState(0.75);

  const deckAControls = useAudioDeck(engine?.context || null, 'A');
  const deckBControls = useAudioDeck(engine?.context || null, 'B');

  // Refs for Crossfader Logic
  const deckAGain = useRef<GainNode | null>(null);
  const deckBGain = useRef<GainNode | null>(null);

  // Constant for Gain Scaling
  const GAIN_SCALER = 1 / 0.75;

  // Force Landscape Mode Logic
  useEffect(() => {
    const lockOrientation = async () => {
      // Attempt to lock screen orientation to landscape
      try {
        if (screen.orientation && 'lock' in screen.orientation) {
           await (screen.orientation as any).lock('landscape');
        } else if ((window as any).screen && (window as any).screen.lockOrientation) {
           (window as any).screen.lockOrientation('landscape');
        }
      } catch (e) {
        // Silently fail if not supported or denied
      }
    };

    lockOrientation();

    // Re-attempt on interaction (needed for some mobile browsers)
    const handleInteraction = () => {
        lockOrientation();
        document.removeEventListener('click', handleInteraction);
        document.removeEventListener('touchstart', handleInteraction);
    };

    document.addEventListener('click', handleInteraction);
    document.addEventListener('touchstart', handleInteraction);

    return () => {
        document.removeEventListener('click', handleInteraction);
        document.removeEventListener('touchstart', handleInteraction);
    };
  }, []);

  useEffect(() => {
     const nodeA = deckAControls.getGainNode();
     if (nodeA && engine) {
         nodeA.connect(engine.masterGain);
         deckAGain.current = nodeA;
         updateCrossfader(crossfaderValue);
         deckAControls.setVolume(volA * GAIN_SCALER);
     }
  }, [deckAControls.getGainNode(), engine]);

  useEffect(() => {
     const nodeB = deckBControls.getGainNode();
     if (nodeB && engine) {
         nodeB.connect(engine.masterGain);
         deckBGain.current = nodeB;
         updateCrossfader(crossfaderValue);
         deckBControls.setVolume(volB * GAIN_SCALER);
     }
  }, [deckBControls.getGainNode(), engine]);


  // Initialize Audio Context on Mount
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const context = new AudioContextClass();
    const masterGain = context.createGain();
    masterGain.connect(context.destination);
    masterGain.gain.value = 0.9;

    setEngine({ context, masterGain });

    const unlockAudio = () => {
        if (context.state === 'suspended') {
            context.resume();
        }
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };

    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    return () => {
        context.close();
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  const updateCrossfader = (value: number) => {
    setCrossfaderValue(value);
    if (deckAGain.current) deckAGain.current.gain.value = 1 - value;
    if (deckBGain.current) deckBGain.current.gain.value = value;
  };

  const handleEqChange = (deck: 'A' | 'B', band: 'high' | 'mid' | 'low', val: number) => {
      if (deck === 'A') {
          setEqA(prev => ({...prev, [band]: val}));
          deckAControls.setEQ(band, val);
      } else {
          setEqB(prev => ({...prev, [band]: val}));
          deckBControls.setEQ(band, val);
      }
  }

  const handleVolumeChange = (deck: 'A' | 'B', val: number) => {
      const scaledGain = val * GAIN_SCALER;
      if (deck === 'A') {
          setVolA(val);
          deckAControls.setVolume(scaledGain);
      } else {
          setVolB(val);
          deckBControls.setVolume(scaledGain);
      }
  }

  return (
    <div id="app-content" className="flex flex-row bg-braun-bg w-full h-full overflow-hidden select-none">
      
      {/* Left Column: Deck A */}
      <div className="flex-1 h-full">
        <Deck 
          id="A" 
          controls={deckAControls} 
          color="#84cc16" 
        />
      </div>

      {/* Middle Column: Mixer */}
      {/* Reduced vertical padding (py-1) for small screens to maximize space */}
      <div className="h-full py-1 md:py-3 lg:py-4 mx-1 z-20 flex flex-col">
        <div className="w-[150px] md:w-[170px] lg:w-[240px] xl:w-[320px] h-full bg-braun-surface flex flex-col border border-braun-border rounded relative shadow-2xl transition-all duration-200 overflow-hidden">
            
            {/* Logo Area - Reduced height for small screens */}
            <div className="h-[30px] md:h-[10%] min-h-[30px] lg:min-h-[50px] flex items-center justify-center border-b border-braun-border bg-braun-surface overflow-hidden shrink-0">
                <div className="text-braun-text font-black tracking-tighter text-lg md:text-4xl lg:text-5xl w-full text-center leading-[0.8] scale-110 origin-center select-none">
                    PortaDJ
                </div>
            </div>

            {/* Mixer Controls Section */}
            <div className="flex-1 flex flex-row items-stretch justify-center relative min-h-0 overflow-hidden">
                
                {/* Column A Controls */}
                <div className="flex-1 flex flex-col h-full items-center border-r border-braun-border/50 bg-braun-surface overflow-hidden">
                    {/* EQ Section - Using justify-evenly and tighter padding */}
                    <div className="flex-1 flex flex-col justify-evenly w-full items-center min-h-0 py-1 md:py-4">
                      <Knob label="HI" value={eqA.high} onChange={(v) => handleEqChange('A', 'high', v)} />
                      <Knob label="MID" value={eqA.mid} onChange={(v) => handleEqChange('A', 'mid', v)} />
                      <Knob label="LO" value={eqA.low} onChange={(v) => handleEqChange('A', 'low', v)} />
                    </div>
                    {/* Volume Section - Compact padding */}
                    <div className="w-full py-1 md:py-4 border-t border-braun-border/50 flex justify-center shrink-0">
                      <Knob label="VOL" value={volA} onChange={(v) => handleVolumeChange('A', v)} defaultValue={0.75} />
                    </div>
                </div>

                {/* Column B Controls */}
                <div className="flex-1 flex flex-col h-full items-center bg-braun-surface overflow-hidden">
                    {/* EQ Section */}
                    <div className="flex-1 flex flex-col justify-evenly w-full items-center min-h-0 py-1 md:py-4">
                      <Knob label="HI" value={eqB.high} onChange={(v) => handleEqChange('B', 'high', v)} />
                      <Knob label="MID" value={eqB.mid} onChange={(v) => handleEqChange('B', 'mid', v)} />
                      <Knob label="LO" value={eqB.low} onChange={(v) => handleEqChange('B', 'low', v)} />
                    </div>
                    {/* Volume Section */}
                    <div className="w-full py-1 md:py-4 border-t border-braun-border/50 flex justify-center shrink-0">
                      <Knob label="VOL" value={volB} onChange={(v) => handleVolumeChange('B', v)} defaultValue={0.75} />
                    </div>
                </div>

            </div>

            {/* Crossfader Section - Compact height for small screens */}
            <div className="h-[50px] md:h-[70px] lg:h-[120px] flex-shrink-0 flex items-center px-4 lg:px-8 border-t border-braun-border bg-braun-panel">
                <Crossfader value={crossfaderValue} onChange={updateCrossfader} />
            </div>

        </div>
      </div>

      {/* Right Column: Deck B */}
      <div className="flex-1 h-full">
         <Deck 
           id="B" 
           controls={deckBControls} 
           color="#f97316" 
         />
      </div>

    </div>
  );
};

export default App;