import { useEffect, useRef, useState } from 'react';
import { moveTrack, validateRemotePlaylist, type LocalTrack } from './playlistRules';

const api = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/playlists`;
const button = 'rounded border border-slate-700 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40';

async function responseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Playlist request failed (${response.status})`);
  return data;
}

export default function PlaylistSetup({ tracks, onTracks, random, onRandom, onBusy }: {
  tracks: LocalTrack[]; onTracks: (tracks: LocalTrack[]) => void;
  random: boolean; onRandom: (value: boolean) => void; onBusy: (value: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const active = useRef<{ controller: AbortController; id?: string } | null>(null);
  const remove = (id: string) => fetch(`${api}/${id}`, {
    method: 'DELETE', keepalive: true, signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  const cancel = () => {
    const request = active.current;
    active.current = null;
    request?.controller.abort();
    if (request?.id) void remove(request.id);
    setBusy(false); onBusy(false); setMessage('Download cancelled. You can try again.');
  };
  useEffect(() => () => {
    active.current?.controller.abort();
    if (active.current?.id) void remove(active.current.id);
  }, []);

  const download = async () => {
    if (active.current) return;
    const request = { controller: new AbortController(), id: undefined as string | undefined };
    active.current = request;
    const signal = request.controller.signal;
    // Includes server download and transfer; never poll indefinitely.
    const timeout = window.setTimeout(() => request.controller.abort(), 12 * 60_000);
    setBusy(true); onBusy(true); setError(''); setProgress(0); setMessage('Starting playlist download…'); onTracks([]);
    try {
      // Keep the POST alive long enough to obtain the cleanup token even if Cancel is pressed.
      let job = validateRemotePlaylist(await responseJson(await fetch(api, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(20_000),
      })));
      request.id = job.id;
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      while (job.state === 'downloading') {
        setMessage(job.message);
        setProgress(job.total ? Math.round(job.completed / job.total * 75) : 0);
        await new Promise<void>((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
          const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
          signal.addEventListener('abort', abort, { once: true });
        });
        job = validateRemotePlaylist(await responseJson(await fetch(`${api}/${job.id}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        })));
      }
      if (job.state === 'error') throw new Error(job.message);
      const files: LocalTrack[] = [];
      const manifest = job.manifest!;
      let bytes = 0;
      for (let i = 0; i < manifest.tracks.length; i++) {
        setMessage(`Preparing track ${i + 1}/${manifest.tracks.length} in your browser`);
        const track = manifest.tracks[i];
        const response = await fetch(`${api}/${job.id}/tracks/${i}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
        });
        if (!response.ok) throw new Error('Track transfer failed. Download the playlist again.');
        const size = Number(response.headers.get('content-length'));
        if (!size || size > 24 * 1024 * 1024) throw new Error('Track exceeds the transfer size limit');
        const blob = await response.blob();
        bytes += blob.size;
        if (!blob.size || blob.size > 24 * 1024 * 1024 || bytes > 192 * 1024 * 1024) throw new Error('Playlist exceeds the size limit');
        files.push({ id: track.id, title: track.title, file: new File([blob], `${track.title}.mp3`, { type: 'audio/mpeg' }) });
        setProgress(75 + Math.round((i + 1) / manifest.tracks.length * 25));
      }
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      onTracks(files);
      setMessage(`${files.length} tracks ready.${manifest.skipped ? ` ${manifest.skipped} unavailable tracks skipped.` : ''} Review the order, then Analyze and play.`);
    } catch (problem) {
      if (active.current === request) setError(signal.aborted ? 'Download cancelled or timed out. Try again.' : problem instanceof Error ? problem.message : 'Playlist download failed');
    } finally {
      clearTimeout(timeout);
      if (request.id) await remove(request.id);
      if (active.current === request) { active.current = null; setBusy(false); onBusy(false); }
    }
  };

  return <div className="hud-panel mt-4 rounded-xl p-5" data-testid="playlist-setup">
    <label className="block text-xs font-bold uppercase tracking-widest text-cyan-300" htmlFor="playlist-url">YouTube Music playlist</label>
    <input id="playlist-url" data-testid="input-playlist-url" type="url" maxLength={512} value={url}
      onChange={(event) => setUrl(event.target.value)} disabled={busy} placeholder="https://music.youtube.com/playlist?list=…"
      className="mt-3 w-full rounded border border-slate-700 bg-slate-950 p-3 text-sm text-slate-200" />
    <p className="mt-2 text-xs text-slate-500">Public playlists only. Up to 20 tracks, 12 minutes and 24 MB per track, 192 MB total. Download only music you have permission to use.</p>
    <div className="mt-3 flex gap-2">
      <button type="button" className={button} data-testid="button-download-playlist" disabled={busy || !url.trim()} onClick={() => void download()}>Download playlist</button>
      {busy && <button type="button" className={button} onClick={cancel}>Cancel download</button>}
    </div>
    {message && <p className="mt-3 text-sm text-slate-300" role="status" data-testid="playlist-status">{message}</p>}
    {busy && <progress className="mt-3 w-full" value={progress} max={100} aria-label="Playlist preparation" />}
    {error && <p role="alert" className="mt-3 text-sm text-red-300" data-testid="playlist-error">{error}</p>}
    {tracks.length > 0 && <>
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" data-testid="input-shuffle-playlist" checked={random} onChange={(event) => onRandom(event.target.checked)} />
        Random order — shuffle once when starting
      </label>
      <ol className="mt-3 space-y-2" data-testid="playlist-tracks">
        {tracks.map((track, i) => <li key={track.id} className="flex items-center gap-2 rounded bg-slate-950/70 p-2 text-sm">
          <span className="text-slate-500">{i + 1}.</span><span className="min-w-0 flex-1 truncate text-slate-200">{track.title}</span>
          <button className={button} disabled={i === 0} aria-label={`Move ${track.title} up`} onClick={() => onTracks(moveTrack(tracks, i, i - 1))}>↑</button>
          <button className={button} disabled={i === tracks.length - 1} aria-label={`Move ${track.title} down`} onClick={() => onTracks(moveTrack(tracks, i, i + 1))}>↓</button>
        </li>)}
      </ol>
      <p className="mt-3 text-xs text-slate-400">Adjacent tracks become stage/boss pairs. The end wraps to the first track, including odd-length lists. One track plays both roles. Replay keeps the same order.</p>
    </>}
  </div>;
}