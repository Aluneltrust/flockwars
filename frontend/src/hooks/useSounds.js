// ============================================================================
// HERDSWACKER - Sound System
// ============================================================================
// Handles all game audio: effects, MP3 voice lines, and arena owner laughs
// Falls back to browser TTS when MP3 files are not available
// ============================================================================

import { useEffect, useCallback, useState } from 'react';

// ============================================================================
// MP3 FILE COUNTS - Update these as you add more audio files
// ============================================================================
// Files must be in: public/sounds/{category}/{category}_001.mp3, _002.mp3, etc.

const AUDIO_FILE_COUNTS = {
  miss: 35,
  hit: 26,
  enemyHit: 18,
  enemyMiss: 9,
  victory: 6,
  defeat: 5,
  startGame: 8,
  placeSheep: 10,
  lowHealth: 0,
  arenaLaugh: 4,
  sheep_baa: 5,
};

// Game music counts — files in public/sounds/game_music/
// Single tracks: lobby.mp3, battle.mp3, menu.mp3
// Multi-track folders: victor/victor_001.mp3, loser/loser_001.mp3, etc.
const GAME_MUSIC_COUNTS = {
  victor: 2,
  loser: 3,
};

// ============================================================================
// TTS FALLBACK VOICE LINES (used when no MP3 files exist for a category)
// ============================================================================

const VOICE_LINES = {
  miss: [
    "I hit my leg!", "Damnit, I'm losing coins!", "My back! I'm too old for this!",
    "Missed again? I need glasses!", "The sheep are laughing at me!",
    "I scratched my rod!", "Son of a shepherd!", "What the flock was that?!",
    "Satoshi would be disappointed!", "That's coming out of my UTXO!",
    "My private key is crying!", "Even Craig Wright could hit that!",
    "Hash rate: ZERO!", "404: Sheep not found!", "I'm bleeding sats over here!",
    "This is worse than a 51% attack!", "Sweet mother of Merkle trees!",
    "I'd rather lose my seed phrase!",
  ],
  hit: [
    "GOTCHA!", "Wool you look at that!", "Baaa-bye sheep!",
    "Mutton for dinner tonight!", "Ka-ching! Show me the money!",
    "Satoshi would be proud!", "Satoshi ain't vegan!",
    "That's on-chain forever baby!", "Block confirmed! Sheep destroyed!",
    "Proof of WHACK!", "Immutable damage!", "Get rekt, woolly!",
    "Blockchain doesn't lie: you're toast!", "HODL this, lamb chop!",
    "Signed, sealed, DESTROYED!", "Zero confirmation... zero sheep!",
  ],
  enemyHit: [
    "NOOO! Not Fluffy!", "My precious wool!", "They got Bartholomew!",
    "That sheep had a family!", "I'll never financially recover from this!",
    "You absolute donkey!", "Lucky shot, butthead!", "My wallet is bleeding!",
    "May your transactions never confirm!", "Your mother was a goat herder!",
    "I'll fork your whole family tree!", "Curse your merkle roots!",
  ],
  enemyMiss: [
    "Ha! Missed me!", "Too slow!", "My sheep have plot armor!",
    "Can't touch this!", "Your aim is worse than mine!",
    "Is that your best shot, farm boy?!", "My grandma swings harder!",
    "Your rod must be made of spaghetti!", "Error 404: Skill not found!",
  ],
  lowHealth: [
    "This is fine... everything is fine...", "I'm in danger!",
    "Mayday! Mayday!", "Someone call a shepherd!",
    "We're running out of sheep!", "Code red! Code red!",
  ],
  victory: [
    "I am the sheep whacker champion!", "Who's baaaa-d now?!",
    "Winner winner, mutton dinner!", "Your sheep got REKT, son!",
    "Proof of VICTORY!", "Thanks for the sats, sucker!",
  ],
  defeat: [
    "My sheep... my beautiful sheep...", "I blame lag!",
    "I got rekt harder than Mt. Gox!", "Satoshi has abandoned me...",
    "This is the darkest timeline...",
  ],
  placeSheep: [
    "Go there, little one!", "Hide well, my child!",
    "Stay safe!", "Don't move... much!",
    "Perfect hiding spot!", "They'll never find you there! Hopefully!",
  ],
  startGame: [
    "Let's get ready to rumble!", "It's whackin' time!",
    "Prepare for sheepocalypse!", "Let the sheep slaughter BEGIN!",
  ],
};

// ============================================================================
// SOUND MANAGER CLASS
// ============================================================================

class SoundManager {
  constructor() {
    this.sounds = {};
    this.music = null;
    this.musicVolume = 0.12;
    this.effectsVolume = 0.45;
    this.voiceVolume = 0.9;
    this.muted = false;
    this.musicEnabled = true;
    this.speechSynthesis = window.speechSynthesis;
    this.audioContext = null;
    this.currentVoiceAudio = null;

    // Arena owner laugh tracking (every 5-8 misses)
    this.missCounter = 0;
    this.nextLaughAt = this._getRandomLaughThreshold();
  }

  _getRandomLaughThreshold() {
    return Math.floor(Math.random() * 4) + 5; // 5, 6, 7, or 8
  }

  resetArenaLaughCounter() {
    this.missCounter = 0;
    this.nextLaughAt = this._getRandomLaughThreshold();
  }

  // Initialize audio context (must be called after user interaction)
  init() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this;
  }

  // ========================================================================
  // MP3 PLAYBACK
  // ========================================================================

  playVoiceLine(category, volume = this.voiceVolume) {
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

  speak(text, options = {}) {
    if (this.muted || !this.speechSynthesis) return;
    this.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.1;
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || this.voiceVolume;

    const voices = this.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v =>
      v.name.includes('Daniel') ||
      v.name.includes('Alex') ||
      v.name.includes('Fred') ||
      v.lang.startsWith('en')
    );
    if (preferredVoice) utterance.voice = preferredVoice;

    this.speechSynthesis.speak(utterance);
  }

  getRandomLine(category) {
    const lines = VOICE_LINES[category];
    if (!lines || lines.length === 0) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  speakRandom(category, options = {}) {
    if (this.muted) return;
    if (!this.playVoiceLine(category)) {
      const line = this.getRandomLine(category);
      if (line) this.speak(line, options);
    }
  }

  playArenaLaugh() {
    if (this.muted) return;

    this.missCounter++;
    if (this.missCounter < this.nextLaughAt) return;

    this.missCounter = 0;
    this.nextLaughAt = this._getRandomLaughThreshold();

    setTimeout(() => {
      this.playVoiceLine('arenaLaugh', 0.12);
    }, 1500);
  }

  // ========================================================================
  // GENERATED SOUND EFFECTS (Web Audio API)
  // ========================================================================

  generateSound(type) {
    if (this.muted || !this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    switch (type) {
      case 'whoosh': this.createWhoosh(ctx, now); break;
      case 'explosion': this.createExplosion(ctx, now); break;
      case 'splash': this.createSplash(ctx, now); break;
      case 'coin_gain': this.createCoinGain(ctx, now); break;
      case 'coin_lose': this.createCoinLose(ctx, now); break;
      case 'click': this.createClick(ctx, now); break;
      case 'sheep_baa': this.createBaa(ctx, now); break;
    }
  }

  createWhoosh(ctx, now) {
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(200, now + 0.3);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  createExplosion(ctx, now) {
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

  createSplash(ctx, now) {
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / data.length) * 0.5;
    }
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(this.effectsVolume * 0.6, now);
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);
  }

  createCoinGain(ctx, now) {
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

  createCoinLose(ctx, now) {
    [600, 400, 300].forEach((freq, i) => {
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

  createClick(ctx, now) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(this.effectsVolume * 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  createBaa(ctx, now) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(350, now + 0.1);
    osc.frequency.linearRampToValueAtTime(280, now + 0.3);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.3, now + 0.05);
    gain.gain.linearRampToValueAtTime(this.effectsVolume * 0.2, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  // ========================================================================
  // MUSIC
  // ========================================================================

  playMenuMusic() {
      if (this.muted) return;
      this.stopMusic();
      const audio = new Audio('/sounds/game_music/menu.mp3');
      audio.loop = true;
      audio.volume = this.musicVolume;
      this.music = audio;
      this.currentMusicTrack = 'menu';
      audio.play().catch(() => {});
  }

  playLobbyMusic() {
      if (this.muted) return;
      if (this.music && this.currentMusicTrack === 'lobby') return;
      this.stopMusic();
      const audio = new Audio('/sounds/game_music/lobby.mp3');
      audio.loop = true;
      audio.volume = this.musicVolume;
      this.music = audio;
      this.currentMusicTrack = 'lobby';
      audio.play().catch(() => {});
  }

  playBattleMusic() {
      if (this.muted) return;
      this.stopMusic();
      const audio = new Audio('/sounds/game_music/battle.mp3');
      audio.loop = true;
      audio.volume = this.musicVolume;
      this.music = audio;
      this.currentMusicTrack = 'battle';
      audio.play().catch(() => {});
  }

  stopMusic() {
      if (this.music) {
        this.music.pause();
        this.music.currentTime = 0;
        this.music = null;
      }
  }

  playVictoryMusic() {
      if (this.muted) return;
      this.stopMusic();
      const count = GAME_MUSIC_COUNTS.victor || 0;
      if (count === 0) return;
      const index = Math.floor(Math.random() * count) + 1;
      const padded = String(index).padStart(3, '0');
      const audio = new Audio(`/sounds/game_music/victor/victor_${padded}.mp3`);
      audio.volume = this.musicVolume * 3;
      this.music = audio;
      this.currentMusicTrack = 'victory';
      audio.play().catch(() => {});
  }

  playDefeatMusic() {
      if (this.muted) return;
      this.stopMusic();
      const count = GAME_MUSIC_COUNTS.loser || 0;
      if (count === 0) return;
      const index = Math.floor(Math.random() * count) + 1;
      const padded = String(index).padStart(3, '0');
      const audio = new Audio(`/sounds/game_music/loser/loser_${padded}.mp3`);
      audio.volume = this.musicVolume * 3;
      this.music = audio;
      this.currentMusicTrack = 'defeat';
      audio.play().catch(() => {});
  }

  resumeMusic() {
      if (!this.currentMusicTrack) return;
      if (this.currentMusicTrack === 'menu') this.playMenuMusic();
      else if (this.currentMusicTrack === 'battle') this.playBattleMusic();
      else if (this.currentMusicTrack === 'lobby') this.playLobbyMusic();
  }

  // ========================================================================
  // MUTE
  // ========================================================================

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.stopMusic();
      this.speechSynthesis?.cancel();
      if (this.currentVoiceAudio) {
        this.currentVoiceAudio.pause();
        this.currentVoiceAudio = null;
      }
    }
    return this.muted;
  }

  setMusicVolume(vol) { this.musicVolume = vol; if (this.music) this.music.volume = vol; }
  setEffectsVolume(vol) { this.effectsVolume = vol; }
  setVoiceVolume(vol) { this.voiceVolume = vol; }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const soundManager = new SoundManager();

// ============================================================================
// REACT HOOK
// ============================================================================

export function useGameSounds() {
  const [isMuted, setIsMuted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const initSound = useCallback(() => {
    if (!isInitialized) {
      soundManager.init();
      setIsInitialized(true);
    }
  }, [isInitialized]);

  const playMiss = useCallback(() => {
    initSound();
    soundManager.generateSound('splash');
    soundManager.speakRandom('miss', { rate: 1.2, pitch: 1.1 });
    soundManager.playArenaLaugh();
  }, [initSound]);

  const playHit = useCallback(() => {
    initSound();
    soundManager.generateSound('explosion');
    soundManager.generateSound('coin_gain');
    soundManager.speakRandom('hit', { rate: 1.1, pitch: 1.2 });
  }, [initSound]);

  const playEnemyHit = useCallback(() => {
    initSound();
    if (Math.random() > 0.5) {
      soundManager.generateSound('explosion');
      soundManager.generateSound('coin_lose');
      soundManager.speakRandom('enemyHit', { rate: 1.0, pitch: 0.9 });
    } else {
      soundManager.generateSound('explosion');
      soundManager.generateSound('coin_lose');
    }
  }, [initSound]);

  const playEnemyMiss = useCallback(() => {
    initSound();
    if (Math.random() > 0.5) {
      soundManager.generateSound('splash');
      soundManager.speakRandom('enemyMiss', { rate: 1.2, pitch: 1.1 });
    } else {
      soundManager.generateSound('splash');
    }
  }, [initSound]);

  const playWhoosh = useCallback(() => {
    initSound();
    soundManager.generateSound('whoosh');
  }, [initSound]);

  const playClick = useCallback(() => {
    initSound();
    soundManager.generateSound('click');
  }, [initSound]);

  const playSheepPlace = useCallback(() => {
    initSound();
    if (Math.random() < 0.7) {
      soundManager.speakRandom('placeSheep', { rate: 1.0 });
    } else {
      soundManager.playVoiceLine('sheep_baa');
    }
  }, [initSound]);

  const playStartGame = useCallback(() => {
    initSound();
    soundManager.speakRandom('startGame', { rate: 1.0, pitch: 1.1 });
    soundManager.resetArenaLaughCounter();
  }, [initSound]);

  const playVictory = useCallback(() => {
    initSound();
    soundManager.generateSound('coin_gain');
    soundManager.playVictoryMusic();
    setTimeout(() => {
      soundManager.speakRandom('victory', { rate: 0.9, pitch: 1.2 });
    }, 500);
  }, [initSound]);

  const playDefeat = useCallback(() => {
    initSound();
    soundManager.generateSound('coin_lose');
    soundManager.playDefeatMusic();
    setTimeout(() => {
      soundManager.speakRandom('defeat', { rate: 0.8, pitch: 0.8 });
    }, 500);
  }, [initSound]);

  const playLowHealth = useCallback(() => {
    initSound();
    soundManager.speakRandom('lowHealth', { rate: 1.1, pitch: 1.3 });
  }, [initSound]);

  const playMenuMusic = useCallback(() => {
    initSound();
    soundManager.playMenuMusic();
  }, [initSound]);

  const playLobbyMusic = useCallback(() => {
    initSound();
    soundManager.playLobbyMusic();
  }, [initSound]);

  const playBattleMusic = useCallback(() => {
    initSound();
    soundManager.playBattleMusic();
  }, [initSound]);

  const stopMusic = useCallback(() => {
    soundManager.stopMusic();
  }, []);

  const toggleMute = useCallback(() => {
      const muted = soundManager.toggleMute();
      setIsMuted(muted);
      if (!muted) {
        soundManager.resumeMusic();
      }
      return muted;
  }, []);

  return {
    isMuted,
    isInitialized,
    initSound,
    playMiss,
    playHit,
    playEnemyHit,
    playEnemyMiss,
    playWhoosh,
    playClick,
    playSheepPlace,
    playStartGame,
    playVictory,
    playDefeat,
    playLowHealth,
    playMenuMusic,
    playLobbyMusic,
    playBattleMusic,
    stopMusic,
    toggleMute,
  };
}

export default soundManager;