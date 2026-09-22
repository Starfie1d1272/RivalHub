export type ListQueryValue = string | number | boolean | null | undefined;
export type ListQueryUpdates = Record<string, ListQueryValue>;
export type ListQueryDefaults = Readonly<Record<string, ListQueryValue>>;

export interface ListQuerySearchParams {
  get(key: string): string | null;
}

export interface ListQueryUpdateOptions {
  defaults?: ListQueryDefaults;
  history?: "replace" | "push";
}

export type ListQueryUpdate = (updates: ListQueryUpdates, options?: ListQueryUpdateOptions) => void;

export interface ListQueryParamsOptions {
  routeBase?: string;
  defaults?: ListQueryDefaults;
}

function toQueryValue(value: ListQueryValue): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

/** Apply list URL changes without knowing anything about a domain's values. */
export function applyListQueryUpdates(
  current: URLSearchParams,
  updates: ListQueryUpdates,
  options: Pick<ListQueryUpdateOptions, "defaults"> = {},
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  const defaults = options.defaults ?? {};

  for (const [key, value] of Object.entries(updates)) {
    const nextValue = toQueryValue(value);
    const defaultValue = toQueryValue(defaults[key]);
    if (nextValue === undefined || (defaultValue !== undefined && nextValue === defaultValue)) {
      next.delete(key);
    } else {
      next.set(key, nextValue);
    }
  }

  // Any change other than an explicit page update returns the list to page 1.
  if (!Object.prototype.hasOwnProperty.call(updates, "page")) next.delete("page");
  return next;
}
