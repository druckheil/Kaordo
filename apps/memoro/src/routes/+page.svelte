<script lang="ts">
  // Opens the encrypted diary through the shared account gate
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
  import MemoroApp from '$lib/MemoroApp.svelte';
</script>

<svelte:head><title>Memoro | Kaordo</title><meta name="description" content="Your private calendar, plans and daily journal." /></svelte:head>

<AccountGate appName="Memoro" returnPath={appPaths.memoro} environment={import.meta.env}>
  {#snippet children(user)}<MemoroApp {user} />{/snippet}
</AccountGate>
