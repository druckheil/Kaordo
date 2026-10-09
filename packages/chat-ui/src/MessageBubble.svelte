<script lang="ts">
	// Renders one conversation message with its attachments, reactions, and actions

	import { tick } from 'svelte';
	import type { LigoMedia, LigoMessage, LigoReaction } from '@kaordo/contracts';
	import { UserAvatar } from '@kaordo/account-ui';
	import { MessageMediaGrid, type MediaAttachment } from '@kaordo/media-ui';
	import {
		AlertDialog,
		Attachment,
		Bubble,
		Button,
		CheckCheckIcon,
		CheckIcon,
		ContextMenu,
		DropdownMenu,
		EllipsisIcon,
		FileIcon,
		HeartIcon,
		Message,
		PencilIcon,
		Textarea,
		ThumbsDownIcon,
		ThumbsUpIcon,
		Trash2Icon
	} from '@kaordo/ui';
	import { formatFileSize, formatMessageTime, splitMessageText } from './message-formatting';

	let {
		message,
		viewerId,
		personal,
		showSender,
		showAvatarSlot,
		react,
		edit,
		remove,
		showReceipt = true
	}: {
		message: LigoMessage;
		viewerId: string;
		personal: boolean;
		showReceipt?: boolean;
		showSender: boolean;
		showAvatarSlot: boolean;
		react: (message: LigoMessage, emoji: LigoReaction['emoji']) => Promise<void>;
		edit: (message: LigoMessage, text: string) => Promise<void>;
		remove: (message: LigoMessage) => Promise<void>;
	} = $props();

	const own = $derived(message.sender.id === viewerId);
	const visuals = $derived(
		message.media.filter((item): item is LigoMedia & MediaAttachment => item.kind !== 'file')
	);
	const documents = $derived(message.media.filter((item) => item.kind === 'file'));
	const hasAttachments = $derived(message.media.length > 0);
	let editing = $state(false);
	let editText = $state('');
	let editor = $state<HTMLTextAreaElement | null>(null);
	let deleteOpen = $state(false);
	let busy = $state(false);
	let error = $state('');

	const choices: { emoji: LigoReaction['emoji']; label: string; icon: typeof HeartIcon }[] = [
		{ emoji: '❤️', label: 'Heart', icon: HeartIcon },
		{ emoji: '👍', label: 'Like', icon: ThumbsUpIcon },
		{ emoji: '👎', label: 'Dislike', icon: ThumbsDownIcon }
	];

	function startEdit() {
		editText = message.text;
		error = '';
		editing = true;
		void tick().then(() => editor?.focus());
	}

	async function saveEdit() {
		if (busy || editText.length > 4000 || (!editText.trim() && !message.media.length)) return;
		busy = true;
		error = '';
		try {
			await edit(message, editText.trim());
			editing = false;
		} catch (reason) {
			error = errorMessage(reason, 'Could not edit the message.');
		} finally {
			busy = false;
		}
	}

	async function toggleReaction(emoji: LigoReaction['emoji']) {
		try {
			await react(message, emoji);
		} catch (reason) {
			error = errorMessage(reason, 'Could not add the reaction.');
		}
	}

	async function confirmDelete() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			await remove(message);
			deleteOpen = false;
		} catch (reason) {
			error = errorMessage(reason, 'Could not delete the message.');
		} finally {
			busy = false;
		}
	}

	function errorMessage(reason: unknown, fallback: string): string {
		return reason instanceof Error ? reason.message : fallback;
	}
</script>

{#snippet linkedText(text: string)}
	{#each splitMessageText(text) as part, index (index)}
		{#if part.href}<a
				href={part.href}
				rel="external"
				class="font-semibold text-link underline underline-offset-2">{part.text}</a
			>{:else}{part.text}{/if}
	{/each}
{/snippet}

{#snippet timestamp()}
	<span
		class="inline-flex shrink-0 items-center gap-0.5 text-xs leading-none whitespace-nowrap text-muted-foreground"
	>
		<time datetime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
		{#if message.editedAt && !message.deleted}<span aria-label="Edited">· edited</span>{/if}
		{#if own && !personal && !message.deleted && showReceipt}
			{#if message.status === 'read'}<CheckCheckIcon class="size-3.5 text-link" aria-label="Read" />
			{:else if message.status === 'delivered'}<CheckIcon
					class="size-3.5 text-link"
					aria-label="Delivered"
				/>
			{:else}<CheckIcon
					class="size-3.5 text-muted-foreground/55"
					aria-label="Sent, not delivered"
				/>{/if}
		{/if}
	</span>
{/snippet}

<Message.Root align={own ? 'end' : 'start'} class="items-start gap-1.5">
	{#if showAvatarSlot}
		{#if showSender}
			<UserAvatar
				user={message.sender}
				class="size-8 rounded-xl [&_[data-slot=avatar-fallback]]:text-xs"
			/>
		{:else}
			<span class="size-8 shrink-0" aria-hidden="true"></span>
		{/if}
	{/if}
	<div
		class={`group/message-frame flex w-fit min-w-0 items-end gap-1 ${own ? 'flex-row-reverse' : ''}`}
		style:max-width={showAvatarSlot ? 'calc(100% - 2.5rem)' : '100%'}
	>
		<Message.Content class="w-fit max-w-[min(86vw,38rem)] gap-0.5 sm:max-w-[min(76vw,38rem)]">
			{#if showSender}
				<Message.Header class="px-1 text-xs font-semibold text-link"
					>{message.sender.displayName}</Message.Header
				>
			{/if}
			<ContextMenu.Root>
				<ContextMenu.Trigger
					role="group"
					class="block w-fit max-w-full rounded-[14px]"
					aria-label={`Message from ${message.sender.displayName}`}
				>
					<Bubble.Root
						variant={message.deleted ? 'muted' : own ? 'tinted' : 'outline'}
						align={own ? 'end' : 'start'}
						class="max-w-full gap-0.5"
					>
						<Bubble.Content
							class={`w-fit max-w-full rounded-[14px] border shadow-xs ${hasAttachments || editing ? 'p-[2px]' : 'px-2.5 py-1.5'} ${own ? 'border-primary/10' : 'border-border/75'}`}
						>
							{#if !message.deleted && visuals.length}
								<div class="w-full max-w-[34rem] min-w-0"><MessageMediaGrid media={visuals} /></div>
							{/if}
							{#if !message.deleted && documents.length}
								<div class="grid gap-0.5" class:mt-0.5={visuals.length > 0}>
									{#each documents as file (file.id)}
										<Attachment.Root
											size="sm"
											class="w-full gap-1 border-border/75 bg-background/85 p-1!"
										>
											<Attachment.Media variant="icon"><FileIcon class="size-4" /></Attachment.Media
											>
											<Attachment.Content class="min-w-0 flex-1">
												<Attachment.Title class="truncate">{file.filename}</Attachment.Title>
												<Attachment.Description>{formatFileSize(file.size)}</Attachment.Description>
											</Attachment.Content>
											<Attachment.Actions
												><Attachment.Action
													href={file.url}
													target="_blank"
													rel="noreferrer"
													aria-label={`Download ${file.filename}`}>Download</Attachment.Action
												></Attachment.Actions
											>
										</Attachment.Root>
										{#if file.altText}<p class="px-2 text-xs text-foreground/75">
												{file.altText}
											</p>{/if}
									{/each}
								</div>
							{/if}
							{#if message.deleted}
								<p class="text-sm text-muted-foreground italic">
									Message deleted <span class="ml-2 align-middle">{@render timestamp()}</span>
								</p>
							{:else if editing}
								<div class="min-w-[min(18rem,65vw)] space-y-1 p-0.5">
									<Textarea
										bind:ref={editor}
										bind:value={editText}
										maxlength={4000}
										aria-label="Edit message"
										class="kaordo-scrollbar max-h-36 min-h-18 overflow-y-auto border-0 bg-background text-sm focus-visible:ring-1"
									/>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="xs"
											onclick={() => {
												editing = false;
												error = '';
											}}>Cancel</Button
										>
										<Button
											size="xs"
											disabled={busy ||
												editText.length > 4000 ||
												(!editText.trim() && !hasAttachments)}
											onclick={() => void saveEdit()}>Save</Button
										>
									</div>
								</div>
							{:else if hasAttachments}
								{#if message.text}
									<p class="px-2.5 pt-1 pb-0.5 text-sm leading-5 break-words whitespace-pre-wrap">
										{@render linkedText(message.text)}
									</p>
								{/if}
								<div class="flex justify-end px-2 pt-0.5 pb-1.5">{@render timestamp()}</div>
							{:else}
								<p class="text-sm leading-5 break-words whitespace-pre-wrap">
									{@render linkedText(message.text)}<span class="ml-2 inline-block align-[-0.125em]"
										>{@render timestamp()}</span
									>
								</p>
							{/if}
						</Bubble.Content>
						{#if !message.deleted && message.reactions.length}
							<Bubble.Reactions placement="inline" class="pt-0.5" aria-label="Message reactions">
								{#each message.reactions as reaction (reaction.emoji)}
									<button
										type="button"
										disabled={busy}
										onclick={() => void toggleReaction(reaction.emoji)}
										aria-label={`${reaction.emoji} reaction, ${reaction.count}. ${reaction.mine ? 'Remove' : 'Add'} reaction`}
										aria-pressed={reaction.mine}
										class={`inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${reaction.mine ? 'border-primary/35 bg-primary-soft' : 'border-border bg-card'}`}
									>
										{reaction.emoji} <span class="tabular-nums">{reaction.count}</span>
									</button>
								{/each}
							</Bubble.Reactions>
						{/if}
					</Bubble.Root>
				</ContextMenu.Trigger>
				<ContextMenu.Content>
					{#if message.deleted}
						<ContextMenu.Item disabled>Message deleted</ContextMenu.Item>
					{:else}
						<ContextMenu.Label>React to message</ContextMenu.Label>
						{#each choices as choice (choice.emoji)}
							<ContextMenu.Item onSelect={() => void toggleReaction(choice.emoji)}
								><choice.icon class="size-4" />{choice.label}</ContextMenu.Item
							>
						{/each}
						{#if own}
							<ContextMenu.Separator />
							<ContextMenu.Item onSelect={startEdit}
								><PencilIcon class="size-4" />Edit</ContextMenu.Item
							>
							<ContextMenu.Item
								variant="destructive"
								onSelect={() => {
									deleteOpen = true;
								}}><Trash2Icon class="size-4" />Delete</ContextMenu.Item
							>
						{/if}
					{/if}
				</ContextMenu.Content>
			</ContextMenu.Root>
			{#if error}<p class="px-1 text-xs text-destructive" role="alert">{error}</p>{/if}
		</Message.Content>
		{#if !message.deleted}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label="Message actions"
					class="mb-0.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:opacity-0 sm:group-focus-within/message-frame:opacity-100 sm:group-hover/message-frame:opacity-100"
				>
					<EllipsisIcon class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align={own ? 'start' : 'end'}>
					<DropdownMenu.Label>React</DropdownMenu.Label>
					{#each choices as choice (choice.emoji)}
						<DropdownMenu.Item onSelect={() => void toggleReaction(choice.emoji)}
							><choice.icon class="size-4" />{choice.label}</DropdownMenu.Item
						>
					{/each}
					{#if own}
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={startEdit}
							><PencilIcon class="size-4" />Edit</DropdownMenu.Item
						>
						<DropdownMenu.Item
							variant="destructive"
							onSelect={() => {
								deleteOpen = true;
							}}><Trash2Icon class="size-4" />Delete</DropdownMenu.Item
						>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
	</div>
</Message.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete message?</AlertDialog.Title>
			<AlertDialog.Description
				>The message will be removed for everyone in this conversation.</AlertDialog.Description
			>
		</AlertDialog.Header>
		{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={busy}>Cancel</AlertDialog.Cancel>
			<Button variant="destructive" disabled={busy} onclick={() => void confirmDelete()}
				>Delete message</Button
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
