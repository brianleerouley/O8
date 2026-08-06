import { motion, AnimatePresence } from "framer-motion";
import { History, Camera, Upload, Trash2, ChevronRight } from "lucide-react";
import { SUIT_MAP } from "../lib/cards";

const BAND_TEXT = {
  red: "text-rose-400 border-rose-500/40 bg-rose-500/10",
  gold: "text-[#d4af37] border-[#d4af37]/40 bg-[#d4af37]/10",
  green: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
};

const timeAgo = (iso) => {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const MiniCard = ({ card }) => {
  const suit = SUIT_MAP[card.suit];
  const red = suit?.color === "red";
  return (
    <span
      className={`inline-flex items-center rounded-md bg-white px-1.5 py-0.5 text-xs font-bold font-head ${
        red ? "text-rose-600" : "text-zinc-900"
      }`}
    >
      {card.rank}
      {suit?.symbol}
    </span>
  );
};

export const HandHistory = ({ hands, onSelect, onClear }) => {
  return (
    <section
      data-testid="hand-history"
      className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 mt-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#d4af37]" />
          <h4 className="font-head text-lg font-bold">Scanned hand history</h4>
          <span className="text-xs text-zinc-500">({hands.length})</span>
        </div>
        {hands.length > 0 && (
          <button
            data-testid="clear-history-btn"
            onClick={onClear}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear all
          </button>
        )}
      </div>

      {hands.length === 0 ? (
        <p className="text-sm text-zinc-500 py-6 text-center">
          No scanned hands yet. Scan or upload a hand and it will be logged here automatically.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto pr-1 space-y-2" data-testid="hand-history-list">
          <AnimatePresence initial={false}>
            {hands.map((h) => (
              <motion.button
                key={h.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onClick={() => onSelect(h.cards)}
                data-testid={`history-item-${h.id}`}
                className="group w-full flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-left hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
              >
                <div className="flex gap-1.5 flex-shrink-0">
                  {h.cards.map((c, i) => (
                    <MiniCard key={i} card={c} />
                  ))}
                </div>
                <span
                  className={`flex-shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${BAND_TEXT[h.band]}`}
                >
                  {h.total}/9 · {h.chip}
                </span>
                <span className="hidden sm:block text-xs text-zinc-500 truncate flex-1">{h.plan}</span>
                <span className="flex items-center gap-1 text-[10px] text-zinc-600 flex-shrink-0">
                  {h.source === "upload" ? <Upload className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                  {timeAgo(h.timestamp)}
                </span>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-[#d4af37] transition-colors flex-shrink-0" />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
};
