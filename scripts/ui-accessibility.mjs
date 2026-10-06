// Audits settled rendered screens without treating unfinished transitions as final colors or geometry

import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';

export async function assertAccessible(page, stage) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const transitions = document.getAnimations({ subtree: true }).filter((animation) =>
      animation.playState === 'running' && animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(transitions.map((animation) => animation.finished.catch(() => undefined)));
  });
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  assert.deepEqual(violations.map(({ id, impact, nodes }) => ({
    id, impact,
    targets: nodes.map(({ target, html, failureSummary, any }) => ({
      target, html, failureSummary, data: any.map(({ data }) => data),
    })),
  })), [], `${stage} must have no automated WCAG A/AA violations`);
}
