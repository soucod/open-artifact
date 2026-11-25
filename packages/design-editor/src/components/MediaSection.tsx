/**
 * The Image / Video section of the properties panel.
 *
 * - Images: replace the file (uploaded, then `src` rewritten), how it fills
 *   its box (`object-fit`), and Crop: the eight-handle crop editor over the
 *   canvas (CropOverlay.tsx), written as `clip-path: inset(…)`.
 * - Videos: replace the file, the poster, the playback attributes
 *   (`controls`, `autoplay`, `loop`, `muted`, `playsinline`), and play /
 *   pause / restart of the rendered video for a look without leaving the
 *   canvas.
 */

import { Crop, Pause, Play, RotateCcw, Upload } from 'lucide-react';
import { useRef } from 'react';
import { attributeValue, elementPath } from '@open-artifact/dc';
import { toast } from '@open-artifact/ui';
import { useView } from '../state/view.ts';
import { useDocument } from '../state/document.ts';
import { templateOf } from '../services/agent.ts';
import { mediaTarget, relocateMedia } from '../lib/media-target.ts';
import { edit } from '../services/commands.ts';
import { boardApi, frameOf } from '../services/frames.ts';
import { session } from '../services/session.ts';
import { announce } from '../services/announce.ts';
import { PButton, PIconButton, PNote, PRow, PSection, PSelect } from './fields.tsx';
import type { ElementContext } from './PropertiesPanel.tsx';

const FITS = [
  { value: 'fill', label: 'Stretch' },
  { value: 'cover', label: 'Fill (crop)' },
  { value: 'contain', label: 'Fit' },
  { value: 'none', label: 'Original size' },
  { value: 'scale-down', label: 'Fit, never larger' },
];

const FLAGS: { name: string; label: string }[] = [
  { name: 'controls', label: 'Controls' },
  { name: 'autoplay', label: 'Autoplay' },
  { name: 'loop', label: 'Loop' },
  { name: 'muted', label: 'Muted' },
  { name: 'playsinline', label: 'Inline' },
];

/** The rendered `<video>` of an element (its first instance), from the artboard's frame. */
function renderedVideo(board: string, tid: number): HTMLVideoElement | null {
  try {
    const rect = boardApi(board)?.rects([tid])[tid]?.[0];
    const doc = frameOf(board)?.contentDocument;
    if (!rect || !doc) return null;
    const found = doc.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (found instanceof (doc.defaultView as unknown as typeof globalThis).HTMLVideoElement) return found as HTMLVideoElement;
    return (found?.closest('video') as HTMLVideoElement | null) ?? (doc.querySelector('video') as HTMLVideoElement | null);
  } catch {
    return null;
  }
}

export function MediaSection({ ctx, readOnly }: { ctx: ElementContext; readOnly: boolean }) {
  const file = useRef<HTMLInputElement>(null);
  const crop = useView((s) => s.crop);
  const tid = ctx.model.tidOf.get(ctx.element)!;
  const target = { tid, path: elementPath(ctx.model, ctx.element) };
  const video = ctx.element.tag === 'video';
  const cropping = crop?.board === ctx.board && crop.tid === tid;
  const locked = readOnly || ctx.locked;

  const replace = async (picked: File): Promise<void> => {
    const { assets } = session();
    if (!assets) {
      toast.add({ title: 'Files cannot be uploaded here', description: 'This host does not accept uploads.' });
      return;
    }
    const before = mediaTarget(ctx.model, ctx.element);
    try {
      const record = await assets.upload(picked, { name: picked.name });
      const source = useDocument.getState().boards[ctx.board]?.source;
      const now = source ? relocateMedia(templateOf(source), before) : null;
      if (!now) {
        toast.add({ title: `That ${video ? 'video' : 'image'} could not be placed here.`, description: 'It changed or was removed while the file uploaded.' });
        return;
      }
      if (!edit(ctx.board, { kind: 'attr', target: now, name: 'src', value: record.url })) return;
      announce(`${video ? 'Video' : 'Image'} replaced with ${picked.name}`);
    } catch (error) {
      toast.add({ title: `Could not upload ${picked.name}`, description: error instanceof Error ? error.message : String(error) });
    }
  };

  const play = (action: 'play' | 'pause' | 'restart'): void => {
    const element = renderedVideo(ctx.board, tid);
    if (!element) {
      toast.add({ title: 'The video is not on screen', description: 'Scroll the artboard into view and try again.' });
      return;
    }
    if (action === 'restart') element.currentTime = 0;
    if (action === 'pause') element.pause();
    else void element.play().catch(() => toast.add({ title: 'The browser would not play this video' }));
  };

  return (
    <PSection title={video ? 'Video' : 'Image'}>
      <input
        ref={file}
        type="file"
        hidden
        accept={video ? 'video/*' : 'image/*'}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = '';
          if (picked) void replace(picked);
        }}
      />
      <div className="flex flex-wrap gap-1.5 px-3 pb-1.5">
        <PButton disabled={readOnly} onClick={() => file.current?.click()}>
          <Upload className="size-3.5" /> Replace…
        </PButton>
        {video ? null : (
          <PButton
            disabled={locked}
            aria-pressed={cropping}
            className={cropping ? 'bg-chrome-selected' : undefined}
            onClick={() => {
              useView.getState().setCrop(cropping ? null : { board: ctx.board, ...target });
              announce(cropping ? 'Crop done' : 'Cropping. Drag the handles; Enter when done.');
            }}
          >
            <Crop className="size-3.5" /> {cropping ? 'Done' : 'Crop'}
          </PButton>
        )}
        {!video && ctx.inline['clip-path'] ? (
          <PButton disabled={locked} onClick={() => ctx.set({ 'clip-path': null })}>
            Reset crop
          </PButton>
        ) : null}
      </div>
      <PRow label="Fit">
        <PSelect
          aria-label="How the media fills its box"
          value={ctx.inline['object-fit'] ?? ctx.computed['object-fit'] ?? 'fill'}
          options={FITS}
          disabled={locked}
          onChange={(next) => ctx.set({ 'object-fit': next === 'fill' ? null : next })}
        />
      </PRow>
      {video ? (
        <>
          <PRow label="Playback">
            <PIconButton label="Play" onClick={() => play('play')}>
              <Play className="size-3.5" />
            </PIconButton>
            <PIconButton label="Pause" onClick={() => play('pause')}>
              <Pause className="size-3.5" />
            </PIconButton>
            <PIconButton label="Restart" onClick={() => play('restart')}>
              <RotateCcw className="size-3.5" />
            </PIconButton>
          </PRow>
          <PRow label="Options">
            <div className="flex flex-wrap gap-1">
              {FLAGS.map((flag) => {
                const on = ctx.element.attrs.some((attr) => attr.name.toLowerCase() === flag.name);
                return (
                  <PButton
                    key={flag.name}
                    disabled={readOnly}
                    aria-pressed={on}
                    className={on ? 'h-6 bg-chrome-selected px-2' : 'h-6 px-2'}
                    onClick={() => edit(ctx.board, { kind: 'attr', target, name: flag.name, value: on ? null : '' })}
                  >
                    {flag.label}
                  </PButton>
                );
              })}
            </div>
          </PRow>
          {attributeValue(ctx.element, 'autoplay') !== undefined && attributeValue(ctx.element, 'muted') === undefined ? (
            <PNote className="py-1">Browsers only autoplay muted videos.</PNote>
          ) : null}
        </>
      ) : null}
    </PSection>
  );
}
