import { access, readFile } from 'node:fs/promises';

const required = [
  'context/README.md',
  'context/LAUNCH_CONTRACT.md',
  'context/PRODUCT.md',
  'context/CURRENT.md',
  'context/DECISIONS.md',
  'context/NEXT.md',
];
const strict = process.argv.includes('--strict');
const problems = [];

for (const path of required) {
  try {
    await access(path);
    const content = await readFile(path, 'utf8');
    if (content.includes('TODO_CONTEXT')) problems.push(`${path} contains TODO_CONTEXT`);
  } catch {
    problems.push(`${path} is missing`);
  }
}

if (problems.length === 0) {
  console.log('Context handoff is present.');
} else {
  const message = `Context warning:\n- ${problems.join('\n- ')}`;
  if (strict) throw new Error(message);
  console.warn(message);
}
