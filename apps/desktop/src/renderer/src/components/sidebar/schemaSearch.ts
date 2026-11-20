// Search names in the catalog already loaded by the user; never fetch table metadata.
export function matchesSchemaName(name: string, search: string): boolean {
  const normalizedName = name.normalize('NFKC').toLowerCase()
  const terms = search.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean)
  return terms.every((term) => normalizedName.includes(term))
}
