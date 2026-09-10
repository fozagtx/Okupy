export type SpectrumState = {
  send: ((userId: string, body: string) => Promise<void>) | null;
  ready: boolean;
};

export const spectrumState: SpectrumState = { send: null, ready: false };

export function setSpectrumSender(send: SpectrumState["send"]): void {
  spectrumState.send = send;
  spectrumState.ready = true;
}

export function clearSpectrum(): void {
  spectrumState.send = null;
  spectrumState.ready = false;
}

export async function spectrumSend(userId: string, body: string): Promise<boolean> {
  const send = spectrumState.send;
  if (!send || !spectrumState.ready) return false;
  try {
    await send(userId, body);
    return true;
  } catch (error) {
    console.error(`[spectrum] send failed for ${userId}`, error);
    return false;
  }
}
