// What the ask bar's box says in each place (AskBar's placeholders)
export function askPlaceholders({ drafting, tab }) {
  if (drafting) return { ai: 'Ask, or say what to write...' };
  return tab === 'notes' ? { search: 'Search notes' } : {};
}
