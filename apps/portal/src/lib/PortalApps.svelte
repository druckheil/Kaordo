<script lang="ts">
	// Lists the independent Kaordo applications

	import { appPaths } from "@kaordo/links";
	import { ArrowUpRightIcon, HouseIcon, LanguagesIcon, MessageCircleIcon, UsersIcon } from "@kaordo/ui";

	const applications = [
		{
			name: "Fluo",
			description: "Share a thought, discover new voices and keep the posts you love.",
			category: "Social",
			href: appPaths.fluo,
			icon: HouseIcon,
		},
		{
			name: "Ligo",
			description: "Keep conversations, photos and files together in one place.",
			category: "Messages",
			href: appPaths.ligo,
			icon: MessageCircleIcon,
		},
		{
			name: "Rondo",
			description: "Build a community with channels, shared files and local voice rooms.",
			category: "Communities",
			href: appPaths.rondo,
			icon: UsersIcon,
		},
		{
			name: "Lingvo",
			description: "Make a language your own with personal flashcards and everyday phrases.",
			category: "Languages",
			href: appPaths.lingvo,
			icon: LanguagesIcon,
		},
	];
</script>

<section class="mt-8" aria-label="Applications">
	<div class="mb-5">
		<p class="text-xs font-semibold uppercase tracking-[0.18em] text-link">Apps</p>
		<h2 class="mt-1 text-2xl font-bold tracking-[-0.04em]">Choose an app</h2>
	</div>
	<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
		{#each applications as application (application.name)}
			{@const Icon = application.icon}
			<a
				href={application.href}
				rel="external"
				class="group flex min-h-48 flex-col rounded-[1.5rem] border border-border bg-card p-6 shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
			>
				<div class="flex items-start justify-between gap-3">
					<span class="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground" aria-hidden="true">
						<Icon class="size-6" />
					</span>
					<span class="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
						{application.category}
					</span>
				</div>
				<h3 class="mt-4 text-2xl font-bold tracking-tight">{application.name}</h3>
				<p class="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">{application.description}</p>
				<span class="mt-auto inline-flex items-center gap-1.5 pt-3 text-sm font-semibold text-link">
					Open {application.name}
					<ArrowUpRightIcon class="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
				</span>
			</a>
		{/each}
	</div>
</section>
