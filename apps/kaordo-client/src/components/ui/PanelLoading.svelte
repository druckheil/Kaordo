<script lang="ts">
  import LoadingSpinner from './LoadingSpinner.svelte';

  type Props = {
    message: string;
  };

  let { message }: Props = $props();
</script>

<div class="panel-empty" role="status">
  <LoadingSpinner />
  <p>{message}</p>
</div>

<style>
  .panel-empty {
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    gap: 16px;
    padding: 30px 28px;
    color: #68716b;
    text-align: center;
  }

  p {
    max-width: 160px;
    font-size: calc(12px * var(--text-scale));
    line-height: 1.55;
  }
</style>
