export interface Tab {
  id: string;
  label: string;
}

export function Tabs({ tabs, active, onChange }: { tabs: readonly Tab[]; active: string; onChange: (id: string) => void }) {
  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <button key={tab.id} className={tab.id === active ? 'active' : ''} onClick={() => onChange(tab.id)}>{tab.label}</button>
      ))}
    </nav>
  );
}
