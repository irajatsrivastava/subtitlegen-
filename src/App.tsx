/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  FileVideo, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Type,
  Sparkles,
  Settings2,
  Palette,
  Type as TypeIcon,
  Scissors,
  RotateCcw,
  RotateCw,
  Pause,
  Play,
  Sun,
  Contrast,
  Droplets,
  FlipHorizontal,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Volume2,
  VolumeX,
  Undo2,
  Redo2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { SubtitleGrid } from './components/SubtitleGrid';
import { VideoEditor } from './components/VideoEditor';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Subtitle {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
}

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

interface ProjectState {
  editState: VideoEditState;
  subtitles: Subtitle[];
}

// Initialize Gemini
const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Please ensure it is set in the environment.');
  }
  return new GoogleGenAI({ apiKey });
};

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
};

const parseSRT = (srt: string): Subtitle[] => {
  const lines = srt.split('\n');
  const subtitles: Subtitle[] = [];
  let currentSub: Partial<Subtitle> = {};

  const timeToSeconds = (timeStr: string) => {
    const parts = timeStr.trim().split(':');
    if (parts.length < 3) return 0;
    const [hours, minutes, secondsAndMs] = parts;
    const [seconds, ms] = secondsAndMs.split(',');
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + (parseInt(ms || '0') / 1000);
  };

  let state = 'ID'; // ID, TIME, TEXT
  for (let line of lines) {
    line = line.trim();
    if (state === 'ID' && /^\d+$/.test(line)) {
      currentSub.id = parseInt(line);
      state = 'TIME';
    } else if (state === 'TIME' && line.includes('-->')) {
      const [start, end] = line.split(' --> ');
      currentSub.startTime = timeToSeconds(start);
      currentSub.endTime = timeToSeconds(end);
      state = 'TEXT';
    } else if (state === 'TEXT') {
      if (line === '') {
        if (currentSub.text) {
          subtitles.push(currentSub as Subtitle);
        }
        currentSub = {};
        state = 'ID';
      } else {
        currentSub.text = currentSub.text ? `${currentSub.text}\n${line}` : line;
      }
    }
  }
  if (currentSub.text) {
    subtitles.push(currentSub as Subtitle);
  }
  return subtitles;
};

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
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

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [srtContent, setSrtContent] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Customization state
  const [fontSize, setFontSize] = useState(24);
  const [textColor, setTextColor] = useState('#ffffff');
  const [showSettings, setShowSettings] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Video Edit State
  const [editState, setEditState] = useState<VideoEditState>({
    startTime: 0,
    endTime: 0,
    playbackRate: 1,
    volume: 1,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    rotation: 0,
    flipped: false
  });

  // History state for Undo/Redo
  const [history, setHistory] = useState<ProjectState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isHistoryAction = useRef(false);

  // Initialize history when video is loaded
  useEffect(() => {
    if (videoUrl && history.length === 0) {
      const initialState: ProjectState = { editState, subtitles };
      setHistory([initialState]);
      setHistoryIndex(0);
    }
  }, [videoUrl]);

  // Function to push new state to history
  const pushToHistory = useCallback((newEditState: VideoEditState, newSubtitles: Subtitle[]) => {
    if (isHistoryAction.current) return;

    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      const lastState = newHistory[newHistory.length - 1];
      
      // Only push if different from last state
      if (lastState && 
          JSON.stringify(lastState.editState) === JSON.stringify(newEditState) && 
          JSON.stringify(lastState.subtitles) === JSON.stringify(newSubtitles)) {
        return prev;
      }
      
      const newState: ProjectState = { 
        editState: { ...newEditState }, 
        subtitles: [...newSubtitles] 
      };
      
      // Limit history size to 50
      const updatedHistory = [...newHistory, newState];
      if (updatedHistory.length > 50) {
        return updatedHistory.slice(1);
      }
      return updatedHistory;
    });
    setHistoryIndex(prev => {
      const nextIndex = prev + 1;
      return nextIndex > 49 ? 49 : nextIndex;
    });
  }, [historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      isHistoryAction.current = true;
      const prevState = history[historyIndex - 1];
      setEditState(prevState.editState);
      setSubtitles(prevState.subtitles);
      setHistoryIndex(prev => prev - 1);
      addToast('Undo', 'info');
      setTimeout(() => { isHistoryAction.current = false; }, 50);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isHistoryAction.current = true;
      const nextState = history[historyIndex + 1];
      setEditState(nextState.editState);
      setSubtitles(nextState.subtitles);
      setHistoryIndex(prev => prev + 1);
      addToast('Redo', 'info');
      setTimeout(() => { isHistoryAction.current = false; }, 50);
    }
  }, [history, historyIndex]);

  // Debounced effect to record history of editState changes
  useEffect(() => {
    const timer = setTimeout(() => {
      pushToHistory(editState, subtitles);
    }, 500);
    return () => clearTimeout(timer);
  }, [editState, subtitles, pushToHistory]);
  
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = editState.playbackRate;
      videoRef.current.volume = editState.volume;
    }
  }, [editState.playbackRate, editState.volume]);

  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'seek' | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);

  const handleTimelineInteraction = (e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    let newTime = percentage * duration;

    // Snapping logic
    const snapThreshold = 0.5 / zoom; // Adjust threshold based on zoom
    const snapPoints = [0, duration, editState.startTime, editState.endTime, ...subtitles.map(s => s.startTime), ...subtitles.map(s => s.endTime)];
    
    for (const point of snapPoints) {
      if (Math.abs(newTime - point) < snapThreshold) {
        newTime = point;
        break;
      }
    }

    if (isDragging === 'start') {
      setEditState(prev => ({ ...prev, startTime: Math.min(newTime, prev.endTime - 0.1) }));
    } else if (isDragging === 'end') {
      setEditState(prev => ({ ...prev, endTime: Math.max(newTime, prev.startTime + 0.1) }));
    } else if (isDragging === 'seek') {
      seekTo(newTime);
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in a textarea or input
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          seekTo(Math.max(editState.startTime, currentTime - 5));
          break;
        case 'arrowright':
          seekTo(Math.min(editState.endTime, currentTime + 5));
          break;
        case 'm':
          setEditState(prev => ({ ...prev, volume: prev.volume === 0 ? 1 : 0 }));
          break;
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case 'y':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            redo();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, duration, isPlaying, editState.startTime, editState.endTime, history, historyIndex, undo, redo]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile && selectedFile.type.startsWith('video/')) {
      setFile(selectedFile);
      setVideoUrl(URL.createObjectURL(selectedFile));
      setSrtContent(null);
      setSubtitles([]);
      setError(null);
      // Reset edit state when new file is uploaded
      setEditState(prev => ({ ...prev, startTime: 0, endTime: 0 }));
    } else {
      setError('Please upload a valid video file.');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'video/*': [] } as any,
    multiple: false
  } as any);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const generateSubtitles = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    setProgress('Preparing video for AI analysis...');

    try {
      const ai = getGenAI();
      let dataToTranslate: string;
      let mimeType: string;

      // Try to extract audio to reduce payload size (fixes "Rpc failed due to xhr error")
      try {
        setProgress('Extracting audio for faster transcription...');
        if (!ffmpegRef.current) {
          ffmpegRef.current = new FFmpeg();
          const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
          await ffmpegRef.current.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
          });
        }
        const ffmpeg = ffmpegRef.current;
        const inputName = 'input_transcribe_' + Date.now() + '_' + file.name;
        const outputName = 'audio_' + Date.now() + '.mp3';
        
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        // Extract audio to a low-bitrate MP3 to keep payload small
        await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-ab', '64k', '-ar', '16000', outputName]);
        
        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([(data as any).buffer], { type: 'audio/mp3' });
        
        dataToTranslate = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        mimeType = 'audio/mp3';
        
        // Cleanup
        try {
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
        } catch (e) {
          console.warn('Cleanup failed:', e);
        }
      } catch (ffmpegErr) {
        console.warn('FFmpeg audio extraction failed, falling back to full video:', ffmpegErr);
        // Fallback to full video if it's small enough, otherwise warn
        if (file.size > 20 * 1024 * 1024) {
          throw new Error('Video file is too large for direct transcription. Please try a smaller file or ensure your browser supports audio extraction.');
        }
        setProgress('Analyzing video content (this may take longer)...');
        dataToTranslate = await fileToBase64(file);
        mimeType = file.type;
      }
      
      setProgress('Analyzing content and transcribing speech...');
      
      const model = "gemini-3-flash-preview";
      const result = await ai.models.generateContent({
        model: model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: dataToTranslate
                }
              },
              {
                text: "Transcribe the speech in this audio/video and generate subtitles in SRT format. CRITICAL: Ensure the timestamps are extremely precise and sync perfectly with when each word or short phrase is spoken. Use a 'word-by-word' or 'phrase-by-phrase' approach to ensure the text appears exactly as it is heard. Break down the subtitles into very short, readable segments (max 3-5 words per segment) for maximum synchronization. Only return the SRT content, nothing else."
              }
            ]
          }
        ]
      });

      const text = result.text;
      if (text) {
        const cleanedSrt = text.replace(/```srt|```/g, '').trim();
        setSrtContent(cleanedSrt);
        setSubtitles(parseSRT(cleanedSrt));
        setProgress('Subtitles generated successfully!');
        addToast('Captions generated successfully!', 'success');
      } else {
        throw new Error('No subtitles were generated. Please try again.');
      }
    } catch (err: any) {
      console.error(err);
      let message = err.message || 'An error occurred while generating subtitles.';
      if (message.includes('xhr error') || message.includes('fetch')) {
        message = 'Network error: The file might be too large or the connection was interrupted. Try a shorter video.';
      }
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadSrt = () => {
    if (subtitles.length === 0) return;
    
    const srtString = subtitles.map((sub, index) => {
      return `${index + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${sub.text}\n`;
    }).join('\n');

    addToast('SRT copied to clipboard!', 'success');
    navigator.clipboard.writeText(srtString);

    const blob = new Blob([srtString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name.split('.')[0] || 'subtitles'}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);

      // Handle trimming loop
      if (time >= editState.endTime && editState.endTime > 0) {
        videoRef.current.currentTime = editState.startTime;
      }
      if (time < editState.startTime) {
        videoRef.current.currentTime = editState.startTime;
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const d = videoRef.current.duration;
      setDuration(d);
      setEditState(prev => ({ ...prev, endTime: d }));
    }
  };

  const seekTo = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
  };

  const activeSubtitle = subtitles.find(
    sub => currentTime >= sub.startTime && currentTime <= sub.endTime
  );

  const shiftSubtitles = (offset: number) => {
    setSubtitles(prev => prev.map(sub => ({
      ...sub,
      startTime: Math.max(0, sub.startTime + offset),
      endTime: Math.max(0, sub.endTime + offset)
    })));
  };

  const handleExport = async () => {
    if (!file) return;
    setIsExporting(true);
    addToast('Export started. This might take a moment...', 'info');
    
    try {
      if (!ffmpegRef.current) {
        ffmpegRef.current = new FFmpeg();
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpegRef.current.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }

      const ffmpeg = ffmpegRef.current;
      const inputName = 'input.mp4';
      const outputName = 'output.mp4';

      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Build complex filter string
      let filters = [];
      
      // 1. Rotation & Flip
      if (editState.rotation === 90) filters.push('transpose=1');
      if (editState.rotation === 180) filters.push('transpose=2,transpose=2');
      if (editState.rotation === 270) filters.push('transpose=2');
      if (editState.flipped) filters.push('hflip');

      // 2. Color Adjustments
      const b = (editState.brightness - 100) / 100;
      const c = editState.contrast / 100;
      const s = editState.saturation / 100;
      filters.push(`eq=brightness=${b}:contrast=${c}:saturation=${s}`);

      const vfilter = filters.join(',');

      const args = [
        '-ss', editState.startTime.toString(),
        '-to', editState.endTime.toString(),
        '-i', inputName,
      ];

      if (vfilter) {
        args.push('-vf', vfilter);
      }

      // Use libx264 for better compatibility if possible, or just copy if no filters
      if (vfilter) {
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy');
      } else {
        args.push('-c:v', 'copy', '-c:a', 'copy');
      }

      args.push(outputName);

      await ffmpeg.exec(args);

      const data = await ffmpeg.readFile(outputName);
      const url = URL.createObjectURL(new Blob([(data as any).buffer], { type: 'video/mp4' }));
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `edited-${file.name}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('Video exported successfully!', 'success');
    } catch (err) {
      console.error('Export failed:', err);
      setError('Export failed. This might be due to browser limitations (SharedArrayBuffer).');
      addToast('Export failed', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const [activeTab, setActiveTab] = useState<'edit' | 'captions' | 'filters' | 'adjust'>('edit');

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const videoFilter = `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturation}%)`;
  const videoTransform = `rotate(${editState.rotation}deg) scaleX(${editState.flipped ? -1 : 1})`;

  if (videoUrl) {
    return (
      <div className="h-screen bg-[#09090b] text-zinc-100 font-sans flex flex-col overflow-hidden">
        {/* Toast Container */}
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2">
          <AnimatePresence>
            {toasts.map(toast => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 20, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.9 }}
                className={cn(
                  "px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-3 min-w-[200px]",
                  toast.type === 'success' ? "bg-emerald-500 text-black border-emerald-400" :
                  toast.type === 'error' ? "bg-red-500 text-white border-red-400" :
                  "bg-zinc-800 text-white border-zinc-700"
                )}
              >
                {toast.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
                {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
                {toast.type === 'info' && <Loader2 className="w-4 h-4 animate-spin" />}
                {toast.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Workspace Header */}
        <header className="h-14 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-500 rounded flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-black" />
              </div>
              <span className="text-sm font-bold tracking-tight">SubGenie Pro</span>
            </div>
            <div className="h-4 w-px bg-zinc-800" />
            <span className="text-xs text-zinc-500 font-medium truncate max-w-[200px]">{file?.name}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-zinc-900 rounded-lg p-1 border border-white/5 mr-2">
              <button
                onClick={undo}
                disabled={historyIndex <= 0}
                className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={redo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => {
                setFile(null);
                setVideoUrl(null);
                setSrtContent(null);
                setSubtitles([]);
              }}
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Close Project
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="h-9 px-4 bg-emerald-500 text-black text-xs font-bold rounded-lg hover:bg-emerald-400 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Tools */}
          <aside className="w-16 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-4 gap-4 shrink-0">
            {[
              { id: 'edit', icon: Scissors, label: 'Edit' },
              { id: 'captions', icon: Type, label: 'Captions' },
              { id: 'filters', icon: Palette, label: 'Filters' },
              { id: 'adjust', icon: Settings2, label: 'Adjust' },
            ].map((tool) => (
              <button
                key={tool.id}
                onClick={() => setActiveTab(tool.id as any)}
                className={cn(
                  "w-10 h-10 rounded-xl flex flex-col items-center justify-center gap-1 transition-all",
                  activeTab === tool.id ? "bg-emerald-500/10 text-emerald-500" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                )}
              >
                <tool.icon className="w-5 h-5" />
                <span className="text-[8px] font-bold uppercase tracking-tighter">{tool.label}</span>
              </button>
            ))}
          </aside>

          {/* Main Content: Preview & Contextual Panel */}
          <main className="flex-1 flex overflow-hidden bg-black/20">
            {/* Preview Area */}
            <div className="flex-1 flex flex-col relative">
              <div className="flex-1 flex items-center justify-center p-8 relative">
                <div className="relative max-w-full max-h-full aspect-video bg-black shadow-2xl rounded-lg overflow-hidden border border-white/5 group/preview">
                  <video 
                    ref={videoRef}
                    src={videoUrl} 
                    className="w-full h-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    style={{ 
                      filter: videoFilter,
                      transform: videoTransform
                    }}
                  />
                  
                  {/* Quick Volume Control Overlay */}
                  <div className="absolute top-4 right-4 opacity-0 group-hover/preview:opacity-100 transition-opacity flex flex-col items-center gap-2 bg-black/50 backdrop-blur-md p-2 rounded-lg">
                    <button 
                      onClick={() => setEditState(prev => ({ ...prev, volume: prev.volume === 0 ? 1 : 0 }))}
                      className="text-white hover:text-emerald-500 transition-colors"
                    >
                      {editState.volume === 0 ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <div className="h-20 w-1 bg-zinc-800 rounded-full relative overflow-hidden">
                      <div 
                        className="absolute bottom-0 left-0 right-0 bg-emerald-500 transition-all"
                        style={{ height: `${editState.volume * 100}%` }}
                      />
                      <input 
                        type="range" min="0" max="1" step="0.01" value={editState.volume}
                        onChange={(e) => setEditState(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                        className="absolute inset-0 opacity-0 cursor-pointer [writing-mode:bt-lr] appearance-slider-vertical"
                      />
                    </div>
                  </div>

                  {/* Subtitle Overlay */}
                  {activeSubtitle && (
                    <div 
                      className="absolute bottom-8 left-0 right-0 flex justify-center pointer-events-none px-4 text-center"
                      style={{ 
                        fontSize: `${fontSize}px`, 
                        color: textColor,
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8)'
                      }}
                    >
                      <span className="bg-black/40 backdrop-blur-sm px-3 py-1 rounded-lg">
                        {activeSubtitle.text}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Playback Controls */}
              <div className="h-16 border-t border-zinc-800 bg-zinc-950 flex items-center justify-center gap-8 shrink-0">
                <button 
                  onClick={() => seekTo(Math.max(editState.startTime, currentTime - 5))}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="Backward 5s (Left Arrow)"
                >
                  <RotateCcw className="w-5 h-5" />
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
                  title="Play/Pause (Space)"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>
                <button 
                  onClick={() => seekTo(Math.min(editState.endTime, currentTime + 5))}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="Forward 5s (Right Arrow)"
                >
                  <RotateCw className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setEditState(prev => ({ ...prev, volume: prev.volume === 0 ? 1 : 0 }))}
                  className="text-zinc-500 hover:text-white transition-colors"
                  title="Mute/Unmute (M)"
                >
                  {editState.volume === 0 ? <VolumeX className="w-5 h-5 text-red-500" /> : <Volume2 className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Right Panel: Contextual Tools */}
            <aside className="w-80 border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">{activeTab}</h3>
                <div className="flex items-center gap-2">
                  {(activeTab === 'adjust' || activeTab === 'filters') && (
                    <button 
                      onClick={() => setEditState(prev => ({ 
                        ...prev, 
                        brightness: 100, 
                        contrast: 100, 
                        saturation: 100,
                        rotation: 0,
                        flipped: false,
                        playbackRate: 1,
                        volume: 1
                      }))}
                      className="text-[10px] text-zinc-500 hover:text-white transition-colors uppercase font-bold"
                    >
                      Reset
                    </button>
                  )}
                  {activeTab === 'captions' && !srtContent && (
                    <button 
                      onClick={generateSubtitles}
                      disabled={isProcessing}
                      className="text-[10px] bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {isProcessing ? 'Generating...' : 'Auto-Caption'}
                    </button>
                  )}
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                {activeTab === 'edit' && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Trim Boundaries</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-zinc-900 p-2 rounded-lg border border-white/5">
                          <span className="text-[9px] text-zinc-500 block">START</span>
                          <span className="text-xs font-mono">{formatTime(editState.startTime)}</span>
                        </div>
                        <div className="bg-zinc-900 p-2 rounded-lg border border-white/5">
                          <span className="text-[9px] text-zinc-500 block">END</span>
                          <span className="text-xs font-mono">{formatTime(editState.endTime)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Orientation</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => setEditState(prev => ({ ...prev, rotation: (prev.rotation + 90) % 360 }))}
                          className="py-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-[10px] font-medium border border-white/5 flex items-center justify-center gap-2"
                        >
                          <RotateCw className="w-3 h-3" /> Rotate
                        </button>
                        <button 
                          onClick={() => setEditState(prev => ({ ...prev, flipped: !prev.flipped }))}
                          className="py-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-[10px] font-medium border border-white/5 flex items-center justify-center gap-2"
                        >
                          <FlipHorizontal className="w-3 h-3" /> Flip
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase">Playback</label>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>Speed</span>
                            <span>{editState.playbackRate}x</span>
                          </div>
                          <input 
                            type="range" min="0.5" max="2" step="0.1" value={editState.playbackRate}
                            onChange={(e) => setEditState(prev => ({ ...prev, playbackRate: parseFloat(e.target.value) }))}
                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-[10px] text-zinc-500">
                            <span>Volume</span>
                            <span>{Math.round(editState.volume * 100)}%</span>
                          </div>
                          <input 
                            type="range" min="0" max="1" step="0.01" value={editState.volume}
                            onChange={(e) => setEditState(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'captions' && (
                  <div className="h-full flex flex-col">
                    {srtContent ? (
                      <SubtitleGrid 
                        subtitles={subtitles}
                        activeSubtitleId={activeSubtitle?.id || null}
                        onUpdate={setSubtitles}
                        onSeek={seekTo}
                      />
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                        <Type className="w-12 h-12 text-zinc-800 mb-4" />
                        <p className="text-sm text-zinc-500 mb-4">No captions generated yet.</p>
                        <button 
                          onClick={generateSubtitles}
                          disabled={isProcessing}
                          className="w-full py-3 bg-emerald-500 text-black text-xs font-bold rounded-xl hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {isProcessing ? 'Generating...' : 'Auto-Generate Captions'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'filters' && (
                  <div className="grid grid-cols-2 gap-2">
                    {FILTER_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => setEditState(prev => ({ 
                          ...prev, 
                          brightness: preset.brightness, 
                          contrast: preset.contrast, 
                          saturation: preset.saturation 
                        }))}
                        className="p-3 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-[10px] font-medium border border-white/5 text-center transition-all active:scale-95"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                )}

                {activeTab === 'adjust' && (
                  <div className="space-y-6">
                    {[
                      { label: 'Brightness', icon: Sun, key: 'brightness' as const },
                      { label: 'Contrast', icon: Contrast, key: 'contrast' as const },
                      { label: 'Saturation', icon: Droplets, key: 'saturation' as const },
                    ].map((adj) => (
                      <div key={adj.key} className="space-y-2">
                        <div className="flex justify-between text-[10px] text-zinc-500">
                          <span className="flex items-center gap-1"><adj.icon className="w-3 h-3" /> {adj.label}</span>
                          <span>{editState[adj.key]}%</span>
                        </div>
                        <input 
                          type="range" min="0" max="200" value={editState[adj.key]}
                          onChange={(e) => setEditState(prev => ({ ...prev, [adj.key]: parseInt(e.target.value) }))}
                          className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </main>
        </div>

        {/* Bottom Timeline */}
        <footer className="h-48 border-t border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
          <div className="h-8 border-b border-zinc-800 flex items-center justify-between px-4">
            <div className="flex items-center gap-4">
              <span className="text-[10px] font-mono text-zinc-500">{formatTime(currentTime)} / {formatTime(duration)}</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setZoom(Math.max(1, zoom - 1))} className="text-zinc-500 hover:text-white"><ZoomOut className="w-3 h-3" /></button>
                <span className="text-[9px] text-zinc-500 w-4 text-center">{zoom}x</span>
                <button onClick={() => setZoom(Math.min(10, zoom + 1))} className="text-zinc-500 hover:text-white"><ZoomIn className="w-3 h-3" /></button>
              </div>
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden">
             <div className="absolute inset-0 overflow-x-auto custom-scrollbar-horizontal">
                <div 
                  className="relative h-full"
                  style={{ width: `${100 * zoom}%` }}
                >
                  {/* Timeline Ruler */}
                  <div className="absolute top-0 left-0 right-0 h-4 flex justify-between px-2 opacity-20 pointer-events-none">
                    {Array.from({ length: Math.floor(duration * zoom) }).map((_, i) => (
                      <div key={i} className="w-px h-full bg-white" />
                    ))}
                  </div>

                  {/* Trim Range */}
                  <div 
                    className="absolute top-4 bottom-4 bg-emerald-500/10 border-x border-emerald-500/30 z-10"
                    style={{ 
                      left: `${(editState.startTime / duration) * 100}%`,
                      width: `${((editState.endTime - editState.startTime) / duration) * 100}%`
                    }}
                  >
                    {/* Handles */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 cursor-ew-resize"
                      onMouseDown={() => setIsDragging('start')}
                    />
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-1 bg-emerald-500 cursor-ew-resize"
                      onMouseDown={() => setIsDragging('end')}
                    />
                  </div>

                  {/* Caption Track */}
                  {srtContent && (
                    <div className="absolute bottom-4 left-0 right-0 h-6 bg-white/5 flex items-center">
                      {subtitles.map((sub) => (
                        <div
                          key={sub.id}
                          className={cn(
                            "absolute h-4 rounded-sm text-[8px] flex items-center px-1 truncate border border-white/10",
                            activeSubtitle?.id === sub.id ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-400"
                          )}
                          style={{
                            left: `${(sub.startTime / duration) * 100}%`,
                            width: `${((sub.endTime - sub.startTime) / duration) * 100}%`
                          }}
                        >
                          {sub.text}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Playhead */}
                  <div 
                    className="absolute top-0 bottom-0 w-px bg-white z-20 shadow-[0_0_10px_rgba(255,255,255,0.5)] pointer-events-none"
                    style={{ left: `${(currentTime / duration) * 100}%` }}
                  >
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
                  </div>

                  {/* Click Area */}
                  <div 
                    className="absolute inset-0 z-0 cursor-crosshair"
                    onMouseDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const percentage = x / rect.width;
                      seekTo(percentage * duration);
                      setIsDragging('seek');
                    }}
                  />
                </div>
             </div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100 font-sans selection:bg-emerald-500/30 overflow-x-hidden">
      {/* Toast Container */}
      <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.9 }}
              className={cn(
                "px-4 py-3 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-3 min-w-[200px]",
                toast.type === 'success' ? "bg-emerald-500 text-black border-emerald-400" :
                toast.type === 'error' ? "bg-red-500 text-white border-red-400" :
                "bg-zinc-800 text-white border-zinc-700"
              )}
            >
              {toast.type === 'success' && <CheckCircle2 className="w-4 h-4" />}
              {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
              {toast.type === 'info' && <Loader2 className="w-4 h-4 animate-spin" />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <header className="border-b border-white/5 bg-black/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-black" />
            </div>
            <span className="text-xl font-semibold tracking-tight">SubGenie</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-400">
            <a href="#" className="hover:text-white transition-colors">How it works</a>
            <a href="#" className="hover:text-white transition-colors">Pricing</a>
            <a href="#" className="hover:text-white transition-colors">API</a>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 md:py-20">
        <div className="text-center mb-16">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-widest mb-6"
          >
            <Sparkles className="w-3 h-3" />
            AI-Powered Video Studio
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent"
          >
            Create Content <br /> That Speaks.
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-zinc-400 max-w-2xl mx-auto leading-relaxed"
          >
            The all-in-one studio for creators. Generate precise captions, apply cinematic filters, and edit your videos with AI-driven precision.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left Column: Upload & Preview */}
          <div className="space-y-6">
            <div 
              {...getRootProps()} 
              className={cn(
                "relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 overflow-hidden aspect-video flex items-center justify-center bg-white/5",
                isDragActive ? "border-emerald-500 bg-emerald-500/5" : "border-white/10 hover:border-white/20",
                file ? "border-solid" : ""
              )}
            >
              <input {...getInputProps()} />
              
              {videoUrl ? (
                <div className="relative w-full h-full group/video">
                  <video 
                    ref={videoRef}
                    src={videoUrl} 
                    className="w-full h-full object-contain transition-transform duration-300"
                    controls
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    style={{ 
                      filter: videoFilter,
                      transform: videoTransform
                    }}
                  />
                  
                  {/* Subtitle Overlay */}
                  {activeSubtitle && (
                    <div 
                      className="absolute bottom-12 left-0 right-0 flex justify-center pointer-events-none px-4 text-center"
                      style={{ 
                        fontSize: `${fontSize}px`, 
                        color: textColor,
                        textShadow: '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8), -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8)'
                      }}
                    >
                      <span className="bg-black/40 backdrop-blur-sm px-3 py-1 rounded-lg">
                        {activeSubtitle.text}
                      </span>
                    </div>
                  )}

                  {/* Settings Toggle */}
                  {srtContent && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowSettings(!showSettings);
                      }}
                      className="absolute top-4 left-4 p-2 bg-black/50 backdrop-blur-md rounded-full hover:bg-white/10 transition-all opacity-0 group-hover/video:opacity-100"
                    >
                      <Settings2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Upload className="w-8 h-8 text-zinc-400" />
                  </div>
                  <p className="text-lg font-medium mb-1">Drop your video here</p>
                  <p className="text-sm text-zinc-500">MP4, MOV, AVI up to 50MB</p>
                </div>
              )}

              {file && !isProcessing && (
                <div className="absolute top-4 right-4">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setVideoUrl(null);
                      setSrtContent(null);
                      setSubtitles([]);
                    }}
                    className="p-2 bg-black/50 backdrop-blur-md rounded-full hover:bg-red-500/20 hover:text-red-500 transition-all"
                  >
                    <AlertCircle className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            {/* Subtitle Settings Panel */}
            <AnimatePresence>
              {showSettings && srtContent && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-6 overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-emerald-500" />
                      Subtitle Customization
                    </h4>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <TypeIcon className="w-3 h-3" />
                        Font Size ({fontSize}px)
                      </label>
                      <input 
                        type="range" 
                        min="12" 
                        max="64" 
                        value={fontSize}
                        onChange={(e) => setFontSize(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    
                    <div className="space-y-3">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <Palette className="w-3 h-3" />
                        Text Color
                      </label>
                      <div className="flex items-center gap-3">
                        <input 
                          type="color" 
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="w-10 h-10 rounded-lg bg-transparent border-none cursor-pointer"
                        />
                        <span className="text-sm font-mono text-zinc-400 uppercase">{textColor}</span>
                      </div>
                    </div>

                    <div className="space-y-3 md:col-span-2 pt-4 border-t border-white/5">
                      <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                        <Sparkles className="w-3 h-3" />
                        Sync Correction (Shift All)
                      </label>
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => shiftSubtitles(-0.1)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium transition-colors"
                        >
                          -0.1s
                        </button>
                        <button 
                          onClick={() => shiftSubtitles(-0.5)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium transition-colors"
                        >
                          -0.5s
                        </button>
                        <div className="flex-1 text-center text-xs text-zinc-500 italic">
                          Adjust all subtitle timings at once
                        </div>
                        <button 
                          onClick={() => shiftSubtitles(0.5)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium transition-colors"
                        >
                          +0.5s
                        </button>
                        <button 
                          onClick={() => shiftSubtitles(0.1)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium transition-colors"
                        >
                          +0.1s
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  disabled={!file || isProcessing}
                  onClick={generateSubtitles}
                  className={cn(
                    "py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                    !file || isProcessing 
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                      : "bg-emerald-500 text-black hover:bg-emerald-400 active:scale-[0.98]"
                  )}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Type className="w-5 h-5" />
                      Generate Subtitles
                    </>
                  )}
                </button>

                <button
                  disabled={!file || isProcessing}
                  onClick={() => setShowEditor(true)}
                  className={cn(
                    "py-4 px-6 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all duration-300",
                    !file || isProcessing 
                      ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                      : "bg-white/10 text-white hover:bg-white/20 active:scale-[0.98]"
                  )}
                >
                  <Scissors className="w-5 h-5" />
                  Video Edit
                </button>
              </div>

              {isProcessing && (
                <motion.p 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center text-sm text-emerald-500 font-medium"
                >
                  {progress}
                </motion.p>
              )}
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:sticky lg:top-24 h-[600px]">
            <AnimatePresence mode="wait">
              {srtContent ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="h-full flex flex-col"
                >
                  <SubtitleGrid 
                    subtitles={subtitles}
                    activeSubtitleId={activeSubtitle?.id || null}
                    onUpdate={setSubtitles}
                    onSeek={seekTo}
                  />
                  
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={downloadSrt}
                      className="flex items-center gap-2 text-sm font-medium text-emerald-500 hover:text-emerald-400 transition-colors bg-emerald-500/10 px-4 py-2 rounded-xl"
                    >
                      <Download className="w-4 h-4" />
                      Download Final .srt
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full rounded-3xl border border-white/5 bg-white/[0.02] flex flex-col items-center justify-center text-center p-12"
                >
                  <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-6">
                    <FileVideo className="w-10 h-10 text-zinc-600" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2 text-zinc-300">No subtitles yet</h3>
                  <p className="text-zinc-500 max-w-xs">
                    Upload a video and click generate to see the magic happen.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
              </motion.div>
            )}
          </div>
        </div>

        {/* Features Section */}
        <div className="mt-32 grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "AI Powered",
              desc: "Powered by Gemini 3 Flash for lightning fast transcription and high accuracy.",
              icon: Sparkles
            },
            {
              title: "SRT Export",
              desc: "Download your subtitles in standard SRT format compatible with all video players.",
              icon: Download
            },
            {
              title: "Secure & Private",
              desc: "Your videos are processed securely and never stored on our servers.",
              icon: CheckCircle2
            }
          ].map((feature, i) => (
            <div key={i} className="p-8 rounded-3xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6">
                <feature.icon className="w-6 h-6 text-emerald-500" />
              </div>
              <h4 className="text-lg font-semibold mb-2">{feature.title}</h4>
              <p className="text-zinc-400 text-sm leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Video Editor Modal */}
      <AnimatePresence>
        {showEditor && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditor(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <VideoEditor 
              duration={duration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              editState={editState}
              onUpdate={(updates) => setEditState(prev => ({ ...prev, ...updates }))}
              onClose={() => setShowEditor(false)}
              onSeek={seekTo}
              onTogglePlay={togglePlay}
              onExport={handleExport}
              isExporting={isExporting}
            />
          </div>
        )}
      </AnimatePresence>

      <footer className="border-t border-white/5 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-zinc-500">
          <p>© 2026 SubGenie. Built with Google AI Studio.</p>
          <div className="flex items-center gap-8">
            <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
