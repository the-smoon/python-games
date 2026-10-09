import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  getGetMusicLibraryQueryKey, getGetOwnerStatusQueryKey, getListSharedPlaylistsQueryKey,
  loadSharedPlaylist, ownerSignOut, saveSharedPlaylist,
  useGetMusicLibrary, useGetOwnerStatus, useListSharedPlaylists,
} from '@workspace/api-client-react';
import { moveTrack, type LocalTrack } from './playlistRules';

// The shared API has its own /api route, separate from this legacy preview prefix.
const api = '/api/playlists';
const MAX_TRACK = 24 * 1024 * 1024;
const MAX_TOTAL = 192 * 1024 * 1024;
const MAX_TRACKS = 20;
const button = 'action-button rounded border border-cyan-500/40 bg-slate-950 px-3 py-2 font-mono text-[11px] uppercase text-cyan-200 disabled:opacity-40';
const field = 'w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-200';
const label = 'block text-xs font-bold uppercase tracking-widest text-cyan-300';
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const message = (e: unknown, fallback: string) => {
  const d = e as { data?: { error?: string }; message?: string } | null;
  return d?.data?.error || (e instanceof Error && e.message) || fallback;
};

async function downloadTrack(id: string, title: string, used: number, signal: AbortSignal): Promise<LocalTrack> {
  const response = await fetch(`${api}/audio/${encodeURIComponent(id)}`, {
    credentials: 'include', signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Could not download "${title}" (${response.status})`);
  }
  const size = Number(response.headers.get('content-length'));
  if (!size || size > MAX_TRACK) throw new Error(`"${title}" is missing a size or exceeds 24 MB`);
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_TRACK) throw new Error(`"${title}" exceeds 24 MB`);
  if (used + blob.size > MAX_TOTAL) throw new Error('Playlist would exceed the 192 MB total limit');
  return { id, title, file: new File([blob], `${title}.mp3`, { type: 'audio/mpeg' }) };
}

function Setup({ tracks, onTracks, random, onRandom, onBusy }: {
  tracks: LocalTrack[]; onTracks: (tracks: LocalTrack[]) => void;
  random: boolean; onRandom: (value: boolean) => void; onBusy: (value: boolean) => void;
}) {
  const qc = useQueryClient();
  const library = useGetMusicLibrary();
  const shared = useListSharedPlaylists();
  const owner = useGetOwnerStatus();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const active = useRef<AbortController | null>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const total = tracks.reduce((sum, t) => sum + t.file.size, 0);
  const isOwner = owner.data?.owner === true;
  const configured = owner.data?.configured === true;
  const signInHref = `${api}/owner/google?returnTo=${encodeURIComponent(import.meta.env.BASE_URL)}`;

  useEffect(() => () => { active.current?.abort(); onBusy(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('ownerSignIn');
    if (!result) return;
    setStatus(result === 'success' ? 'Owner signed in.' : 'Sign-in was not completed. Use the verified owner Google account.');
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
  }, []);

  const run = async (work: (signal: AbortSignal) => Promise<void>, start: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 10 * 60_000);
    setBusy(true); onBusy(true); setError(''); setStatus(start);
    try { await work(controller.signal); }
    catch (e) { setError(controller.signal.aborted ? 'Cancelled or timed out. Try again.' : message(e, 'Request failed')); setStatus(''); }
    finally { clearTimeout(timer); active.current = null; setBusy(false); onBusy(false); }
  };
  const cancel = () => active.current?.abort();

  const add = (id: string, title: string) => {
    if (tracks.length >= MAX_TRACKS) { setError('Playlists are capped at 20 tracks.'); return; }
    void run(async (signal) => {
      const t = await downloadTrack(id, title, total, signal);
      onTracks([...tracksRef.current, t]);
      setStatus(`Added ${title}.`);
    }, `Downloading ${title}...`);
  };
  const loadSaved = () => {
    if (!selectedId) return;
    void run(async (signal) => {
      const list = await loadSharedPlaylist(selectedId, { signal });
      if (list.tracks.length > MAX_TRACKS) throw new Error('Playlist has more than 20 tracks');
      const out: LocalTrack[] = [];
      let used = 0;
      for (let i = 0; i < list.tracks.length; i++) {
        const t = list.tracks[i];
        setStatus(`Downloading ${i + 1}/${list.tracks.length}: ${t.title}`);
        const local = await downloadTrack(t.id, t.title, used, signal);
        used += local.file.size; out.push(local);
      }
      onTracks(out); setName(list.name);
      setStatus(`Loaded "${list.name}" with ${out.length} tracks.`);
    }, 'Loading playlist...');
  };
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || !tracks.length) return;
    void run(async (signal) => {
      try {
        const s = await saveSharedPlaylist({ name: trimmed, trackIds: tracks.map((t) => t.id) }, { signal });
        setSelectedId(s.id); setStatus(`Saved "${s.name}".`);
        await qc.invalidateQueries({ queryKey: getListSharedPlaylistsQueryKey() });
      } catch (e) {
        if ((e as { status?: number })?.status === 409) throw new Error('A playlist with that name already exists. Choose another name; nothing was overwritten.');
        throw e;
      }
    }, 'Saving playlist...');
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetMusicLibraryQueryKey() });
    void qc.invalidateQueries({ queryKey: getListSharedPlaylistsQueryKey() });
  };
  const logout = () => void run(async (signal) => {
    await ownerSignOut({ signal });
    qc.setQueryData(getGetOwnerStatusQueryKey(), { owner: false, configured: true });
    await qc.invalidateQueries({ queryKey: getGetOwnerStatusQueryKey() });
    setStatus('Signed out.');
  }, 'Signing out...');
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!/\.mp3$/i.test(file.name) || file.size > MAX_TRACK || !file.size) { setError('Upload an .mp3 file of 24 MB or less.'); return; }
    void run(async (signal) => {
      const response = await fetch(`${api}/upload`, {
        method: 'POST', credentials: 'include', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        headers: { 'Content-Type': 'audio/mpeg', 'X-Filename': encodeURIComponent(file.name) }, body: file,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Upload failed (${response.status})`);
      }
      await qc.invalidateQueries({ queryKey: getGetMusicLibraryQueryKey() });
      setStatus(`Uploaded ${file.name}.`);
    }, `Uploading ${file.name}...`);
  };

  const lib = library.data ?? [];
  const lists = shared.data ?? [];
  return <div className="hud-panel mt-4 rounded-xl p-5 text-left" data-testid="playlist-setup">
    <div className="flex items-center justify-between gap-2">
      <span className={label}>Shared music library</span>
      <button type="button" className={button} data-testid="button-refresh-library" disabled={busy} onClick={refresh}>Refresh</button>
    </div>
    <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto" data-testid="library-tracks">
      {library.isLoading && <li className="text-sm text-slate-400" data-testid="library-loading">Loading library...</li>}
      {library.isError && <li role="alert" className="text-sm text-red-300">{message(library.error, 'Library unavailable.')} <button type="button" className="underline" onClick={refresh}>Retry</button></li>}
      {!library.isLoading && !library.isError && lib.length === 0 && <li className="text-sm text-slate-400">No tracks in the shared library yet.</li>}
      {lib.map((t) => <li key={t.id} className="flex items-center gap-2 rounded bg-slate-950/70 p-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-slate-200">{t.title}</span>
        <span className="font-mono text-[10px] text-slate-500">{mb(t.size)}</span>
        <button type="button" className={button} data-testid={`button-add-${t.id}`}
          disabled={busy || tracks.length >= MAX_TRACKS || tracks.some((x) => x.id === t.id)} onClick={() => add(t.id, t.title)}>Add</button>
      </li>)}
    </ul>

    <div className="mt-5 border-t border-slate-800 pt-4">
      <label className={label} htmlFor="saved-playlist">Saved playlists</label>
      {shared.isError && <p role="alert" className="mt-2 text-sm text-red-300">{message(shared.error, 'Saved playlists are unavailable.')}</p>}
      <div className="mt-2 flex gap-2">
        <select id="saved-playlist" data-testid="select-saved-playlist" className={field} value={selectedId} disabled={busy} onChange={(e) => setSelectedId(e.target.value)}>
          <option value="">{shared.isError ? 'Could not load list' : lists.length ? 'Choose a playlist' : 'No saved playlists'}</option>
          {lists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" className={button} data-testid="button-load-playlist" disabled={busy || !selectedId} onClick={loadSaved}>Load</button>
      </div>
    </div>

    <div className="mt-5 border-t border-slate-800 pt-4">
      <span className={label}>Your order ({tracks.length}/{MAX_TRACKS}, {mb(total)} of 192 MB)</span>
      {tracks.length === 0 && <p className="mt-2 text-sm text-slate-400">Add tracks from the library or load a saved playlist.</p>}
      <ol className="mt-3 space-y-2" data-testid="playlist-tracks">
        {tracks.map((track, i) => <li key={track.id} className="flex items-center gap-2 rounded bg-slate-950/70 p-2 text-sm">
          <span className="text-slate-500">{i + 1}.</span><span className="min-w-0 flex-1 truncate text-slate-200">{track.title}</span>
          <button type="button" className={button} disabled={busy || i === 0} aria-label={`Move ${track.title} up`} onClick={() => onTracks(moveTrack(tracks, i, i - 1))}>Up</button>
          <button type="button" className={button} disabled={busy || i === tracks.length - 1} aria-label={`Move ${track.title} down`} onClick={() => onTracks(moveTrack(tracks, i, i + 1))}>Down</button>
          <button type="button" className={button} disabled={busy} aria-label={`Remove ${track.title}`} data-testid={`button-remove-${track.id}`} onClick={() => onTracks(tracks.filter((_, n) => n !== i))}>Remove</button>
        </li>)}
      </ol>
      {tracks.length > 0 && <>
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" data-testid="input-shuffle-playlist" checked={random} disabled={busy} onChange={(e) => onRandom(e.target.checked)} />
          Random order - shuffle once when starting
        </label>
        <p className="mt-3 text-xs text-slate-400">Adjacent tracks become stage/boss pairs. The end wraps to the first track, including odd-length lists. One track plays both roles. Replay keeps the same order.</p>
        <label className={`${label} mt-4`} htmlFor="playlist-name">Playlist name</label>
        <div className="mt-2 flex gap-2">
          <input id="playlist-name" data-testid="input-playlist-name" className={field} maxLength={80} value={name} disabled={busy}
            onChange={(e) => setName(e.target.value)} placeholder="Name this playlist" />
          <button type="button" className={button} data-testid="button-save-playlist" disabled={busy || !name.trim()} onClick={save}>Save</button>
        </div>
      </>}
    </div>

    {configured && <div className="mt-5 border-t border-slate-800 pt-4" data-testid="owner-panel">
      {isOwner ? <>
        <div className="flex items-center justify-between">
          <span className={label}>Owner upload</span>
          <button type="button" className={button} data-testid="button-owner-signout" disabled={busy} onClick={logout}>Sign out</button>
        </div>
        <input type="file" accept=".mp3,audio/mpeg" data-testid="input-owner-upload" disabled={busy}
          className="mt-3 block w-full text-xs text-slate-300" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="mt-2 text-xs text-slate-500">MP3 only, 24 MB maximum. Adds to the shared library.</p>
      </> : <div>
        <span className={label}>Owner sign in</span>
        <a className={`${button} mt-2 inline-flex`} data-testid="button-owner-signin" href={signInHref}>Sign in with Google</a>
        <p className="mt-2 text-xs text-slate-500">Uploads are limited to the verified owner Google account.</p>
      </div>}
    </div>}

    {status && <p className="mt-4 text-sm text-slate-300" role="status" data-testid="playlist-status">{status}</p>}
    {busy && <div className="mt-3 flex items-center gap-3"><progress className="flex-1" aria-label="Working" />
      <button type="button" className={button} data-testid="button-cancel" onClick={cancel}>Cancel</button></div>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300" data-testid="playlist-error">{error}</p>}
  </div>;
}

export default function PlaylistSetup(props: Parameters<typeof Setup>[0]) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: true } } }));
  return <QueryClientProvider client={client}><Setup {...props} /></QueryClientProvider>;
}
