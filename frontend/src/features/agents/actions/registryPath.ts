export const SEPARATOR = '\\';

export function joinPath(parent: string, name: string): string {
  return parent ? `${parent}${SEPARATOR}${name}` : name;
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf(SEPARATOR);
  return index < 0 ? '' : path.slice(0, index);
}

export function pathSegments(path: string): { name: string; path: string }[] {
  const parts = path.split(SEPARATOR).filter(Boolean);
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join(SEPARATOR) }));
}

/** Aceita barras normais e remove separadores repetidos ou nas pontas. */
export function normalizePath(input: string): string {
  return input
    .replace(/\//g, SEPARATOR)
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean)
    .join(SEPARATOR);
}
