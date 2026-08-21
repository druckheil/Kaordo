import { render, waitFor } from '@testing-library/svelte';
import type { ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { FluoGState, FluoPost } from '../../lib/states/FluoGState';
import FluoTimeline from './FluoTimeline.svelte';

type TimelineProps = ComponentProps<typeof FluoTimeline>;

const posts: FluoPost[] = Array.from({ length: 200 }, (_, index) => ({
  attachments: [],
  author: 'timeline',
  body: `Post ${index}`,
  createdAt: 2_000_000_000_000 - index,
  id: `post-${index}`,
  liked: false,
  nodeId: 'node-1',
  space: 'private',
}));

function timelineState(): FluoGState {
  return {
    deletePost: vi.fn(),
    loadMore: vi.fn(() => Promise.resolve()),
    toggleLike: vi.fn(),
  } as unknown as FluoGState;
}

function createScroller(): HTMLElement {
  const scroller = document.createElement('main');
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 900 },
    clientWidth: { configurable: true, value: 680 },
    offsetHeight: { configurable: true, value: 900 },
    offsetWidth: { configurable: true, value: 680 },
  });
  scroller.getBoundingClientRect = () => ({
    bottom: 900,
    height: 900,
    left: 0,
    right: 680,
    toJSON: () => ({}),
    top: 0,
    width: 680,
    x: 0,
    y: 0,
  });
  document.body.append(scroller);
  return scroller;
}

describe('FluoTimeline', () => {
  it('keeps a fifty-post buffer in both scroll directions', async () => {
    const scroller = createScroller();
    const view = render(FluoTimeline, {
      fluoState: timelineState(),
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      isRefreshing: false,
      posts,
      scrollElement: scroller,
    });
    await waitFor(() => {
      expect(view.container.querySelectorAll('.post-card').length).toBeGreaterThanOrEqual(50);
    });
    expect(view.container.querySelectorAll('.post-card').length).toBeLessThan(120);

    scroller.scrollTop = 20_000;
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      expect(view.container.querySelector('[data-post-key="private:node-1:post-150"]')).not.toBeNull();
    });
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));

    await waitFor(() => {
      expect(view.container.querySelector('[data-post-key="private:node-1:post-0"]')).not.toBeNull();
    });
    expect(view.container.querySelectorAll('.post-card').length).toBeGreaterThanOrEqual(50);
    view.unmount();
    scroller.remove();
  });

  it('loads metadata pages sequentially until the initial buffer is available', async () => {
    const scroller = createScroller();
    let loadedPosts = posts.slice(0, 24);
    let updateProps = async (_props: TimelineProps): Promise<void> => {};
    const fluoState = timelineState();
    const loadMore = vi.mocked(fluoState.loadMore);
    loadMore.mockImplementation(async () => {
      await Promise.resolve();
      loadedPosts = posts.slice(0, Math.min(120, loadedPosts.length + 24));
      await updateProps({
        fluoState,
        hasMore: loadedPosts.length < 120,
        isLoading: false,
        isLoadingMore: false,
        isRefreshing: false,
        posts: loadedPosts,
        scrollElement: scroller,
      });
    });
    const initialProps: TimelineProps = {
      fluoState,
      hasMore: true,
      isLoading: false,
      isLoadingMore: false,
      isRefreshing: false,
      posts: loadedPosts,
      scrollElement: scroller,
    };
    const view = render(FluoTimeline, initialProps);
    updateProps = (next) => view.rerender(next);

    await waitFor(() => {
      expect(loadMore).toHaveBeenCalledTimes(4);
      expect(loadedPosts).toHaveLength(120);
    });

    view.unmount();
    scroller.remove();
  });
});
