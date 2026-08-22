import { useMemo, useState } from 'react';
import type { ChangeFile, WorkUnitView } from '@review-workspace/schema';
import { useApi } from '../../components/ApiContext';
import { Icon } from '../../components/Icon';

const PAGE_SIZE = 100;

export type ReviewFilter = 'all' | 'unreviewed' | 'reviewed';

/** Path-like tokens named by risk reasons, so a file can be flagged by directory or by path. */
function collectRiskPaths(view: WorkUnitView): string[] {
  const paths = new Set<string>();
  for (const reason of view.risk.reasons) {
    for (const part of reason.detail.split(/[,:]/)) {
      const token = part.trim().replace(/^[.\\/]+/, '');
      if (/[\\/]/.test(token)) paths.add(token.replaceAll('\\', '/'));
    }
  }
  return [...paths];
}

function fileOnRiskSurface(filePath: string, riskPaths: readonly string[]): boolean {
  return riskPaths.some((candidate) => filePath === candidate || filePath.startsWith(`${candidate}/`));
}

const FILE_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'untracked'] as const;

export function FilesPanel({
  view,
  onRefresh,
  onOpenFile,
}: {
  view: WorkUnitView;
  onRefresh: () => Promise<void>;
  onOpenFile: (filePath: string) => void;
}) {
  const api = useApi();
  const [review, setReview] = useState<ReviewFilter>('all');
  const [status, setStatus] = useState<string>('all');
  const [area, setArea] = useState<string>('all');
  const [riskOnly, setRiskOnly] = useState(false);
  const [page, setPage] = useState(0);

  const riskPaths = useMemo(() => collectRiskPaths(view), [view]);
  const areas = useMemo(() => view.change?.topLevelAreas ?? [], [view]);
  const files = useMemo<ChangeFile[]>(() => view.change?.files ?? [], [view]);

  const filtered = useMemo(() => files.filter((file) => {
    if (review === 'unreviewed' && file.reviewed) return false;
    if (review === 'reviewed' && !file.reviewed) return false;
    if (status !== 'all' && file.status !== status) return false;
    if (area !== 'all' && file.path.split('/')[0] !== area) return false;
    if (riskOnly && !fileOnRiskSurface(file.path, riskPaths)) return false;
    return true;
  }), [files, review, status, area, riskOnly, riskPaths]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageFiles = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const filterRow = (
    <div className="files-filters">
      <select aria-label="Reviewed status" value={review} onChange={(event) => { setReview(event.target.value as ReviewFilter); setPage(0); }}>
        <option value="all">All reviews</option>
        <option value="unreviewed">Unreviewed</option>
        <option value="reviewed">Reviewed</option>
      </select>
      <select aria-label="File status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
        <option value="all">All statuses</option>
        {FILE_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <select aria-label="Directory" value={area} onChange={(event) => { setArea(event.target.value); setPage(0); }}>
        <option value="all">All directories</option>
        {areas.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <label className="risk-toggle"><input type="checkbox" checked={riskOnly} onChange={(event) => { setRiskOnly(event.target.checked); setPage(0); }} />Risk surface only</label>
      <span className="muted-copy">{filtered.length} of {files.length} files</span>
    </div>
  );

  return (
    <section className="panel files-panel">
      <div className="panel-title"><span><Icon name="file" />Changed files</span><span className="muted-copy">{view.change?.additions ?? 0} additions · {view.change?.deletions ?? 0} deletions</span></div>
      {files.length === 0
        ? <div className="soft-empty compact">No changes against the base reference.</div>
        : <>
          {filterRow}
          <div className="file-list">
            {pageFiles.map((file) => (
              <div className="file-row" key={file.path}>
                <input type="checkbox" aria-label={`Review ${file.path}`} checked={file.reviewed} onChange={(event) => void api.setReviewed(view.workUnit.id, [file.path], event.target.checked).then(onRefresh)} />
                <button className="file-open" onClick={() => onOpenFile(file.path)}>
                  <span className={`file-status status-${file.status}`}>{file.status[0]?.toUpperCase()}</span>
                  <span className="file-path">{file.path}</span>
                  {file.previousPath && <span className="previous-path">from {file.previousPath}</span>}
                  <span className="diff-stat"><b>+{file.additions}</b><i>-{file.deletions}</i></span>
                </button>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="files-pagination">
              <button className="pager" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Previous</button>
              <span>Page {safePage + 1} of {pageCount}</span>
              <button className="pager" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button>
            </div>
          )}
        </>}
    </section>
  );
}
