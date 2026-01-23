"use client";

import { Howl } from "howler";

export type RewardEvent =
  | { type: "coin_burst"; amountRs: number; anchorId?: string }
  | { type: "confetti_small"; anchorId?: string }
  | { type: "badge_unlock"; badgeKey: string }
  | { type: "streak_fireworks"; streak: number }
  | { type: "toast"; message: string };

type Listener = (evt: RewardEvent) => void;

export type RewardsMode = "kid" | "parent";

export type RewardsPrefs = {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  reducedMotion: boolean;
  mode: RewardsMode;
};

const STORAGE_KEY = "goc_rewards_prefs_v1";

const defaultPrefs: RewardsPrefs = {
  soundEnabled: true,
  hapticsEnabled: true,
  reducedMotion: false,
  mode: "kid",
};

function safeParse(json: string | null) {
  try {
    return json ? (JSON.parse(json) as Partial<RewardsPrefs>) : null;
  } catch {
    return null;
  }
}

function loadPrefs(): RewardsPrefs {
  if (typeof window === "undefined") return defaultPrefs;
  const raw = safeParse(window.localStorage.getItem(STORAGE_KEY));
  const merged: RewardsPrefs = { ...defaultPrefs, ...(raw ?? {}) };
  if (merged.mode === "parent") {
    merged.soundEnabled = false;
    merged.hapticsEnabled = false;
  }
  return merged;
}

function savePrefs(p: RewardsPrefs) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

class RewardsBus {
  private listeners = new Set<Listener>();
  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(evt: RewardEvent) {
    for (const fn of this.listeners) fn(evt);
  }
}

type SoundKey = "click" | "coin" | "success" | "streak";

type SoundsMap = Record<SoundKey, Howl>;

function createSounds(): SoundsMap {
  // NOTE: we ship tiny .wav placeholders in /public/sfx/ so audio never 404s.
  return {
    click: new Howl({ src: ["/sfx/click-soft.wav"], volume: 0.6 }),
    coin: new Howl({ src: ["/sfx/coin-pop.wav"], volume: 0.7 }),
    success: new Howl({ src: ["/sfx/success-chime.wav"], volume: 0.7 }),
    streak: new Howl({ src: ["/sfx/streak-fire.wav"], volume: 0.6 }),
  };
}

class RewardsEngine {
  private prefs: RewardsPrefs = defaultPrefs;
  private bus = new RewardsBus();

  private sounds: SoundsMap | null = null;
  private audioUnlocked = false;
  private lastSoundAt = 0;
  private SOUND_COOLDOWN_MS = 700;

  private lastHapticAt = 0;
  private HAPTIC_COOLDOWN_MS = 500;

  init(mode: RewardsMode) {
    const p = loadPrefs();
    this.prefs = { ...p, mode };
    if (mode === "parent") {
      this.prefs.soundEnabled = false;
      this.prefs.hapticsEnabled = false;
    }
    savePrefs(this.prefs);
    this.sounds = null;
    this.audioUnlocked = false;
  }

  getPrefs(): RewardsPrefs {
    return this.prefs;
  }

  setPrefs(partial: Partial<RewardsPrefs>) {
    this.prefs = { ...this.prefs, ...partial };
    if (this.prefs.mode === "parent") {
      this.prefs.soundEnabled = false;
      this.prefs.hapticsEnabled = false;
    }
    savePrefs(this.prefs);
  }

  unlockAudioFromGesture() {
    if (this.audioUnlocked) return;
    if (!this.sounds) this.sounds = createSounds();

    // iOS: unlock audio via user-initiated play. We play at 0 volume once.
    const click = this.sounds.click;
    const prev = (click as any)._volume ?? 0.6;
    click.volume(0);
    click.play();
    click.volume(prev);
    this.audioUnlocked = true;
  }

  on(fn: Listener) {
    return this.bus.on(fn);
  }

  emit(evt: RewardEvent) {
    if (this.prefs.reducedMotion) {
      if (evt.type === "streak_fireworks" || evt.type === "confetti_small") {
        this.bus.emit({ type: "toast", message: "Nice!" });
        return;
      }
    }
    this.bus.emit(evt);
  }

  private canPlaySound() {
    if (!this.prefs.soundEnabled) return false;
    const now = Date.now();
    if (now - this.lastSoundAt < this.SOUND_COOLDOWN_MS) return false;
    this.lastSoundAt = now;
    return true;
  }

  private ensureSounds() {
    if (!this.sounds) this.sounds = createSounds();
    return this.sounds;
  }

  playSound(key: SoundKey) {
    if (!this.canPlaySound()) return;
    if (!this.audioUnlocked) return;
    const s = this.ensureSounds();
    s[key].play();
  }

  private canHaptic() {
    if (!this.prefs.hapticsEnabled) return false;
    const now = Date.now();
    if (now - this.lastHapticAt < this.HAPTIC_COOLDOWN_MS) return false;
    this.lastHapticAt = now;
    return true;
  }

  haptic(pattern: number | number[]) {
    if (!this.canHaptic()) return;
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  }

  tap() {
    this.playSound("click");
    this.haptic(15);
  }

  choreCompleted(amountRs: number, anchorId?: string) {
    if (this.prefs.mode === "kid") {
      this.playSound("coin");
      this.haptic([20, 20, 30]);
      this.emit({ type: "coin_burst", amountRs, anchorId });
      this.emit({ type: "confetti_small", anchorId });
    } else {
      this.emit({ type: "toast", message: `Chore recorded: Rs.${amountRs}` });
    }
  }

  badgeUnlocked(badgeKey: string) {
    if (this.prefs.mode === "kid") {
      this.playSound("success");
      this.haptic([20, 20, 50]);
      this.emit({ type: "badge_unlock", badgeKey });
    } else {
      this.emit({ type: "toast", message: `Badge unlocked: ${badgeKey}` });
    }
  }

  streakIncreased(streak: number) {
    if (this.prefs.mode === "kid") {
      this.playSound("streak");
      this.haptic([15, 15, 15, 40]);
      this.emit({ type: "streak_fireworks", streak });
    } else {
      this.emit({ type: "toast", message: `Streak: ${streak}` });
    }
  }
}

export const rewards = new RewardsEngine();
