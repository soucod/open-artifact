/**
 * The editor's crash fallback: the canvas could not load, with a reload.
 *
 * Nothing in the project is lost: edits are saved as they are made, so a
 * reload reopens the design where it was.
 */

import type { ReactNode } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button, CrashBoundary as Boundary } from '@open-artifact/ui';

/** Shows {@link CrashCard} when `children` fail to render. */
export function CrashBoundary({ children }: { children: ReactNode }): ReactNode {
  return <Boundary fallback={<CrashCard />}>{children}</Boundary>;
}

/** The fallback: what happened and how to recover. */
export function CrashCard() {
  return (
    <div data-testid="design-crashed" className="flex h-full w-full items-center justify-center bg-canvas p-8 text-center">
      <div role="alert" className="flex max-w-sm flex-col items-center gap-2">
        <TriangleAlert className="size-6 text-fg-subtle" aria-hidden />
        <h1 className="m-0 text-balance text-[15px] font-semibold text-fg">Couldn’t load this canvas</h1>
        <p className="m-0 text-pretty text-[13px] text-fg-muted">Reload to try again.</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => window.location.reload()}>
          <RotateCw className="size-3.5" aria-hidden />
          Reload
        </Button>
      </div>
    </div>
  );
}
