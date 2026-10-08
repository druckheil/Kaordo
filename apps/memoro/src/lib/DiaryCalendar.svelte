<script lang="ts">
  // Uses Bits UI keyboard navigation and date selection for the private calendar
  import { untrack } from 'svelte';
  import { CalendarDate, type DateValue } from '@internationalized/date';
  import { Calendar, ChevronLeftIcon, ChevronRightIcon } from '@kaordo/ui';
  import { categories, type DaySummary } from '@kaordo/memoro-client';
  import EventDots from './EventDots.svelte';
  let { date, summaries, busy, onDate, onMonth }:
    { date: string; summaries: DaySummary[]; busy: boolean; onDate: (date: string) => void; onMonth: (month: string) => void } = $props();
  function parse(value: string) { const [y, m, d] = value.split('-').map(Number); return new CalendarDate(y, m, d); }
  const selected = $derived(parse(date));
  let placeholder = $state<DateValue>(untrack(() => parse(date)));
  $effect(() => { const next = parse(date); untrack(() => { placeholder = next; }); });
  const summaryMap = $derived(new Map(summaries.map(value => [value.date, value])));
</script>
<section class="memoro-surface p-4 sm:p-6" aria-label="Calendar" aria-busy={busy}>
  <Calendar.Root type="single" value={selected} bind:placeholder weekdayFormat="short" weekStartsOn={1} fixedWeeks preventDeselect locale="en-GB"
    onValueChange={(value) => { if (value) { onDate(value.toString()); } }}
    onPlaceholderChange={(value) => onMonth(value.toString().slice(0, 7))}>
    {#snippet children({ months, weekdays })}
      <Calendar.Header class="mb-5 flex items-center justify-between gap-2">
        <Calendar.Heading class="text-xl font-semibold tracking-tight" />
        <div class="flex items-center gap-1">
          <Calendar.PrevButton class="grid size-10 place-items-center rounded-xl hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ChevronLeftIcon class="size-5" /></Calendar.PrevButton>
          <Calendar.NextButton class="grid size-10 place-items-center rounded-xl hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ChevronRightIcon class="size-5" /></Calendar.NextButton>
        </div>
      </Calendar.Header>
      {#each months as month}
        <Calendar.Grid class="w-full table-fixed border-separate border-spacing-1">
          <Calendar.GridHead><Calendar.GridRow>{#each weekdays as weekday}<Calendar.HeadCell class="pb-3 text-center text-xs font-medium text-muted-foreground">{weekday}</Calendar.HeadCell>{/each}</Calendar.GridRow></Calendar.GridHead>
          <Calendar.GridBody>{#each month.weeks as weekDates}<Calendar.GridRow>
            {#each weekDates as date}
              {@const summary = summaryMap.get(date.toString())}
              <Calendar.Cell {date} month={month.value} class="p-0 text-center">
                <Calendar.Day class="group mx-auto flex h-[clamp(3.4rem,6.5vw,5rem)] w-full flex-col items-center justify-center gap-1 rounded-xl text-sm font-medium transition-colors hover:bg-muted data-[outside-month]:opacity-35 data-[today]:font-bold data-[today]:ring-1 data-[today]:ring-primary/50 data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  <span>{date.day}</span><EventDots colors={summary?.colors} journal={summary?.hasJournal} />
                  {#if summary}<span class="sr-only">{summary.colors.length} {summary.colors.length === 1 ? 'task' : 'tasks'}{summary.hasJournal ? ', journal entry' : ''}</span>{/if}
                </Calendar.Day>
              </Calendar.Cell>
            {/each}
          </Calendar.GridRow>{/each}</Calendar.GridBody>
        </Calendar.Grid>
      {/each}
    {/snippet}
  </Calendar.Root>
  <div class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
    {#each categories as category}<span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full" style={`background:${category.color}`}></span>{category.name}</span>{/each}
  </div>
</section>
