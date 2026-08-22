import { Icon } from '../../components/Icon';
import { SoftEmpty } from '../../components/EmptyState';
import './review.css';

export function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="soft-empty"><Icon name="check" /><p>No diff to review.</p></div>;
  return <pre className="diff-view">{diff.split('\n').map((line, index) => (
    <div key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : line.startsWith('diff --git') ? 'diff-file' : ''}>
      <span className="line-number">{index + 1}</span>{line || ' '}
    </div>
  ))}</pre>;
}
