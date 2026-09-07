<script lang="ts">
  import type { IloSnapshot } from '../../lib/domain/ilo';
  import type { LingvolernandoPetPalette, LingvolernandoRewardOutcome } from '../../lib/domain/lingvolernando';
  import type { IloGState } from '../../lib/states/IloGState';
  import LingvolernandoCompanion from './lingvolernando/LingvolernandoCompanion.svelte';
  import LingvolernandoHome, { type LingvolernandoRoom } from './lingvolernando/LingvolernandoHome.svelte';
  import LingvolernandoInsights from './lingvolernando/LingvolernandoInsights.svelte';
  import LingvolernandoJourney from './lingvolernando/LingvolernandoJourney.svelte';
  import LingvolernandoRewardSequence from './lingvolernando/LingvolernandoRewardSequence.svelte';
  import LingvolernandoVault from './lingvolernando/LingvolernandoVault.svelte';
  import LingvolernandoWorld from './lingvolernando/LingvolernandoWorld.svelte';

  type Props = {
    gameState: IloGState;
    onOpenTrain: () => void;
    snapshot: Readonly<IloSnapshot>;
  };
  let { gameState, onOpenTrain, snapshot }: Props = $props();
  let room = $state<'home' | LingvolernandoRoom>('home');
  let reward = $state<LingvolernandoRewardOutcome | null>(null);

  function answerJourney(remembered: boolean): void {
    const outcome = gameState.answerLingvolernandoJourney(remembered);
    if (outcome) reward = outcome;
  }

  function home(): void {
    room = 'home';
  }

</script>

<div class="lingvolernando-game" data-room={room}>
  {#if room === 'home'}
    <LingvolernandoHome snapshot={snapshot} onNavigate={(next) => { room = next; }} onTrain={onOpenTrain} />
  {:else if room === 'journey'}
    <LingvolernandoJourney snapshot={snapshot} onAnswer={answerJourney} onHome={home} />
  {:else if room === 'world'}
    <LingvolernandoWorld snapshot={snapshot} onHome={home} onSelectBiome={(index) => gameState.selectLingvolernandoBiome(index)} />
  {:else if room === 'companion'}
    <LingvolernandoCompanion
      snapshot={snapshot}
      onArtifact={(artifactId) => gameState.toggleLingvolernandoPetArtifact(artifactId)}
      onHome={home}
      onPalette={(palette: LingvolernandoPetPalette) => gameState.setLingvolernandoPetPalette(palette)}
      onRename={(name) => gameState.renameLingvolernandoPet(name)}
    />
  {:else if room === 'vault'}
    <LingvolernandoVault
      snapshot={snapshot}
      onEquip={(artifactId, slot) => gameState.equipLingvolernandoArtifact(artifactId, slot)}
      onEvolve={(artifactId) => gameState.evolveLingvolernandoArtifact(artifactId)}
      onHome={home}
    />
  {:else if room === 'insights'}
    <LingvolernandoInsights snapshot={snapshot} onHome={home} />
  {/if}

  {#if reward}
    <LingvolernandoRewardSequence outcome={reward} onClose={() => { reward = null; }} />
  {/if}
</div>

<style>
  .lingvolernando-game {
    min-width:0;
    min-height:100%;
    color:var(--sui-text);
    background:
      radial-gradient(circle at 78% 9%,rgb(107 95 221 / 5%),transparent 28%),
      radial-gradient(circle at 13% 83%,rgb(49 166 137 / 4%),transparent 31%),
      var(--sui-bg);
    isolation:isolate;
  }
</style>
