<script lang="ts">
  import type {
    ArrowElement,
    ObjectSummary,
    MediaElement,
    RectangleElement,
    TextElement,
    WorkspaceDetail,
  } from '../lib/domain/workspace';
  import { textElementLabel } from '../lib/domain/workspace';
  import type { CanvasService } from '../lib/services/CanvasService';
  import type { CanvasSnapshot } from '../lib/states/CanvasGState';
  import { openContextMenu } from '../lib/ui/contextMenu';
  import PanelHeader from './ui/PanelHeader.svelte';
  import PanelLoading from './ui/PanelLoading.svelte';

  type Props = {
    canvas: CanvasService;
    canvasSnapshot: Readonly<CanvasSnapshot>;
    isOpening: boolean;
    onNewPanel: () => void | Promise<void>;
    openError: string | null;
    workspace: WorkspaceDetail | null;
  };

  type PanelNode = {
    depth: number;
    id: string;
    key: string;
    kind: 'panel';
    label: string;
    object: ObjectSummary;
    placed: boolean;
  };

  type CardNode = {
    depth: number;
    element: RectangleElement;
    id: string;
    key: string;
    kind: 'card';
    label: string;
    selected: boolean;
  };

  type TextNode = {
    depth: number;
    element: TextElement;
    id: string;
    key: string;
    kind: 'text';
    label: string;
    selected: boolean;
  };

  type MediaNode = {
    depth: number;
    element: MediaElement;
    id: string;
    key: string;
    kind: 'media';
    label: string;
    selected: boolean;
  };

  type ArrowNode = {
    depth: number;
    element: ArrowElement;
    id: string;
    key: string;
    kind: 'arrow';
    label: string;
    selected: boolean;
  };

  type ElementNode = ArrowNode | CardNode | TextNode | MediaNode;

  type ContentNode = PanelNode | ElementNode;

  /**
   * Render-ready shape for SoftUI's Tree View.  The canvas snapshot is kept
   * flat because that is the most useful shape for focus/delete operations;
   * this lightweight projection adds only the parent/children relationship
   * needed by the tree markup.
   */
  type ContentTreeNode = ContentNode & { children: ContentTreeNode[] };

  let {
    canvas,
    canvasSnapshot,
    isOpening,
    onNewPanel,
    openError,
    workspace,
  }: Props = $props();
  let newPanelButton = $state<HTMLButtonElement>();
  let placedPanelIds = $derived(
    new Set(
      workspace
        ? (canvasSnapshot.placements[workspace.id] ?? []).map(
            (placement) => placement.id,
          )
        : [],
    ),
  );

  let contentNodes = $derived.by(() => buildContentTree(
    workspace,
    canvasSnapshot,
    placedPanelIds,
  ));
  let contentTree = $derived.by(() => buildContentTreeHierarchy(contentNodes));
  let collapsedTreeKeys = $state<Set<string>>(new Set());

  export function focusNewPanel() {
    newPanelButton?.focus();
  }

  function focusNode(node: ContentNode): void {
    if (!workspace) return;
    if (node.kind === 'panel') {
      canvas.handleObjectSourceClick(node.object);
      return;
    }
    void canvas.focusCanvasElement(workspace.id, node.element.id);
  }

  function isTreeNodeExpanded(node: ContentTreeNode): boolean {
    return node.children.length > 0 && !collapsedTreeKeys.has(node.key);
  }

  function handleTreeNodeClick(event: MouseEvent, node: ContentTreeNode): void {
    const target = event.target;
    const clickedToggle = typeof Element !== 'undefined'
      && target instanceof Element
      && target.closest('.sui-tree-toggle') !== null;

    if (clickedToggle && node.children.length > 0) {
      event.stopPropagation();
      const next = new Set(collapsedTreeKeys);
      if (next.has(node.key)) next.delete(node.key);
      else next.add(node.key);
      collapsedTreeKeys = next;
      return;
    }

    focusNode(node);
  }

  function handleNodeKeydown(event: KeyboardEvent, node: ContentNode): void {
    if (node.kind !== 'panel') return;
    canvas.handleObjectSourceKeydown(event, node.object);
  }

  function handleNodeContextMenu(event: MouseEvent, node: ContentNode): void {
    if (!workspace) return;
    if (node.kind === 'panel') {
      openContextMenu(event, node.label, [
        {
          action: () => focusNode(node),
          icon: node.placed ? 'focus' : 'open',
          id: node.placed ? 'focus-panel' : 'place-panel',
          label: node.placed ? 'Focus on Canvas' : 'Place on Canvas',
        },
        {
          action: async () => {
            await canvas.deleteWorkspaceObject(workspace.id, node.id);
          },
          confirmation: `Delete ${node.label}?`,
          danger: true,
          icon: 'delete',
          id: 'delete-panel',
          label: 'Delete Panel',
        },
      ]);
      return;
    }

    const element = node.element;
    const isCard = element.type === 'rectangle';
    const isMedia = element.type === 'media';
    const isArrow = element.type === 'arrow';
    openContextMenu(event, node.label, [
      {
        action: () => focusNode(node),
        icon: 'focus',
        id: `focus-${node.kind}`,
        label: 'Focus on Canvas',
      },
      ...(isCard
        ? [{
            action: () => canvas.state.setTool('text'),
            icon: 'text' as const,
            id: 'text-tool',
            label: 'Text Tool',
          }]
        : isMedia || isArrow
        ? []
        : [{
            action: () => canvas.state.editText(element.id),
            icon: 'edit' as const,
            id: 'edit-text',
            label: 'Edit Text',
          }]),
      {
        action: () => canvas.deleteCanvasElement(workspace.id, element.id),
          confirmation: `Delete this ${isCard ? 'card' : isMedia ? 'media' : isArrow ? 'arrow' : 'text'}?`,
        danger: true,
        icon: 'delete',
        id: `delete-${node.kind}`,
          label: `Delete ${isCard ? 'Card' : isMedia ? 'Media' : isArrow ? 'Arrow' : 'Text'}`,
      },
    ]);
  }

  function nodeSubtitle(node: ElementNode): string {
    if (node.kind === 'arrow') {
      return node.element.parentObjectId ? 'Arrow · Panel' : 'Arrow · Canvas';
    }
    if (node.kind === 'card') {
      return node.element.parentObjectId ? 'Card · Panel' : 'Card · Canvas';
    }
    if (node.kind === 'text') {
      return node.element.parentElementId
        ? 'Text · Card'
        : node.element.parentObjectId ? 'Text · Panel' : 'Text · Canvas';
    }
    return node.element.parentElementId
      ? `${node.element.kind} · Card`
      : node.element.parentObjectId
        ? `${node.element.kind} · Panel`
        : `${node.element.kind} · Canvas`;
  }

  function buildContentTree(
    currentWorkspace: WorkspaceDetail | null,
    snapshot: Readonly<CanvasSnapshot>,
    placedIds: ReadonlySet<string>,
  ): ContentNode[] {
    if (!currentWorkspace) return [];

    const document = snapshot.canvasDocuments[currentWorkspace.id];
    const elements = document?.elements ?? [];
    const panelIds = new Set(currentWorkspace.objects.map((object) => object.id));
    const cards = new Map(
      elements
        .filter((element): element is RectangleElement => element.type === 'rectangle')
        .map((element) => [element.id, element] as const),
    );
    const emitted = new Set<string>();
    const nodes: ContentNode[] = [];
    let cardNumber = 0;

    const addText = (element: TextElement, depth: number) => {
      if (emitted.has(element.id)) return;
      emitted.add(element.id);
      nodes.push({
        depth,
        element,
        id: element.id,
        key: `text:${element.id}`,
        kind: 'text',
        label: textElementLabel(element),
        selected: snapshot.selectedGlobalElementId === element.id,
      });
    };

    const addMedia = (element: MediaElement, depth: number) => {
      if (emitted.has(element.id)) return;
      emitted.add(element.id);
      nodes.push({
        depth,
        element,
        id: element.id,
        key: `media:${element.id}`,
        kind: 'media',
        label: element.name,
        selected: snapshot.selectedGlobalElementId === element.id,
      });
    };

    const addArrow = (element: ArrowElement, depth: number) => {
      if (emitted.has(element.id)) return;
      emitted.add(element.id);
      nodes.push({
        depth,
        element,
        id: element.id,
        key: `arrow:${element.id}`,
        kind: 'arrow',
        label: 'Arrow',
        selected: snapshot.selectedGlobalElementId === element.id,
      });
    };

    const addCard = (element: RectangleElement, depth: number) => {
      if (emitted.has(element.id)) return;
      emitted.add(element.id);
      cardNumber += 1;
      nodes.push({
        depth,
        element,
        id: element.id,
        key: `card:${element.id}`,
        kind: 'card',
        label: `Card ${cardNumber}`,
        selected: snapshot.selectedGlobalElementId === element.id,
      });
      for (const child of elements) {
        if (child.type === 'text' && child.parentElementId === element.id) {
          addText(child, depth + 1);
        } else if (child.type === 'media' && child.parentElementId === element.id) {
          addMedia(child, depth + 1);
        }
      }
    };

    for (const object of currentWorkspace.objects) {
      nodes.push({
        depth: 0,
        id: object.id,
        key: `panel:${object.id}`,
        kind: 'panel',
        label: object.title,
        object,
        placed: placedIds.has(object.id),
      });
      for (const element of elements) {
        if (
          element.type === 'rectangle' &&
          element.parentObjectId === object.id
        ) {
          addCard(element, 1);
        } else if (
          element.type === 'text' &&
          element.parentObjectId === object.id &&
          (!element.parentElementId || !cards.has(element.parentElementId))
        ) {
          addText(element, 1);
        } else if (
          element.type === 'media' &&
          element.parentObjectId === object.id &&
          (!element.parentElementId || !cards.has(element.parentElementId))
        ) {
          addMedia(element, 1);
        } else if (
          element.type === 'arrow' &&
          element.parentObjectId === object.id
        ) {
          addArrow(element, 1);
        }
      }
    }

    // Keep unattached cards and text visible as root-level canvas content. A
    // malformed parent reference is treated as detached rather than hidden.
    for (const element of elements) {
      if (element.type === 'rectangle') {
        if (!element.parentObjectId || !panelIds.has(element.parentObjectId)) {
          addCard(element, 0);
        }
        continue;
      }
      if (element.type === 'arrow') {
        if (!element.parentObjectId || !panelIds.has(element.parentObjectId)) {
          addArrow(element, 0);
        }
        continue;
      }
      if (
        element.parentElementId &&
        cards.has(element.parentElementId)
      ) continue;
      if (!element.parentObjectId || !panelIds.has(element.parentObjectId)) {
        if (element.type === 'text') addText(element, 0);
        else addMedia(element, 0);
      }
    }
    return nodes;
  }

  function buildContentTreeHierarchy(nodes: readonly ContentNode[]): ContentTreeNode[] {
    const roots: ContentTreeNode[] = [];
    const stack: Array<{ depth: number; node: ContentTreeNode }> = [];

    for (const node of nodes) {
      const treeNode: ContentTreeNode = { ...node, children: [] };

      while (stack.length && stack[stack.length - 1]!.depth >= node.depth) {
        stack.pop();
      }

      const parent = stack[stack.length - 1]?.node;
      if (parent) parent.children.push(treeNode);
      else roots.push(treeNode);

      stack.push({ depth: node.depth, node: treeNode });
    }

    return roots;
  }
</script>

{#snippet headerAction()}
  {#if workspace && !isOpening}
    <button
      class="new-panel-action"
      type="button"
      bind:this={newPanelButton}
      onclick={onNewPanel}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 4v12M4 10h12" />
      </svg>
      New Panel
    </button>
  {/if}
{/snippet}

<aside class="panel contents-panel" aria-labelledby="contents-title">
  <PanelHeader
    action={headerAction}
    eyebrow="Contents"
    title="Contents"
    titleId="contents-title"
  />

  {#if isOpening}
    <PanelLoading message="Loading contents…" />
  {:else if workspace && contentNodes.length}
    {#snippet renderTree(nodes: ContentTreeNode[])}
      {#each nodes as node (node.key)}
        <li
          class="sui-tree-item"
          class:expanded={isTreeNodeExpanded(node)}
          role="treeitem"
          aria-level={node.depth + 1}
          aria-expanded={node.children.length > 0 ? isTreeNodeExpanded(node) : undefined}
          aria-selected={node.kind !== 'panel' ? node.selected : undefined}
        >
          <button
            class="content-node sui-tree-label sui-raised"
            class:content-node--panel={node.kind === 'panel'}
            class:content-node--card={node.kind === 'card'}
            class:content-node--text={node.kind === 'text'}
            class:content-node--media={node.kind === 'media'}
            class:content-node--arrow={node.kind === 'arrow'}
            class:content-node--selected={node.kind !== 'panel' && node.selected}
            class:content-node--placed={node.kind === 'panel' && node.placed}
            class:active={node.kind !== 'panel' ? node.selected : node.placed}
            type="button"
            aria-label={node.kind === 'panel'
              ? `${node.placed ? 'Focus' : 'Place'} ${node.label} on canvas`
              : node.kind === 'card'
                ? `Focus Card ${node.label.replace('Card ', '')} on canvas`
                : node.kind === 'text'
                  ? `Focus text: ${node.label}`
                  : `Focus ${node.label} on canvas`}
            title={node.kind === 'panel'
              ? node.placed ? 'Focus panel on canvas' : 'Place panel on canvas'
              : 'Focus on canvas'}
            onclick={(event) => handleTreeNodeClick(event, node)}
            onkeydown={(event) => handleNodeKeydown(event, node)}
            oncontextmenu={(event) => handleNodeContextMenu(event, node)}
          >
            {#if node.children.length > 0}
              <span class="sui-tree-toggle" aria-hidden="true">
                <svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
              </span>
            {:else}
              <span class="sui-tree-toggle-spacer" aria-hidden="true"></span>
            {/if}
            <span class="content-node-icon sui-tree-icon" aria-hidden="true">
              {#if node.kind === 'panel'}
                <svg viewBox="0 0 20 20"><path d="M3 5.5h5l1.5 2H17v7H3z" /></svg>
              {:else if node.kind === 'card'}
                <svg viewBox="0 0 20 20"><rect x="3.5" y="4.5" width="13" height="11" rx="2" /></svg>
              {:else if node.kind === 'text'}
                <span>T</span>
              {:else if node.kind === 'media'}
                <svg viewBox="0 0 20 20"><path d="M5 4h10v12H5zM8 4v12M8 8h7M8 12h7" /></svg>
              {:else}
                <svg viewBox="0 0 20 20"><path d="M3 10h11m-4-4 4 4-4 4" /></svg>
              {/if}
            </span>
            <span class="content-node-copy sui-tree-text">
              <strong>{node.label}</strong>
              <small>{node.kind === 'panel' ? 'Panel' : nodeSubtitle(node)}</small>
            </span>
            {#if node.kind === 'panel' && node.placed}
              <span class="content-node-status" aria-label="On canvas">✓</span>
            {/if}
          </button>
          {#if node.children.length > 0}
            <ul
              class="sui-tree-children sui-inset"
              role="group"
            >
              {@render renderTree(node.children)}
            </ul>
          {/if}
        </li>
      {/each}
    {/snippet}

    <ul class="contents-tree sui-tree" role="tree" aria-label="Contents in this workspace">
      {@render renderTree(contentTree)}
    </ul>
  {:else}
    <div class="panel-empty panel-empty--contents">
      <span class="empty-icon empty-icon--contents" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <p>{openError ? 'Contents are unavailable.' : 'No content yet.'}</p>
    </div>
  {/if}
</aside>

<style>
  .panel {
    display: grid;
    grid-template-rows: 64px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    background: var(--panel);
  }

  .contents-panel { border-left: 1px solid var(--line); }

  .contents-tree {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-height: 0;
    margin: 0;
    padding: 10px 12px;
    overflow: auto;
    list-style: none;
  }

  .sui-tree-item {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sui-tree-label {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 46px;
    padding: 6px 8px;
    color: #3c453f;
    background: var(--panel);
    border: 0;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    box-shadow: 3px 3px 8px rgb(39 51 67 / 20%);
    transition: color 150ms ease, background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
  }

  .sui-tree-label:hover {
    color: #285a4e;
    background: color-mix(in srgb, var(--panel) 92%, var(--accent) 8%);
    box-shadow: 2px 2px 6px rgb(39 51 67 / 18%);
    transform: translateY(-1px);
  }

  .sui-tree-label:active,
  .content-node--selected,
  .content-node--placed {
    color: #285a4e;
    background: color-mix(in srgb, var(--panel) 88%, var(--accent) 12%);
    box-shadow: inset 2px 2px 5px rgb(39 51 67 / 20%);
    transform: translateY(1px);
  }

  .sui-tree-label:focus-visible {
    outline: 2px solid rgb(55 117 102 / 38%);
    outline-offset: 1px;
  }

  .sui-tree-toggle,
  .sui-tree-toggle-spacer {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
  }

  .sui-tree-toggle { color: #747d76; transition: color 150ms ease, transform 180ms ease; }
  .sui-tree-toggle svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
  .sui-tree-item.expanded > .sui-tree-label .sui-tree-toggle { color: var(--accent); transform: rotate(90deg); }

  .content-node-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 21px;
    height: 21px;
    flex: 0 0 21px;
    color: #397565;
    background: transparent;
    border: 0;
    border-radius: 6px;
  }

  .content-node--text .content-node-icon {
    color: #775c8d;
    font-family: Georgia, serif;
    font-size: calc(12px * var(--text-scale));
    font-weight: 700;
  }

  .content-node-icon svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .content-node-copy { min-width: 0; flex: 1; overflow: hidden; }
  strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { font-size: calc(12px * var(--text-scale)); font-weight: 640; line-height: 1.3; }
  small { margin-top: 3px; color: #747d76; font-size: calc(10px * var(--text-scale)); line-height: 1.2; }
  .content-node-status { margin-left: auto; color: #377566; font-size: calc(13px * var(--text-scale)); font-weight: 700; }

  .sui-tree-children {
    display: none;
    min-width: 0;
    margin: 2px 0 2px 12px;
    padding: 3px 4px 3px 8px;
    background: color-mix(in srgb, var(--panel) 84%, #c6d0dd 16%);
    border-radius: 14px;
    box-shadow: inset 2px 2px 5px rgb(39 51 67 / 16%);
    list-style: none;
  }

  .sui-tree-item.expanded > .sui-tree-children {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .panel-empty { display: flex; align-items: center; flex-direction: column; justify-content: center; gap: 16px; padding: 30px 28px; color: #68716b; text-align: center; }
  .panel-empty p { max-width: 160px; font-size: calc(12px * var(--text-scale)); line-height: 1.55; }
  .empty-icon { position: relative; display: block; width: 38px; height: 38px; color: #a8aea9; }
  .empty-icon--contents { display: grid; align-content: center; gap: 6px; padding: 7px 5px; border: 1px solid currentColor; border-radius: 6px; }
  .empty-icon--contents span { display: block; width: 100%; height: 1px; background: currentColor; }
  .empty-icon--contents span:nth-child(2) { width: 68%; }

  .new-panel-action { display: inline-flex; align-items: center; justify-content: center; flex: none; gap: 4px; height: 30px; padding: 0 9px; color: #2f675a; background: #f7faf8; border: 1px solid #b9cec6; border-radius: 7px; cursor: pointer; font-size: calc(10px * var(--text-scale)); font-weight: 670; }
  .new-panel-action:hover { color: #285a4e; background: #eaf3ef; border-color: #94b8aa; }
  .new-panel-action:focus-visible { outline: 2px solid rgb(55 117 102 / 35%); outline-offset: 2px; }
  .new-panel-action svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.8; }

  @media (prefers-reduced-motion: reduce) {
    .content-node { transition: none; }
  }
</style>
