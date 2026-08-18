import type {
  GateDefinitionInput,
  GateRun,
  WorkUnit,
  WorkUnitRegistration,
  WorkspaceEvent,
  WorkspaceSnapshot,
} from '@review-workspace/schema';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(body.error || response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  workspace: () => request<WorkspaceSnapshot>('/workspace'),
  register: (input: WorkUnitRegistration) => request<WorkUnit>('/work-units', { method: 'POST', body: JSON.stringify(input) }),
  unregister: (id: string) => request<void>(`/work-units/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  diff: async (id: string) => {
    const response = await fetch(`/api/v1/work-units/${encodeURIComponent(id)}/diff`);
    if (!response.ok) throw new Error((await response.json() as { error: string }).error);
    return response.text();
  },
  addGate: (id: string, input: GateDefinitionInput) => request(`/work-units/${encodeURIComponent(id)}/gates`, { method: 'POST', body: JSON.stringify(input) }),
  runGate: (id: string, gateId: string) => request<GateRun>(`/work-units/${encodeURIComponent(id)}/gates/${encodeURIComponent(gateId)}/run`, { method: 'POST', body: JSON.stringify({ force: true }) }),
  removeGate: (id: string, gateId: string) => request<void>(`/work-units/${encodeURIComponent(id)}/gates/${encodeURIComponent(gateId)}`, { method: 'DELETE' }),
  setReviewed: (id: string, files: string[], reviewed: boolean) => request<WorkspaceSnapshot>(`/work-units/${encodeURIComponent(id)}/reviewed`, { method: 'POST', body: JSON.stringify({ files, reviewed }) }),
  events: (onEvent: (event: WorkspaceEvent) => void, onState: (connected: boolean) => void) => {
    const source = new EventSource('/api/v1/events');
    source.addEventListener('workspace.snapshot', (message) => onEvent(JSON.parse((message as MessageEvent<string>).data) as WorkspaceEvent));
    source.onopen = () => onState(true);
    source.onerror = () => onState(false);
    return () => source.close();
  },
};
