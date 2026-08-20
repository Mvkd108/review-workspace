/**
 * Installs a filter for Node's `node:sqlite` experimental warning.
 *
 * Depending on the built-in SQLite module is a deliberate choice recorded in
 * `context/DECISIONS.md`, so the warning tells an operator nothing they can act
 * on and appears on every single invocation, including `--help`.
 *
 * This must be imported before anything that reaches `node:sqlite`, because Node
 * emits the warning when that module is first evaluated and ES module imports
 * are evaluated in source order. Only this exact warning is dropped; every other
 * warning Node raises still reaches stderr unchanged.
 */
const emitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  const first = rest[0];
  const type = typeof first === 'string' ? first : (first as { type?: string } | undefined)?.type;
  if (type === 'ExperimentalWarning' && text.includes('SQLite')) return;
  (emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
