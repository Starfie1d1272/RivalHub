/** Public directory URL semantics; list primitives own navigation only. */
export function parseParticipantDirectoryQuery(input: { q?: string | string[]; team?: string | string[] } = {}, teams: readonly { id: string }[] = []) {
  return {
    q: typeof input.q === "string" ? input.q.trim().slice(0, 100) : "",
    team: typeof input.team === "string" && teams.some((team) => team.id === input.team) ? input.team : "",
  };
}

export function matchesDirectorySearch(query: string, ...names: (string | null | undefined)[]) {
  return !query || names.some((name) => name?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}
