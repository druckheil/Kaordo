// Audits settled rendered screens without treating unfinished transitions as final colors or geometry

import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export async function settleInterface(page) {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // Read current animations instead of retaining finished promises for replaced or detached effects
  await expect.poll(() => page.evaluate(() => document.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running' && animation.effect?.target?.checkVisibility() && Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => ({ target: animation.effect?.target?.tagName, name: animation.animationName ?? animation.transitionProperty }))),
  { message: 'Finite interface animations must settle before measuring' }).toEqual([]);
}

export async function accessibilityViolations(page) {
  await settleInterface(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .analyze();
  return violations.map(({ id, impact, nodes }) => ({
    id, impact,
    targets: nodes.map(({ target, html, failureSummary, any }) => ({
      target, html, failureSummary, data: any.map(({ data }) => data),
    })),
  }));
}

export async function assertAccessible(page, stage) {
  assert.deepEqual(await accessibilityViolations(page), [], `${stage} must have no automated WCAG A/AA violations`);
}

export async function interfaceGeometry(page, targetSize = 24) {
  return page.evaluate(minimum => {
    const targets = [...document.querySelectorAll('button,a[href],summary,input:not([type=hidden]),textarea,select,[contenteditable=true],[role=radio],[role=switch],[role=slider]')].filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width && rect.height && style.visibility !== 'hidden' && style.clip !== 'rect(0px, 0px, 0px, 0px)' && style.clipPath !== 'inset(50%)' && !element.closest('[inert],[aria-hidden=true]');
    }).map(element => {
      const labelledTarget = element.matches('input[type=checkbox],input[type=radio],[role=radio],[role=switch]');
      const label = labelledTarget ? element.closest('label') ?? (element.id ? [...document.querySelectorAll('label')].find(label => label.htmlFor === element.id) : null) : null;
      const rect = (label ?? element).getBoundingClientRect();
      return { name: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 90), width: rect.width, height: rect.height, inline: element.tagName === 'A' && getComputedStyle(element).display === 'inline', disabled: element.matches(':disabled,[aria-disabled=true]') };
    });
    const dialog = document.querySelector('[role=dialog],[role=alertdialog]');
    const rect = dialog?.getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth - innerWidth,
      small: targets.filter(target => !target.inline && !target.disabled && (target.width < minimum || target.height < minimum)),
      dialog: rect ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, viewportHeight: innerHeight, viewportWidth: innerWidth } : null };
  }, targetSize);
}

export async function assertInterfaceGeometry(page, stage) {
  await settleInterface(page);
  const geometry = await interfaceGeometry(page);
  assert.ok(geometry.overflow <= 1, `${stage} must reflow without page overflow`);
  assert.deepEqual(geometry.small, [], `${stage} targets must have 24 CSS pixels or an associated label`);
  if (geometry.dialog) {
    const { top, bottom, left, right, viewportHeight, viewportWidth } = geometry.dialog;
    assert.ok(top >= 0 && left >= 0 && bottom <= viewportHeight + 1 && right <= viewportWidth + 1, `${stage} dialog must fit the viewport`);
  }
}

export async function semanticContrast(page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const colors = new Map();
    function luminance(token) {
      if (colors.has(token)) return colors.get(token);
      probe.style.color = `var(--${token})`;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      colors.set(token, value);
      return value;
    }
    const pairs = [
      ['foreground', 'background', 4.5], ['card-foreground', 'card', 4.5],
      ['popover-foreground', 'popover', 4.5], ['primary-foreground', 'primary', 4.5],
      ['secondary-foreground', 'secondary', 4.5], ['accent-foreground', 'accent', 4.5],
      ['primary-soft-foreground', 'primary-soft', 4.5],
      ...['background', 'card', 'muted'].flatMap(surface =>
        ['muted-foreground', 'link', 'destructive'].map(text => [text, surface, 4.5])),
      ...['background', 'card'].flatMap(surface =>
        ['control-border', 'focus-color'].map(control => [control, surface, 3])),
    ];
    const result = pairs.map(([foreground, background, minimum]) => {
      const a = luminance(foreground), b = luminance(background);
      return { foreground, background, minimum, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
    probe.remove();
    return result;
  });
}
