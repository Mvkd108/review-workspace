import type { WorkUnitView } from '@review-workspace/schema';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { relativeTime } from '../../components/RelativeTime';
import { isArchived, rowMeta } from './queueMeta';

export function QueueRow({
  view,
  selected,
  onSelect,
  onArchive,
  onUnarchive,
  bulk,
}: {
  view: WorkUnitView;
  selected: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  bulk?: { enabled: boolean; checked: boolean; onToggle: (checked: boolean) => void } | undefined;
}) {
  const meta = rowMeta(view);
  const unit = view.workUnit;
  const changed = view.change?.files.length ?? 0;
  const archived = isArchived(view);
  return (
    <div className={`queue-row ${selected ? 'selected' : ''}`}>
      {bulk?.enabled && (
        <input
          className="row-check"
          type="checkbox"
          aria-label={`Select ${unit.task}`}
          checked={bulk.checked}
          onChange={(event) => bulk.onToggle(event.target.checked)}
        />
      )}
      <button className="queue-row-main" onClick={onSelect} title={`${meta.action}. ${unit.branch}`}>
        <span className="row-head">
          <span className={`row-state row-${meta.tone}`}>{meta.state}</span>
          <span className="row-task" title={unit.task}>{unit.task}</span>
          <span className="row-time">{relativeTime(unit.updatedAt)}</span>
        </span>
        <span className="row-sub">
          <span className="row-action">{meta.action}</span>
          <span className="row-branch"><Icon name="branch" /><span>{unit.branch}</span></span>
          <span className="row-files">{changed} file{changed === 1 ? '' : 's'}</span>
        </span>
      </button>
      {archived
        ? <IconButton className="row-action-btn" onClick={onUnarchive} aria-label={`Restore ${unit.task}`} title="Restore to active"><Icon name="refresh" /></IconButton>
        : <IconButton className="row-action-btn" onClick={onArchive} aria-label={`Archive ${unit.task}`} title="Archive without touching files"><Icon name="archive" /></IconButton>}
    </div>
  );
}
