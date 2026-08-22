import type { WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Icon } from '../../components/Icon';

export function ChangesPanel({ view, onRefresh }: { view: WorkUnitView; onRefresh: () => Promise<void> }) {
  const api = useApi();
  return (
    <section className="panel changes-panel">
      <div className="panel-title"><span><Icon name="file" />Changed files</span><span className="muted-copy">{view.change?.additions ?? 0} additions · {view.change?.deletions ?? 0} deletions</span></div>
      {!view.change?.files.length
        ? <div className="soft-empty compact">No changes against the base reference.</div>
        : <div className="file-list">{view.change.files.map((file) => (
          <label className="file-row" key={file.path}>
            <input type="checkbox" checked={file.reviewed} onChange={(event) => void api.setReviewed(view.workUnit.id, [file.path], event.target.checked).then(onRefresh)} />
            <span className={`file-status status-${file.status}`}>{file.status[0]?.toUpperCase()}</span>
            <span className="file-path">{file.path}</span>
            {file.previousPath && <span className="previous-path">from {file.previousPath}</span>}
            <span className="diff-stat"><b>+{file.additions}</b><i>-{file.deletions}</i></span>
          </label>
        ))}</div>}
    </section>
  );
}
