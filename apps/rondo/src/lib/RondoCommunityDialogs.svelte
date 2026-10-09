<script lang="ts">
	// Presents community creation, discovery, invitation and leave dialogs
	import { UserAvatar } from '@kaordo/account-ui';
	import {
		AlertDialog,
		Button,
		Dialog,
		Input,
		SearchIcon,
		Textarea,
		UserPlusIcon
	} from '@kaordo/ui';
	import { getInitials as initials } from './rondo-state';
	import type { RondoCommunityState, RondoDialogMode } from './community-state.svelte.ts';

	let { state }: { state: RondoCommunityState } = $props();

	const dialogCopy: Record<RondoDialogMode, { title: string; description: string }> = {
		create: {
			title: 'Create a server',
			description: 'Start with a general channel and invite people when you are ready.'
		},
		discover: {
			title: 'Explore servers',
			description: 'Join a public community.'
		},
		channel: {
			title: 'Create a channel',
			description: 'Every channel has messages and its own voice room.'
		},
		invite: {
			title: 'Invite a member',
			description: 'Find a Kaordo account by username.'
		}
	};
</script>

<Dialog.Root open={!!state.dialog} onOpenChange={state.handleDialogOpenChange}>
	<Dialog.Content class="max-h-[90dvh] overflow-hidden p-2 sm:max-w-lg">
		<div class="kaordo-scrollbar max-h-[calc(90dvh-1rem)] space-y-4 overflow-y-auto p-3 sm:p-5">
			<Dialog.Header class="pr-8"
				><Dialog.Title class="text-xl font-bold"
					>{dialogCopy[state.dialogContentMode].title}</Dialog.Title
				>
				<Dialog.Description>{dialogCopy[state.dialogContentMode].description}</Dialog.Description
				></Dialog.Header
			>
			{#if state.dialogContentMode === 'create'}
				<label class="block text-sm font-semibold" for="rondo-name">Server name</label>
				<Input
					id="rondo-name"
					bind:value={state.serverName}
					maxlength={100}
					placeholder="Your community"
				/>
				<label class="block text-sm font-semibold" for="rondo-description">Description</label>
				<Textarea
					id="rondo-description"
					bind:value={state.serverDescription}
					maxlength={500}
					rows={3}
					placeholder="What brings people together?"
				/>
				<fieldset class="space-y-2">
					<legend class="text-sm font-semibold">Access</legend>
					<label class="flex items-center gap-2 text-sm"
						><input
							type="radio"
							bind:group={state.serverAccess}
							value="private"
							class="accent-primary"
						/> Private · owner invites members</label
					>
					<label class="flex items-center gap-2 text-sm"
						><input
							type="radio"
							bind:group={state.serverAccess}
							value="public"
							class="accent-primary"
						/> Public · anyone can join</label
					>
				</fieldset>
				<Dialog.Footer
					><Button
						disabled={state.dialogBusy || !state.serverName.trim()}
						onclick={() => void state.createServer()}
						>{state.dialogBusy ? 'Creating…' : 'Create server'}</Button
					></Dialog.Footer
				>
			{:else if state.dialogContentMode === 'discover'}
				<label class="relative block"
					><SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/><Input
						aria-label="Search public servers"
						placeholder="Search public servers"
						class="pl-10"
						value={state.discoverInput}
						oninput={(event) => state.search(event.currentTarget.value, 'discover')}
					/></label
				>
				{#if state.discoverQuery.isPending}<p
						class="py-5 text-center text-sm text-muted-foreground"
						role="status"
					>
						Loading communities…
					</p>
				{:else if state.discoverQuery.error}<p class="text-sm text-destructive" role="alert">
						Could not load public servers.
					</p>
				{:else if !state.discoverQuery.data?.items.length}<p
						class="py-5 text-center text-sm text-muted-foreground"
					>
						No public servers found.
					</p>
				{:else}<div class="space-y-2">
						{#each state.discoverQuery.data.items as item (item.id)}
							<div class="flex items-center gap-3 rounded-xl border border-border p-3">
								<span
									class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft font-bold text-primary-soft-foreground"
									>{initials(item.name)}</span
								>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-bold">{item.name}</p>
									<p class="truncate text-xs text-muted-foreground">
										{item.memberCount} members · {item.description || 'Public community'}
									</p>
								</div>
								<Button
									size="sm"
									disabled={state.dialogBusy}
									onclick={() => void state.joinServer(item)}>Join</Button
								>
							</div>
						{/each}
					</div>{/if}
			{:else if state.dialogContentMode === 'channel'}
				<label class="block text-sm font-semibold" for="rondo-channel">Channel name</label><Input
					id="rondo-channel"
					bind:value={state.channelName}
					maxlength={80}
					placeholder="ideas"
				/>
				<Dialog.Footer
					><Button
						disabled={state.dialogBusy || !state.channelName.trim()}
						onclick={() => void state.createChannel()}
						>{state.dialogBusy ? 'Creating…' : 'Create channel'}</Button
					></Dialog.Footer
				>
			{:else if state.dialogContentMode === 'invite'}
				<label class="block text-sm font-semibold" for="rondo-invite">Find an account</label><Input
					id="rondo-invite"
					placeholder="Search by username"
					value={state.inviteInput}
					oninput={(event) => state.search(event.currentTarget.value, 'invite')}
				/>
				{#if state.inviteTerm.length < 2}<p class="text-sm text-muted-foreground">
						Type at least two characters.
					</p>
				{:else if state.inviteQuery.isPending}<p
						class="text-sm text-muted-foreground"
						role="status"
					>
						Searching accounts…
					</p>
				{:else if state.inviteQuery.error}<p class="text-sm text-destructive" role="alert">
						Search is unavailable.
					</p>
				{:else if !state.inviteCandidates.length}<p class="text-sm text-muted-foreground">
						{state.inviteQuery.data?.items.length
							? 'Everyone matching is already in this server.'
							: 'No accounts found.'}
					</p>
				{:else}<div class="space-y-1">
						{#each state.inviteCandidates as candidate (candidate.id)}
							<button
								type="button"
								disabled={state.dialogBusy}
								onclick={() => void state.invite(candidate.id)}
								class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
								><UserAvatar
									user={candidate}
									class="size-9 rounded-xl [&_[data-slot=avatar-fallback]]:text-xs"
								/><span class="min-w-0 flex-1"
									><span class="block truncate text-sm font-semibold">{candidate.displayName}</span
									><span class="block truncate text-xs text-muted-foreground"
										>@{candidate.username}</span
									></span
								><UserPlusIcon class="size-4 text-link" /></button
							>
						{/each}
					</div>{/if}
			{/if}
			{#if state.dialogError}<p
					class="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
					role="alert"
				>
					{state.dialogError}
				</p>{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={state.leaveOpen}>
	<AlertDialog.Content
		><AlertDialog.Header
			><AlertDialog.Title>Leave this server?</AlertDialog.Title><AlertDialog.Description
				>You will lose access to its channels and voice rooms. The owner can invite you again.</AlertDialog.Description
			></AlertDialog.Header
		>
		<AlertDialog.Footer
			><AlertDialog.Cancel disabled={state.dialogBusy}>Cancel</AlertDialog.Cancel><Button
				variant="destructive"
				disabled={state.dialogBusy}
				onclick={() => void state.leaveServer()}>Leave server</Button
			></AlertDialog.Footer
		>
	</AlertDialog.Content>
</AlertDialog.Root>
