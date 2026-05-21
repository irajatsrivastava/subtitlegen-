import React from 'react';
import { Trash2, Plus, Play, Clock } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Subtitle {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
}

interface SubtitleGridProps {
  subtitles: Subtitle[];
  activeSubtitleId: number | null;
  onUpdate: (updatedSubtitles: Subtitle[]) => void;
  onSeek: (time: number) => void;
}

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
};

const parseTime = (timeStr: string): number | null => {
  const regex = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;
  const match = timeStr.match(regex);
  if (!match) return null;
  const [_, h, m, s, ms] = match;
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
};

interface TimeInputProps {
  label: string;
  value: number;
  onChange: (newTime: number) => void;
}

const TimeInput: React.FC<TimeInputProps> = ({ label, value, onChange }) => {
  const [displayValue, setDisplayValue] = React.useState(formatTime(value));

  React.useEffect(() => {
    setDisplayValue(formatTime(value));
  }, [value]);

  const handleBlur = () => {
    const time = parseTime(displayValue);
    if (time !== null) {
      onChange(time);
    } else {
      setDisplayValue(formatTime(value));
    }
  };

  return (
    <div className="flex items-center gap-2 bg-black/20 px-3 py-1.5 rounded-lg border border-white/5">
      <span className="text-[10px] uppercase font-bold text-zinc-500">{label}</span>
      <input 
        type="text"
        value={displayValue}
        onChange={(e) => setDisplayValue(e.target.value)}
        onBlur={handleBlur}
        className="bg-transparent border-none p-0 text-xs font-mono text-zinc-300 focus:ring-0 w-24"
      />
    </div>
  );
};

export const SubtitleGrid: React.FC<SubtitleGridProps> = ({ 
  subtitles, 
  activeSubtitleId, 
  onUpdate, 
  onSeek 
}) => {
  const handleTextChange = (id: number, text: string) => {
    onUpdate(subtitles.map(s => s.id === id ? { ...s, text } : s));
  };

  const handleTimeUpdate = (id: number, field: 'startTime' | 'endTime', time: number) => {
    onUpdate(subtitles.map(s => s.id === id ? { ...s, [field]: time } : s));
  };

  const handleDelete = (id: number) => {
    onUpdate(subtitles.filter(s => s.id !== id));
  };

  const handleAdd = () => {
    const lastSub = subtitles[subtitles.length - 1];
    const startTime = lastSub ? lastSub.endTime + 0.5 : 0;
    const newSub: Subtitle = {
      id: Date.now(),
      startTime,
      endTime: startTime + 2,
      text: 'New subtitle'
    };
    onUpdate([...subtitles, newSub]);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-hidden">
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-emerald-500" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Subtitle Editor</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              const srtString = subtitles.map((sub, index) => {
                return `${index + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${sub.text}\n`;
              }).join('\n');
              navigator.clipboard.writeText(srtString);
            }}
            className="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors px-2 py-1"
            title="Copy SRT"
          >
            COPY
          </button>
          <button
            onClick={() => onUpdate([])}
            className="text-[10px] font-bold text-red-500/50 hover:text-red-500 transition-colors px-2 py-1"
            title="Clear All"
          >
            CLEAR
          </button>
          <button
            onClick={handleAdd}
            className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors bg-emerald-500/10 px-2 py-1 rounded"
          >
            <Plus className="w-3 h-3" />
            ADD
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {subtitles.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 py-10">
            <p className="text-[10px] uppercase tracking-widest">No subtitles</p>
          </div>
        ) : (
          subtitles.map((sub) => (
            <div 
              key={sub.id}
              className={cn(
                "group p-2 rounded-lg border transition-all duration-200",
                activeSubtitleId === sub.id 
                  ? "bg-emerald-500/5 border-emerald-500/30" 
                  : "bg-zinc-900/50 border-white/5 hover:border-white/10"
              )}
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => onSeek(sub.startTime)}
                      className="p-1 rounded bg-white/5 text-zinc-500 hover:text-emerald-500 transition-all"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] font-mono text-zinc-500">{formatTime(sub.startTime).split(',')[0]}</span>
                      <span className="text-[9px] text-zinc-700">→</span>
                      <span className="text-[9px] font-mono text-zinc-500">{formatTime(sub.endTime).split(',')[0]}</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => handleDelete(sub.id)}
                    className="p-1 text-zinc-700 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <textarea
                  value={sub.text}
                  onChange={(e) => handleTextChange(sub.id, e.target.value)}
                  className="w-full bg-black/40 border border-white/5 rounded p-2 text-[11px] text-zinc-300 focus:border-emerald-500/30 focus:ring-0 resize-none transition-colors leading-relaxed"
                  rows={2}
                  placeholder="Subtitle text..."
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
