import { useEffect, useState } from 'react';
import type { WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Icon } from '../../components/Icon';
import { DiffView } from './DiffView';
import './review.css';

/**
 * The Diff tab's default surface: one file at a time with previous/next
 * navigation across an ordered file list, loaded on demand. The full unified
 * diff stays available as an explicit secondary option.
 */
export function PerFileDiff({
  view,
  paths,
  selectedPath,
  onSelectPath,
}: {
  view: WorkUnitView;
  paths: readonly string[];
  selectedPath: string;
  onSelectPath: (filePath: string) => void;
}) {
  const api = useApi();
  const [diff, setDiff] = useState('');
  const [unified, setUnified] = useState(false);
  const [unifiedDiff, setUnifiedDiff] = useState('');

  const index = paths.indexOf(selectedPath);
  const prev = index > 0 ? paths[index - 1] : null;
  const next = index >= 0 && index < paths.length - 1 ? paths[index + 1] : null;

  useEffect(() => {
    setDiff('');
    setUnified(false);
    if (selectedPath) void api.fileDiff(view.workUnit.id, selectedPath).then(setDiff);
  }, [selectedPath, view.workUnit.id, api]);

  useEffect(() => {
    if (unified && !unifiedDiff) void api.diff(view.workUnit.id).then(setUnifiedDiff);
  }, [unified, unifiedDiff, view.workUnit.id, api]);

  const shown = unified ? unifiedDiff : diff;
  return (
    <div className="diff-tab">
      <div className="diff-toolbar">
        <div className="diff-nav">
          <button className="pager" disabled={!prev} onClick={() => prev && onSelectPath(prev)}>Previous</button>
          <select aria-label="Changed file" className="file-select" value={selectedPath} onChange={(event) => onSelectPath(event.target.value)}>
            {paths.map((filePath) => <option key={filePath} value={filePath}>{filePath}</option>)}
          </select>
          <button className="pager" disabled={!next} onClick={() => next && onSelectPath(next)}>Next</button>
        </div>
        {unified
          ? <button className="pager" onClick={() => setUnified(false)}>Per-file</button>
          : <button className="pager" onClick={() => setUnified(true)}>Unified diff</button>}
      </div>
      {!paths.length
        ? <div className="soft-empty"><Icon name="check" /><p>No diff to review.</p></div>
        : unified
          ? <DiffView diff={unifiedDiff} />
          : <DiffView diff={diff} />}
    </div>
  );
}
