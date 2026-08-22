"use client";

interface TabsProps<T extends string> {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (key: T) => void;
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className="mb-6 flex gap-1 border-b border-umbra-border-soft">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
            active === t.key ? "text-umbra-ink" : "text-umbra-faint hover:text-umbra-muted"
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] tabular">{t.count}</span>
          )}
          {active === t.key && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-umbra-violet" />}
        </button>
      ))}
    </div>
  );
}
