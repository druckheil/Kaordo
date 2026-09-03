<script lang="ts">
  import type { FluoAuthorProfile, FluoPost, FluoQuote } from '../../lib/domain/fluo';
  import { fluoPostKey as postIdentity } from '../../lib/domain/fluo';
  import type { FluoGState, FluoSnapshot } from '../../lib/states/FluoGState';
  import FluoPostPage from './FluoPostPage.svelte';
  import FluoTimeline from './FluoTimeline.svelte';

  type Props = {
    active?: boolean;
    fluoState: FluoGState | null;
    onBack: () => void;
    onOpenProfile?: (username: string) => void;
    onQuote?: (post: FluoPost) => void;
    profile: FluoAuthorProfile | null;
    profileError: string | null;
    profileLoading: boolean;
    snapshot: Readonly<FluoSnapshot> | null;
    username: string;
  };

  let {
    active = true,
    fluoState,
    onBack,
    onOpenProfile,
    onQuote,
    profile,
    profileError,
    profileLoading,
    snapshot,
    username,
  }: Props = $props();

  let profileScroll = $state<HTMLDivElement>();
  let backButton = $state<HTMLButtonElement>();
  let openPostKey = $state<string | null>(null);
  let postHistory = $state<string[]>([]);
  let avatarImageFailed = $state(false);
  let bannerImageFailed = $state(false);

  let displayName = $derived(profile?.nickname || username);
  let initial = $derived((displayName.trim().slice(0, 1) || '?').toUpperCase());
  let openPost = $derived(snapshot?.posts.find((post) => postIdentity(post) === openPostKey) ?? null);
  let postBackLabel = $derived(postHistory.length > 1 ? 'Back to quoted post' : 'Back to profile');
  let profileAccent = $derived(profile?.accentColor ?? null);
  let profileDescription = $derived(profile?.description?.trim() ?? '');
  let profileHeadline = $derived(profile?.headline?.trim() ?? '');
  let profileLocation = $derived(profile?.location?.trim() ?? '');
  let profilePronouns = $derived(profile?.pronouns?.trim() ?? '');
  let profileStatus = $derived(profile?.status?.trim() ?? '');
  let profileWebsite = $derived(safeWebsite(profile?.website ?? ''));
  let profileWebsiteLabel = $derived(profileWebsite.replace(/^https?:\/\//, '').replace(/\/$/u, ''));

  $effect(() => {
    username;
    profile;
    avatarImageFailed = false;
    bannerImageFailed = false;
  });

  $effect(() => {
    if (!active) return;
    if (!openPostKey || !snapshot) return;
    if (snapshot.posts.some((post) => postIdentity(post) === openPostKey)) return;
    const fallback = [...postHistory].reverse().find((key) =>
      snapshot.posts.some((post) => postIdentity(post) === key));
    if (fallback) {
      const index = postHistory.lastIndexOf(fallback);
      postHistory = postHistory.slice(0, index + 1);
      openPostKey = fallback;
      return;
    }
    postHistory = [];
    openPostKey = null;
  });

  function safeWebsite(value: string): string {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username && !url.password ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function bannerStyle(): string {
    if (profileAccent === 'mint') return 'background: linear-gradient(125deg, #2d9c78, #79cbb1);';
    if (profileAccent === 'ocean') return 'background: linear-gradient(125deg, #3c71b8, #85b6e2);';
    if (profileAccent === 'sunset') return 'background: linear-gradient(125deg, #c76c66, #e4b477);';
    if (profileAccent === 'violet') return 'background: linear-gradient(125deg, #6554d9, #a79ae9);';
    return 'background: linear-gradient(125deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 35%, #72b8c2));';
  }

  function openPostPage(post: FluoPost, fromQuote = false): void {
    const key = postIdentity(post);
    if (fromQuote && postHistory.length) {
      if (postHistory.at(-1) !== key) postHistory = [...postHistory, key];
    } else {
      postHistory = [key];
    }
    openPostKey = key;
  }

  function closePostPage(): void {
    if (postHistory.length > 1) {
      postHistory = postHistory.slice(0, -1);
      openPostKey = postHistory.at(-1) ?? null;
      return;
    }
    postHistory = [];
    openPostKey = null;
  }

  function openQuotedPost(quote: FluoQuote): void {
    const target = snapshot?.posts.find((post) => postIdentity(post) === postIdentity(quote));
    if (target) openPostPage(target, true);
  }

  function openProfilePost(post: FluoPost): void {
    openPostPage(post);
  }

  function handleBack(): void {
    if (openPostKey) {
      closePostPage();
      return;
    }
    onBack();
  }

  function scrollToTop(): void {
    profileScroll?.scrollTo({ top: 0, behavior: 'smooth' });
  }
</script>

<section class="public-profile-page" aria-labelledby="public-profile-title">
  {#if openPost && fluoState}
    <FluoPostPage
      {fluoState}
      backLabel={postBackLabel}
      onClose={closePostPage}
      onOpenProfile={onOpenProfile}
      onOpenQuotedPost={openQuotedPost}
      onQuote={onQuote}
      post={openPost}
    />
  {:else}
    <header class="public-profile-page__header">
      <button
        bind:this={backButton}
        class="public-profile-page__back"
        type="button"
        aria-label="Back to timeline"
        onclick={handleBack}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11.5 4.5-5.5 5.5 5.5 5.5M6.5 10h8" /></svg>
        <span>Back to timeline</span>
      </button>
      <div class="public-profile-page__title">
        <span class="section-eyebrow">Public profile</span>
        <h1 id="public-profile-title">{displayName}</h1>
      </div>
      <button class="public-profile-page__top" type="button" aria-label="Scroll to top" onclick={scrollToTop}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 12 5-5 5 5M10 7v8" /></svg>
      </button>
    </header>

    <div bind:this={profileScroll} class="public-profile-page__scroll">
      <div class="public-profile-page__content">
        {#if profileLoading && !profile}
          <section class="profile-loading" aria-busy="true" role="status">
            <span class="loading-orbit" aria-hidden="true"><i></i><b>{initial}</b></span>
            <strong>Opening public profile</strong>
            <p>Loading the details shared with the Kaordo community…</p>
          </section>
        {:else}
          <section
            class="profile-hero"
            class:profile-hero--mint={profileAccent === 'mint'}
            class:profile-hero--ocean={profileAccent === 'ocean'}
            class:profile-hero--sunset={profileAccent === 'sunset'}
            aria-labelledby="profile-identity-title"
          >
            <div class="profile-banner" class:profile-banner--empty={!profile?.bannerUrl || bannerImageFailed} style={bannerStyle()}>
              {#if profile?.bannerUrl && !bannerImageFailed}
                <img src={profile.bannerUrl} alt="" onerror={() => bannerImageFailed = true} />
              {:else}
                <span class="profile-banner__glow" aria-hidden="true"></span>
                <span class="profile-banner__label">Kaordo public profile</span>
              {/if}
            </div>

            <div class="profile-hero__body">
              <div class="profile-identity">
                <div class="profile-avatar" aria-hidden={!profile?.avatarUrl || avatarImageFailed}>
                  {#if profile?.avatarUrl && !avatarImageFailed}
                    <img src={profile.avatarUrl} alt="" onerror={() => avatarImageFailed = true} />
                  {:else}
                    <span>{initial}</span>
                  {/if}
                </div>
                <div class="profile-identity__copy">
                  <span class="profile-kicker">Kaordo member</span>
                  <h2 id="profile-identity-title">{displayName}</h2>
                  <p>@{username}</p>
                </div>
                {#if profileStatus}
                  <span class="profile-status"><i aria-hidden="true"></i>{profileStatus}</span>
                {/if}
              </div>

              {#if profileHeadline}<p class="profile-headline">{profileHeadline}</p>{/if}
              {#if profileDescription}<p class="profile-description">{profileDescription}</p>{/if}

              {#if profilePronouns || profileLocation || profileWebsite}
                <div class="profile-facts" aria-label="Profile details">
                  {#if profilePronouns}<span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h8M10 4v12M6 16h8" /></svg>{profilePronouns}</span>{/if}
                  {#if profileLocation}<span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 17s5-4.2 5-8.4A5 5 0 0 0 5 8.6C5 12.8 10 17 10 17Z" /><circle cx="10" cy="8.5" r="1.5" /></svg>{profileLocation}</span>{/if}
                  {#if profileWebsite}<a href={profileWebsite} rel="noreferrer" target="_blank"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M3.5 10h13M10 3c2 2 2.8 4.3 2.8 7S12 15 10 17c-2-2-2.8-4.3-2.8-7S8 5 10 3Z" /></svg>{profileWebsiteLabel}</a>{/if}
                </div>
              {/if}
            </div>
          </section>

          <section class="profile-feed-card" aria-labelledby="profile-feed-title">
            <header class="profile-feed-heading">
              <div>
                <span class="section-eyebrow">From this member</span>
                <h2 id="profile-feed-title">Posts by @{username}</h2>
              </div>
              {#if snapshot?.posts.length}
                <span class="profile-post-count">{snapshot.posts.length}{snapshot.hasMore ? '+' : ''} posts</span>
              {/if}
            </header>

            {#if profileError}
              <p class="profile-error" role="alert">{profileError}</p>
            {:else if !fluoState || !snapshot}
              <div class="feed-loading" aria-busy="true"><i></i><span>Preparing this timeline…</span></div>
            {:else if snapshot.storageError}
              <p class="profile-error" role="alert">{snapshot.storageError}</p>
            {:else if snapshot.posts.length || snapshot.isLoading || snapshot.hasMore}
              <FluoTimeline
                active={active && !openPost}
                hasMore={snapshot.hasMore}
                isLoading={snapshot.isLoading}
                isLoadingMore={snapshot.isLoadingMore}
                isRefreshing={snapshot.isRefreshing}
                {fluoState}
                onOpenPost={openProfilePost}
                onOpenProfile={onOpenProfile}
                onOpenQuotedPost={openQuotedPost}
                onQuote={onQuote}
                posts={snapshot.posts}
                scrollElement={profileScroll}
              />
            {:else}
              <div class="empty-profile-feed">
                <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 5h12v10H9l-3 3V5Zm4 4h4m-4 3h6" /></svg></span>
                <strong>No posts yet</strong>
                <p>Posts by @{username} from available Nodos will appear here.</p>
              </div>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}
</section>

<style>
  .public-profile-page {
    position: absolute;
    inset: 0;
    z-index: 96;
    display: grid;
    grid-template-rows: 54px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --fluo-shadow-color: rgb(39 51 67 / 20%);
    --sui-shadow-light: transparent !important;
    --sui-shadow-dark: var(--fluo-shadow-color) !important;
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-radius-sm: 12px;
    --sui-radius: 20px;
    --sui-radius-lg: 28px;
    --sui-shadow-raised: 0 5px 14px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-sm: 0 3px 8px var(--fluo-shadow-color) !important;
    --sui-shadow-raised-lg: 0 16px 36px var(--fluo-shadow-color) !important;
    --sui-shadow-inset-sm: inset 2px 2px 5px var(--sui-shadow-dark);
    color: var(--sui-text);
    background: var(--sui-bg);
    animation: public-profile-enter 180ms ease-out both;
  }

  :global(html[data-theme='dark']) .public-profile-page {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --fluo-shadow-color: rgb(0 0 0 / 42%);
    --sui-primary: var(--accent, #69a993);
    --sui-primary-hover: color-mix(in srgb, var(--sui-primary) 84%, white);
    --sui-success: #54c99a;
    --sui-text: #e2e8f0;
    --sui-text-muted: #9ba5b8;
    --sui-text-light: #8a94a6;
  }

  .public-profile-page__header {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    min-height: 40px;
    margin: 7px 12px 0;
    padding: 0 14px;
    background: var(--sui-bg-light);
    border-radius: var(--sui-radius);
    box-shadow: var(--sui-shadow-raised);
  }

  .public-profile-page__title { display: grid; justify-items: center; min-width: 0; }
  .public-profile-page__title h1 { max-width: min(360px, 42vw); margin: 2px 0 0; overflow: hidden; color: var(--sui-text); font-size: calc(13px * var(--text-scale)); font-weight: 720; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
  .section-eyebrow { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 730; letter-spacing: .13em; text-transform: uppercase; }

  .public-profile-page__back,
  .public-profile-page__top {
    display: inline-flex;
    align-items: center;
    justify-self: start;
    gap: 7px;
    min-height: 31px;
    padding: 0 10px;
    color: var(--sui-primary);
    background: var(--sui-bg);
    border: 0;
    border-radius: 11px;
    box-shadow: var(--sui-shadow-raised-sm);
    cursor: pointer;
    font: inherit;
    font-size: calc(8px * var(--text-scale));
    font-weight: 680;
    transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
  }

  .public-profile-page__top { justify-self: end; padding: 0 9px; }
  .public-profile-page__back:hover,
  .public-profile-page__top:hover { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .public-profile-page__back:active,
  .public-profile-page__top:active { box-shadow: var(--sui-shadow-inset-sm); transform: translateY(1px); }
  .public-profile-page__back:focus-visible,
  .public-profile-page__top:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 48%, transparent); outline-offset: 3px; }
  .public-profile-page__back svg,
  .public-profile-page__top svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }

  .public-profile-page__scroll { min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; }
  .public-profile-page__content { width: min(100%, 820px); margin: 0 auto; padding: 28px 28px 72px; }

  .profile-loading,
  .profile-hero,
  .profile-feed-card { background: var(--sui-bg); border-radius: var(--sui-radius); box-shadow: var(--sui-shadow-raised); }
  .profile-loading { display: grid; justify-items: center; gap: 8px; min-height: 230px; padding: 56px 24px; color: var(--sui-text-muted); text-align: center; }
  .profile-loading strong { color: var(--sui-text); font-size: calc(14px * var(--text-scale)); }
  .profile-loading p { max-width: 320px; font-size: calc(10px * var(--text-scale)); line-height: 1.5; }
  .loading-orbit { position: relative; display: grid; width: 52px; height: 52px; margin-bottom: 5px; color: var(--sui-primary); background: var(--sui-bg-light); border-radius: 17px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .loading-orbit b { font-size: 19px; font-weight: 730; }
  .loading-orbit i { position: absolute; inset: 7px; border: 2px solid color-mix(in srgb, var(--sui-primary) 25%, transparent); border-top-color: var(--sui-primary); border-radius: 50%; animation: profile-spin 800ms linear infinite; }

  .profile-hero { overflow: hidden; }
  .profile-banner { position: relative; height: 164px; overflow: hidden; isolation: isolate; }
  .profile-banner::after { position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, transparent 28%, rgb(24 33 47 / 28%)); content: ''; pointer-events: none; }
  .profile-banner img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .profile-banner--empty { display: grid; place-items: center; }
  .profile-banner__glow { position: absolute; width: 320px; height: 190px; background: radial-gradient(ellipse, rgb(255 255 255 / 31%), transparent 66%); filter: blur(6px); transform: rotate(-9deg); }
  .profile-banner__label { position: relative; z-index: 2; color: rgb(255 255 255 / 86%); font-size: calc(10px * var(--text-scale)); font-weight: 680; letter-spacing: .08em; text-transform: uppercase; }

  .profile-hero__body { position: relative; z-index: 2; padding: 0 24px 24px; }
  .profile-identity { display: flex; align-items: flex-start; gap: 15px; min-width: 0; margin-top: -43px; }
  .profile-avatar { position: relative; z-index: 3; display: grid; width: 92px; height: 92px; flex: none; overflow: hidden; color: #fff; background: var(--sui-primary); border: 6px solid var(--sui-bg); border-radius: 27px; box-shadow: var(--sui-shadow-raised-lg); font-size: 28px; font-weight: 740; place-items: center; }
  .profile-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
  /* Keep the avatar overlap, but place all identity text below the banner so
     it always uses the solid profile surface for contrast. */
  .profile-identity__copy { position: relative; z-index: 4; min-width: 0; padding-top: 48px; }
  .profile-kicker { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 730; letter-spacing: .13em; text-transform: uppercase; }
  .profile-identity h2 { margin-top: 4px; overflow: hidden; color: var(--sui-text); font-size: calc(25px * var(--text-scale)); font-weight: 720; letter-spacing: -.035em; text-overflow: ellipsis; white-space: nowrap; }
  .profile-identity__copy p { margin-top: 3px; color: var(--sui-text-muted); font-size: calc(11px * var(--text-scale)); }
  .profile-status { display: inline-flex; align-self: flex-end; align-items: center; gap: 6px; max-width: 150px; margin-left: auto; margin-bottom: 10px; padding: 7px 10px; overflow: hidden; color: var(--sui-text-muted); background: var(--sui-bg-light); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(9px * var(--text-scale)); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .profile-status i { width: 7px; height: 7px; flex: none; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-success) 15%, transparent); }
  .profile-headline { margin-top: 20px; color: var(--sui-text); font-size: calc(15px * var(--text-scale)); font-weight: 650; line-height: 1.4; }
  .profile-description { max-width: 680px; margin-top: 8px; color: var(--sui-text-muted); font-size: calc(11px * var(--text-scale)); line-height: 1.62; white-space: pre-wrap; overflow-wrap: anywhere; }
  .profile-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .profile-facts span,
  .profile-facts a { display: inline-flex; align-items: center; gap: 6px; min-height: 29px; padding: 0 10px; color: var(--sui-text-muted); background: var(--sui-bg-light); border-radius: 999px; box-shadow: var(--sui-shadow-raised-sm); font-size: calc(9px * var(--text-scale)); text-decoration: none; transition: color 140ms ease, transform 140ms ease, box-shadow 140ms ease; }
  .profile-facts a:hover { color: var(--sui-primary); transform: translateY(-1px); }
  .profile-facts svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }

  .profile-feed-card { margin-top: 18px; padding: 20px 20px 16px; }
  .profile-feed-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding: 0 4px 9px; }
  .profile-feed-heading h2 { margin-top: 5px; color: var(--sui-text); font-size: calc(17px * var(--text-scale)); font-weight: 700; letter-spacing: -.025em; }
  .profile-post-count { padding: 5px 9px; color: var(--sui-text-muted); background: var(--sui-bg-light); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(8px * var(--text-scale)); font-weight: 650; white-space: nowrap; }
  .profile-feed-card :global(.post-list) { margin-top: 5px; }
  .profile-feed-card :global(.feed-page-loader) { min-height: 42px; }
  .profile-error { margin: 8px 4px; padding: 9px 11px; color: color-mix(in srgb, #d03a5c 80%, var(--sui-text)); background: color-mix(in srgb, #d03a5c 10%, var(--sui-bg)); border-radius: var(--sui-radius-sm); font-size: calc(10px * var(--text-scale)); }
  .feed-loading { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 120px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }
  .feed-loading i { width: 14px; height: 14px; border: 2px solid color-mix(in srgb, var(--sui-shadow-dark) 55%, transparent); border-top-color: var(--sui-primary); border-radius: 50%; animation: profile-spin .7s linear infinite; }
  .empty-profile-feed { display: grid; justify-items: center; gap: 8px; min-height: 150px; padding: 34px 20px 26px; color: var(--sui-text-muted); text-align: center; }
  .empty-profile-feed > span { display: grid; width: 38px; height: 38px; color: var(--sui-primary); background: var(--sui-bg-light); border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .empty-profile-feed svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .empty-profile-feed strong { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); }
  .empty-profile-feed p { font-size: calc(9px * var(--text-scale)); }

  @keyframes public-profile-enter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes profile-spin { to { transform: rotate(360deg); } }

  @media (max-width: 600px) {
    .public-profile-page__header { margin-inline: 8px; padding-inline: 10px; }
    .public-profile-page__back span { display: none; }
    .public-profile-page__content { padding: 18px 14px 48px; }
    .profile-banner { height: 128px; }
    .profile-hero__body { padding-inline: 16px; }
    .profile-avatar { width: 74px; height: 74px; border-radius: 22px; border-width: 5px; font-size: 23px; }
    .profile-identity { gap: 10px; margin-top: -34px; }
    .profile-identity__copy { padding-top: 36px; }
    .profile-identity h2 { font-size: calc(19px * var(--text-scale)); }
    .profile-status { max-width: 112px; margin-bottom: 6px; }
    .profile-feed-card { padding-inline: 12px; }
    .profile-feed-heading { align-items: flex-start; flex-direction: column; }
  }

  @media (prefers-reduced-motion: reduce) {
    .public-profile-page { animation: none; }
    .loading-orbit i,
    .feed-loading i { animation: none; }
  }
</style>
