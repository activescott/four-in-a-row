// Helpers for asserting on server-rendered markup without depending on the
// order of the classes in an element's class attribute.

/** The opening tag of the first element whose text starts with `text`. */
export function openTag(html: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<\\w+\\b[^>]*>(?=${escaped})`));
  if (!match) throw new Error(`no element starts with ${JSON.stringify(text)}`);
  return match[0];
}

/** The classes in an opening tag, as a set. */
export function classSet(tag: string): Set<string> {
  const value = tag.match(/\bclass="([^"]*)"/)?.[1] ?? "";
  return new Set(value.split(/\s+/).filter(Boolean));
}
