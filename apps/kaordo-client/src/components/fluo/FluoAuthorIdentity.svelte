<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { FluoAuthorProfile } from '../../lib/domain/fluo';
  import type { FluoGState } from '../../lib/states/FluoGState';

  type Props = {
    active?: boolean;
    author: string;
    compact?: boolean;
    fluoState: FluoGState;
    onOpenProfile?: (username: string) => void;
  };

  let {
    active = true,
    author,
    compact = false,
    fluoState,
    onOpenProfile,
  }: Props = $props();

  let profile = $state<FluoAuthorProfile | null>(null);
  let profilePending = $state(false);
  let profileLoaded = $state(false);
  let open = $state(false);
  let avatarImageFailed = $state(false);
  let bannerImageFailed = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let loadSequence = 0;

  let displayName = $derived(profile?.nickname || author);
  let initial = $derived((displayName.trim().slice(0, 1) || '?').toUpperCase());

  onDestroy(cancelClose);

  $effect(() => {
    const currentAuthor = author;
    active;
    if (!active || profileLoaded) return;
    const sequence = ++loadSequence;
    if (typeof fluoState.loadAuthorProfile !== 'function') {
      profileLoaded = true;
      return;
    }
    profilePending = true;
    void fluoState.loadAuthorProfile(currentAuthor).then((value) => {
      if (sequence !== loadSequence) return;
      profile = value;
      profileLoaded = true;
      profilePending = false;
      avatarImageFailed = false;
      bannerImageFailed = false;
    });
    return () => {
      if (sequence === loadSequence) loadSequence += 1;
    };
  });

  function handleEnter(): void {
    cancelClose();
    open = true;
  }

  function cancelClose(): void {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
  }

  function scheduleClose(): void {
    cancelClose();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      open = false;
    }, 120);
  }

  function toggle(event: MouseEvent): void {
    event.stopPropagation();
    cancelClose();
    if (onOpenProfile) {
      open = false;
      onOpenProfile(author);
      return;
    }
    open = !open;
  }

  function stopPropagation(event: Event): void {
    event.stopPropagation();
  }

  function handleFocusOut(event: FocusEvent): void {
    const related = event.relatedTarget;
    const root = event.currentTarget;
    if (!(root instanceof HTMLElement) || !(related instanceof Node) || !root.contains(related)) {
      scheduleClose();
    }
  }

  function bannerStyle(): string {
    if (profile?.accentColor === 'mint') return 'background: linear-gradient(125deg, #2d9c78, #79cbb1);';
    if (profile?.accentColor === 'ocean') return 'background: linear-gradient(125deg, #3c71b8, #85b6e2);';
    if (profile?.accentColor === 'sunset') return 'background: linear-gradient(125deg, #c76c66, #e4b477);';
    if (profile?.accentColor === 'violet') return 'background: linear-gradient(125deg, #6554d9, #a79ae9);';
    return 'background: linear-gradient(125deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 35%, #72b8c2));';
  }
</script>

<span
  class="author-profile"
  class:author-profile--compact={compact}
  class:author-profile--open={open}
  role="presentation"
  onmouseenter={handleEnter}
  onmouseleave={scheduleClose}
  onfocusin={handleEnter}
  onfocusout={handleFocusOut}
>
  <button
    class="author-avatar"
    type="button"
    aria-label={`${onOpenProfile ? 'Open' : 'Show'} ${displayName}'s public profile`}
    aria-expanded={open}
    onclick={toggle}
    onkeydown={stopPropagation}
  >
    {#if profile?.avatarUrl && !avatarImageFailed}
      <img src={profile.avatarUrl} alt="" loading="lazy" onerror={() => avatarImageFailed = true} />
    {:else}
      <span aria-hidden="true">{initial}</span>
    {/if}
  </button>

  {#if open}
    <div
      class="author-popover"
      role="dialog"
      tabindex="-1"
      aria-label={`${displayName}'s public profile`}
      onmouseenter={handleEnter}
      onmouseleave={scheduleClose}
      onclick={stopPropagation}
      onkeydown={stopPropagation}
    >
      <div class="author-popover__banner" style={bannerStyle()}>
        {#if profile?.bannerUrl && !bannerImageFailed}
          <img src={profile.bannerUrl} alt="" loading="lazy" onerror={() => bannerImageFailed = true} />
        {:else}
          <span class="author-popover__banner-glow" aria-hidden="true"></span>
        {/if}
      </div>
      <div class="author-popover__body">
        <div class="author-popover__identity">
          <span class="author-popover__avatar" aria-hidden="true">
            {#if profile?.avatarUrl && !avatarImageFailed}
              <img src={profile.avatarUrl} alt="" loading="lazy" />
            {:else}
              <span>{initial}</span>
            {/if}
          </span>
          <div class="author-popover__names">
            <strong>{displayName}</strong>
            <span>@{author.toLowerCase()}</span>
          </div>
          {#if profile?.status}
            <span class="author-popover__status" title={profile.status}><i aria-hidden="true"></i>{profile.status}</span>
          {/if}
        </div>

        {#if profilePending && !profileLoaded}
          <p class="author-popover__loading">Loading public profile…</p>
        {:else if !profile}
          <p class="author-popover__empty">No public profile yet.</p>
        {:else}
          <div class="author-popover__details">
            {#if profile.pronouns}<span class="author-popover__pronouns">{profile.pronouns}</span>{/if}
            {#if profile.headline || profile.description}
              <p>{profile.headline || profile.description}</p>
            {/if}
            {#if profile.location}<span class="author-popover__meta">{profile.location}</span>{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</span>

<style>
  .author-profile {
    position: relative;
    z-index: 1;
    display: inline-flex;
    width: 38px;
    height: 38px;
    flex: none;
    align-items: center;
  }

  .author-profile--open { z-index: 20; }

  .author-avatar,
  .author-popover__avatar {
    display: grid;
    width: 38px;
    height: 38px;
    overflow: hidden;
    flex: none;
    color: #fff;
    background: var(--sui-primary);
    border: 0;
    border-radius: var(--sui-radius-sm);
    box-shadow: 0 2px 6px var(--fluo-shadow-color, rgb(39 51 67 / 18%));
    font: inherit;
    font-size: calc(12px * var(--text-scale));
    font-weight: 720;
    place-items: center;
  }

  .author-avatar {
    padding: 0;
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease, filter 150ms ease;
  }

  .author-avatar:hover,
  .author-avatar:focus-visible {
    filter: saturate(1.08);
    box-shadow: 0 5px 12px var(--fluo-shadow-color, rgb(39 51 67 / 25%));
    transform: translateY(-1px);
  }

  .author-avatar:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--sui-primary) 55%, transparent);
    outline-offset: 3px;
  }

  .author-avatar img,
  .author-popover__avatar img,
  .author-popover__banner img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .author-popover {
    position: absolute;
    top: -8px;
    left: calc(100% + 10px);
    z-index: 30;
    width: min(258px, calc(100vw - 28px));
    overflow: hidden;
    color: var(--sui-text);
    background: var(--sui-bg-light);
    border-radius: var(--sui-radius);
    box-shadow: 0 14px 32px var(--fluo-shadow-color, rgb(39 51 67 / 25%));
    pointer-events: auto;
    animation: author-popover-enter 150ms cubic-bezier(.2, .8, .2, 1) both;
  }

  .author-popover__banner {
    position: relative;
    z-index: 0;
    height: 60px;
    overflow: hidden;
  }

  .author-popover__banner::after {
    position: absolute;
    inset: 0;
    z-index: 1;
    background: linear-gradient(180deg, rgb(17 26 49 / 5%), rgb(17 26 49 / 32%));
    content: '';
    pointer-events: none;
  }

  .author-popover__banner-glow {
    position: absolute;
    right: -25px;
    bottom: -65px;
    width: 170px;
    height: 130px;
    border: 18px solid rgb(255 255 255 / 18%);
    border-radius: 50%;
    box-shadow: 0 0 0 9px rgb(255 255 255 / 8%);
  }

  .author-popover__body {
    position: relative;
    z-index: 2;
    padding: 12px 14px 14px;
  }

  .author-popover__identity {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    position: relative;
    z-index: 3;
  }

  .author-popover__avatar {
    width: 52px;
    height: 52px;
    margin-top: -29px;
    border: 4px solid var(--sui-bg-light);
    border-radius: 15px;
    box-shadow: 0 4px 9px var(--fluo-shadow-color, rgb(39 51 67 / 20%));
    font-size: calc(15px * var(--text-scale));
    position: relative;
    z-index: 4;
  }

  .author-popover__names {
    display: grid;
    min-width: 0;
    gap: 1px;
  }

  .author-popover__names strong,
  .author-popover__names span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-popover__names strong { color: var(--sui-text); font-size: calc(14px * var(--text-scale)); font-weight: 720; }
  .author-popover__names span { color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }

  .author-popover__status {
    display: inline-flex;
    max-width: 110px;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    overflow: hidden;
    padding: 5px 8px;
    color: var(--sui-text-muted);
    background: color-mix(in srgb, var(--sui-bg-dark) 58%, transparent);
    border-radius: 999px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 670;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-popover__status i {
    width: 5px;
    height: 5px;
    flex: none;
    background: var(--sui-success);
    border-radius: 50%;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--sui-success) 14%, transparent);
  }

  .author-popover__details { display: grid; gap: 6px; margin-top: 10px; }
  .author-popover__details p { margin: 0; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); line-height: 1.4; overflow-wrap: anywhere; }
  .author-popover__pronouns { color: var(--sui-primary); font-size: calc(10px * var(--text-scale)); font-weight: 700; }
  .author-popover__meta { color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .author-popover__loading, .author-popover__empty { margin: 10px 0 0; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }

  .author-profile--compact { width: 20px; height: 20px; }
  .author-profile--compact .author-avatar { width: 20px; height: 20px; border-radius: 6px; font-size: calc(8px * var(--text-scale)); }
  .author-profile--compact .author-popover { top: -11px; left: calc(100% + 8px); }

  @keyframes author-popover-enter {
    from { opacity: 0; transform: translate3d(-4px, 3px, 0) scale(.985); }
    to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  }

  @media (max-width: 560px) {
    .author-popover { top: calc(100% + 8px); left: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .author-avatar { transition: none; }
    .author-popover { animation: none; }
  }
</style>
