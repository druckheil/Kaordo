<script lang="ts">
  import ProfileEditDialog, { type ProfileEditValues } from '../dialog/ProfileEditDialog.svelte';
  import type { AuthUser } from '../../lib/domain/auth';
  import type { UserProfile } from '../../lib/domain/profile';
  import LoadingSpinner from '../ui/LoadingSpinner.svelte';

  type Props = {
    onSaveProfile: (values: ProfileEditValues) => Promise<boolean>;
    profile: UserProfile | null;
    profileError: string | null;
    profileLoading: boolean;
    profileSaving: boolean;
    user: AuthUser;
  };

  let {
    onSaveProfile,
    profile,
    profileError,
    profileLoading,
    profileSaving,
    user,
  }: Props = $props();

  let profileModal = $state(false);
  let initial = $derived((profile?.nickname || user.username).slice(0, 1).toUpperCase());
  let displayName = $derived(profile?.nickname || user.username);
  let joined = $derived(formatMonth(user.createdAt));
  let updated = $derived(profile?.updatedAt ? formatDate(profile.updatedAt) : 'Not published yet');

  function formatMonth(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(timestamp * 1_000));
  }

  function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp * 1_000));
  }

  async function submitProfileChange(values: ProfileEditValues): Promise<void> {
    if (await onSaveProfile(values)) profileModal = false;
  }
</script>

<main class="profile-shell" aria-labelledby="profile-title">
  <div class="profile-layout">
    <header class="profile-heading">
      <div>
        <span class="eyebrow">Public profile</span>
        <h1 id="profile-title">Mi</h1>
        <p>The profile other people see across Kaordo.</p>
      </div>
      <span class="profile-visibility"><i aria-hidden="true"></i> Visible to everyone</span>
    </header>

    {#if profileLoading && !profile}
      <section class="profile-loading" aria-busy="true" role="status">
        <span class="loading-orbit" aria-hidden="true"><i></i><b>M</b></span>
        <strong>Opening your public profile</strong>
        <p>Loading the details shared with your Kaordo community…</p>
      </section>
    {:else}
      <section class="profile-hero" aria-labelledby="identity-title">
        <div class="avatar" aria-hidden={!profile?.avatarUrl}>
          {#if profile?.avatarUrl}
            <img src={profile.avatarUrl} alt="" />
          {:else}
            {initial}
          {/if}
        </div>
        <div class="profile-hero-copy">
          <span class="card-label">Kaordo member</span>
          <h2 id="identity-title">{displayName}</h2>
          <p class="profile-username">@{user.username} <span aria-hidden="true">·</span> Member since {joined}</p>
          {#if profile?.description}
            <p class="profile-description">{profile.description}</p>
          {:else}
            <p class="profile-description profile-description--empty">Add a short description so people know what matters to you.</p>
          {/if}
        </div>
        <div class="profile-hero-actions">
          <button class="profile-edit-button" type="button" disabled={profileLoading || profileSaving} onclick={() => (profileModal = true)}>
            {#if profileSaving}<LoadingSpinner compact />{/if}
            {profileSaving ? 'Saving…' : 'Edit profile'}
          </button>
          <span class="profile-badge">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="m7 10 2 2 4-4" /></svg>
            Public
          </span>
        </div>
      </section>

      <div class="profile-grid">
        <section class="profile-card" aria-labelledby="about-title">
          <header class="card-heading">
            <span class="detail-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" /><path d="M10 9.3v4M10 6.8h.01" /></svg>
            </span>
            <div>
              <h2 id="about-title">About</h2>
              <p>What you choose to share publicly</p>
            </div>
          </header>
          <p class="about-copy">{profile?.description || 'Your public description will appear here once you add one.'}</p>
        </section>

        <section class="profile-card" aria-labelledby="profile-details-title">
          <header class="card-heading">
            <span class="detail-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20"><path d="M5 4h10v12H5z" /><path d="M8 7h4M8 10h4M8 13h2" /></svg>
            </span>
            <div>
              <h2 id="profile-details-title">Profile details</h2>
              <p>Public information and publishing status</p>
            </div>
          </header>
          <dl class="profile-details-list">
            <div><dt>Username</dt><dd>@{user.username}</dd></div>
            <div><dt>Member since</dt><dd>{joined}</dd></div>
            <div><dt>Last updated</dt><dd>{updated}</dd></div>
          </dl>
        </section>
      </div>

    {/if}

    {#if profileError}<p class="profile-error" role="alert">{profileError}</p>{/if}
  </div>
</main>

{#if profileModal}
  <ProfileEditDialog
    avatarUrl={profile?.avatarUrl ?? null}
    busy={profileSaving}
    description={profile?.description ?? ''}
    error={profileError}
    nickname={profile?.nickname ?? user.username}
    onCancel={() => { if (!profileSaving) profileModal = false; }}
    onSubmit={submitProfileChange}
  />
{/if}

<style>
  .profile-shell {
    --sui-bg: #e4e9f0;
    --sui-bg-light: #edf1f7;
    --sui-bg-dark: #d1d9e6;
    --sui-shadow-color: rgb(39 51 67 / 20%);
    --sui-primary: #5b54e0;
    --sui-primary-hover: #4a44c4;
    --sui-success: #1fa96e;
    --sui-text: #2d3748;
    --sui-text-muted: #5a6a7e;
    --sui-text-light: #6a7d94;
    --sui-shadow-raised: 0 9px 22px var(--sui-shadow-color), -5px -5px 14px rgb(255 255 255 / 56%);
    --sui-shadow-raised-sm: 0 4px 10px rgb(39 51 67 / 17%), -3px -3px 8px rgb(255 255 255 / 50%);
    --sui-shadow-raised-lg: 0 15px 34px rgb(39 51 67 / 22%), -6px -6px 16px rgb(255 255 255 / 48%);
    --sui-shadow-inset: inset 3px 3px 8px rgb(39 51 67 / 17%), inset -3px -3px 7px rgb(255 255 255 / 50%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(39 51 67 / 17%), inset -2px -2px 5px rgb(255 255 255 / 50%);
    min-width: 0;
    min-height: 0;
    overflow: auto;
    color: var(--sui-text);
    background: radial-gradient(circle at 76% 2%, rgb(91 84 224 / 8%), transparent 33%), var(--sui-bg);
  }

  :global(html[data-theme='dark']) .profile-shell {
    --sui-bg: #2a2d35;
    --sui-bg-light: #31343c;
    --sui-bg-dark: #23262d;
    --sui-shadow-color: rgb(0 0 0 / 42%);
    --sui-primary: #918cf2;
    --sui-primary-hover: #aaa6ff;
    --sui-success: #54c99a;
    --sui-text: #e2e8f0;
    --sui-text-muted: #aab4c5;
    --sui-text-light: #8a94a6;
    --sui-shadow-raised: 0 11px 25px rgb(0 0 0 / 42%);
    --sui-shadow-raised-sm: 0 5px 12px rgb(0 0 0 / 36%);
    --sui-shadow-raised-lg: 0 18px 40px rgb(0 0 0 / 45%);
    --sui-shadow-inset: inset 3px 3px 8px rgb(0 0 0 / 32%), inset -3px -3px 7px rgb(255 255 255 / 4%);
    --sui-shadow-inset-sm: inset 2px 2px 6px rgb(0 0 0 / 32%), inset -2px -2px 5px rgb(255 255 255 / 4%);
  }

  :global(html[data-theme='dark']) .profile-hero {
    background: linear-gradient(145deg, var(--sui-bg-light), var(--sui-bg));
    box-shadow: var(--sui-shadow-raised-lg), inset 1px 1px 0 rgb(255 255 255 / 5%);
  }

  .profile-layout { width: min(100%, 960px); min-height: 100%; margin: 0 auto; padding: 26px 30px 54px; }
  .profile-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 17px; padding: 0 2px; }
  .eyebrow, .card-label { color: var(--sui-primary); font-size: calc(8px * var(--text-scale)); font-weight: 780; letter-spacing: .15em; text-transform: uppercase; }
  .profile-heading h1 { margin-top: 4px; color: var(--sui-text); font-size: calc(27px * var(--text-scale)); font-weight: 740; letter-spacing: -.045em; }
  .profile-heading p { margin-top: 5px; color: var(--sui-text-muted); font-size: calc(10px * var(--text-scale)); }
  .profile-visibility { display: inline-flex; align-items: center; gap: 7px; color: var(--sui-success); font-size: calc(8px * var(--text-scale)); font-weight: 720; white-space: nowrap; }
  .profile-visibility i { width: 7px; height: 7px; background: var(--sui-success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--sui-success) 14%, transparent); }

  .profile-loading { display: grid; min-height: 330px; color: var(--sui-text-muted); background: var(--sui-bg); border-radius: 22px; box-shadow: var(--sui-shadow-raised-lg); place-items: center; align-content: center; text-align: center; }
  .loading-orbit { position: relative; display: grid; width: 64px; height: 64px; margin-bottom: 17px; background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-raised); place-items: center; }
  .loading-orbit i { position: absolute; inset: -6px; border: 2px solid transparent; border-top-color: var(--sui-primary); border-right-color: color-mix(in srgb, var(--sui-primary) 34%, transparent); border-radius: 50%; animation: profile-spin .9s linear infinite; }
  .loading-orbit b { display: grid; width: 41px; height: 41px; color: #fff; background: linear-gradient(145deg, var(--sui-primary), var(--sui-primary-hover)); border-radius: 13px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .profile-loading strong { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); }
  .profile-loading p { margin-top: 6px; font-size: calc(8px * var(--text-scale)); }

  .profile-hero { position: relative; display: grid; grid-template-columns: 82px minmax(0, 1fr) auto; align-items: center; gap: 18px; min-height: 148px; padding: 22px 24px; overflow: hidden; background: linear-gradient(145deg, var(--sui-bg-light), var(--sui-bg)); border-radius: 22px; box-shadow: var(--sui-shadow-raised-lg), inset 1px 1px 0 rgb(255 255 255 / 30%); animation: profile-rise 260ms cubic-bezier(.2, .8, .2, 1) both; }
  .profile-hero::after { position: absolute; right: -34px; bottom: -54px; width: 180px; height: 180px; border: 18px solid color-mix(in srgb, var(--sui-primary) 8%, transparent); border-radius: 50%; content: ''; pointer-events: none; }
  .avatar { position: relative; z-index: 1; display: grid; width: 82px; height: 82px; overflow: hidden; color: #fff; background: linear-gradient(145deg, var(--sui-primary), color-mix(in srgb, var(--sui-primary) 65%, #25314d)); border-radius: 25px; box-shadow: 8px 8px 16px rgb(39 51 67 / 19%), -5px -5px 12px rgb(255 255 255 / 52%); font-size: calc(29px * var(--text-scale)); font-weight: 740; place-items: center; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  .profile-hero-copy { position: relative; z-index: 1; min-width: 0; }
  .profile-hero-copy h2 { margin-top: 6px; color: var(--sui-text); font-size: calc(23px * var(--text-scale)); font-weight: 740; letter-spacing: -.04em; }
  .profile-username { margin-top: 5px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); }
  .profile-username span { padding: 0 4px; color: var(--sui-text-light); }
  .profile-description { max-width: 620px; margin-top: 10px; overflow-wrap: anywhere; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); line-height: 1.45; }
  .profile-description--empty { color: var(--sui-text-light); font-style: italic; }
  .profile-hero-actions { position: relative; z-index: 1; display: flex; align-items: flex-end; flex-direction: column; gap: 10px; }
  .profile-edit-button, .profile-badge, .profile-card { background: var(--sui-bg); box-shadow: var(--sui-shadow-raised-sm); }
  .profile-edit-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 104px; min-height: 36px; padding: 0 12px; color: var(--sui-primary); border: 0; border-radius: 11px; cursor: pointer; font: inherit; font-size: calc(9px * var(--text-scale)); font-weight: 710; transition: color 140ms ease, box-shadow 140ms ease, transform 140ms ease; }
  .profile-edit-button:hover:not(:disabled) { color: var(--sui-primary-hover); transform: translateY(-1px); }
  .profile-edit-button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .profile-edit-button:disabled { cursor: default; opacity: .58; }
  .profile-edit-button :global(.library-loader) { border-color: color-mix(in srgb, var(--sui-primary) 22%, transparent); border-top-color: var(--sui-primary); }
  .profile-badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; color: var(--sui-success); border-radius: 999px; font-size: calc(7px * var(--text-scale)); font-weight: 760; text-transform: uppercase; }
  .profile-badge svg { width: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }

  .profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
  .profile-card { min-width: 0; padding: 17px 18px; border-radius: 16px; animation: profile-rise 280ms cubic-bezier(.2, .8, .2, 1) both; }
  .profile-card:nth-child(2) { animation-delay: 40ms; }
  .card-heading { display: flex; align-items: center; gap: 10px; padding-bottom: 13px; border-bottom: 1px solid color-mix(in srgb, var(--sui-text-light) 18%, transparent); }
  .detail-icon { display: grid; flex: none; color: var(--sui-primary); background: var(--sui-bg); box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .detail-icon { width: 35px; height: 35px; border-radius: 11px; }
  .detail-icon svg { width: 19px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.45; }
  .card-heading h2 { color: var(--sui-text); font-size: calc(12px * var(--text-scale)); font-weight: 710; }
  .card-heading p { margin-top: 3px; color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  .about-copy { min-height: 54px; margin-top: 14px; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); line-height: 1.5; }
  .profile-details-list { margin: 11px 0 0; }
  .profile-details-list > div { display: grid; grid-template-columns: 87px minmax(0, 1fr); align-items: center; min-height: 31px; }
  dt { color: var(--sui-text-light); font-size: calc(8px * var(--text-scale)); }
  dd { min-width: 0; margin: 0; overflow: hidden; color: var(--sui-text); font-size: calc(9px * var(--text-scale)); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
  .profile-error { margin-top: 12px; padding: 10px 12px; color: #c95667; background: color-mix(in srgb, #c95667 10%, var(--sui-bg)); border-radius: 10px; font-size: calc(8px * var(--text-scale)); }
  button:focus-visible { outline: 2px solid color-mix(in srgb, var(--sui-primary) 45%, transparent); outline-offset: 3px; }
  @keyframes profile-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes profile-spin { to { transform: rotate(360deg); } }
  @media (max-width: 700px) {
    .profile-layout { padding-inline: 18px; }
    .profile-heading { align-items: flex-start; flex-direction: column; gap: 9px; }
    .profile-hero { grid-template-columns: 64px minmax(0, 1fr); padding: 18px; }
    .avatar { width: 64px; height: 64px; border-radius: 19px; }
    .profile-hero-actions { grid-column: 2; align-items: flex-start; flex-direction: row; }
    .profile-grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { .profile-hero, .profile-card, .loading-orbit i { animation: none; } .profile-edit-button { transition: none; } }
</style>
