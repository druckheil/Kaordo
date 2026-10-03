<script lang="ts">
  // Lists community members and exposes owner actions in either responsive panel

  import type { RondoDetail } from '@kaordo/contracts';
  import { Button, ChevronRightIcon, UserPlusIcon } from '@kaordo/ui';
  import { getInitials } from './rondo-state';

  let {
    current,
    userId,
    onInvite,
    onHide,
    hideButton = $bindable(null)
  }: {
    current: RondoDetail;
    userId: string;
    onInvite: () => void;
    onHide: () => void;
    hideButton?: HTMLButtonElement | null;
  } = $props();
</script>

<div class="flex min-h-16 items-center gap-2 border-b border-border/70 px-4">
  <div class="min-w-0 flex-1">
    <h2 class="text-sm font-bold">Members</h2>
    <p class="text-xs text-muted-foreground">{current.server.memberCount} in this server</p>
  </div>
  {#if current.server.ownerId === userId}
    <Button size="icon-xs" variant="ghost" aria-label="Invite member" title="Invite member" onclick={onInvite}>
      <UserPlusIcon class="size-4" />
    </Button>
  {/if}
  <Button bind:ref={hideButton} size="icon-xs" variant="ghost" aria-label="Hide members" title="Hide members" onclick={onHide}>
    <ChevronRightIcon class="size-4" />
  </Button>
</div>

<div class="kaordo-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
  {#each current.members as member (member.id)}
    <div class="flex items-center gap-2.5 rounded-xl px-2 py-2">
      <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-xs font-bold text-primary">
        {getInitials(member.displayName)}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{member.displayName}</span>
        <span class="block truncate text-xs text-muted-foreground">@{member.username}</span>
      </span>
      {#if member.id === current.server.ownerId}
        <span class="text-[10px] font-semibold text-primary" title="Server owner">Owner</span>
      {/if}
    </div>
  {/each}
  {#if current.server.memberCount > current.members.length}
    <p class="px-2 py-3 text-xs text-muted-foreground">Showing the first {current.members.length} members.</p>
  {/if}
</div>
