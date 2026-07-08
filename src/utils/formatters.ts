const dateFormatters = new Map<Intl.DateTimeFormatOptions["dateStyle"], Intl.DateTimeFormat>();

function dateFormatter(dateStyle: Intl.DateTimeFormatOptions["dateStyle"]): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(dateStyle);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, { dateStyle });
    dateFormatters.set(dateStyle, formatter);
  }

  return formatter;
}

export function formatMediumDate(value: string): string {
  return dateFormatter("medium").format(new Date(value));
}

export function formatLongDate(value: string): string {
  return dateFormatter("long").format(new Date(value));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
