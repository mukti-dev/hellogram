import { en } from './en.js';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en>;

/** Looks up a string by dotted key and fills `{placeholders}`. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en);
  const template = typeof value === 'string' ? value : key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
