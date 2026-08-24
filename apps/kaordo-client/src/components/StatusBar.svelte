<script lang="ts">
  import type { AppSection } from '../lib/domain/appSection';

  type Props = { platform: 'desktop' | 'web'; section: AppSection };

  const SECTION_STATUS: Record<AppSection, string> = {
    agordoj: 'Application settings',
    fluo: 'Local social feed',
    ilo: 'Personal tools',
    klaro: 'workspace',
    ligo: 'Direct messages and file sharing',
    mi: 'Personal profile',
    nodo: 'Personal data node',
    regado: 'Administration console',
    rondo: 'Community spaces',
  };

  let { platform, section }: Props = $props();

  let sectionStatus = $derived(
    section === 'klaro'
      ? `${platform === 'desktop' ? 'Desktop' : 'Browser'} ${SECTION_STATUS.klaro}`
      : SECTION_STATUS[section],
  );
</script>

<footer class="status-bar">
  <span class="status-item">
    <span class="status-pulse" aria-hidden="true"></span>
    Local-first
  </span>
  <span>{sectionStatus}</span>
</footer>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    color: rgb(246 250 247 / 50%);
    background: var(--chrome);
    border-top: 1px solid rgb(255 255 255 / 7%);
    font-size: calc(10px * var(--text-scale));
    font-weight: 560;
    letter-spacing: 0.03em;
    user-select: none;
  }

  .status-item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  .status-pulse {
    flex: none;
    width: 5px;
    height: 5px;
    background: var(--accent-bright);
    border-radius: 50%;
  }
</style>
