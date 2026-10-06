<script lang="ts">
  // Renders responsive Fluo preference selectors and immediate feedback with shared radio controls

  import { MediaQuery } from 'svelte/reactivity';
  import type { FluoNotificationPreferences, FluoSettings, UserIdentity } from '@kaordo/contracts';
  import { appPaths } from '@kaordo/links';
  import {
    BellIcon, Button, ChevronLeftIcon, ChevronRightIcon, RadioGroup, ShieldCheckIcon,
    ThumbsUpIcon, ThumbsDownIcon, MessageCircleIcon, UserPlusIcon, UserMinusIcon, Repeat2Icon,
    CheckIcon, LoaderCircleIcon
  } from '@kaordo/ui';
  import type { FluoSettingsSection, FluoView } from './fluo-model';
  import type { FluoSettingChange, FluoSettingsState } from './settings-state.svelte.ts';

  let { section, state, user, onNavigate }: {
    section: FluoSettingsSection | null;
    state: FluoSettingsState;
    user: UserIdentity;
    onNavigate: (view: FluoView) => void;
  } = $props();

  const id = $props.id();
  const wide = new MediaQuery('(min-width: 640px)', false);
  const settings = $derived(state.settings);
  const saving = $derived(state.isSaving);
  const notificationRows = [
    { key: 'likes', label: 'Likes', description: 'When someone likes your post.', icon: ThumbsUpIcon },
    { key: 'dislikes', label: 'Dislikes', description: 'When someone dislikes your post.', icon: ThumbsDownIcon },
    { key: 'replies', label: 'Replies', description: 'When someone replies to your post.', icon: MessageCircleIcon },
    { key: 'follows', label: 'Follows', description: 'When someone starts following you.', icon: UserPlusIcon },
    { key: 'unfollows', label: 'Unfollows', description: 'When someone stops following you.', icon: UserMinusIcon },
    { key: 'quotes', label: 'Quotes', description: 'When someone quotes your post.', icon: Repeat2Icon }
  ] as const satisfies readonly { key: keyof FluoNotificationPreferences; label: string; description: string; icon: typeof BellIcon }[];
  const privacyRows = [
    {
      key: 'accountVisibility', label: 'Account', icon: ShieldCheckIcon,
      description: 'A private account shares posts only with people you follow. Posts you individually mark private stay visible only to you.'
    },
    {
      key: 'showLikes', label: 'Show others what I like', icon: ThumbsUpIcon,
      description: 'When hidden, your likes still increase the count. Your name is hidden from post authors and other people.'
    }
  ] as const;
  const rows = $derived(section === 'notifications' ? notificationRows : privacyRows);
  const labels = new Map([...notificationRows, ...privacyRows].map((row) => [row.key, row.label] as const));
  const notificationOptions = [
    { value: 'all', label: 'Notify' },
    { value: 'off', label: 'Off' },
    { value: 'following', label: 'Only people I follow' }
  ] as const;
  const accountOptions = [{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }] as const;
  const likeOptions = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as const;
  const notificationTones = { all: 'primary', off: 'muted', following: 'accent' } as const;

  function choiceFor(settings: FluoSettings, field: FluoSettingChange['field']) {
    if (field === 'accountVisibility') {
      const value = settings.privacy.accountVisibility;
      return { value, options: accountOptions, tone: value === 'private' ? 'primary' : 'muted' };
    }
    if (field === 'showLikes') {
      const visible = settings.privacy.showLikes;
      return { value: visible ? 'yes' : 'no', options: likeOptions, tone: visible ? 'primary' : 'muted' };
    }
    const value = settings.notifications[field];
    return { value, options: notificationOptions, tone: notificationTones[value] };
  }

  function changeSetting(field: FluoSettingChange['field'], value: string): void {
    if (!settings || choiceFor(settings, field).value === value) return;
    switch (field) {
      case 'accountVisibility':
        if (value === 'public' || value === 'private') state.save.mutate({ field, value });
        return;
      case 'showLikes':
        if (value === 'yes' || value === 'no') state.save.mutate({ field, value: value === 'yes' });
        return;
      default:
        if (value === 'all' || value === 'off' || value === 'following') state.save.mutate({ field, value });
    }
  }
</script>

{#snippet choices(key: string, value: string, options: readonly { value: string; label: string }[], onChange: (value: string) => void)}
  <div
    class="choice-field mt-4" data-stacked={options.length === 3}
    style={`--choice-count: ${options.length}; --choice-index: ${options.findIndex((option) => option.value === value)}`}
  >
    <RadioGroup.Root
      {value} onValueChange={onChange}
      orientation={options.length === 3 && !wide.current ? 'vertical' : 'horizontal'}
      aria-labelledby={`${id}-${key}-label`} aria-describedby={`${id}-${key}-description`}
      class={`relative isolate auto-rows-fr gap-1 rounded-2xl border border-border bg-muted/45 p-1 ${options.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}
    >
      <span class="choice-highlight rounded-xl shadow-sm" aria-hidden="true"></span>
      {#each options as option (option.value)}
        <label
          for={`${id}-${key}-${option.value}`}
          class="group/field-label relative z-10 flex min-h-11 cursor-pointer items-center justify-center gap-2.5 rounded-xl px-3 py-2.5 text-center text-sm font-medium text-muted-foreground transition-[color,background-color,transform] duration-200 hover:bg-foreground/5 hover:text-foreground active:translate-y-px has-data-[state=checked]:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:transform-none"
        >
          <RadioGroup.Item id={`${id}-${key}-${option.value}`} value={option.value} />
          <span class="min-w-0 leading-5">{option.label}</span>
        </label>
      {/each}
    </RadioGroup.Root>
  </div>
{/snippet}

{#if section === null}
  <nav class="grid gap-3" aria-label="Fluo settings">
    {#each [
      { view: 'settings/notifications', label: 'Notifications', description: 'Likes, replies, follows and more.', icon: BellIcon },
      { view: 'settings/privacy', label: 'Privacy', description: 'Who can see your posts and likes.', icon: ShieldCheckIcon }
    ] as const as item (item.view)}
      {@const Icon = item.icon}
      <Button
        variant="outline"
        class="group/settings-entry h-auto min-h-24 w-full justify-start gap-4 rounded-[1.5rem] bg-card px-5 py-5 text-left whitespace-normal shadow-sm hover:border-primary/35 hover:shadow-md"
        onclick={() => onNavigate(item.view)}
      >
        <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground"><Icon class="size-5" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-base font-semibold">{item.label}</span>
          <span class="mt-1 block text-sm font-normal leading-5 text-muted-foreground">{item.description}</span>
        </span>
        <ChevronRightIcon class="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/settings-entry:translate-x-1 motion-reduce:transition-none motion-reduce:transform-none" />
      </Button>
    {/each}
  </nav>
  <div class="mt-6 rounded-[1.5rem] border border-border bg-card p-5 shadow-sm">
    <h2 class="text-base font-semibold">Kaordo account</h2>
    <p class="mt-1 text-sm text-muted-foreground">{user.displayName} · @{user.username}</p>
    <p class="mt-4 text-sm leading-6 text-muted-foreground">Manage your account and sign-in security in Kaordo Identity.</p>
    <Button class="mt-4" href={appPaths.portal} rel="external" variant="outline" size="sm">Open Kaordo account</Button>
  </div>
{:else}
  <Button class="mb-4" variant="ghost" size="sm" onclick={() => onNavigate('settings')}>
    <ChevronLeftIcon class="size-4" />Settings
  </Button>

  {#if settings}
    <div class="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-sm">
      {#each rows as row (row.key)}
        {@const Icon = row.icon}
        {@const choice = choiceFor(settings, row.key)}
        <section class="settings-row border-b border-border p-5 last:border-b-0" data-tone={choice.tone} aria-labelledby={`${id}-${row.key}-label`}>
          <div class="flex items-start gap-3">
            <span
              data-tone={choice.tone}
              class="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground transition-[background-color,color] duration-200 data-[tone=primary]:bg-primary/10 data-[tone=primary]:text-link data-[tone=accent]:bg-accent data-[tone=accent]:text-accent-foreground motion-reduce:transition-none"
              aria-hidden="true"
            ><Icon class="size-5" /></span>
            <div>
              <h2 id={`${id}-${row.key}-label`} class="text-base font-semibold">{row.label}</h2>
              <p id={`${id}-${row.key}-description`} class="mt-1 text-sm leading-5 text-muted-foreground">{row.description}</p>
            </div>
          </div>
          {@render choices(row.key, choice.value, choice.options, (value) => changeSetting(row.key, value))}
        </section>
      {/each}
    </div>

    <div class="mt-3 flex min-h-5 items-center gap-2 text-sm text-muted-foreground" role="status">
      {#if saving}
        <LoaderCircleIcon class="size-3.5 shrink-0 motion-safe:animate-spin" />Saving…
      {:else if state.failures.length > 0}
        Some changes could not be saved.
      {:else if state.save.isSuccess}
        <CheckIcon class="size-3.5 shrink-0 text-link" />Changes saved.
      {:else}Changes save automatically.{/if}
    </div>
    {#each state.failures as failure (failure.id)}
      <div class="mt-3 rounded-xl border border-destructive/35 bg-card p-4">
        <p class="text-sm text-destructive" role="alert">{labels.get(failure.change.field)}: {failure.error?.message ?? 'Could not save your settings.'}</p>
        <Button class="mt-3" variant="outline" size="sm" onclick={() => state.save.mutate(failure.change)}>Try again</Button>
      </div>
    {/each}
  {:else if state.query.isError}
    <div class="rounded-[1.5rem] border border-destructive/35 bg-card p-5">
      <p class="text-sm text-destructive" role="alert">{state.query.error?.message ?? 'Could not load your settings.'}</p>
      <Button class="mt-3" variant="outline" size="sm" onclick={() => void state.query.refetch()}>Try again</Button>
    </div>
  {:else}
    <p class="rounded-[1.5rem] border border-border bg-card px-6 py-14 text-center text-sm text-muted-foreground" role="status">Loading settings…</p>
  {/if}
{/if}

<style>
  /* The highlight follows equal grid tracks without measurements or replacing radio controls */
  .choice-highlight {
    --choice-gap: var(--spacing);
    position: absolute;
    pointer-events: none;
    inset-block: var(--choice-gap);
    left: var(--choice-gap);
    width: calc((100% - 2 * var(--choice-gap) - (var(--choice-count) - 1) * var(--choice-gap)) / var(--choice-count));
    border: 1px solid color-mix(in oklch, var(--primary) 25%, var(--border));
    background: var(--card);
    transform: translateX(calc(var(--choice-index) * (100% + var(--choice-gap))));
    transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .settings-row { transition: background-color 220ms ease; }
  .settings-row[data-tone='primary'] { background: color-mix(in oklch, var(--primary) 3%, var(--card)); }
  .settings-row[data-tone='accent'] { background: color-mix(in oklch, var(--accent) 8%, var(--card)); }

  @media (width < 640px) {
    .choice-field[data-stacked='true'] .choice-highlight {
      top: var(--choice-gap);
      bottom: auto;
      width: calc(100% - 2 * var(--choice-gap));
      height: calc((100% - 2 * var(--choice-gap) - (var(--choice-count) - 1) * var(--choice-gap)) / var(--choice-count));
      transform: translateY(calc(var(--choice-index) * (100% + var(--choice-gap))));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .choice-highlight, .settings-row { transition: none; }
  }
</style>
