import React, { useState, useEffect, useRef } from 'react';
import { 
  Scissors, 
  Zap, 
  Volume2, 
  Sun, 
  Contrast, 
  Droplets,
  RotateCcw,
  X,
  RotateCw,
  FlipHorizontal,
  Play,
  Pause,
  Download,
  Loader2,
  ZoomIn,
  ZoomOut,
  GripVertical
} from 'lucide-react';
import { motion } from 'motion/react';

interface VideoEditState {
  startTime: number;
  endTime: number;
  playbackRate: number;
  volume: number;
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  flipped: boolean;
}

interface VideoEditorProps {
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  editState: VideoEditState;
  onUpdate: (updates: Partial<VideoEditState>) => void;
  onClose: () => void;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onExport: () => void;
  isExporting?: boolean;
}

const FILTER_PRESETS = [
  { name: 'None', brightness: 100, contrast: 100, saturation: 100 },
  { name: 'Vintage', brightness: 110, contrast: 90, saturation: 80 },
  { name: 'B&W', brightness: 100, contrast: 120, saturation: 0 },
  { name: 'Sepia', brightness: 100, contrast: 95, saturation: 60 },
  { name: 'Vibrant', brightness: 105, contrast: 110, saturation: 150 },
  { name: 'Dramatic', brightness: 90, contrast: 140, saturation: 110 },
  { name: 'Cinema', brightness: 95, contrast: 115, saturation: 85 },
  { name: 'Cold', brightness: 100, contrast: 105, saturation: 70 },
];

export const VideoEditor: React.FC<VideoEditorProps> = ({
  duration,
  currentTime,
  isPlaying,
  editState,
  onUpdate,
  onClose,
  onSeek,
  onTogglePlay,
  onExport,
  isExporting = false
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'seek' | null>(null);

  const resetAll = () => {
    onUpdate({
      startTime: 0,
      endTime: duration,
      playbackRate: 1,
      volume: 1,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      rotation: 0,
      flipped: false
    });
    setZoom(1);
  };

  const resetFilters = () => {
    onUpdate({
      brightness: 100,
      contrast: 100,
      saturation: 100,
      rotation: 0,
      flipped: false
    });
  };

  const applyPreset = (preset: typeof FILTER_PRESETS[0]) => {
    onUpdate({
      brightness: preset.brightness,
      contrast: preset.contrast,
      saturation: preset.saturation
    });
  };

  const rotate = () => {
    onUpdate({ rotation: (editState.rotation + 90) % 360 });
  };

  const toggleFlip = () => {
    onUpdate({ flipped: !editState.flipped });
  };

  const handleTimelineInteraction = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newTime = percentage * duration;

    if (isDragging === 'start') {
      onUpdate({ startTime: Math.min(newTime, editState.endTime - 0.1) });
    } else if (isDragging === 'end') {
      onUpdate({ endTime: Math.max(newTime, editState.startTime + 0.1) });
    } else if (isDragging === 'seek') {
      onSeek(newTime);
    }
  };

  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      if (isDragging) handleTimelineInteraction(e);
    };
    const handleGlobalUp = () => setIsDragging(null);

    if (isDragging) {
      window.addEventListener('mousemove', handleGlobalMove);
      window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchmove', handleGlobalMove);
      window.addEventListener('touchend', handleGlobalUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [isDragging]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const timelineWidth = 100 * zoom;

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-[2rem] p-8 shadow-2xl space-y-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <Scissors className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Video Editor</h3>
            <p className="text-xs text-zinc-500">Trim, filter and transform</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={resetAll}
            className="p-2 hover:bg-white/5 rounded-xl transition-colors text-zinc-500 hover:text-emerald-500"
            title="Reset All"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-400 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="space-y-8">
        {/* Playback Controls & Timeline */}
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
            <span>{formatTime(currentTime)}</span>
            <div className="flex items-center gap-4">
              <span className="text-emerald-500 font-bold">
                {formatTime(editState.endTime - editState.startTime)} Selected
              </span>
              <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded-lg">
                <button onClick={() => setZoom(Math.max(1, zoom - 1))} className="hover:text-white transition-colors">
                  <ZoomOut className="w-3 h-3" />
                </button>
                <span className="text-[10px] w-6 text-center">{zoom}x</span>
                <button onClick={() => setZoom(Math.min(10, zoom + 1))} className="hover:text-white transition-colors">
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>
            </div>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="relative h-20 bg-zinc-800/30 rounded-2xl overflow-hidden border border-white/5">
            <div 
              className="absolute inset-0 overflow-x-auto custom-scrollbar-horizontal"
              style={{ overflowY: 'hidden' }}
            >
              <div 
                ref={timelineRef}
                className="relative h-full min-w-full"
                style={{ width: `${timelineWidth}%` }}
                onMouseDown={(e) => {
                  if (e.button === 0) setIsDragging('seek');
                }}
              >
                {/* Grid Lines */}
                <div className="absolute inset-0 flex justify-between pointer-events-none opacity-10">
                  {Array.from({ length: Math.floor(duration * zoom) }).map((_, i) => (
                    <div key={i} className="w-px h-full bg-white" />
                  ))}
                </div>

                {/* Trim Range Background */}
                <div 
                  className="absolute h-full bg-emerald-500/10 border-x border-emerald-500/30"
                  style={{ 
                    left: `${(editState.startTime / duration) * 100}%`,
                    width: `${((editState.endTime - editState.startTime) / duration) * 100}%`
                  }}
                />
                
                {/* Start Handle */}
                <div 
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-20 group"
                  style={{ left: `${(editState.startTime / duration) * 100}%` }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsDragging('start');
                  }}
                >
                  <div className="absolute inset-y-2 left-1/2 w-1 bg-emerald-500 rounded-full group-hover:w-2 transition-all shadow-[0_0_10px_rgba(16,185,129,0.5)] flex items-center justify-center">
                    <GripVertical className="w-3 h-3 text-black opacity-0 group-hover:opacity-100" />
                  </div>
                </div>

                {/* End Handle */}
                <div 
                  className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-20 group"
                  style={{ left: `${(editState.endTime / duration) * 100}%` }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsDragging('end');
                  }}
                >
                  <div className="absolute inset-y-2 left-1/2 w-1 bg-emerald-500 rounded-full group-hover:w-2 transition-all shadow-[0_0_10px_rgba(16,185,129,0.5)] flex items-center justify-center">
                    <GripVertical className="w-3 h-3 text-black opacity-0 group-hover:opacity-100" />
                  </div>
                </div>

                {/* Current Time Indicator */}
                <div 
                  className="absolute h-full w-0.5 bg-white z-10 shadow-[0_0_10px_rgba(255,255,255,0.5)] pointer-events-none"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-6">
            <button 
              onClick={() => onSeek(Math.max(editState.startTime, currentTime - 5))}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button 
              onClick={onTogglePlay}
              className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shadow-xl"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
            </button>
            <button 
              onClick={() => onSeek(Math.min(editState.endTime, currentTime + 5))}
              className="p-2 text-zinc-400 hover:text-white transition-colors"
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Playback Settings */}
        <div className="grid grid-cols-2 gap-8 pt-6 border-t border-white/5">
          <div className="space-y-4">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Zap className="w-3.5 h-3.5" />
              Speed ({editState.playbackRate}x)
            </label>
            <input 
              type="range" 
              min="0.5" 
              max="2" 
              step="0.1"
              value={editState.playbackRate}
              onChange={(e) => onUpdate({ playbackRate: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Volume2 className="w-3.5 h-3.5" />
              Volume ({Math.round(editState.volume * 100)}%)
            </label>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01"
              value={editState.volume}
              onChange={(e) => onUpdate({ volume: parseFloat(e.target.value) })}
              className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>Mute</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        {/* Filter Presets */}
        <div className="space-y-4 pt-6 border-t border-white/5">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Filter Presets</span>
          <div className="grid grid-cols-4 gap-2">
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.name}
                onClick={() => applyPreset(preset)}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[10px] font-medium transition-all border border-transparent hover:border-white/10 active:scale-95"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Orientation & Adjustments */}
        <div className="grid grid-cols-2 gap-8 pt-6 border-t border-white/5">
          <div className="space-y-4">
            <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Orientation</span>
            <div className="flex flex-col gap-2">
              <button 
                onClick={rotate}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center gap-2 text-xs font-medium transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Rotate 90°
              </button>
              <button 
                onClick={toggleFlip}
                className="w-full py-2.5 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center gap-2 text-xs font-medium transition-colors"
              >
                <FlipHorizontal className="w-3.5 h-3.5" />
                Flip Horizontal
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Adjust</span>
              <button onClick={resetFilters} className="text-[10px] text-emerald-500 hover:underline">Reset</button>
            </div>
            <div className="space-y-3">
              {[
                { label: 'Brightness', icon: Sun, key: 'brightness' as const },
                { label: 'Contrast', icon: Contrast, key: 'contrast' as const },
                { label: 'Saturation', icon: Droplets, key: 'saturation' as const },
              ].map((adj) => (
                <div key={adj.key} className="space-y-1">
                  <div className="flex justify-between text-[9px] text-zinc-500">
                    <span className="flex items-center gap-1"><adj.icon className="w-2.5 h-2.5" /> {adj.label}</span>
                    <span>{editState[adj.key]}%</span>
                  </div>
                  <input 
                    type="range" min="0" max="200" value={editState[adj.key]}
                    onChange={(e) => onUpdate({ [adj.key]: parseInt(e.target.value) })}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-4 pt-4">
        <button 
          onClick={onClose}
          className="flex-1 py-4 bg-white/5 text-white font-bold rounded-2xl hover:bg-white/10 transition-colors"
        >
          Cancel
        </button>
        <button 
          onClick={onExport}
          disabled={isExporting}
          className="flex-[2] py-4 bg-emerald-500 text-black font-bold rounded-2xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(16,185,129,0.3)]"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              Export Video
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
};
