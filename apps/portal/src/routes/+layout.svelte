<script lang="ts">
	// Loads the shared design system for portal routes

	import "./layout.css";
	import { ThemeProvider } from "@kaordo/ui";

	let { children } = $props();
</script>

<ThemeProvider />
{@render children()}
