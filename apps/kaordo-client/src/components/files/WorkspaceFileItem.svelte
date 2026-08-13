<script lang="ts">
  import type { WorkspaceSummary } from '../../lib/domain/workspace';
  import { openContextMenu } from '../../lib/ui/contextMenu';

  type Props = {
    active: boolean;
    file: WorkspaceSummary;
    onOpen: (file: WorkspaceSummary) => void | Promise<void>;
    onDelete: (file: WorkspaceSummary) => void | Promise<void>;
    platform: 'desktop' | 'web';
  };

  let { active, file, onDelete, onOpen, platform }: Props = $props();
</script>

<li>
  <button
    class:active
    type="button"
    aria-current={active ? 'page' : undefined}
    onclick={() => void onOpen(file)}
    oncontextmenu={(event) => openContextMenu(event, `${file.name}.vdw`, [
      {
        action: () => onOpen(file),
        hint: 'Enter',
        icon: 'open',
        id: 'open-workspace',
        label: active ? 'Reopen Workspace' : 'Open Workspace',
      },
      {
        action: () => onDelete(file),
        confirmation: `Delete ${file.name}.vdw?`,
        danger: true,
        icon: 'delete',
        id: 'delete-workspace',
        label: 'Delete Workspace',
      },
    ])}
    title={file.path}
  >
    <span class="file-icon" aria-hidden="true"></span>
    <span class="file-copy">
      <strong>{file.name}.vdw</strong>
      <small>{platform === 'desktop' ? 'Workspace file' : 'Browser workspace'}</small>
    </span>
  </button>
</li>

<style>
  button {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 47px;
    padding: 7px 9px;
    color: #3c453f;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }

  button:hover {
    background: rgb(255 255 255 / 52%);
    border-color: rgb(203 208 201 / 72%);
  }

  button.active {
    color: #264a40;
    background: var(--accent-soft);
    border-color: #c7dcd4;
  }

  button:focus-visible {
    outline: 2px solid rgb(55 117 102 / 42%);
    outline-offset: 1px;
  }

  .file-icon {
    position: relative;
    display: block;
    width: 22px;
    height: 27px;
    background: #fbfcfa;
    border: 1px solid #aeb6b0;
    border-radius: 4px;
    box-shadow: 0 2px 5px rgb(45 58 51 / 5%);
  }

  .file-icon::after {
    position: absolute;
    top: 5px;
    right: 4px;
    left: 4px;
    height: 1px;
    background: #b5bcb7;
    box-shadow: 0 5px 0 #c5cac6;
    content: '';
  }

  button.active .file-icon {
    background: #f7fbf9;
    border-color: #7aa899;
  }

  .file-copy {
    display: block;
    min-width: 0;
  }

  strong {
    display: block;
    overflow: hidden;
    font-size: calc(12px * var(--text-scale));
    font-weight: 640;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: block;
    margin-top: 3px;
    color: #747d76;
    font-size: calc(10px * var(--text-scale));
    line-height: 1.2;
  }
</style>
