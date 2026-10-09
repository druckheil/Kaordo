<script lang="ts">
	// Presents released changes and lazy-loads the selected version's details

	import { AppHeader, Button, ChevronRightIcon } from '@kaordo/ui';
	import { appPaths } from '@kaordo/links';
	import {
		latestReleasedVersion,
		loadReleaseNotes,
		releaseVersions,
		type ReleaseNotes
	} from '$lib/changelog';

	const dateFormatter = new Intl.DateTimeFormat('en', {
		dateStyle: 'long',
		timeZone: 'UTC'
	});
	let loadedReleases = $state<Record<string, ReleaseNotes>>({});
	let loadingReleases = $state<Record<string, boolean>>({});
	let failedReleases = $state<Record<string, boolean>>({});

	function onReleaseToggle(version: string, event: Event): void {
		if ((event.currentTarget as HTMLDetailsElement).open) void loadRelease(version);
	}

	async function loadRelease(version: string): Promise<void> {
		if (loadedReleases[version] || loadingReleases[version]) return;

		loadingReleases[version] = true;
		failedReleases[version] = false;
		try {
			loadedReleases[version] = await loadReleaseNotes(version);
		} catch {
			failedReleases[version] = true;
		} finally {
			loadingReleases[version] = false;
		}
	}

	function formatReleaseDate(date: string): string {
		return dateFormatter.format(new Date(`${date}T00:00:00Z`));
	}
</script>

<svelte:head>
	<title>Release history | Kaordo</title>
	<meta name="description" content="Explore changes included in each released version of Kaordo." />
</svelte:head>

<AppHeader name="Release history" homeHref={appPaths.portal} />

<main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-5 pt-10 pb-16 sm:px-8">
	<header class="max-w-2xl">
		<p class="text-xs font-semibold tracking-[0.2em] text-link uppercase">Kaordo updates</p>
		<h1 class="mt-4 text-4xl leading-[1.08] font-bold tracking-[-0.055em] sm:text-5xl">
			Release history
		</h1>
		<p class="mt-5 text-base leading-7 text-muted-foreground">
			Changes included in released versions of Kaordo.
		</p>
	</header>

	{#if releaseVersions.length > 0}
		<div class="mt-8 space-y-3">
			{#each releaseVersions as version (version)}
				<details
					class="group overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors open:border-primary/30"
					ontoggle={(event) => onReleaseToggle(version, event)}
				>
					<summary
						class="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-ring sm:px-6 [&::-webkit-details-marker]:hidden"
					>
						<span class="flex min-w-0 items-center gap-3">
							<span class="text-lg font-semibold tracking-tight">{version}</span>
							{#if version === latestReleasedVersion}
								<span
									class="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-link"
								>
									Latest release
								</span>
							{/if}
						</span>
						<ChevronRightIcon
							class="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
							aria-hidden="true"
						/>
					</summary>

					<div class="border-t border-border/80 px-5 pt-5 pb-6 sm:px-6">
						{#if loadingReleases[version]}
							<p class="text-sm text-muted-foreground" role="status">Loading release notes…</p>
						{:else if failedReleases[version]}
							<p class="text-sm text-destructive" role="alert">
								Release notes could not be loaded. Close and reopen this version to try again.
							</p>
						{:else if loadedReleases[version]}
							{@const release = loadedReleases[version] as ReleaseNotes}
							<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
								<p class="max-w-2xl text-base leading-7 text-muted-foreground">
									{release.summary}
								</p>
								<time class="shrink-0 text-sm text-muted-foreground" datetime={release.releasedAt}>
									{formatReleaseDate(release.releasedAt)}
								</time>
							</div>

							<div class="mt-6 grid gap-6 sm:grid-cols-2">
								{#each release.sections as section, index (section.heading)}
									<section aria-labelledby={`release-${version}-${index}`}>
										<h2
											id={`release-${version}-${index}`}
											class="text-sm font-semibold tracking-[0.12em] text-foreground uppercase"
										>
											{section.heading}
										</h2>
										<ul class="mt-3 space-y-2.5 text-sm leading-6 text-muted-foreground">
											{#each section.changes as change (change)}
												<li class="flex gap-2.5">
													<span
														class="mt-[0.6rem] size-1.5 shrink-0 rounded-full bg-primary"
														aria-hidden="true"
													></span>
													<span>{change}</span>
												</li>
											{/each}
										</ul>
									</section>
								{/each}
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">
								Open this version to load its release notes.
							</p>
						{/if}
					</div>
				</details>
			{/each}
		</div>
	{:else}
		<section class="mt-8 rounded-2xl border border-border bg-card p-6">
			<h2 class="text-lg font-semibold">No releases yet</h2>
			<p class="mt-2 text-sm text-muted-foreground">Released versions will appear here.</p>
		</section>
	{/if}

	<Button href={appPaths.portal} variant="ghost" class="mt-8">
		<ChevronRightIcon class="size-4 rotate-180" aria-hidden="true" />
		Back to Kaordo
	</Button>
</main>
