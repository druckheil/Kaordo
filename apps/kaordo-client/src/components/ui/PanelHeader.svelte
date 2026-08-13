<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    action?: Snippet;
    eyebrow: string;
    title: string;
    titleId: string;
  };

  let { action, eyebrow, title, titleId }: Props = $props();
  let titleElement = $state<HTMLHeadingElement>();

  export function focusTitle() {
    titleElement?.focus();
  }
</script>

<header class="panel-heading" class:panel-heading--action={action !== undefined}>
  <div>
    <span class="panel-eyebrow">{eyebrow}</span>
    <h2 id={titleId} bind:this={titleElement} tabindex="-1">{title}</h2>
  </div>
  {#if action}
    {@render action()}
  {/if}
</header>

<style>
  .panel-heading {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    padding: 0 22px;
    border-bottom: 1px solid var(--line);
  }

  .panel-heading--action {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
    gap: 10px;
    padding: 0 14px 0 18px;
  }

  .panel-heading--action > div {
    min-width: 0;
  }

  .panel-eyebrow {
    display: block;
    color: var(--muted);
    font-size: calc(10px * var(--text-scale));
    font-weight: 700;
    letter-spacing: 0.13em;
    line-height: 1;
    text-transform: uppercase;
  }

  h2 {
    margin-top: 7px;
    color: #222925;
    font-size: calc(18px * var(--text-scale));
    font-weight: 640;
    letter-spacing: -0.018em;
    line-height: 1;
  }
</style>
