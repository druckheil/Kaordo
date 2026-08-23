<script lang="ts">
  import type { ObjectSummary } from '../../lib/domain/workspace';

  type Props = {
    object: Pick<ObjectSummary, 'title' | 'type'>;
  };

  let { object }: Props = $props();
</script>

<span class="canvas-card-accent" aria-hidden="true"></span>
<span class="canvas-card-icon" aria-hidden="true">
  <svg viewBox="0 0 24 24" role="presentation">
    <path d="M6 4.5h9l3 3v12H6zM15 4.5v3h3M9 12h6M9 15h4" />
  </svg>
</span>
<span class="canvas-card-copy">
  <small>Panel</small>
  <strong>{object.title}</strong>
</span>
<span class="canvas-card-grip" aria-hidden="true">
  <i></i><i></i><i></i><i></i><i></i><i></i>
</span>

<style>
  .canvas-card-accent {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: linear-gradient(#65a08f, #2f6d5d);
  }

  .canvas-card-icon {
    display: grid;
    width: 28px;
    height: 28px;
    color: #397565;
    background: #e3efe9;
    border: 1px solid #c5dcd3;
    border-radius: 8px;
    place-items: center;
  }

  .canvas-card-icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.45;
  }

  .canvas-card-copy {
    min-width: 0;
  }

  .canvas-card-copy small,
  .canvas-card-copy strong {
    display: block;
  }

  .canvas-card-copy small {
    margin-bottom: 2px;
    color: #78827c;
    font-size: calc(8px * var(--text-scale));
    font-weight: 680;
    letter-spacing: 0.075em;
    text-transform: uppercase;
  }

  .canvas-card-copy strong {
    overflow: hidden;
    color: #303a34;
    font-size: calc(12px * var(--text-scale));
    font-weight: 670;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-card-grip {
    display: grid;
    grid-template-columns: repeat(2, 2px);
    gap: 3px;
    justify-self: end;
    padding: 2px;
    color: #9fa9a3;
  }

  .canvas-card-grip i {
    width: 2px;
    height: 2px;
    background: currentColor;
    border-radius: 50%;
  }
</style>
