import { COLOR_CLASSES } from "../lib/cards";

const LEVELS = { L: 4, H: 3, F: 2, R: 3 };

export const MetricCard = ({ letter, name, data, testid }) => {
  const c = COLOR_CLASSES[data.color] || COLOR_CLASSES.warn;
  const maxLevel = LEVELS[letter] || 4;
  const level = data.points !== undefined ? data.points : data.penalty;

  return (
    <div
      data-testid={testid}
      className={`rounded-xl border ${c.border} ${c.bg} p-5 flex flex-col gap-3 transition-colors`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-400 font-semibold">
          {name}
        </span>
        <span className={`font-mono text-sm font-bold ${c.text}`}>{data.code}</span>
      </div>
      <div className="flex items-end gap-1.5 h-6">
        {Array.from({ length: maxLevel }).map((_, i) => (
          <span
            key={i}
            className={`flex-1 rounded-sm transition-all ${
              i < level ? c.bar : "bg-zinc-800"
            }`}
            style={{ height: `${40 + i * 18}%` }}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">{data.label}</p>
    </div>
  );
};
