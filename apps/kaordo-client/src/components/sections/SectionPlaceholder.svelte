<script lang="ts">
  import type { AppSection } from '../../lib/domain/appSection';

  type Props = { section: Extract<AppSection, 'ligo'> };

  let { section }: Props = $props();
  let content = $derived(details(section));

  function details(value: Props['section']) {
    switch (value) {
      case 'ligo':
        return {
          eyebrow: 'Private by default',
          message: 'Direct conversations and effortless file sharing.',
          title: 'Ligo',
        };
    }
  }
</script>

<main class="section-placeholder" aria-labelledby="section-placeholder-title">
  <div class="placeholder-mark" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>
  <span class="eyebrow">{content.eyebrow}</span>
  <h1 id="section-placeholder-title">{content.title}</h1>
  <p>{content.message}</p>
  <span class="coming-soon">Foundation ready · UI coming next</span>
</main>

<style>
  .section-placeholder {
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 0;
    padding: 48px;
    color: #354039;
    background:
      radial-gradient(circle at 50% 42%, rgb(74 137 118 / 8%), transparent 27%),
      #f5f7f3;
    text-align: center;
  }

  .placeholder-mark {
    position: relative;
    width: 58px;
    height: 58px;
    margin-bottom: 25px;
    color: #4e8b79;
    background: rgb(255 255 255 / 72%);
    border: 1px solid #cbd9d2;
    border-radius: 18px;
    box-shadow: 0 16px 36px rgb(40 74 61 / 9%);
  }

  .placeholder-mark span {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-radius: 5px;
  }

  .placeholder-mark span:nth-child(1) { top: 13px; left: 13px; }
  .placeholder-mark span:nth-child(2) { top: 13px; right: 13px; opacity: 0.62; }
  .placeholder-mark span:nth-child(3) { right: 13px; bottom: 13px; opacity: 0.34; }

  .eyebrow {
    color: #548173;
    font-size: calc(10px * var(--text-scale));
    font-weight: 720;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    margin-top: 12px;
    color: #25312b;
    font-size: calc(31px * var(--text-scale));
    font-weight: 680;
    letter-spacing: -0.035em;
  }

  p {
    max-width: 410px;
    margin-top: 13px;
    color: #6a756e;
    font-size: calc(13px * var(--text-scale));
    line-height: 1.65;
  }

  .coming-soon {
    margin-top: 24px;
    padding: 7px 10px;
    color: #7e8982;
    background: rgb(255 255 255 / 60%);
    border: 1px solid #d9dfda;
    border-radius: 999px;
    font-size: calc(9px * var(--text-scale));
    font-weight: 620;
  }
</style>
