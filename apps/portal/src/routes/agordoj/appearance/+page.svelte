<script lang="ts">
	// Presents shared browser appearance settings without an account round trip
	import { ThemePicker } from '@kaordo/ui';
</script>

<svelte:head>
	<title>Appearance · Agordoj | Kaordo</title>
	<meta name="description" content="Choose the appearance of your Kaordo apps." />
</svelte:head>

<div class="mb-9">
	<h1 class="text-3xl font-bold tracking-tight sm:text-4xl">Appearance</h1>
	<p class="mt-3 text-sm leading-6 text-muted-foreground">
		Make Kaordo yours. Your theme applies to every app.
	</p>
</div>
<ThemePicker />
