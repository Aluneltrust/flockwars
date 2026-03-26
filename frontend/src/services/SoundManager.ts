// ============================================================================
// SOUND MANAGER SERVICE
// ============================================================================

import { VOICE_LINES, VoiceCategory, PlatformVoiceCategory } from '../constants/voiceLines';

// ============================================================================
// MP3 FILE COUNTS - Update these as you add more audio files
// Files must be in: public/sounds/{category}/{category}_001.mp3, _002.mp3, etc.
// ============================================================================
const AUDIO_FILE_COUNTS: Record<string, number> = {
  miss: 36,
  hit: 26,
  enemyHit: 19,
  enemyMiss: 12,
  victory: 11,
  defeat: 8,
  startGame: 8,
  placeSheep: 10,
  lowHealth: 11,
  arenaLaugh: 10,
};

class SoundManager {
  private audioContext: AudioContext | null = null;
  public muted: boolean = false;
  private effectsVolume: number = 0.7;
  private voiceVolume: number = 0.8;
  private currentVoiceAudio: HTMLAudioElement | null = null;
  private currentSongAudio: HTMLAudioElement | null = null;
  private discoveredCounts: Record<string, number> = {};
  
  // Arena owner laugh tracking (every 5-8 misses)
  private missCounter: number = 0;
  private nextLaughAt: number = this.getRandomLaughThreshold();

  init(): this {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this;
  }

  private getRandomLaughThreshold(): number {
    return Math.floor(Math.random() * 4) + 5; // 5, 6, 7, or 8
  }

  resetPlatformMockCounter(): void {
    this.missCounter = 0;
    this.nextLaughAt = this.getRandomLaughThreshold();
  }

  // ========================================================================
  // MP3 PLAYBACK
  // ========================================================================

  /**
   * Play a random MP3 from /sounds/{category}/{category}_XXX.mp3
   * Returns true if file exists and plays, false if no files for this category
   */
  private playAudioFile(category: string, volume: number = this.voiceVolume): boolean {
    if (this.muted) return false;

    const fileCount = AUDIO_FILE_COUNTS[category] || 0;
    if (fileCount === 0) return false;

    const index = Math.floor(Math.random() * fileCount) + 1;
    const paddedIndex = String(index).padStart(3, '0');
    const path = `/sounds/${category}/${category}_${paddedIndex}.mp3`;

    // Stop any currently playing voice line
    if (this.currentVoiceAudio) {
      this.currentVoiceAudio.pause();
      this.currentVoiceAudio = null;
    }

    const audio = new Audio(path);
    audio.volume = volume;
    this.currentVoiceAudio = audio;

    audio.play().catch((err) => {
      console.warn(`Failed to play ${path}:`, err);
    });

    return true;
  }

  // ========================================================================
  // TTS FALLBACK
  // ========================================================================

  private speakTTS(text: string, options: { rate?: number; pitch?: number; volume?: number } | null = null): void {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options?.rate ?? 1.1;
    utterance.pitch = options?.pitch ?? 1.0;
    utterance.volume = options?.volume ?? this.voiceVolume;
    window.speechSynthesis.speak(utterance);
  }

  // ========================================================================
  // PUBLIC VOICE METHODS
  // ========================================================================

  getRandomLine(category: VoiceCategory | PlatformVoiceCategory): string | null {
    const lines = VOICE_LINES[category];
    if (!lines || lines.length === 0) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  speak(text: string, options: { rate?: number; pitch?: number; volume?: number } | null = null): void {
    if (this.muted) return;
    this.speakTTS(text, options);
  }

  /**
   * Play MP3 voice line, fall back to TTS if no MP3 files exist
   */
  speakRandom(category: VoiceCategory, options: { rate?: number; pitch?: number } | null = null): string | null {
    if (this.muted) return null;

    const line = this.getRandomLine(category);

    // Try MP3 first, fall back to TTS
    if (!this.playAudioFile(category)) {
      if (line) this.speakTTS(line, options);
    }

    return line;
  }

  /**
   * Platform voice - now plays arena owner greedy laughs
   * For 'platformMiss': Only laughs once every 5-8 misses
   * For 'platformHit' and 'platformGameEnd': Always plays
   */
  speakPlatform(category: PlatformVoiceCategory): string | null {
    if (this.muted) return null;

    // For misses, only laugh occasionally (every 5-8 misses)
    if (category === 'platformMiss') {
      this.missCounter++;
      if (this.missCounter < this.nextLaughAt) {
        return null;
      }
      this.missCounter = 0;
      this.nextLaughAt = this.getRandomLaughThreshold();
    }

    // Play arena owner laugh with delay, quiet volume
    setTimeout(() => {
      if (!this.playAudioFile('arenaLaugh', 0.25)) {
        // TTS fallback for platform lines
        const line = this.getRandomLine(category);
        if (line && window.speechSynthesis) {
          const utterance = new SpeechSynthesisUtterance(line);
          utterance.rate = 0.8;
          utterance.pitch = 0.6;
          utterance.volume = 0.25;
          window.speechSynthesis.speak(utterance);
        }
      }
    }, 1500);

    return null;
  }

  // ========================================================================
  // DYNAMIC FILE COUNT DISCOVERY
  // ========================================================================

  /**
   * Probe /sounds/{category}/{category}_001.mp3, _002.mp3, ... via HEAD requests
   * to discover how many files exist. Caches the result.
   */
  private async discoverFileCount(category: string): Promise<number> {
    if (this.discoveredCounts[category] !== undefined) {
      return this.discoveredCounts[category];
    }

    let count = 0;
    for (let i = 1; i <= 999; i++) {
      const paddedIndex = String(i).padStart(3, '0');
      const path = `/sounds/${category}/${category}_${paddedIndex}.mp3`;
      try {
        const res = await fetch(path, { method: 'HEAD' });
        if (!res.ok) break;
        count = i;
      } catch {
        break;
      }
    }

    this.discoveredCounts[category] = count;
    return count;
  }

  // ========================================================================
  // VICTORY / DEFEAT SONGS
  // ========================================================================

  /**
   * Play a random song from /sounds/victor/ or /sounds/loser/.
   * File count is auto-discovered (no hardcoded limit).
   */
  async playEndSong(won: boolean, volume: number = 0.5): Promise<void> {
    if (this.muted) return;

    this.stopEndSong();

    const category = won ? 'victor' : 'loser';
    const fileCount = await this.discoverFileCount(category);
    if (fileCount === 0) return;

    const index = Math.floor(Math.random() * fileCount) + 1;
    const paddedIndex = String(index).padStart(3, '0');
    const path = `/sounds/${category}/${category}_${paddedIndex}.mp3`;

    const audio = new Audio(path);
    audio.volume = volume;
    this.currentSongAudio = audio;

    audio.play().catch((err) => {
      console.warn(`Failed to play ${path}:`, err);
    });
  }

  /**
   * Stop the currently playing end song.
   */
  stopEndSong(): void {
    if (this.currentSongAudio) {
      this.currentSongAudio.pause();
      this.currentSongAudio.currentTime = 0;
      this.currentSongAudio = null;
    }
  }

  // ========================================================================
  // GENERATED SOUND EFFECTS (Web Audio API)
  // ========================================================================

  createExplosion(): void {
    if (this.muted || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  createSplash(): void {
    if (this.muted || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length) * 0.5;
    }
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    noise.connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  createCoinGain(): void {
    if (this.muted || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    [800, 1000, 1200].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.3, now + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }

  createCoinLose(): void {
    if (this.muted || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    [400, 300, 200].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.3, now + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted) {
      window.speechSynthesis?.cancel();
      if (this.currentVoiceAudio) {
        this.currentVoiceAudio.pause();
        this.currentVoiceAudio = null;
      }
      this.stopEndSong();
    }
    return this.muted;
  }
}

export const soundManager = new SoundManager();