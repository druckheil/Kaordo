<div class="canvas-onboarding" aria-hidden="true">
  <span class="canvas-onboarding-icon">
    <svg viewBox="0 0 32 32" role="presentation">
      <path d="M7 7h9l4 4v14H7zM16 7v4h4" />
      <path d="M22.5 16.5v9m-4.5-4.5h9" />
    </svg>
  </span>
  <strong>Build your knowledge canvas</strong>
  <span>Use Text or Rectangle above, or drag an object here.</span>
</div>

<style>
  .canvas-onboarding {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 3;
    display: flex;
    align-items: center;
    flex-direction: column;
    width: min(340px, calc(100% - 80px));
    padding: 28px 32px;
    color: #69746d;
    background: rgb(250 252 249 / 66%);
    border: 1px dashed rgb(96 139 124 / 38%);
    border-radius: 18px;
    box-shadow: 0 20px 52px rgb(47 75 63 / 6%);
    backdrop-filter: blur(5px);
    pointer-events: none;
    text-align: center;
    transform: translate(-50%, -54%);
    animation: canvas-onboarding-enter 360ms ease-out both;
  }

  .canvas-onboarding-icon {
    display: grid;
    width: 54px;
    height: 54px;
    margin-bottom: 15px;
    color: #4e8979;
    background: linear-gradient(145deg, #e4f0eb, #f5f9f6);
    border: 1px solid #c8ddd5;
    border-radius: 15px;
    box-shadow: 0 9px 24px rgb(51 98 83 / 10%);
    place-items: center;
  }

  .canvas-onboarding-icon svg {
    width: 29px;
    height: 29px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.5;
  }

  .canvas-onboarding strong {
    color: #34413a;
    font-size: calc(14px * var(--text-scale));
    font-weight: 670;
    letter-spacing: -0.012em;
  }

  .canvas-onboarding > span:last-child {
    max-width: 240px;
    margin-top: 7px;
    color: #768079;
    font-size: calc(11px * var(--text-scale));
    line-height: 1.5;
  }

  @keyframes canvas-onboarding-enter {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.975);
    }

    to {
      opacity: 1;
      transform: translate(-50%, -54%) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas-onboarding {
      animation: none;
    }
  }
</style>
