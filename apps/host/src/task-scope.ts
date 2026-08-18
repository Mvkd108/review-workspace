const STOP_WORDS = new Set(['about', 'after', 'agent', 'before', 'build', 'change', 'create', 'from', 'into', 'make', 'please', 'review', 'that', 'this', 'update', 'with']);

export function inferPathTokens(task: string): string[] {
  const explicit = task.match(/[\w@.-]+(?:[\\/][\w@.*/-]+)+|[\w-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|css|scss|sql|py|rs|go)/gi) ?? [];
  const words = task.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  return [...new Set([...explicit, ...words.filter((word) => !STOP_WORDS.has(word))])].slice(0, 20);
}
