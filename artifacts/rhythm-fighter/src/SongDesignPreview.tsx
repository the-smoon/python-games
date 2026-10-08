import { useEffect, useMemo, useRef } from 'react';
import { drawGeometricBody } from './enemyVisuals';
import { createSongDesignPreview } from './songDesign';
import type { FeatureSet } from './gameRuntimeTypes';
import type { LocalTrack } from './playlistRules';

export type SongPreviewState = {
  trackId: string;
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  features?: FeatureSet;
  message?: string;
  progress?: number;
};

export default function SongDesignPreview({ track, preview }: {
  track: LocalTrack | null;
  preview: SongPreviewState;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const features = preview.trackId === track?.id && preview.status === 'ready' && preview.features?.analyzed
    ? preview.features : null;
  const design = useMemo(() => features ? createSongDesignPreview(features) : null, [features]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = 360 * scale;
    canvas.height = 160 * scale;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#070c17';
    ctx.fillRect(0, 0, 360, 160);
    ctx.strokeStyle = 'rgba(0,229,255,.07)';
    ctx.lineWidth = 1;
    for (let x = 16; x < 360; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 160); ctx.stroke();
    }
    for (let y = 16; y < 160; y += 24) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(360, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,229,255,.16)';
    ctx.beginPath(); ctx.moveTo(180, 14); ctx.lineTo(180, 146); ctx.stroke();
    if (!design) return;

    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = design.enemy.color;
    drawGeometricBody(ctx, 88, 80, 29, design.enemy.form, design.enemy.color, design.enemy.shape);
    ctx.restore();

    const x = 270, y = 82, radius = 38;
    ctx.save();
    ctx.shadowBlur = 22;
    ctx.shadowColor = design.boss.color;
    ctx.strokeStyle = design.boss.color;
    ctx.lineWidth = 5;
    for (const side of [-1, 1]) {
      const wingX = x + side * radius * .82;
      const wingY = y + radius * .15;
      ctx.beginPath(); ctx.moveTo(x + side * 12, y + 5); ctx.lineTo(wingX, wingY); ctx.stroke();
      drawGeometricBody(ctx, wingX, wingY, radius * .48, design.boss.form, design.boss.color, design.boss.wings);
    }
    drawGeometricBody(ctx, x, y, radius * .85, design.boss.form, design.boss.color, design.boss.shape);
    drawGeometricBody(ctx, x, y - radius * .56, radius * .3, design.boss.form, design.boss.accentColor, 'TRIANGLE');
    ctx.restore();
  }, [design]);

  if (!track) return null;
  const selectedPreview = preview.trackId === track.id;
  const ready = selectedPreview && preview.status === 'ready' && Boolean(design);
  const ariaLabel = ready && design
    ? `Enemy ${design.enemy.shape}, boss ${design.boss.shape} with ${design.boss.wings} wings`
    : `Enemy and boss style preview for ${track.title}`;

  return <section className="mt-4 overflow-hidden rounded-lg border border-cyan-500/20 bg-slate-950/70"
    data-testid="song-style-preview" aria-label={`Song style preview: ${track.title}`}>
    <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[.16em] text-cyan-200">Enemy style preview</p>
        <p className="truncate text-xs text-slate-400">{track.title}</p>
      </div>
      {preview.status === 'loading' && selectedPreview && <span className="shrink-0 font-mono text-[9px] uppercase text-slate-500" role="status">
        Scanning {preview.progress ?? 0}%
      </span>}
      {ready && <span className="shrink-0 font-mono text-[9px] uppercase text-emerald-300">Full-song map</span>}
    </div>
    {ready ? <>
      <canvas ref={canvasRef} width="360" height="160" className="block h-auto w-full"
        role="img" aria-label={ariaLabel} data-testid="song-style-preview-canvas"
        data-enemy-shape={design?.enemy.shape} data-boss-shape={design?.boss.shape} />
      <div className="grid grid-cols-2 border-t border-slate-800 font-mono text-[9px] uppercase tracking-[.12em]">
        <div className="border-r border-slate-800 px-3 py-2 text-center text-slate-300">
          Enemy <span className="text-cyan-200">{design?.enemy.shape}</span>
        </div>
        <div className="px-3 py-2 text-center text-slate-300">
          Boss <span className="text-orange-200">{design?.boss.shape}</span>
        </div>
      </div>
    </> : <div className="px-3 py-5 text-center text-xs text-slate-400" role={preview.status === 'error' ? 'alert' : 'status'}>
      {!selectedPreview || preview.status === 'idle' ? 'Choose a song to scan its full-track enemy design.' :
        preview.status === 'loading' ? 'Preparing this song’s full-track design. This does not start a match.' :
          preview.status === 'unavailable' ? 'This track could not be fully analyzed, so its enemy design cannot be previewed.' :
            preview.message || 'The song design could not be prepared.'}
      {selectedPreview && preview.message && preview.status === 'ready' && <p className="mt-2 text-[10px] text-amber-200">{preview.message}</p>}
    </div>}
    {ready && preview.message && <p className="border-t border-slate-800 px-3 py-2 text-[10px] text-amber-200">{preview.message}</p>}
    <p className="border-t border-slate-800 px-3 py-2 text-[10px] leading-relaxed text-slate-500">
      Forms use this song’s full-track analysis. Live music still drives movement and attacks during play.
    </p>
  </section>;
}
