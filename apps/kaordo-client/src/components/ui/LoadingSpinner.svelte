<script lang="ts">
  type Props = {
    compact?: boolean;
  };

  let { compact = false }: Props = $props();
</script>

<span
  class="library-loader"
  class:library-loader--compact={compact}
  aria-hidden="true"
></span>

<style>
  .library-loader {
    width: 24px;
    height: 24px;
    border: 2px solid #ced5cf;
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: library-loader-spin 700ms linear infinite;
  }

  .library-loader--compact {
    width: 18px;
    height: 18px;
  }

  @keyframes library-loader-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .library-loader {
      animation: none;
    }
  }
</style>
