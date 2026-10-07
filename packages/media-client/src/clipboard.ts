// Extracts clipboard files without duplicating representations shared by files and items

export function clipboardFiles(data: Pick<DataTransfer, 'files' | 'items'> | null): File[] {
  const files = Array.from(data?.files ?? []);
  if (files.length) return files;
  return Array.from(data?.items ?? [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null);
}
