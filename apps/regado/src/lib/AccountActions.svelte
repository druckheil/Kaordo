<script lang="ts">
	// Presents administrative actions available for one account

	import type { AdminUser } from "@kaordo/contracts";
	import { Button } from "@kaordo/ui";
	import type { AdminIntent } from "./regado-model";

	let {
		account,
		currentUserId,
		onIntent,
	}: {
		account: AdminUser;
		currentUserId: string;
		onIntent: (intent: AdminIntent) => void;
	} = $props();
</script>

<div class="flex flex-wrap justify-end gap-2">
	{#if account.id !== currentUserId}
		{#if !account.isAdmin}
			<Button
				size="xs"
				variant="outline"
				onclick={() =>
					onIntent({
						type: "status",
						id: account.id,
						name: account.username,
						disabled: !account.disabledAt,
					})}>{account.disabledAt ? "Enable" : "Disable"}</Button
			>
		{/if}
		<Button
			size="xs"
			variant="outline"
			disabled={!!account.disabledAt}
			onclick={() =>
				onIntent({
					type: "role",
					id: account.id,
					name: account.username,
					isAdmin: !account.isAdmin,
				})}>{account.isAdmin ? "Revoke admin" : "Grant admin"}</Button
		>
	{:else}
		<span class="text-xs text-muted-foreground">Your account</span>
	{/if}
</div>
