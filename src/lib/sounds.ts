import { safeStorageGetItem } from "@/lib/safe-browser";

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const SETTINGS_KEY = "vettrack-settings";

function soundEnabled(): boolean {
  try {
    const raw = safeStorageGetItem(SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { soundEnabled?: boolean };
    return parsed.soundEnabled !== false;
  } catch (err) {
    console.warn("[sounds] failed to parse settings:", err);
    return true;
  }
}

function criticalSoundEnabled(): boolean {
  try {
    const raw = safeStorageGetItem(SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { soundEnabled?: boolean; criticalAlertsSound?: boolean };
    return parsed.soundEnabled !== false && parsed.criticalAlertsSound !== false;
  } catch (err) {
    console.warn("[sounds] failed to parse settings:", err);
    return true;
  }
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx || audioCtx.state === "closed") {
      const win = window as WindowWithWebkitAudio;
      const AudioContextClass = window.AudioContext ?? win.webkitAudioContext;
      if (!AudioContextClass) return null;
      audioCtx = new AudioContextClass();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function resumeContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    return ctx.resume();
  }
  return Promise.resolve();
}

export async function playFeedbackTone(): Promise<void> {
  if (!soundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  await resumeContext(ctx);

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);

  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.15);
}

export async function playMuteTone(): Promise<void> {
  if (!soundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  await resumeContext(ctx);

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(660, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);

  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.12);
}

export async function playCriticalAlertTone(): Promise<void> {
  if (!criticalSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  await resumeContext(ctx);

  const beepCount = 3;
  const beepDuration = 0.12;
  const beepGap = 0.06;

  for (let i = 0; i < beepCount; i++) {
    const startTime = ctx.currentTime + i * (beepDuration + beepGap);

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1047, startTime);

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.7, startTime + 0.01);
    gainNode.gain.setValueAtTime(0.7, startTime + beepDuration - 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + beepDuration);

    oscillator.start(startTime);
    oscillator.stop(startTime + beepDuration);
  }
}
