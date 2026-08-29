<script lang="ts">
  import type { IloProgress } from '../../lib/domain/ilo';

  type Props = { progress: IloProgress };
  let { progress }: Props = $props();
  const stageLabels = ['New', '10 min', '1 hour', '1 day', '3 days', '7 days', '14 days', '30 days', 'Maintenance'];
  let maxPoints = $derived(Math.max(1, ...progress.pointsHistory.map(({ points }) => points)));
  let totalPoints = $derived(progress.pointsHistory.reduce((sum, item) => sum + item.points, 0));

  function dayLabel(date: string): string {
    return new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`));
  }
</script>

<section class="progress-shell" aria-labelledby="progress-title">
  <header>
    <span>Learning signal</span>
    <h3 id="progress-title">Progress</h3>
    <p>Your review rhythm and the current shape of the spaced-repetition ladder.</p>
  </header>

  <div class="summary-grid">
    <article><span>Active cards</span><strong>{progress.active}</strong><small>Your complete dictionary</small></article>
    <article class:attention={progress.due > 0}><span>Due now</span><strong>{progress.due}</strong><small>{progress.due > 0 ? 'Ready to review' : 'Queue is clear'}</small></article>
    <article class:complete={progress.learnedToday}><span>Learned today</span><strong>{progress.learnedToday ? 'Yes' : 'Not yet'}</strong><small>Daily study signal</small></article>
    <article><span>Today points</span><strong>{progress.todayPoints}</strong><small>{totalPoints} in the last week</small></article>
  </div>

  <div class="charts-grid">
    <article class="week-card">
      <div class="chart-heading">
        <div><span>Last 7 days</span><h4>Study activity</h4></div>
        <strong>{totalPoints}<small>points</small></strong>
      </div>
      <div class="week-chart" aria-label="Points earned over the last seven days">
        {#each progress.pointsHistory as item}
          <div class="day-column" title={`${item.date}: ${item.points} points`}>
            <span class="point-value">{item.points || ''}</span>
            <div class="bar-track"><i style={`height: ${Math.max(item.points > 0 ? 7 : 0, (item.points / maxPoints) * 100)}%`}></i></div>
            <small>{dayLabel(item.date)}</small>
          </div>
        {/each}
      </div>
    </article>

    <article class="stages-card">
      <div class="chart-heading">
        <div><span>SRS ladder</span><h4>Cards by stage</h4></div>
        <strong>{progress.active}<small>cards</small></strong>
      </div>
      <div class="stage-list">
        {#each stageLabels as label, stage}
          {@const count = progress.stages[String(stage)] ?? 0}
          <div>
            <span class="stage-index">{stage}</span>
            <span class="stage-label">{label}</span>
            <i><b style={`width: ${progress.active ? Math.max(count > 0 ? 4 : 0, (count / progress.active) * 100) : 0}%`}></b></i>
            <strong>{count}</strong>
          </div>
        {/each}
      </div>
    </article>
  </div>
</section>

<style>
  .progress-shell {
    --soft-bg: var(--sui-bg, #e4e9f0);
    --soft-bg-light: var(--sui-bg-light, #edf1f7);
    --soft-shadow: var(--sui-shadow-dark, rgb(39 51 67 / 20%));
    --soft-primary: var(--sui-primary, #5b54e0);
    --soft-primary-hover: var(--sui-primary-hover, #4a44c4);
    --soft-text: var(--sui-text, #2d3748);
    --soft-muted: var(--sui-text-muted, #5a6a7e);
    --soft-light: var(--sui-text-light, #6a7d94);
    max-width: 1120px;
    margin: 0 auto;
    color: var(--soft-text);
  }

  header > span, .summary-grid article > span, .chart-heading span { color: var(--soft-primary); font-size: calc(8px * var(--text-scale)); font-weight: 760; letter-spacing: .1em; text-transform: uppercase; }
  h3 { margin: 5px 0 0; color: var(--soft-text); font-size: calc(22px * var(--text-scale)); font-weight: 730; letter-spacing: -.03em; }
  header p { margin-top: 6px; color: var(--soft-muted); font-size: calc(9px * var(--text-scale)); }
  .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 11px; margin-top: 20px; }
  .summary-grid article { position: relative; min-width: 0; padding: 13px 15px; overflow: hidden; background: var(--soft-bg); border: 0; border-radius: 15px; box-shadow: 0 5px 14px var(--soft-shadow); }
  .summary-grid article::after { position: absolute; right: -17px; bottom: -24px; width: 78px; height: 78px; background: color-mix(in srgb, var(--soft-primary) 8%, transparent); border-radius: 50%; content: ''; }
  .summary-grid article.attention { box-shadow: 0 5px 14px color-mix(in srgb, var(--sui-warning, #c57b46) 22%, var(--soft-shadow)); }
  .summary-grid article.complete { box-shadow: 0 5px 14px color-mix(in srgb, var(--sui-success, #1fa96e) 19%, var(--soft-shadow)); }
  .summary-grid strong { display: block; margin-top: 5px; color: var(--soft-text); font-size: calc(22px * var(--text-scale)); font-weight: 730; letter-spacing: -.04em; }
  .summary-grid small { display: block; margin-top: 3px; color: var(--soft-light); font-size: calc(8px * var(--text-scale)); }
  .charts-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr); gap: 13px; margin-top: 13px; }
  .charts-grid > article { padding: 21px; background: var(--soft-bg); border: 0; border-radius: 17px; box-shadow: 0 5px 14px var(--soft-shadow); }
  .chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  h4 { margin: 5px 0 0; color: var(--soft-text); font-size: calc(13px * var(--text-scale)); font-weight: 710; }
  .chart-heading > strong { color: var(--soft-primary); font-size: calc(18px * var(--text-scale)); font-weight: 730; text-align: right; }
  .chart-heading > strong small { display: block; margin-top: 2px; color: var(--soft-light); font-size: calc(7px * var(--text-scale)); font-weight: 650; text-transform: uppercase; }
  .week-chart { display: grid; grid-template-columns: repeat(7, minmax(30px, 1fr)); gap: 10px; height: 240px; padding: 25px 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--soft-shadow) 55%, transparent); }
  .day-column { display: grid; grid-template-rows: 19px minmax(0, 1fr) 24px; align-items: end; min-width: 0; text-align: center; }
  .point-value { min-height: 17px; color: var(--soft-primary); font-size: calc(8px * var(--text-scale)); font-weight: 700; }
  .bar-track { position: relative; width: min(28px, 70%); height: 100%; margin: 0 auto; overflow: hidden; background: var(--soft-bg); border-radius: 8px 8px 2px 2px; box-shadow: inset 2px 2px 5px var(--soft-shadow); }
  .bar-track i { position: absolute; right: 0; bottom: 0; left: 0; background: linear-gradient(180deg, var(--soft-primary), var(--soft-primary-hover)); border-radius: 8px 8px 2px 2px; transition: height 360ms cubic-bezier(.2, .8, .2, 1); }
  .day-column small { align-self: center; color: var(--soft-light); font-size: calc(7px * var(--text-scale)); font-weight: 660; }
  .stage-list { display: grid; gap: 11px; margin-top: 22px; }
  .stage-list > div { display: grid; grid-template-columns: 22px 76px minmax(80px, 1fr) 26px; align-items: center; gap: 8px; }
  .stage-index { display: grid; width: 20px; height: 20px; color: var(--soft-primary); background: var(--soft-bg); border-radius: 6px; box-shadow: var(--soft-shadow-raised-sm, 0 3px 8px var(--soft-shadow)); font-size: calc(7px * var(--text-scale)); font-weight: 760; place-items: center; }
  .stage-label { color: var(--soft-muted); font-size: calc(8px * var(--text-scale)); font-weight: 650; }
  .stage-list i { height: 7px; overflow: hidden; background: var(--soft-bg); border-radius: 999px; box-shadow: inset 2px 2px 5px var(--soft-shadow); }
  .stage-list i b { display: block; height: 100%; background: linear-gradient(90deg, var(--soft-primary), var(--soft-primary-hover)); border-radius: inherit; transition: width 320ms ease; }
  .stage-list > div > strong { color: var(--soft-text); font-size: calc(8px * var(--text-scale)); text-align: right; }
  @media (max-width: 1180px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } .charts-grid { grid-template-columns: 1fr; } }
  @media (prefers-reduced-motion: reduce) { .bar-track i, .stage-list i b { transition: none; } }
</style>
