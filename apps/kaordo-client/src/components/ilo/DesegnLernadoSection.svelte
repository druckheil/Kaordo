<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PhotoViewer from '../ui/PhotoViewer.svelte';
  import { clipboardMediaFiles } from '../../lib/features/clipboardMedia';
  import { isDesegnImageFile } from '../../lib/services/desegnLernadoMedia';
  import {
    type DesegnDrawing,
    type DesegnFocus,
    type DesegnPetPalette,
  } from '../../lib/domain/desegnLernado';
  import type { IloGState } from '../../lib/states/IloGState';
  import {
    DESEGN_ARTIFACTS,
    artifactProgress,
    desegnArtifact,
    desegnPracticePrompt,
    desegnStats,
    nextDesegnArtifact,
    unlockedDesegnArtifacts,
  } from '../../lib/services/desegnLernadoProgress';
  import DesegnDrawingEditor from './desegnlernado/DesegnDrawingEditor.svelte';
  import DesegnPet from './desegnlernado/DesegnPet.svelte';
  import DesegnThumbnail from './desegnlernado/DesegnThumbnail.svelte';

  type Props = {
    snapshot: Readonly<import('../../lib/domain/desegnLernado').DesegnLernadoSnapshot>;
    state: IloGState;
  };
  type StudioRoom = 'gallery' | 'review' | 'companion' | 'artifacts' | 'insights';

  let { snapshot, state: iloState }: Props = $props();
  let activeRoom = $state<StudioRoom>('gallery');
  let fileInput: HTMLInputElement;
  let search = $state('');
  let focusFilter = $state<DesegnFocus | 'all'>('all');
  let galleryLimit = $state(36);
  let dragActive = $state(false);
  let editingDrawing = $state<DesegnDrawing | null>(null);
  let pendingDelete = $state<DesegnDrawing | null>(null);
  let viewer = $state<{ drawing: DesegnDrawing; url: string } | null>(null);
  let viewerLoadingId = $state<string | null>(null);
  let viewerRequestId = 0;
  let toast = $state<{ artifactId?: string; message: string; title: string } | null>(null);
  let toastTimer: number | null = null;
  let petName = $state('');
  let lastSavedPetName = $state('');

  $effect(() => {
    const savedName = snapshot.pet.name;
    if (!petName || petName === lastSavedPetName) petName = savedName;
    lastSavedPetName = savedName;
  });

  const stats = $derived(desegnStats(snapshot.drawings));
  const unlockedArtifacts = $derived(unlockedDesegnArtifacts(stats));
  const unlockedIds = $derived(new Set(unlockedArtifacts.map((artifact) => artifact.id)));
  const equippedArtifacts = $derived(snapshot.pet.equippedArtifactIds.flatMap((id) => {
    const artifact = desegnArtifact(id);
    return artifact ? [artifact] : [];
  }));
  const nextArtifact = $derived(nextDesegnArtifact(stats));
  const practicePrompt = $derived(desegnPracticePrompt(snapshot.pet, stats));
  const filteredDrawings = $derived.by(() => {
    const query = search.trim().toLocaleLowerCase();
    return snapshot.drawings.filter((drawing) => {
      if (focusFilter !== 'all' && drawing.focus !== focusFilter) return false;
      if (!query) return true;
      return [drawing.title, drawing.description, drawing.focus, ...drawing.shortcomings]
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  });
  const dueDrawings = $derived(snapshot.drawings
    .filter((drawing) => drawing.nextReviewAt <= Date.now())
    .sort((left, right) => left.nextReviewAt - right.nextReviewAt));
  const flawBank = $derived(commonShortcomings(snapshot.drawings));
  const activityDays = $derived(recentActivity(snapshot.drawings));
  const comparison = $derived(comparisonPair(snapshot.drawings));
  const uploadGoal = $derived(Math.min(100, stats.uploadedThisWeek * 20));
  const reflectionGoal = $derived(stats.totalDrawings === 0 ? 0 : Math.round(stats.describedDrawings / stats.totalDrawings * 100));
  const reviewGoal = $derived(Math.min(100, stats.totalReviews * 5));

  const rooms: Array<{ id: StudioRoom; label: string; hint: string; icon: string }> = [
    { id: 'gallery', label: 'Gallery', hint: 'Your work', icon: 'gallery' },
    { id: 'review', label: 'Review', hint: 'Look again', icon: 'review' },
    { id: 'companion', label: 'Companion', hint: 'Studio guide', icon: 'pet' },
    { id: 'artifacts', label: 'Artifacts', hint: 'Unlock drills', icon: 'artifact' },
    { id: 'insights', label: 'Insights', hint: 'See patterns', icon: 'insights' },
  ];

  onMount(() => {
    void iloState.loadDesegnLernado(false);
    const handlePaste = (event: ClipboardEvent) => {
      if (isTextInput(event.target)) return;
      const images = clipboardMediaFiles(event.clipboardData).filter(isDesegnImageFile);
      if (images.length === 0) return;
      event.preventDefault();
      void upload(images, 'Pasted from clipboard');
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  });

  onDestroy(() => {
    if (toastTimer) window.clearTimeout(toastTimer);
    closeViewer();
  });

  function chooseFiles(): void {
    fileInput?.click();
  }

  function filesChosen(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void upload(files, 'Added from file');
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragActive = false;
    void upload(Array.from(event.dataTransfer?.files ?? []), 'Dropped into gallery');
  }

  function handleDragLeave(event: DragEvent): void {
    const nextTarget = event.relatedTarget;
    const shell = event.currentTarget;
    if (!(shell instanceof HTMLElement) || !(nextTarget instanceof Node) || !shell.contains(nextTarget)) {
      dragActive = false;
    }
  }

  async function readClipboard(): Promise<void> {
    try {
      if (!navigator.clipboard?.read) throw new Error('Clipboard reading is not available here. Use Command/Ctrl + V.');
      const files: File[] = [];
      for (const [index, item] of (await navigator.clipboard.read()).entries()) {
        // A single clipboard item can expose the same bitmap as PNG, JPEG and
        // WebP. Choose one deterministic representation so one paste never
        // creates three identical drawings.
        const type = ['image/png', 'image/webp', 'image/jpeg', 'image/avif', 'image/bmp', 'image/gif']
          .find((candidate) => item.types.includes(candidate));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `clipboard-${Date.now()}-${index + 1}.${extensionFor(type)}`, { type }));
      }
      if (files.length === 0) throw new Error('The clipboard does not contain an image.');
      await upload(files, 'Pasted from clipboard');
    } catch (error) {
      showToast('Clipboard', readableError(error));
    }
  }

  async function upload(files: readonly File[], source: string): Promise<void> {
    const images = files.filter(isDesegnImageFile);
    if (images.length === 0) {
      showToast('No drawing found', 'Choose or paste a PNG, JPEG, WebP, GIF, AVIF, or BMP image.');
      return;
    }
    const result = await iloState.addDesegnDrawings(images);
    if (result.added > 0) {
      activeRoom = 'gallery';
      galleryLimit = Math.max(galleryLimit, result.added + 12);
      const newest = iloState.snapshot.desegnLernado.drawings[0];
      showToast(
        `${source} · ${result.added} ${result.added === 1 ? 'drawing' : 'drawings'}`,
        newest ? `“${newest.title}” is safe in your local studio.` : 'Your local studio has been updated.',
      );
    }
    if (result.unlockedArtifactIds.length > 0) {
      const artifact = desegnArtifact(result.unlockedArtifactIds[0]);
      if (artifact) showToast('Artifact awakened', artifact.name, artifact.id, 4_800);
    } else if (result.errors.length > 0 && result.added === 0) {
      showToast('Could not add drawing', result.errors[0]!);
    }
  }

  async function openViewer(drawing: DesegnDrawing): Promise<void> {
    if (viewerLoadingId) return;
    const requestId = ++viewerRequestId;
    viewerLoadingId = drawing.id;
    const url = await iloState.desegnLernadoMediaUrl(drawing.id, 'original');
    if (requestId !== viewerRequestId) {
      if (url) iloState.releaseDesegnLernadoMediaUrl(drawing.id, 'original');
      return;
    }
    viewerLoadingId = null;
    if (!url) {
      showToast('Image unavailable', 'The local original could not be opened.');
      return;
    }
    viewer = { drawing, url };
  }

  function closeViewer(): void {
    viewerRequestId += 1;
    if (viewer) iloState.releaseDesegnLernadoMediaUrl(viewer.drawing.id, 'original');
    viewer = null;
    viewerLoadingId = null;
  }

  async function confirmDelete(): Promise<void> {
    const drawing = pendingDelete;
    if (!drawing) return;
    if (viewer?.drawing.id === drawing.id) closeViewer();
    if (await iloState.deleteDesegnDrawing(drawing.id)) {
      pendingDelete = null;
      showToast('Drawing removed', 'The original, preview, and its notes were deleted from this device.');
    }
  }

  async function review(drawing: DesegnDrawing, outcome: 'keep-working' | 'progress-visible'): Promise<void> {
    if (await iloState.reviewDesegnDrawing(drawing.id, outcome)) {
      showToast(
        outcome === 'progress-visible' ? 'Progress recorded' : 'Focus kept alive',
        outcome === 'progress-visible' ? 'This drawing will return later.' : 'It will return sooner for another look.',
      );
    }
  }

  async function savePetName(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (await iloState.renameDesegnPet(petName)) petName = iloState.snapshot.desegnLernado.pet.name;
  }

  async function choosePalette(palette: DesegnPetPalette): Promise<void> {
    await iloState.setDesegnPetPalette(palette);
  }

  async function toggleArtifact(artifactId: string): Promise<void> {
    const equippedIndex = snapshot.pet.equippedArtifactIds.indexOf(artifactId);
    if (equippedIndex >= 0) {
      await iloState.equipDesegnArtifact(null, equippedIndex);
      return;
    }
    const emptyIndex = snapshot.pet.equippedArtifactIds.findIndex((id) => id === null);
    await iloState.equipDesegnArtifact(artifactId, emptyIndex >= 0 ? emptyIndex : 2);
  }

  function showToast(title: string, message: string, artifactId?: string, duration = 3_200): void {
    if (toastTimer) window.clearTimeout(toastTimer);
    toast = { artifactId, message, title };
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, duration);
  }

  function formatDate(timestamp: number): string {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(timestamp);
  }

  function formatRelative(timestamp: number): string {
    const days = Math.ceil((timestamp - Date.now()) / 86_400_000);
    if (days <= 0) return 'ready now';
    if (days === 1) return 'tomorrow';
    return `in ${days} days`;
  }

  function focusLabel(focus: string): string {
    return focus.charAt(0).toUpperCase() + focus.slice(1);
  }
</script>

<style>
  .desegn-shell {
    --desegn-accent: #655bdc;
    --desegn-mint: #39a889;
    position: relative;
    box-sizing: border-box;
    min-width: 0;
    min-height: 100%;
    padding: 12px 16px 38px;
    color: var(--sui-text);
    background:
      radial-gradient(circle at 88% 3%, color-mix(in srgb, var(--desegn-mint) 10%, transparent), transparent 27%),
      radial-gradient(circle at 14% 21%, color-mix(in srgb, var(--desegn-accent) 9%, transparent), transparent 25%),
      var(--sui-bg);
  }

  button, input, select { font: inherit; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid color-mix(in srgb, var(--desegn-accent) 70%, transparent); outline-offset: 2px; }
  .file-input { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .eyebrow { color: var(--desegn-accent); font-size: calc(7px * var(--text-scale)); font-weight: 810; letter-spacing: .15em; text-transform: uppercase; }

  .studio-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto auto;
    align-items: center;
    gap: 12px;
    max-width: 1440px;
    min-height: 76px;
    margin: 0 auto;
    padding: 10px 13px;
    background: color-mix(in srgb, var(--sui-bg) 94%, transparent);
    border-radius: 19px;
    box-shadow: var(--sui-shadow-raised);
  }

  .studio-identity { display: flex; align-items: center; gap: 13px; min-width: 0; }
  .studio-mark { display: grid; flex: none; width: 50px; height: 50px; color: #fff; background: linear-gradient(145deg, var(--desegn-accent), #3a9e8a); border-radius: 16px; box-shadow: 5px 6px 13px color-mix(in srgb, var(--desegn-accent) 28%, transparent), inset 1px 1px 1px rgb(255 255 255 / 28%); place-items: center; }
  .studio-mark svg { width: 29px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.7; }
  .studio-identity h1 { margin: 2px 0 0; color: var(--sui-text); font-size: calc(19px * var(--text-scale)); letter-spacing: -.035em; }
  .studio-identity p { max-width: 560px; margin: 2px 0 0; overflow: hidden; color: var(--sui-text-muted); font-size: calc(7.5px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .header-pulse { display: flex; align-items: center; gap: 2px; height: 52px; padding: 0 11px 0 2px; background: var(--sui-bg); border-radius: 15px; box-shadow: var(--sui-shadow-inset-sm); }
  .header-pulse > span { display: grid; gap: 2px; min-width: 100px; }
  .header-pulse small { color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); font-weight: 760; letter-spacing: .08em; text-transform: uppercase; }
  .header-pulse strong { color: var(--sui-text); font-size: calc(8px * var(--text-scale)); }
  .paste-button, .upload-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 40px; padding: 0 13px; border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 760; transition: color 150ms ease, box-shadow 150ms ease, transform 150ms ease; }
  .paste-button { color: var(--desegn-accent); background: var(--sui-bg); }
  .upload-button { min-width: 116px; color: #fff; background: linear-gradient(145deg, var(--desegn-accent), color-mix(in srgb, var(--desegn-accent) 70%, #313160)); box-shadow: 0 8px 18px color-mix(in srgb, var(--desegn-accent) 28%, transparent); }
  .paste-button:hover:not(:disabled), .upload-button:hover:not(:disabled) { transform: translateY(-1px); }
  .paste-button:active:not(:disabled) { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .upload-button:active:not(:disabled) { box-shadow: inset 3px 3px 8px rgb(31 30 77 / 35%); transform: none; }
  .paste-button:disabled, .upload-button:disabled { cursor: progress; opacity: .58; }
  .paste-button svg, .upload-button svg { width: 17px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }

  .studio-rooms { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; max-width: 1440px; margin: 10px auto 0; padding: 6px; background: var(--sui-bg); border-radius: 18px; box-shadow: var(--sui-shadow-inset-sm); }
  .studio-rooms > button { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 9px; min-width: 0; height: 49px; padding: 0 11px; color: var(--sui-text-muted); text-align: left; background: transparent; border: 0; border-radius: 13px; cursor: pointer; transition: color 150ms ease, background 150ms ease, box-shadow 150ms ease, transform 150ms ease; }
  .studio-rooms > button:hover { color: var(--desegn-accent); background: color-mix(in srgb, var(--sui-bg-light) 55%, transparent); }
  .studio-rooms > button.active { color: var(--desegn-accent); background: var(--sui-bg); box-shadow: var(--sui-shadow-raised-sm); }
  .studio-rooms > button:active { box-shadow: var(--sui-shadow-inset-sm); transform: none; }
  .room-icon { display: grid; width: 31px; height: 31px; background: var(--sui-bg); border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); place-items: center; }
  .studio-rooms button.active .room-icon { box-shadow: var(--sui-shadow-inset-sm); }
  .room-icon svg { width: 18px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.4; }
  .studio-rooms button > span:nth-child(2) { display: grid; min-width: 0; }
  .studio-rooms strong { overflow: hidden; color: currentColor; font-size: calc(8px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .studio-rooms small { margin-top: 1px; overflow: hidden; color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }

  .studio-error { display: flex; align-items: center; gap: 10px; max-width: 1440px; margin: 10px auto 0; padding: 10px 13px; color: #cb5d70; background: color-mix(in srgb, #df7284 10%, var(--sui-bg)); border-radius: 13px; box-shadow: var(--sui-shadow-inset-sm); }
  .studio-error > span { display: grid; flex: none; width: 25px; height: 25px; color: #fff; background: #d66578; border-radius: 9px; font-weight: 850; place-items: center; }
  .studio-error p { display: grid; gap: 2px; margin: 0; font-size: calc(7px * var(--text-scale)); }
  .studio-error strong { font-size: calc(8px * var(--text-scale)); }
  .studio-error button { margin-left: auto; color: inherit; background: transparent; border: 0; cursor: pointer; font-size: 20px; }
  .studio-content { max-width: 1440px; min-height: 560px; margin: 0 auto; padding-top: 20px; }
  .room-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
  .room-heading h2 { margin: 4px 0 0; color: var(--sui-text); font-size: calc(21px * var(--text-scale)); letter-spacing: -.035em; }
  .room-heading p { max-width: 690px; margin: 5px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.5; }
  .room-counter { display: grid; min-width: 94px; padding: 10px 14px; background: var(--sui-bg); border-radius: 14px; box-shadow: var(--sui-shadow-raised-sm); text-align: center; }
  .room-counter strong { color: var(--desegn-accent); font-size: calc(17px * var(--text-scale)); }
  .room-counter small { color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); }

  .gallery-intro { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, .8fr); gap: 14px; }
  .prompt-card, .weekly-card { position: relative; overflow: hidden; background: var(--sui-bg); border-radius: 21px; box-shadow: var(--sui-shadow-raised); }
  .prompt-card { min-height: 165px; padding: 25px 27px; }
  .prompt-card::after { position: absolute; right: -35px; bottom: -65px; width: 180px; height: 180px; background: radial-gradient(circle, color-mix(in srgb, var(--desegn-accent) 16%, transparent), transparent 68%); border-radius: 50%; content: ''; pointer-events: none; }
  .prompt-card h2 { max-width: 720px; margin: 7px 0 0; color: var(--sui-text); font-size: calc(18px * var(--text-scale)); line-height: 1.2; letter-spacing: -.025em; }
  .prompt-card p { max-width: 690px; margin: 8px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.52; }
  .prompt-card button { display: inline-flex; align-items: center; gap: 10px; margin-top: 17px; padding: 0; color: var(--desegn-accent); background: transparent; border: 0; cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 790; }
  .prompt-card button span { transition: transform 150ms ease; }
  .prompt-card button:hover span { transform: translateX(3px); }
  .weekly-card { display: flex; align-items: center; gap: 18px; min-height: 165px; padding: 21px; }
  .weekly-ring { position: relative; display: grid; flex: none; width: 84px; height: 84px; background: conic-gradient(var(--desegn-mint) var(--progress), color-mix(in srgb, var(--sui-text-light) 14%, transparent) 0); border-radius: 50%; place-items: center; }
  .weekly-ring::before { position: absolute; inset: 9px; background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-inset-sm); content: ''; }
  .weekly-ring strong, .weekly-ring small { position: relative; z-index: 1; }
  .weekly-ring strong { margin-right: 15px; color: var(--sui-text); font-size: calc(20px * var(--text-scale)); }
  .weekly-ring small { position: absolute; right: 19px; bottom: 25px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .weekly-card h3 { margin: 5px 0 0; color: var(--sui-text); font-size: calc(12px * var(--text-scale)); }
  .weekly-card p { margin: 6px 0 0; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); line-height: 1.45; }

  .empty-gallery { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 410px; margin-top: 17px; padding: 34px; background: var(--sui-bg); border: 2px dashed color-mix(in srgb, var(--desegn-accent) 24%, transparent); border-radius: 23px; box-shadow: var(--sui-shadow-inset); text-align: center; transition: border-color 160ms ease, transform 160ms ease; }
  .empty-gallery.dragging { border-color: var(--desegn-accent); transform: scale(.997); }
  .empty-paper { position: relative; display: grid; width: 94px; height: 94px; margin-bottom: 19px; color: var(--desegn-accent); background: var(--sui-bg); border-radius: 25px; box-shadow: var(--sui-shadow-raised); place-items: center; }
  .empty-paper i { position: absolute; right: -7px; top: -7px; width: 24px; height: 24px; background: var(--desegn-mint); border: 6px solid var(--sui-bg); border-radius: 50%; }
  .empty-paper svg { width: 53px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .empty-gallery h2 { margin: 7px 0 0; color: var(--sui-text); font-size: calc(18px * var(--text-scale)); }
  .empty-gallery p { max-width: 590px; margin: 8px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.55; }
  .empty-gallery > div { display: flex; gap: 10px; margin-top: 21px; }
  .empty-gallery button, .load-more, .no-results button { height: 40px; padding: 0 15px; color: var(--desegn-accent); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 750; }
  .empty-gallery button:first-child { color: #fff; background: var(--desegn-accent); }

  .gallery-tools { display: grid; grid-template-columns: minmax(260px, 1fr) auto auto; align-items: center; gap: 10px; margin-top: 17px; padding: 9px 11px; background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-shadow-raised-sm); }
  .search-field { display: flex; align-items: center; gap: 8px; height: 39px; padding: 0 11px; background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); }
  .search-field svg { flex: none; width: 17px; fill: none; stroke: var(--sui-text-light); stroke-linecap: round; stroke-width: 1.5; }
  .search-field input { min-width: 0; width: 100%; color: var(--sui-text); background: transparent; border: 0; outline: 0; font-size: calc(8px * var(--text-scale)); }
  .search-field input::placeholder { color: var(--sui-text-light); }
  .search-field button { color: var(--sui-text-light); background: transparent; border: 0; cursor: pointer; font-size: 18px; }
  .focus-field { display: flex; align-items: center; gap: 8px; height: 39px; padding: 0 8px 0 12px; background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); }
  .focus-field span { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); font-weight: 700; }
  .focus-field select { min-width: 125px; color: var(--sui-text); background: transparent; border: 0; outline: 0; font-size: calc(8px * var(--text-scale)); font-weight: 680; }
  .gallery-count { display: flex; align-items: baseline; gap: 5px; padding: 0 8px; white-space: nowrap; }
  .gallery-count strong { color: var(--desegn-accent); font-size: calc(13px * var(--text-scale)); }
  .gallery-count small { color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .drawing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(245px, 1fr)); gap: 15px; margin-top: 16px; }
  .drawing-card { min-width: 0; overflow: hidden; background: var(--sui-bg); border-radius: 18px; box-shadow: var(--sui-shadow-raised); transition: box-shadow 180ms ease, transform 180ms ease; }
  .drawing-card:hover { box-shadow: var(--sui-shadow-raised-lg); transform: translateY(-2px); }
  .drawing-image { position: relative; display: block; width: 100%; height: 218px; padding: 0; overflow: hidden; background: var(--sui-bg-dark); border: 0; cursor: zoom-in; }
  .fullscreen-hint { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 5px; padding: 7px 9px; color: #fff; background: rgb(34 40 59 / 72%); border-radius: 9px; font-size: calc(6.5px * var(--text-scale)); font-weight: 740; opacity: 0; backdrop-filter: blur(8px); transform: translateY(4px); transition: opacity 150ms ease, transform 150ms ease; }
  .drawing-image:hover .fullscreen-hint, .drawing-image:focus-visible .fullscreen-hint { opacity: 1; transform: none; }
  .fullscreen-hint svg { width: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .drawing-copy { min-height: 106px; padding: 14px 15px 9px; }
  .focus-chip { display: inline-flex; padding: 4px 7px; color: var(--desegn-mint); background: color-mix(in srgb, var(--desegn-mint) 10%, var(--sui-bg)); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); font-size: calc(6px * var(--text-scale)); font-weight: 780; letter-spacing: .06em; text-transform: uppercase; }
  .drawing-copy h3 { margin: 8px 0 0; overflow: hidden; color: var(--sui-text); font-size: calc(11px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .drawing-copy p { display: -webkit-box; min-height: 34px; margin: 5px 0 0; overflow: hidden; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); line-height: 1.45; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .drawing-card footer { display: flex; align-items: center; gap: 8px; padding: 9px 12px 12px; }
  .drawing-card footer > span:first-child { display: grid; margin-right: auto; }
  .drawing-card time, .drawing-card footer small { color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); }
  .drawing-card footer small { margin-top: 2px; color: #ca6977; }
  .card-rating { color: #e2aa3f; font-size: 9px; letter-spacing: -1px; white-space: nowrap; }
  .card-rating i { color: color-mix(in srgb, var(--sui-text-light) 22%, transparent); font-style: normal; }
  .drawing-card footer button { display: inline-flex; align-items: center; gap: 5px; height: 31px; padding: 0 9px; color: var(--desegn-accent); background: var(--sui-bg); border: 0; border-radius: 9px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .drawing-card footer button:active { box-shadow: var(--sui-shadow-inset-sm); }
  .drawing-card footer svg { width: 14px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .load-more { display: block; min-width: 230px; margin: 20px auto 0; }
  .no-results { display: grid; min-height: 310px; margin-top: 16px; background: var(--sui-bg); border-radius: 20px; box-shadow: var(--sui-shadow-inset); place-content: center; justify-items: center; text-align: center; }
  .no-results > span { color: var(--desegn-accent); font-size: 40px; }
  .no-results h3 { margin: 5px 0 0; color: var(--sui-text); }
  .no-results p { margin: 5px 0 15px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }

  .review-stage { display: grid; grid-template-columns: minmax(320px, 1.15fr) minmax(330px, .85fr); min-height: 510px; margin-top: 18px; overflow: hidden; background: var(--sui-bg); border-radius: 24px; box-shadow: var(--sui-shadow-raised-lg); }
  .review-image { position: relative; min-width: 0; min-height: 480px; padding: 18px; overflow: hidden; background: color-mix(in srgb, var(--sui-bg-dark) 66%, var(--sui-bg)); border: 0; cursor: zoom-in; }
  .review-image :global(.drawing-thumbnail) { border-radius: 17px; box-shadow: var(--sui-shadow-inset-sm); }
  .review-image > span { position: absolute; right: 30px; bottom: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 11px; color: #fff; background: rgb(35 42 62 / 72%); border-radius: 10px; font-size: calc(7px * var(--text-scale)); font-weight: 730; backdrop-filter: blur(8px); }
  .review-image svg { width: 15px; fill: none; stroke: currentColor; stroke-width: 1.5; }
  .review-copy { padding: 30px; }
  .review-copy > h3 { margin: 11px 0 0; color: var(--sui-text); font-size: calc(21px * var(--text-scale)); line-height: 1.15; }
  .review-copy > time { display: block; margin-top: 5px; color: var(--sui-text-light); font-size: calc(7px * var(--text-scale)); }
  .review-copy > p { margin: 17px 0 0; color: var(--sui-text-muted); font-size: calc(9px * var(--text-scale)); line-height: 1.6; }
  .review-copy > section { margin-top: 22px; padding: 17px; background: var(--sui-bg); border-radius: 15px; box-shadow: var(--sui-shadow-inset-sm); }
  .review-copy ul { display: grid; gap: 8px; margin: 12px 0 0; padding: 0; list-style: none; }
  .review-copy li { display: grid; grid-template-columns: 7px minmax(0, 1fr); align-items: start; gap: 9px; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.45; }
  .review-copy li i { width: 7px; height: 7px; margin-top: 4px; background: #dd7280; border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, #dd7280 12%, transparent); }
  .quiet-note { color: var(--sui-text-light) !important; font-size: calc(7px * var(--text-scale)) !important; }
  .review-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 22px; }
  .review-actions button { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 9px; min-height: 54px; padding: 9px 12px; color: #d26b78; text-align: left; background: var(--sui-bg); border: 0; border-radius: 13px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; }
  .review-actions button.positive { color: var(--desegn-mint); }
  .review-actions button:active { box-shadow: var(--sui-shadow-inset-sm); }
  .review-actions svg { width: 20px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.6; }
  .review-actions span { display: grid; }
  .review-actions strong { color: currentColor; font-size: calc(8px * var(--text-scale)); }
  .review-actions small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); }
  .edit-from-review { width: 100%; margin-top: 11px; padding: 7px; color: var(--desegn-accent); background: transparent; border: 0; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .queue-note { margin: 13px 0 0; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); text-align: center; }
  .queue-note strong { color: var(--desegn-accent); }
  .review-clear { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 470px; margin-top: 18px; padding: 35px; background: var(--sui-bg); border-radius: 23px; box-shadow: var(--sui-shadow-raised); text-align: center; }
  .clear-orbit { position: relative; display: grid; width: 88px; height: 88px; margin-bottom: 20px; color: var(--desegn-mint); background: var(--sui-bg); border-radius: 50%; box-shadow: var(--sui-shadow-inset); place-items: center; }
  .clear-orbit svg { width: 45px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
  .clear-orbit i { position: absolute; inset: -8px; border: 2px dashed color-mix(in srgb, var(--desegn-accent) 34%, transparent); border-radius: 50%; animation: orbit 14s linear infinite; }
  .review-clear h3 { margin: 7px 0 0; color: var(--sui-text); font-size: calc(17px * var(--text-scale)); }
  .review-clear p { margin: 7px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); }
  .review-clear button { height: 39px; margin-top: 19px; padding: 0 14px; color: #fff; background: var(--desegn-accent); border: 0; border-radius: 11px; box-shadow: 0 7px 16px color-mix(in srgb, var(--desegn-accent) 27%, transparent); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 740; }

  .companion-room { display: grid; grid-template-columns: minmax(330px, .9fr) minmax(440px, 1.1fr); gap: 18px; }
  .companion-stage { display: grid; min-height: 610px; background: var(--sui-bg); border-radius: 25px; box-shadow: var(--sui-shadow-raised-lg); place-items: center; }
  .companion-controls { min-width: 0; padding: 25px; background: var(--sui-bg); border-radius: 25px; box-shadow: var(--sui-shadow-raised); }
  .rename-pet { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; margin-top: 22px; }
  .rename-pet label { display: grid; gap: 7px; }
  .rename-pet label span, .palette-picker legend { color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .rename-pet input { box-sizing: border-box; width: 100%; height: 42px; padding: 0 13px; color: var(--sui-text); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); outline: 0; }
  .rename-pet button { height: 42px; padding: 0 14px; color: var(--desegn-accent); background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 740; }
  .palette-picker { margin: 18px 0 0; padding: 0; border: 0; }
  .palette-picker > div { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 8px; }
  .palette-picker button { display: flex; align-items: center; justify-content: center; gap: 7px; height: 38px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 690; }
  .palette-picker button.active { color: var(--desegn-accent); box-shadow: var(--sui-shadow-inset-sm); }
  .palette-picker i { width: 13px; height: 13px; background: #6d69d9; border: 3px solid #b9b4f2; border-radius: 50%; }
  .palette-picker i[data-palette='mint'] { background: #48a990; border-color: #b3e4d6; }
  .palette-picker i[data-palette='sunset'] { background: #e27b82; border-color: #f4c2aa; }
  .palette-picker i[data-palette='night'] { background: #48516f; border-color: #8792bc; }
  .equipped-panel { margin-top: 18px; padding: 15px; background: var(--sui-bg); border-radius: 17px; box-shadow: var(--sui-shadow-inset-sm); }
  .equipped-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .equipped-panel h3 { margin: 3px 0 0; color: var(--sui-text); font-size: calc(10px * var(--text-scale)); }
  .equipped-panel header button { color: var(--desegn-accent); background: transparent; border: 0; cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .artifact-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
  .artifact-slots > button { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 8px; min-height: 58px; padding: 8px; color: var(--sui-text-muted); text-align: left; background: var(--sui-bg); border: 0; border-radius: 12px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; }
  .artifact-slots > button > b { display: grid; width: 34px; height: 34px; color: var(--desegn-accent); background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); place-items: center; }
  .artifact-slots > button.filled > b { color: #fff; background: radial-gradient(circle at 30% 25%, white, var(--artifact) 34%, color-mix(in srgb, var(--artifact) 70%, #25294c)); }
  .artifact-slots span { display: grid; min-width: 0; }
  .artifact-slots strong, .artifact-slots small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .artifact-slots strong { color: var(--sui-text); font-size: calc(7px * var(--text-scale)); }
  .artifact-slots small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(5.5px * var(--text-scale)); }
  .companion-needs { display: grid; gap: 10px; margin-top: 18px; }
  .companion-needs article { display: grid; grid-template-columns: minmax(150px, .7fr) minmax(120px, 1fr) 38px; align-items: center; gap: 10px; }
  .companion-needs article > span { display: grid; }
  .companion-needs strong { color: var(--sui-text); font-size: calc(7px * var(--text-scale)); }
  .companion-needs small { color: var(--sui-text-light); font-size: calc(5.5px * var(--text-scale)); }
  .companion-needs article > i { height: 8px; overflow: hidden; background: var(--sui-bg); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .companion-needs article > i b { display: block; height: 100%; background: linear-gradient(90deg, var(--desegn-accent), var(--desegn-mint)); border-radius: inherit; transition: width 400ms ease; }
  .companion-needs em { color: var(--desegn-accent); font-size: calc(7px * var(--text-scale)); font-style: normal; font-weight: 730; text-align: right; }

  .next-artifact { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 17px; max-width: 720px; margin-top: 18px; padding: 17px; background: var(--sui-bg); border-radius: 18px; box-shadow: var(--sui-shadow-raised); }
  .locked-gem { display: grid; width: 69px; height: 69px; color: var(--sui-text-light); background: var(--sui-bg); border-radius: 22px; box-shadow: var(--sui-shadow-inset); font-size: 24px; place-items: center; }
  .next-artifact h3 { margin: 4px 0 0; color: var(--sui-text); }
  .next-artifact p { margin: 4px 0 0; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); }
  .next-artifact div > i { display: block; height: 7px; margin-top: 10px; overflow: hidden; background: var(--sui-bg); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .next-artifact div > i b { display: block; height: 100%; background: linear-gradient(90deg, var(--desegn-accent), var(--desegn-mint)); border-radius: inherit; }
  .next-artifact div > small { display: block; margin-top: 5px; color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); }
  .artifact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 18px; }
  .artifact-grid article { position: relative; display: flex; min-height: 290px; padding: 19px; overflow: hidden; flex-direction: column; background: var(--sui-bg); border-radius: 19px; box-shadow: var(--sui-shadow-raised); transition: transform 170ms ease, box-shadow 170ms ease; }
  .artifact-grid article:hover { transform: translateY(-2px); }
  .artifact-grid article.equipped { box-shadow: var(--sui-shadow-inset-sm), 0 0 0 2px color-mix(in srgb, var(--desegn-accent) 32%, transparent); }
  .artifact-grid article.locked { background: color-mix(in srgb, var(--sui-bg-dark) 20%, var(--sui-bg)); }
  .artifact-gem { display: grid; width: 58px; height: 58px; color: #fff; background: radial-gradient(circle at 32% 25%, white, var(--artifact) 34%, color-mix(in srgb, var(--artifact) 65%, #282b52)); border: 5px solid color-mix(in srgb, var(--artifact) 20%, var(--sui-bg)); border-radius: 20px; box-shadow: 0 8px 18px color-mix(in srgb, var(--artifact) 28%, transparent); font-size: 21px; place-items: center; }
  .locked .artifact-gem { color: var(--sui-text-light); background: var(--sui-bg); box-shadow: var(--sui-shadow-inset); filter: grayscale(1); }
  .rarity { position: absolute; top: 20px; right: 19px; color: var(--desegn-accent); font-size: calc(6px * var(--text-scale)); font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .artifact-grid h3 { margin: 14px 0 0; color: var(--sui-text); font-size: calc(12px * var(--text-scale)); }
  .artifact-grid > article > p { min-height: 40px; margin: 6px 0 0; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); line-height: 1.45; }
  .artifact-drill { margin-top: 12px; padding: 11px; background: var(--sui-bg); border-radius: 12px; box-shadow: var(--sui-shadow-inset-sm); }
  .artifact-drill span, .artifact-drill strong { display: block; }
  .artifact-drill span { color: var(--desegn-mint); font-size: calc(5.5px * var(--text-scale)); font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
  .artifact-drill strong { margin-top: 4px; color: var(--sui-text-muted); font-size: calc(6.5px * var(--text-scale)); line-height: 1.4; }
  .artifact-grid article > button { height: 37px; margin-top: auto; color: var(--desegn-accent); background: var(--sui-bg); border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 750; }
  .artifact-grid article.equipped > button { color: #cf6677; }
  .artifact-progress { position: relative; height: 24px; margin-top: auto; padding-top: 7px; font-style: normal; }
  .artifact-progress::before { position: absolute; top: 9px; right: 0; left: 0; height: 7px; background: var(--sui-bg); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); content: ''; }
  .artifact-progress b { position: absolute; z-index: 1; top: 9px; left: 0; height: 7px; background: var(--desegn-accent); border-radius: 999px; }
  .artifact-progress small { position: absolute; right: 0; bottom: -3px; color: var(--sui-text-light); font-size: calc(5.5px * var(--text-scale)); }

  .insight-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 18px; }
  .insight-metrics article { position: relative; padding: 16px 18px; overflow: hidden; background: var(--sui-bg); border-radius: 16px; box-shadow: var(--sui-shadow-raised-sm); }
  .insight-metrics article::after { position: absolute; right: -23px; bottom: -33px; width: 80px; height: 80px; background: color-mix(in srgb, var(--desegn-accent) 8%, transparent); border-radius: 50%; content: ''; }
  .insight-metrics span, .insight-metrics small { color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); }
  .insight-metrics strong { display: block; margin: 3px 0; color: var(--sui-text); font-size: calc(20px * var(--text-scale)); }
  .insights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  .insights-grid > article { min-height: 250px; padding: 20px; background: var(--sui-bg); border-radius: 20px; box-shadow: var(--sui-shadow-raised); }
  .insights-grid h3 { margin: 5px 0 0; color: var(--sui-text); font-size: calc(13px * var(--text-scale)); }
  .insights-grid > article > p { margin: 10px 0 0; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); line-height: 1.5; }
  .activity-map { display: grid; grid-template-columns: repeat(14, 1fr); gap: 7px; margin-top: 23px; }
  .activity-map i { aspect-ratio: 1; background: var(--sui-bg); border-radius: 5px; box-shadow: var(--sui-shadow-inset-sm); }
  .activity-map i.active { background: color-mix(in srgb, var(--desegn-mint) 52%, var(--sui-bg)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--desegn-mint) 20%, transparent); }
  .activity-map i.strong { background: var(--desegn-mint); box-shadow: 0 3px 8px color-mix(in srgb, var(--desegn-mint) 28%, transparent); }
  .focus-card > div { display: grid; gap: 9px; margin-top: 17px; }
  .focus-card > div > span { display: grid; grid-template-columns: 91px minmax(70px, 1fr) 22px; align-items: center; gap: 8px; }
  .focus-card b { overflow: hidden; color: var(--sui-text-muted); font-size: calc(6.5px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .focus-card i { height: 7px; overflow: hidden; background: var(--sui-bg); border-radius: 999px; box-shadow: var(--sui-shadow-inset-sm); }
  .focus-card em { display: block; height: 100%; background: linear-gradient(90deg, var(--desegn-accent), var(--desegn-mint)); border-radius: inherit; }
  .focus-card small { color: var(--sui-text-light); font-size: calc(6px * var(--text-scale)); text-align: right; }
  .flaw-card ol { display: grid; gap: 8px; margin: 15px 0 0; padding: 0; list-style: none; }
  .flaw-card li { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px 10px; background: var(--sui-bg); border-radius: 11px; box-shadow: var(--sui-shadow-inset-sm); }
  .flaw-card li > b { color: #d36978; font-size: calc(6px * var(--text-scale)); }
  .flaw-card li span { display: grid; min-width: 0; }
  .flaw-card li strong { overflow: hidden; color: var(--sui-text); font-size: calc(7px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; }
  .flaw-card li small { margin-top: 2px; color: var(--sui-text-light); font-size: calc(5.5px * var(--text-scale)); }
  .flaw-card > button { height: 36px; margin-top: 16px; padding: 0 12px; color: var(--desegn-accent); background: var(--sui-bg); border: 0; border-radius: 10px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(7px * var(--text-scale)); font-weight: 720; }
  .comparison-card > div { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin-top: 16px; }
  .comparison-card > div > button { position: relative; height: 145px; padding: 0; overflow: hidden; background: var(--sui-bg-dark); border: 0; border-radius: 13px; box-shadow: var(--sui-shadow-inset-sm); cursor: zoom-in; }
  .comparison-card button > span { position: absolute; right: 7px; bottom: 7px; left: 7px; padding: 6px; overflow: hidden; color: #fff; background: rgb(33 38 55 / 69%); border-radius: 7px; font-size: calc(5.5px * var(--text-scale)); text-overflow: ellipsis; white-space: nowrap; backdrop-filter: blur(6px); }
  .comparison-card > div > i { color: var(--desegn-accent); font-size: 20px; font-style: normal; }

  .studio-loading { display: flex; align-items: center; flex-direction: column; justify-content: center; min-height: 560px; color: var(--sui-text-muted); text-align: center; }
  .studio-loading > span { position: relative; display: grid; width: 80px; height: 80px; margin-bottom: 18px; color: #fff; background: var(--sui-bg); border-radius: 24px; box-shadow: var(--sui-shadow-raised); place-items: center; }
  .studio-loading i { position: absolute; inset: -7px; border: 2px solid transparent; border-top-color: var(--desegn-accent); border-right-color: var(--desegn-mint); border-radius: 27px; animation: orbit 1.1s linear infinite; }
  .studio-loading b { display: grid; width: 47px; height: 47px; background: linear-gradient(145deg, var(--desegn-accent), var(--desegn-mint)); border-radius: 15px; font-size: 24px; place-items: center; }
  .studio-loading > strong { color: var(--sui-text); font-size: calc(11px * var(--text-scale)); }
  .studio-loading p { margin: 5px 0 0; font-size: calc(7px * var(--text-scale)); }
  .drop-curtain { position: fixed; z-index: 300; display: grid; inset: 0; color: #fff; background: rgb(54 53 113 / 69%); backdrop-filter: blur(13px); place-content: center; justify-items: center; pointer-events: none; }
  .drop-curtain > span { display: grid; width: 105px; height: 105px; margin-bottom: 19px; background: rgb(255 255 255 / 13%); border: 2px dashed rgb(255 255 255 / 75%); border-radius: 31px; place-items: center; animation: drop-pulse 1.5s ease-in-out infinite; }
  .drop-curtain svg { width: 52px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
  .drop-curtain strong { font-size: calc(17px * var(--text-scale)); }
  .drop-curtain small { margin-top: 6px; color: rgb(255 255 255 / 75%); font-size: calc(8px * var(--text-scale)); }

  .delete-backdrop { position: fixed; z-index: 260; display: grid; inset: 0; padding: 24px; background: rgb(39 46 66 / 52%); backdrop-filter: blur(9px); place-items: center; }
  .delete-dialog { width: min(430px, 100%); padding: 28px; color: var(--sui-text); background: var(--sui-bg); border-radius: 22px; box-shadow: 18px 18px 42px rgb(35 44 62 / 34%); text-align: center; }
  .delete-dialog > span { display: grid; width: 56px; height: 56px; margin: 0 auto 14px; color: #d56677; background: var(--sui-bg); border-radius: 17px; box-shadow: var(--sui-shadow-inset); place-items: center; }
  .delete-backdrop svg { width: 29px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.5; }
  .delete-backdrop h2 { margin: 0; color: var(--sui-text); font-size: calc(16px * var(--text-scale)); }
  .delete-backdrop p { margin: 9px 0 0; color: var(--sui-text-muted); font-size: calc(8px * var(--text-scale)); line-height: 1.5; }
  .delete-dialog > div { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 21px; }
  .delete-backdrop button { height: 40px; color: var(--sui-text-muted); background: var(--sui-bg); border: 0; border-radius: 11px; box-shadow: var(--sui-shadow-raised-sm); cursor: pointer; font-size: calc(8px * var(--text-scale)); font-weight: 740; }
  .delete-backdrop button.danger { color: #fff; background: #d56677; }
  .studio-toast { position: fixed; z-index: 340; right: 25px; bottom: 25px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 11px; max-width: min(410px, calc(100vw - 50px)); min-width: 300px; padding: 12px 13px; color: var(--sui-text); background: color-mix(in srgb, var(--sui-bg) 91%, transparent); border-radius: 16px; box-shadow: 12px 15px 34px rgb(35 44 62 / 28%), inset 1px 1px 0 rgb(255 255 255 / 20%); backdrop-filter: blur(14px); animation: toast-in 240ms cubic-bezier(.2, .8, .2, 1); }
  .toast-check, .toast-gem { display: grid; width: 37px; height: 37px; color: #fff; background: var(--desegn-mint); border-radius: 12px; box-shadow: 0 6px 13px color-mix(in srgb, var(--desegn-mint) 25%, transparent); place-items: center; }
  .toast-gem { background: radial-gradient(circle at 32% 25%, white, var(--artifact) 34%, color-mix(in srgb, var(--artifact) 68%, #2b2e54)); border-radius: 50%; }
  .studio-toast p { display: grid; gap: 2px; min-width: 0; margin: 0; }
  .studio-toast strong { color: var(--sui-text); font-size: calc(8px * var(--text-scale)); }
  .studio-toast small { overflow: hidden; color: var(--sui-text-muted); font-size: calc(7px * var(--text-scale)); text-overflow: ellipsis; }
  .studio-toast > button { color: var(--sui-text-light); background: transparent; border: 0; cursor: pointer; font-size: 18px; }

  @keyframes orbit { to { transform: rotate(360deg); } }
  @keyframes drop-pulse { 50% { transform: translateY(-5px) scale(1.025); } }
  @keyframes toast-in { from { opacity: 0; transform: translateY(12px) scale(.98); } }

  @media (max-width: 1180px) {
    .studio-header { grid-template-columns: minmax(0, 1fr) auto auto; }
    .header-pulse { display: none; }
    .gallery-intro { grid-template-columns: 1fr; }
    .weekly-card { min-height: 125px; }
    .companion-room { grid-template-columns: minmax(300px, .75fr) minmax(400px, 1.25fr); }
    .artifact-slots { grid-template-columns: 1fr; }
    .companion-stage { min-height: 530px; }
  }

  @media (max-width: 900px) {
    .desegn-shell { padding-inline: 12px; }
    .studio-identity p { display: none; }
    .studio-rooms { grid-template-columns: repeat(5, auto); overflow-x: auto; }
    .studio-rooms > button { min-width: 128px; }
    .review-stage, .companion-room { grid-template-columns: 1fr; }
    .review-image { min-height: 390px; }
    .companion-stage { min-height: 440px; }
    .insight-metrics { grid-template-columns: 1fr 1fr; }
    .insights-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 650px) {
    .studio-header { grid-template-columns: minmax(0, 1fr) auto; }
    .paste-button { display: none; }
    .studio-mark { width: 44px; height: 44px; }
    .studio-identity h1 { font-size: calc(15px * var(--text-scale)); }
    .gallery-tools { grid-template-columns: 1fr; }
    .gallery-count { display: none; }
    .drawing-grid { grid-template-columns: 1fr; }
    .drawing-image { height: 260px; }
    .review-copy { padding: 22px; }
    .review-actions { grid-template-columns: 1fr; }
    .palette-picker > div { grid-template-columns: 1fr 1fr; }
    .insight-metrics { grid-template-columns: 1fr 1fr; }
    .empty-gallery > div { flex-direction: column; }
  }

  @media (prefers-reduced-motion: reduce) {
    .clear-orbit i, .studio-loading i, .drop-curtain > span, .studio-toast { animation: none; }
    .drawing-card, .prompt-card button span, .companion-needs article > i b { transition: none; }
  }
</style>

<section
  class:drag-active={dragActive}
  class="desegn-shell"
  aria-labelledby="desegn-title"
  ondragenter={(event) => { if (event.dataTransfer?.types.includes('Files')) dragActive = true; }}
  ondragover={(event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragActive = true; } }}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <input bind:this={fileInput} class="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp" multiple onchange={filesChosen} />

  <header class="studio-header">
    <div class="studio-identity">
      <span class="studio-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M5 21c4-8 9-13 18-16-3 9-8 15-16 18zM11 17l-4 6M17 10l2 2"/></svg></span>
      <div><span class="eyebrow">Drawing practice</span><h1 id="desegn-title">DesegnLernado</h1><p>A quiet local studio where every saved drawing becomes a visible lesson.</p></div>
    </div>
    <div class="header-pulse" aria-label={`${stats.uploadStreak} day drawing streak`}>
      <DesegnPet pet={snapshot.pet} artifacts={equippedArtifacts} compact />
      <span><small>Studio rhythm</small><strong>{stats.uploadStreak > 0 ? `${stats.uploadStreak} day streak` : 'Make the first mark'}</strong></span>
    </div>
    <button class="paste-button" type="button" disabled={snapshot.busy !== null} onclick={readClipboard} title="Read an image from the clipboard">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5V3.5h6V5M6 5h8a2 2 0 0 1 2 2v9H4V7a2 2 0 0 1 2-2zM7 10h6M7 13h4"/></svg>
      Paste
    </button>
    <button class="upload-button" type="button" disabled={snapshot.busy !== null} onclick={chooseFiles}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 14V4m-4 4 4-4 4 4M4 13v3h12v-3"/></svg>
      {snapshot.busy?.startsWith('Preparing') ? snapshot.busy : 'Add drawing'}
    </button>
  </header>

  <nav class="studio-rooms" aria-label="DesegnLernado rooms">
    {#each rooms as room}
      <button
        class:active={activeRoom === room.id}
        type="button"
        aria-current={activeRoom === room.id ? 'page' : undefined}
        aria-label={`${room.label}: ${room.hint}`}
        onclick={() => { activeRoom = room.id; }}
      >
        <span class="room-icon" aria-hidden="true">
          {#if room.icon === 'gallery'}<svg viewBox="0 0 20 20"><path d="M3 4h14v12H3zM6 12l3-3 2.3 2.2L13 9.5 16 13M6.5 7h.01"/></svg>
          {:else if room.icon === 'review'}<svg viewBox="0 0 20 20"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v4h4M10 7v3l2 1.5"/></svg>
          {:else if room.icon === 'pet'}<svg viewBox="0 0 20 20"><path d="M6 7C5 4 6 2.5 7 2c1 1 1.5 2.3 1.5 3.5a6 6 0 0 1 3 0C12 4 12.5 3 14 2c1 1.5 1.3 3 .4 5A5 5 0 1 1 6 7zM7.7 10h.01m4.6 0h.01M8.5 12.5c1 1 2 1 3 0"/></svg>
          {:else if room.icon === 'artifact'}<svg viewBox="0 0 20 20"><path d="m10 2.5 6 4v7l-6 4-6-4v-7zM10 2.5v15M4 6.5l6 4 6-4"/></svg>
          {:else}<svg viewBox="0 0 20 20"><path d="M3 15V9M7 15V5M11 15v-3M15 15V7M2 16h16"/></svg>{/if}
        </span>
        <span><strong>{room.label}</strong><small>{room.hint}</small></span>
      </button>
    {/each}
  </nav>

  {#if snapshot.error}
    <div class="studio-error" role="alert"><span>!</span><p><strong>Local studio needs attention</strong>{snapshot.error}</p><button type="button" onclick={() => iloState.clearDesegnError()} aria-label="Dismiss error">×</button></div>
  {/if}

  <main class="studio-content">
    {#if snapshot.phase === 'loading'}
      <div class="studio-loading"><span><i></i><b>✎</b></span><strong>Opening your local studio</strong><p>Reading light gallery notes before any image is loaded…</p></div>
    {:else if activeRoom === 'gallery'}
      <section class="gallery-room" aria-labelledby="gallery-title">
        <div class="gallery-intro">
          <article class="prompt-card"><span class="eyebrow">Today’s studio spark</span><h2 id="gallery-title">{practicePrompt}</h2><p>Small studies count. Save the attempt, name what happened, and let the archive show the change.</p><button type="button" onclick={chooseFiles}>Start with a drawing <span>→</span></button></article>
          <article class="weekly-card"><span class="weekly-ring" style={`--progress:${uploadGoal * 3.6}deg`}><strong>{stats.uploadedThisWeek}</strong><small>/ 5</small></span><div><span class="eyebrow">Weekly rhythm</span><h3>{stats.uploadedThisWeek >= 5 ? 'The studio feels alive' : 'Keep the door open'}</h3><p>{stats.uploadedThisWeek >= 5 ? 'Five saved attempts make progress easier to notice.' : `${Math.max(0, 5 - stats.uploadedThisWeek)} more small ${Math.max(0, 5 - stats.uploadedThisWeek) === 1 ? 'study' : 'studies'} for a steady week.`}</p></div></article>
        </div>

        {#if snapshot.drawings.length === 0}
          <div class="empty-gallery" class:dragging={dragActive}>
            <span class="empty-paper" aria-hidden="true"><i></i><svg viewBox="0 0 60 60"><path d="M12 10h36v40H12zM20 38l9-10 7 7 5-5 7 8M22 21h.01"/></svg></span>
            <span class="eyebrow">Your first page is waiting</span><h2>Drop a drawing into the studio</h2><p>Use a file, drag and drop, or paste an image with Command/Ctrl + V. Originals never leave this device.</p>
            <div><button type="button" onclick={chooseFiles}>Choose images</button><button type="button" onclick={readClipboard}>Paste from clipboard</button></div>
          </div>
        {:else}
          <div class="gallery-tools">
            <label class="search-field"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="4.5"/><path d="m12 12 4 4"/></svg><input bind:value={search} placeholder="Search titles, notes, or shortcomings" aria-label="Search drawing gallery" />{#if search}<button type="button" onclick={() => { search = ''; }} aria-label="Clear search">×</button>{/if}</label>
            <label class="focus-field"><span>Focus</span><select bind:value={focusFilter}><option value="all">All practice</option>{#each Object.keys(stats.focusCounts) as focus}<option value={focus}>{focusLabel(focus)}</option>{/each}</select></label>
            <span class="gallery-count"><strong>{filteredDrawings.length}</strong><small>{filteredDrawings.length === 1 ? 'drawing' : 'drawings'}</small></span>
          </div>

          {#if filteredDrawings.length === 0}
            <div class="no-results"><span>⌕</span><h3>No drawings match this view</h3><p>Try a different focus or clear the search.</p><button type="button" onclick={() => { search = ''; focusFilter = 'all'; }}>Show the whole gallery</button></div>
          {:else}
            <div class="drawing-grid">
              {#each filteredDrawings.slice(0, galleryLimit) as drawing (drawing.id)}
                <article class="drawing-card">
                  <button class="drawing-image" type="button" onclick={() => openViewer(drawing)} aria-label={`Open ${drawing.title} fullscreen`}>
                    <DesegnThumbnail {drawing} state={iloState} />
                    <span class="fullscreen-hint"><svg viewBox="0 0 20 20"><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4"/></svg>{viewerLoadingId === drawing.id ? 'Opening…' : 'Open'}</span>
                  </button>
                  <div class="drawing-copy"><span class="focus-chip">{focusLabel(drawing.focus)}</span><h3>{drawing.title}</h3><p>{drawing.description || 'Add a short reflection while the drawing is still fresh.'}</p></div>
                  <footer>
                    <span><time datetime={new Date(drawing.createdAt).toISOString()}>{formatDate(drawing.createdAt)}</time>{#if drawing.shortcomings.length > 0}<small>{drawing.shortcomings.length} to revisit</small>{/if}</span>
                    {#if drawing.rating}<span class="card-rating" aria-label={`${drawing.rating} out of 5`}>{'★'.repeat(drawing.rating)}<i>{'★'.repeat(5 - drawing.rating)}</i></span>{/if}
                    <button type="button" onclick={() => { editingDrawing = drawing; }} aria-label={`Edit notes for ${drawing.title}`}><svg viewBox="0 0 20 20"><path d="m4 16 3-.7L15.5 7 13 4.5 4.7 13zM11.5 6l2.5 2.5"/></svg>Notes</button>
                  </footer>
                </article>
              {/each}
            </div>
            {#if galleryLimit < filteredDrawings.length}<button class="load-more" type="button" onclick={() => { galleryLimit += 36; }}>Reveal {Math.min(36, filteredDrawings.length - galleryLimit)} more drawings</button>{/if}
          {/if}
        {/if}
      </section>
    {:else if activeRoom === 'review'}
      <section class="review-room" aria-labelledby="review-title">
        <header class="room-heading"><div><span class="eyebrow">Spaced reflection</span><h2 id="review-title">Look back with fresher eyes</h2><p>Older work returns gently. Decide whether the weakness still matters or progress is already visible.</p></div><span class="room-counter"><strong>{stats.dueReviews}</strong><small>ready now</small></span></header>
        {#if dueDrawings[0]}
          {@const drawing = dueDrawings[0]}
          <article class="review-stage">
            <button class="review-image" type="button" onclick={() => openViewer(drawing)} aria-label={`Open ${drawing.title} fullscreen`}><DesegnThumbnail {drawing} state={iloState} eager /><span><svg viewBox="0 0 20 20"><path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4"/></svg>Inspect fullscreen</span></button>
            <div class="review-copy"><span class="focus-chip">{focusLabel(drawing.focus)}</span><h3>{drawing.title}</h3><time datetime={new Date(drawing.createdAt).toISOString()}>Made {formatDate(drawing.createdAt)}</time><p>{drawing.description || 'No reflection was saved yet. Look for one decision you would make differently now.'}</p>
              <section><span class="eyebrow">Things you wanted to revisit</span>{#if drawing.shortcomings.length > 0}<ul>{#each drawing.shortcomings as point}<li><i></i>{point}</li>{/each}</ul>{:else}<p class="quiet-note">No shortcomings were recorded. Add one after this review if it would help the next study.</p>{/if}</section>
              <div class="review-actions"><button type="button" disabled={snapshot.busy !== null} onclick={() => review(drawing, 'keep-working')}><svg viewBox="0 0 20 20"><path d="M5 4v5h5M5.5 8.5A6 6 0 1 1 6 14"/></svg><span><strong>Keep working</strong><small>Bring it back sooner</small></span></button><button class="positive" type="button" disabled={snapshot.busy !== null} onclick={() => review(drawing, 'progress-visible')}><svg viewBox="0 0 20 20"><path d="m4 10 4 4 8-8"/></svg><span><strong>Progress visible</strong><small>Return to it later</small></span></button></div>
              <button class="edit-from-review" type="button" onclick={() => { editingDrawing = drawing; }}>Update reflection and shortcomings</button>
            </div>
          </article>
          {#if dueDrawings.length > 1}<p class="queue-note"><strong>{dueDrawings.length - 1}</strong> more {dueDrawings.length - 1 === 1 ? 'drawing waits' : 'drawings wait'} behind this one.</p>{/if}
        {:else}
          <div class="review-clear"><span class="clear-orbit"><svg viewBox="0 0 40 40"><path d="M12 20l6 6 11-13"/></svg><i></i></span><span class="eyebrow">Fresh eyes protected</span><h3>Nothing needs another look yet</h3><p>{snapshot.drawings.length === 0 ? 'Add your first drawing and the review trail will begin automatically.' : `Your next drawing returns ${formatRelative(Math.min(...snapshot.drawings.map((drawing) => drawing.nextReviewAt)))}.`}</p><button type="button" onclick={() => { activeRoom = 'gallery'; }}>{snapshot.drawings.length === 0 ? 'Add a drawing' : 'Return to gallery'}</button></div>
        {/if}
      </section>
    {:else if activeRoom === 'companion'}
      <section class="companion-room" aria-labelledby="companion-title">
        <div class="companion-stage"><DesegnPet pet={snapshot.pet} artifacts={equippedArtifacts} /></div>
        <div class="companion-controls">
          <header class="room-heading"><div><span class="eyebrow">Different from your language companion</span><h2 id="companion-title">A creature made of marks</h2><p>It grows brighter through saved attempts, honest notes, and revisiting old work.</p></div></header>
          <form class="rename-pet" onsubmit={savePetName}><label><span>Companion name</span><input maxlength="24" bind:value={petName} /></label><button type="submit" disabled={snapshot.busy !== null || petName.trim() === snapshot.pet.name}>Rename</button></form>
          <fieldset class="palette-picker"><legend>Ink palette</legend><div>{#each ['ink', 'mint', 'sunset', 'night'] as palette}<button class:active={snapshot.pet.palette === palette} type="button" onclick={() => choosePalette(palette as DesegnPetPalette)}><i data-palette={palette}></i>{focusLabel(palette)}</button>{/each}</div></fieldset>
          <section class="equipped-panel"><header><div><span class="eyebrow">Orbiting tools</span><h3>Equipped artifacts</h3></div><button type="button" onclick={() => { activeRoom = 'artifacts'; }}>Open vault →</button></header><div class="artifact-slots">{#each [0, 1, 2] as slot}{@const artifact = desegnArtifact(snapshot.pet.equippedArtifactIds[slot])}<button class:filled={Boolean(artifact)} type="button" onclick={() => { if (artifact) void iloState.equipDesegnArtifact(null, slot); else activeRoom = 'artifacts'; }}>{#if artifact}<b style={`--artifact:${artifact.accent}`}>{artifact.glyph}</b><span><strong>{artifact.name}</strong><small>Click to unequip</small></span>{:else}<b>+</b><span><strong>Empty orbit</strong><small>Equip a practice drill</small></span>{/if}</button>{/each}</div></section>
          <div class="companion-needs"><article><span><strong>Studio appetite</strong><small>Save five studies each week</small></span><i><b style={`width:${uploadGoal}%`}></b></i><em>{uploadGoal}%</em></article><article><span><strong>Reflection glow</strong><small>Add useful notes to your work</small></span><i><b style={`width:${reflectionGoal}%`}></b></i><em>{reflectionGoal}%</em></article><article><span><strong>Memory ink</strong><small>Revisit twenty drawings</small></span><i><b style={`width:${reviewGoal}%`}></b></i><em>{reviewGoal}%</em></article></div>
        </div>
      </section>
    {:else if activeRoom === 'artifacts'}
      <section class="artifacts-room" aria-labelledby="artifacts-title">
        <header class="room-heading"><div><span class="eyebrow">Practice vault</span><h2 id="artifacts-title">Every artifact changes what you draw next</h2><p>Nothing is decorative-only: equip up to three artifacts and their drills enter your daily prompt pool.</p></div><span class="room-counter"><strong>{unlockedArtifacts.length}</strong><small>of {DESEGN_ARTIFACTS.length} awake</small></span></header>
        {#if nextArtifact}<article class="next-artifact"><span class="locked-gem">?</span><div><span class="eyebrow">Closest discovery</span><h3>{nextArtifact.name}</h3><p>{nextArtifact.description}</p><i><b style={`width:${Math.min(100, artifactProgress(nextArtifact, stats) / nextArtifact.threshold * 100)}%`}></b></i><small>{artifactProgress(nextArtifact, stats)} / {nextArtifact.threshold} · {metricLabel(nextArtifact.metric)}</small></div></article>{/if}
        <div class="artifact-grid">{#each DESEGN_ARTIFACTS as artifact (artifact.id)}{@const unlocked = unlockedIds.has(artifact.id)}{@const equipped = snapshot.pet.equippedArtifactIds.includes(artifact.id)}<article class:locked={!unlocked} class:equipped><span class="artifact-gem" style={`--artifact:${artifact.accent}`}>{unlocked ? artifact.glyph : '?'}</span><span class="rarity">{artifact.rarity}</span><h3>{unlocked ? artifact.name : 'Unknown artifact'}</h3><p>{unlocked ? artifact.description : `${metricLabel(artifact.metric)} reveals this silhouette.`}</p><div class="artifact-drill"><span>Practice effect</span><strong>{unlocked ? artifact.drill : 'Locked until the studio is ready.'}</strong></div>{#if unlocked}<button type="button" disabled={snapshot.busy !== null} onclick={() => toggleArtifact(artifact.id)}>{equipped ? 'Unequip' : 'Equip artifact'}</button>{:else}<i class="artifact-progress"><b style={`width:${Math.min(100, artifactProgress(artifact, stats) / artifact.threshold * 100)}%`}></b><small>{artifactProgress(artifact, stats)} / {artifact.threshold}</small></i>{/if}</article>{/each}</div>
      </section>
    {:else}
      <section class="insights-room" aria-labelledby="insights-title">
        <header class="room-heading"><div><span class="eyebrow">Readable progress</span><h2 id="insights-title">Patterns hiding in your archive</h2><p>No scores from a server — only what your saved work and reflections already say.</p></div></header>
        <div class="insight-metrics"><article><span>Gallery</span><strong>{stats.totalDrawings}</strong><small>saved attempts</small></article><article><span>Reflections</span><strong>{stats.describedDrawings}</strong><small>drawings with context</small></article><article><span>Reviews</span><strong>{stats.totalReviews}</strong><small>fresh-eye checks</small></article><article><span>Self-rating</span><strong>{stats.averageRating === null ? '—' : stats.averageRating.toFixed(1)}</strong><small>out of five</small></article></div>
        <div class="insights-grid">
          <article class="activity-card"><span class="eyebrow">Last 28 days</span><h3>Studio rhythm</h3><div class="activity-map" aria-label="Drawing uploads over the last 28 days">{#each activityDays as day}<i class:active={day.count > 0} class:strong={day.count > 1} title={`${day.label}: ${day.count} drawings`}></i>{/each}</div><p>Each lit square is a day when you saved an attempt. Consistency can be tiny.</p></article>
          <article class="focus-card"><span class="eyebrow">Practice balance</span><h3>What your hand returns to</h3><div>{#each Object.entries(stats.focusCounts).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 7) as [focus, count]}<span><b>{focusLabel(focus)}</b><i><em style={`width:${count / Math.max(1, stats.totalDrawings) * 100}%`}></em></i><small>{count}</small></span>{/each}</div>{#if stats.totalDrawings === 0}<p>Add drawings with a practice focus to reveal this balance.</p>{/if}</article>
          <article class="flaw-card"><span class="eyebrow">Recurring observations</span><h3>Your living flaw bank</h3>{#if flawBank.length > 0}<ol>{#each flawBank.slice(0, 6) as flaw, index}<li><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{flaw.label}</strong><small>noticed {flaw.count} {flaw.count === 1 ? 'time' : 'times'}</small></span></li>{/each}</ol>{:else}<p>Shortcomings become useful here when you write them in specific, repeatable language.</p><button type="button" onclick={() => { activeRoom = 'gallery'; }}>Open gallery notes</button>{/if}</article>
          <article class="comparison-card"><span class="eyebrow">Then and now</span><h3>A visible comparison</h3>{#if comparison}<div><button type="button" onclick={() => openViewer(comparison.oldest)}><DesegnThumbnail drawing={comparison.oldest} state={iloState} /><span>Earlier · {formatDate(comparison.oldest.createdAt)}</span></button><i>→</i><button type="button" onclick={() => openViewer(comparison.latest)}><DesegnThumbnail drawing={comparison.latest} state={iloState} /><span>Latest · {formatDate(comparison.latest.createdAt)}</span></button></div><p>Two {focusLabel(comparison.latest.focus).toLocaleLowerCase()} studies, kept far enough apart to make change easier to see.</p>{:else}<p>Save two drawings with the same practice focus to unlock a meaningful side-by-side comparison.</p>{/if}</article>
        </div>
      </section>
    {/if}
  </main>

  {#if dragActive}<div class="drop-curtain" aria-hidden="true"><span><svg viewBox="0 0 40 40"><path d="M20 27V8m-7 7 7-7 7 7M8 25v7h24v-7"/></svg></span><strong>Release to keep this drawing</strong><small>It stays inside your local studio</small></div>{/if}

  {#if editingDrawing}
    <DesegnDrawingEditor
      busy={snapshot.busy !== null}
      drawing={editingDrawing}
      onClose={() => { editingDrawing = null; }}
      onDelete={() => { pendingDelete = editingDrawing; editingDrawing = null; }}
      onSave={(patch) => iloState.updateDesegnDrawing(editingDrawing!.id, patch)}
    />
  {/if}

  {#if pendingDelete}
    <div class="delete-backdrop" role="presentation" onclick={(event) => { if (event.currentTarget === event.target && !snapshot.busy) pendingDelete = null; }}><div class="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="desegn-delete-title"><span><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4.5h6V7M8 10l.7 9h6.6l.7-9"/></svg></span><h2 id="desegn-delete-title">Remove “{pendingDelete.title}”?</h2><p>The original image, preview, reflection, and review history will be permanently deleted from this device.</p><div><button type="button" disabled={snapshot.busy !== null} onclick={() => { pendingDelete = null; }}>Keep drawing</button><button class="danger" type="button" disabled={snapshot.busy !== null} onclick={confirmDelete}>{snapshot.busy ? 'Removing…' : 'Delete locally'}</button></div></div></div>
  {/if}

  {#if viewer}
    <PhotoViewer alt={viewer.drawing.description || viewer.drawing.title} height={viewer.drawing.height} name={viewer.drawing.fileName} onClose={closeViewer} url={viewer.url} width={viewer.drawing.width} />
  {/if}

  {#if toast}
    {@const currentToast = toast}
    {@const reward = desegnArtifact(currentToast.artifactId)}
    <div class:reward={Boolean(reward)} class="studio-toast" role="status">{#if reward}<span class="toast-gem" style={`--artifact:${reward.accent}`}>{reward.glyph}</span>{:else}<span class="toast-check">✓</span>{/if}<p><strong>{currentToast.title}</strong><small>{currentToast.message}</small></p><button type="button" onclick={() => { toast = null; }} aria-label="Dismiss notification">×</button></div>
  {/if}
</section>

<script lang="ts" module>
  import type { DesegnDrawing as Drawing } from '../../lib/domain/desegnLernado';

  function isTextInput(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function extensionFor(mimeType: string): string {
    const subtype = mimeType.split('/')[1]?.split('+')[0]?.toLowerCase();
    return subtype === 'jpeg' ? 'jpg' : subtype || 'png';
  }

  function readableError(error: unknown): string {
    if (typeof error === 'string' && error.trim()) return error;
    if (error instanceof Error && error.message.trim()) return error.message;
    return 'The clipboard image could not be read.';
  }

  function metricLabel(metric: string): string {
    if (metric.startsWith('focus:')) return `${metric.slice(6)} studies`;
    const labels: Record<string, string> = {
      describedDrawings: 'written reflections',
      rated: 'rated drawings',
      totalDrawings: 'saved drawings',
      totalReviews: 'fresh-eye reviews',
      totalShortcomings: 'specific shortcomings',
      uploadStreak: 'consecutive drawing days',
      uploadedThisWeek: 'drawings this week',
      dueReviews: 'ready reviews',
    };
    return labels[metric] ?? metric;
  }

  function commonShortcomings(drawings: readonly Drawing[]): Array<{ count: number; label: string }> {
    const groups = new Map<string, { count: number; label: string }>();
    for (const drawing of drawings) {
      for (const point of drawing.shortcomings) {
        const key = point.trim().toLocaleLowerCase();
        if (!key) continue;
        const existing = groups.get(key);
        groups.set(key, { count: (existing?.count ?? 0) + 1, label: existing?.label ?? point.trim() });
      }
    }
    return [...groups.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }

  function recentActivity(drawings: readonly Drawing[], now = Date.now()): Array<{ count: number; label: string }> {
    const formatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
    const counts = new Map<string, number>();
    for (const drawing of drawings) {
      const key = localDay(drawing.createdAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 28 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() - (27 - index));
      return { count: counts.get(localDay(date.getTime())) ?? 0, label: formatter.format(date) };
    });
  }

  function localDay(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function comparisonPair(drawings: readonly Drawing[]): { latest: Drawing; oldest: Drawing } | null {
    const groups = new Map<string, Drawing[]>();
    for (const drawing of drawings) groups.set(drawing.focus, [...(groups.get(drawing.focus) ?? []), drawing]);
    const candidate = [...groups.values()]
      .filter((items) => items.length >= 2)
      .sort((left, right) => {
        const leftSpan = Math.max(...left.map((item) => item.createdAt)) - Math.min(...left.map((item) => item.createdAt));
        const rightSpan = Math.max(...right.map((item) => item.createdAt)) - Math.min(...right.map((item) => item.createdAt));
        return rightSpan - leftSpan || right.length - left.length;
      })[0];
    if (!candidate) return null;
    const sorted = [...candidate].sort((left, right) => left.createdAt - right.createdAt);
    return { latest: sorted.at(-1)!, oldest: sorted[0]! };
  }
</script>
