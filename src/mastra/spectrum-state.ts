import { Spectrum, text } from "spectrum-ts";
import type { SpectrumInstance } from "spectrum-ts";

export type SpectrumState = {
  instance: SpectrumInstance | null;
  ready: boolean;
};

export const spectrumState: SpectrumState = { instance: null, ready: false };

export function setSpectrum(spectrum: SpectrumInstance): void {
  spectrumState.instance = spectrum;
  spectrumState.ready = true;
}

export function clearSpectrum(): void {
  spectrumState.instance = null;
  spectrumState.ready = false;
}

export async function spectrumSend(userId: string, body: string): Promise<boolean> {
  const spectrum = spectrumState.instance;
  if (!spectrum || !spectrumState.ready) return false;
  try {
    const space = { id: userId, type: "dm" as const };
    await spectrum.send(space as never, text(body));
    return true;
  } catch (error) {
    console.error(`[spectrum] send failed for ${userId}`, error);
    return false;
  }
}