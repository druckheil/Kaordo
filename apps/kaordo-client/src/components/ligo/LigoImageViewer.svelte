<script lang="ts">
  import type { LigoAttachment } from '../../lib/domain/ligo';
  import PhotoViewer from '../ui/PhotoViewer.svelte';

  type Props = {
    attachment: LigoAttachment;
    onClose: () => void;
    url: string;
  };

  let { attachment, onClose, url }: Props = $props();
</script>

<PhotoViewer name={attachment.name} onClose={onClose} url={url} />
