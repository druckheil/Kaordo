<script lang="ts">
	// Approves devices and manages the recovery key of the signed-in account
	import { AccountGate } from '@kaordo/account-ui';
	import EncryptionSettings from '@kaordo/account-ui/encryption-settings';
	import { agordojPaths } from '@kaordo/links';
</script>

<svelte:head>
	<title>Encryption &amp; recovery · Agordoj | Kaordo</title>
	<meta
		name="description"
		content="See signed-in sessions, approve devices and keep a recovery key."
	/>
</svelte:head>

<div class="max-w-2xl">
	<div class="mb-8">
		<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Encryption &amp; recovery</h1>
		<p class="mt-3 text-sm leading-6 text-muted-foreground">
			Your devices hold the keys to your private content; Kaordo's servers never receive them.
		</p>
	</div>
	<AccountGate
		appName="Agordoj"
		returnPath={agordojPaths.encryption}
		environment={import.meta.env}
		embedded
		compact
	>
		<EncryptionSettings />
	</AccountGate>
</div>
