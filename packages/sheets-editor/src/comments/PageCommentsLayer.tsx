import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AllComments, CommentComposer, CommentPopover, CommentsLayer, ThreadCard } from '@open-artifact/editor-kit/react';
import { useToasts } from '../kit/toast.tsx';
import { COMMENT_CARD_WIDTH } from './card-places.ts';
import {
  closeCommentCard,
  closeCommentComposer,
  COMMENTS_LAYER_MARK,
  keepPreviewOpen,
  pageComments,
  setCommentNotifier,
  useCommentCards,
  useComments,
  type PagePoint,
} from './page-comments.ts';

interface ViewFrame {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
}

const frameOf = (view: Window): ViewFrame => ({ width: view.innerWidth, height: view.innerHeight, scrollX: view.scrollX, scrollY: view.scrollY });

function useViewFrame(): ViewFrame {
  const [frame, setFrame] = useState(() => frameOf(window));
  useEffect(() => {
    const update = (): void => setFrame(frameOf(window));
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, []);
  return frame;
}

const inView = (at: PagePoint, frame: ViewFrame): PagePoint => ({ x: at.x - frame.scrollX, y: at.y - frame.scrollY });

interface CardFrameProps {
  children: ReactNode;
}

/** The open card's frame: tells its height and whether the mouse is on it. */
function CardFrame({ children }: CardFrameProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = (): void => {
      const height = Math.round(element.getBoundingClientRect().height);
      if (height > 0 && useCommentCards.getState().height !== height) useCommentCards.setState({ height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}
      onPointerEnter={() => useCommentCards.setState({ hovered: true })}
      onPointerLeave={() => useCommentCards.setState({ hovered: false })}
      onPointerDownCapture={keepPreviewOpen}
      onFocusCapture={keepPreviewOpen}
    >
      {children}
    </div>
  );
}

/** The comment cards and composer over the cells, and the list of every comment. */
export function PageCommentsLayer(): ReactNode {
  const toasts = useToasts();
  useEffect(() => setCommentNotifier((notice) => void toasts.add(notice)), [toasts]);
  const available = useComments((state) => state.available);
  const active = useComments((state) => state.active);
  const threads = useComments((state) => state.threads);
  const draft = useComments((state) => state.draft);
  const place = useCommentCards((cards) => (active === null ? undefined : cards.places[active]));
  const cardShownAt = useCommentCards((cards) => cards.cardShownAt);
  const composerShownAt = useCommentCards((cards) => cards.composerShownAt);
  const agent = useCommentCards((cards) => cards.agent);
  const frame = useViewFrame();
  if (!available) return null;
  const thread = active === null ? undefined : threads.find((listed) => listed.id === active);
  const cardAt = place ?? cardShownAt;
  const viewport = { width: frame.width, height: frame.height };
  const closeTop = (): boolean => {
    if (useComments.getState().active !== null) closeCommentCard();
    else if (useComments.getState().draft !== null) closeCommentComposer();
    else return false;
    return true;
  };
  return createPortal(
    <>
      <CommentsLayer mark={COMMENTS_LAYER_MARK} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 45 }} onEscape={closeTop}>
        {thread !== undefined && cardAt !== null ? (
          <CommentPopover key={thread.id} corner={inView(cardAt, frame)} viewport={viewport} width={COMMENT_CARD_WIDTH} onEscape={closeCommentCard}>
            {(maxHeight) => (
              <CardFrame>
                <ThreadCard comments={pageComments} agent={agent} thread={thread} maxHeight={maxHeight} onClose={closeCommentCard} />
              </CardFrame>
            )}
          </CommentPopover>
        ) : null}
        {draft !== null && composerShownAt !== null ? (
          <CommentPopover key="composer" corner={inView(composerShownAt, frame)} viewport={viewport} width={COMMENT_CARD_WIDTH} onEscape={closeCommentComposer}>
            <CommentComposer comments={pageComments} agent={agent} anchor={draft} onCancel={closeCommentComposer} />
          </CommentPopover>
        ) : null}
      </CommentsLayer>
      <AllComments comments={pageComments} agent={agent} />
    </>,
    document.body,
  );
}
