<script lang="ts">
	// Displays account activity, access cases, and administrator controls

	import type { AdminAccessCase, AdminContentPage, AdminUser } from "@kaordo/contracts";
	import { Button, Input, SearchIcon } from "@kaordo/ui";
	import AccountActions from "./AccountActions.svelte";
	import { formatBytes as bytes, formatDateTime as time } from "./regado-model";
	import type { AdminIntent, ContentKind } from "./regado-model";

	let {
		users,
		search = $bindable(""),
		sectionLoading,
		contentLoading,
		currentUserId,
		onSearch,
		onIntent,
		caseRecord,
		busy,
		onCloseCase,
		contentKind = $bindable("posts"),
		content,
		onLoadContent,
	}: {
		users: AdminUser[];
		search?: string;
		sectionLoading: boolean;
		contentLoading: boolean;
		currentUserId: string;
		onSearch: () => void;
		onIntent: (intent: AdminIntent) => void;
		caseRecord: AdminAccessCase | null;
		busy: boolean;
		onCloseCase: () => void;
		contentKind?: ContentKind;
		content: AdminContentPage | null;
		onLoadContent: () => void;
	} = $props();
</script>

<section class="mt-6 rounded-[1.4rem] border border-border bg-card p-5 sm:p-6">
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-lg font-bold">Accounts</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				Activity, owned media and access controls.
			</p>
		</div>
		<form
			class="flex w-full min-w-0 gap-2 sm:w-auto"
		onsubmit={(event) => {
				event.preventDefault();
				onSearch();
			}}
		>
			<Input
				bind:value={search}
				placeholder="Find an account"
				aria-label="Find an account"
				class="w-0 flex-1 sm:w-64"
			/>
			<Button type="submit" variant="outline"><SearchIcon class="size-4" /> Search</Button>
		</form>
	</div>

	{#if sectionLoading}
		<p class="mt-5 text-sm text-muted-foreground" role="status">Loading accounts…</p>
	{/if}

	<div class="mt-5 grid gap-3 md:hidden">
		{#each users as account (account.id)}
			<article class="min-w-0 rounded-xl border border-border p-4">
				<h3 class="break-all text-sm font-bold">@{account.username}</h3>
				<p class="mt-1 break-words text-xs text-muted-foreground">
					{account.displayName}{account.isAdmin ? " · administrator" : ""}{account.disabledAt ? " · disabled" : ""}
				</p>
				<dl class="my-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
					<dt class="text-muted-foreground">Posts</dt>
					<dd class="text-right">{account.postCount}</dd>
					<dt class="text-muted-foreground">Messages</dt>
					<dd class="text-right">{account.messageCount}</dd>
					<dt class="text-muted-foreground">Owned media</dt>
					<dd class="text-right">{bytes(account.mediaBytes)}</dd>
					<dt class="text-muted-foreground">Last activity</dt>
					<dd class="text-right">{time(account.lastActivity)}</dd>
				</dl>
				<AccountActions {account} {currentUserId} {onIntent} />
			</article>
		{:else}
			{#if !sectionLoading}
				<p class="py-6 text-center text-sm text-muted-foreground">No accounts found.</p>
			{/if}
		{/each}
	</div>

	<div class="kaordo-scrollbar mt-5 hidden overflow-x-auto md:block">
		<table class="w-full min-w-[800px] text-left text-sm">
			<thead>
				<tr class="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
					<th class="py-3 pr-4">Account</th>
					<th class="py-3 pr-4">Posts</th>
					<th class="py-3 pr-4">Messages</th>
					<th class="py-3 pr-4">Owned media</th>
					<th class="py-3 pr-4">Last activity</th>
					<th class="py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each users as account (account.id)}
					<tr class="border-b border-border/70">
						<td class="py-3 pr-4">
							<strong>@{account.username}</strong>
							<p class="text-xs text-muted-foreground">
								{account.displayName}{account.isAdmin ? " · administrator" : ""}{account.disabledAt ? " · disabled" : ""}
							</p>
						</td>
						<td class="py-3 pr-4">{account.postCount}</td>
						<td class="py-3 pr-4">{account.messageCount}</td>
						<td class="py-3 pr-4">{bytes(account.mediaBytes)}</td>
						<td class="py-3 pr-4 text-xs text-muted-foreground">{time(account.lastActivity)}</td>
						<td class="py-3 text-right"><AccountActions {account} {currentUserId} {onIntent} /></td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="py-8 text-center text-muted-foreground">No accounts found.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

{#if caseRecord}
	<section class="mt-6 rounded-[1.4rem] border border-primary/25 bg-card p-5 sm:p-6">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<p class="text-xs font-bold uppercase tracking-widest text-link">Audited access</p>
				<h2 class="mt-1 text-xl font-bold">@{caseRecord.targetUsername}</h2>
				<p class="mt-1 text-xs text-muted-foreground">
					Expires {time(caseRecord.expiresAt)} · Case {caseRecord.id}
				</p>
			</div>
			<Button variant="outline" disabled={busy} onclick={onCloseCase}>Close access case</Button>
		</div>
		<p class="mt-3 text-sm">{caseRecord.reason}</p>
		<div class="mt-5 flex gap-2">
			<Button
				variant={contentKind === "posts" ? "default" : "outline"}
				size="sm"
				onclick={() => {
					contentKind = "posts";
				}}
			>Posts</Button>
			<Button
				variant={contentKind === "messages" ? "default" : "outline"}
				size="sm"
				onclick={() => {
					contentKind = "messages";
				}}
			>Sent messages</Button>
		</div>
		<div class="mt-5 space-y-3">
			{#if contentLoading}
				<p class="text-sm text-muted-foreground" role="status">Loading account content…</p>
			{/if}
			{#each content?.items ?? [] as item}
				<article class="rounded-xl border border-border bg-background p-4">
					<div class="flex justify-between gap-3 text-xs text-muted-foreground">
						<span>{item.context}</span><time>{time(item.createdAt)}</time>
					</div>
					<p class="mt-2 whitespace-pre-wrap break-words text-sm">{item.text || "Media only"}</p>
					{#if item.media.length}
						<div class="mt-3 flex flex-wrap gap-2">
							{#each item.media as media}
								<a
									class="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-link hover:underline"
									href={media.url}
									target="_blank"
									rel="noopener noreferrer"
								>{media.kind} · {bytes(media.size)} ↗</a>
							{/each}
						</div>
					{/if}
				</article>
			{:else}
				{#if !contentLoading}
					<p class="text-sm text-muted-foreground">No {contentKind} in this account.</p>
				{/if}
			{/each}
		</div>
		{#if content?.nextCursor}
			<Button class="mt-4" variant="outline" disabled={contentLoading} onclick={() => onLoadContent()}>
				Load more
			</Button>
		{/if}
	</section>
{/if}
