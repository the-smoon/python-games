import { getSongAnalysis, storeSongAnalysis, type SongAnalysisDocument } from '@workspace/api-client-react';
import type { FeatureSet } from './gameRuntimeTypes';

type Inspect = (file: File, progress: (value: number) => void) => Promise<FeatureSet>;
const request = () => ({ signal: AbortSignal.timeout(5000) });

/** Content-addressed, versioned documents contain numerical features only, never song bytes. */
export async function prepareSong(file: File, inspect: Inspect, progress: (value: number) => void) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  let warning = '';
  try {
    const cached = await getSongAnalysis(hash, request());
    progress(100);
    return { features: { ...cached, analyzed: true, songKey: hash } as FeatureSet, warning, cached: true };
  } catch (error) {
    if ((error as { status?: number }).status !== 404) warning = 'Saved song analysis is unavailable; this run is using a fresh analysis.';
  }
  const features = await inspect(file, progress);
  features.songKey = hash;
  if (features.analyzed) {
    const document: SongAnalysisDocument = { version: 3, duration: features.duration, playbackDuration: features.playbackDuration,
      signature: features.signature, motifs: features.motifs, analyzedSeconds: features.analyzedSeconds };
    try { await storeSongAnalysis(hash, document, request()); }
    catch { warning = 'Song analysis could not be saved; playback and live music reactions still work for this run.'; }
  }
  return { features, warning, cached: false };
}