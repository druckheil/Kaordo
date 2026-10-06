<script lang="ts">
  // Presents shared browser appearance settings without an account round trip
  import { appPaths } from '@kaordo/links';
  import { AppHeader, ThemePicker } from '@kaordo/ui';
</script>

<svelte:head>
  <title>Agordoj | Kaordo</title>
  <meta name="description" content="Choose the appearance of your Kaordo apps." />
</svelte:head>

<AppHeader name="Agordoj" homeHref={appPaths.portal} settingsActive />

<main id="main-content" tabindex="-1" class="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
  <div class="mb-9">
    <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Appearance</h1>
    <p class="mt-3 text-sm leading-6 text-muted-foreground">
      Make Kaordo yours. Your theme applies to every app.
    </p>
  </div>
  <ThemePicker />
</main>
