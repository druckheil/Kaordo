<script lang="ts">
  import { ModuleLanding } from '@kaordo/ui';
  import { AccountGate } from '@kaordo/account-ui';
  import { appPaths } from '@kaordo/links';
</script>

<svelte:head><title>Ligo | Kaordo</title></svelte:head>

<ModuleLanding name="Ligo" description="A place for your conversations. Messaging is still being built." homeHref={appPaths.portal}>
  <AccountGate appName="Ligo" returnPath={appPaths.ligo} environment={import.meta.env}>
    {#snippet preview(account)}
      <p class="mt-6 text-sm text-muted-foreground">Welcome, {account.displayName}. Your account is loading…</p>
    {/snippet}
    {#snippet children(user)}
      <p class="mt-6 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">Welcome, {user.displayName}. Messaging is not available yet.</p>
    {/snippet}
  </AccountGate>
</ModuleLanding>
