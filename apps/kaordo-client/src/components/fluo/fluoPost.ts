const postTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});
const postDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

/** Formats timeline dates without allocating locale formatters per render. */
export function formatFluoPostDate(value: number, now = Date.now()): string {
  const date = new Date(value);
  const today = new Date(now);
  const sameDay = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay ? postTimeFormatter.format(date) : postDateFormatter.format(date);
}
