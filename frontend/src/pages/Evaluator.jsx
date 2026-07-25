import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import { toast } from "sonner";
import { Spade, RotateCcw, Zap, Loader2, Target, CheckCircle2, XCircle } from "lucide-react";
import { CardSelector } from "../components/CardSelector";
import { MetricCard } from "../components/MetricCard";
import { DEFAULT_HAND, cardId, validateHand } from "../lib/cards";
import { evaluateHand } from "../lib/api";

const BANNER = {
  good: { chip: "bg-[#d4af37] text-zinc-900", glow: "shadow-[0_0_60px_-12px_rgba(212,175,55,0.5)]", accent: "text-[#d4af37]" },
  warn: { chip: "bg-amber-500 text-zinc-900", glow: "shadow-[0_0_50px_-14px_rgba(245,158,11,0.5)]", accent: "text-amber-400" },
  bad: { chip: "bg-rose-600 text-white", glow: "shadow-[0_0_50px_-14px_rgba(225,29,72,0.5)]", accent: "text-rose-400" },
};

const AnimatedNumber = ({ value }) => {
  const mv = useMotionValue(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.6,
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return controls.stop;
  }, [value, mv]);
  return <span>{display}</span>;
};

const StatusPill = ({ ok, label, testid }) => (
  <div
    data-testid={testid}
    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
      ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"
    }`}
  >
    {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
    {label}
  </div>
);

export default function Evaluator() {
  const [cards, setCards] = useState(DEFAULT_HAND);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  const usedIds = cards.map(cardId);
  const validation = validateHand(cards);

  const runEvaluate = useCallback(async (hand) => {
    const v = validateHand(hand);
    if (!v.ready) {
      toast.error("Fix duplicate cards before scoring.");
      return;
    }
    setLoading(true);
    try {
      const data = await evaluateHand(hand);
      setResult(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Evaluation failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-evaluate on change (debounced) once a valid hand exists
  useEffect(() => {
    if (!validation.ready) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runEvaluate(cards), 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cards)]);

  const updateCard = (i, next) => {
    setCards((prev) => prev.map((c, idx) => (idx === i ? next : c)));
  };

  const reset = () => {
    setCards(DEFAULT_HAND);
    toast.success("Example hand restored.");
  };

  const banner = result ? BANNER[result.action.banner] : BANNER.good;

  return (
    <div className="min-h-screen relative noise-overlay">
      {/* atmospheric radial background */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(16,185,129,0.08), transparent 60%), radial-gradient(ellipse 60% 40% at 90% 10%, rgba(212,175,55,0.06), transparent 55%)",
        }}
      />
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 py-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-11 h-11 rounded-xl bg-[#d4af37] text-zinc-900">
              <Spade className="w-6 h-6" fill="currentColor" />
            </div>
            <div>
              <h1 className="font-head text-xl font-extrabold tracking-tight leading-none">
                Omaha8 <span className="text-[#d4af37]">Advisor</span>
              </h1>
              <p className="text-xs text-zinc-500 mt-1">Hi-Lo starting-hand evaluator & scoop coach</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill ok={validation.complete} label="4 cards" testid="status-complete" />
            <StatusPill ok={validation.unique} label={validation.unique ? "All unique" : "Duplicate"} testid="status-unique" />
            <StatusPill ok={validation.ready} label={validation.ready ? "Ready" : "Fix hand"} testid="status-ready" />
          </div>
        </header>

        {/* Hero: card selection */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-sm p-6 sm:p-8 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-sm">
              <span className="text-[10px] uppercase tracking-[0.3em] text-[#d4af37] font-semibold">
                Pre-flop analysis
              </span>
              <h2 className="font-head text-3xl sm:text-4xl font-extrabold tracking-tight mt-3 leading-[1.05]">
                Should you play this hand?
              </h2>
              <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
                Pick four cards. We grade the low, the high, how the cards fit, and the trap risk — then tell you whether to raise, play, or fold.
              </p>
              <div className="flex flex-wrap gap-3 mt-6">
                <button
                  data-testid="evaluate-btn"
                  onClick={() => runEvaluate(cards)}
                  disabled={loading || !validation.ready}
                  className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-6 py-3 text-sm font-bold text-zinc-900 transition-all hover:scale-105 hover:shadow-[0_0_30px_-6px_rgba(212,175,55,0.6)] disabled:opacity-40 disabled:hover:scale-100"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Evaluate hand
                </button>
                <button
                  data-testid="reset-btn"
                  onClick={reset}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end gap-3 sm:gap-4">
              {cards.map((card, i) => (
                <CardSelector key={i} card={card} index={i} onChange={(n) => updateCard(i, n)} usedIds={usedIds} />
              ))}
            </div>
          </div>
        </section>

        {/* Results */}
        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              key={result.formula}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            >
              {/* Decision summary + framework (span 2) */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                <div
                  data-testid="decision-panel"
                  className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 p-7 ${banner.glow}`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <span
                      data-testid="recommendation-chip"
                      className={`inline-flex rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest ${banner.chip}`}
                    >
                      {result.action.chip}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono">Total {result.total}/{result.max_total}</span>
                  </div>
                  <h3 className="font-head text-3xl font-extrabold tracking-tight mt-4">
                    {result.action.title}
                  </h3>
                  <p data-testid="reasoning-text" className="text-sm text-zinc-400 mt-3 leading-relaxed max-w-2xl">
                    {result.note}
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                    <ScoreBox label="Total score" testid="score-total">
                      <span className={`font-head text-3xl font-extrabold ${banner.accent}`}>
                        <AnimatedNumber value={result.total} />
                        <span className="text-zinc-600 text-lg">/{result.max_total}</span>
                      </span>
                    </ScoreBox>
                    <ScoreBox label="Action" testid="score-action">
                      <span className="font-head text-lg font-bold">{result.action.action}</span>
                    </ScoreBox>
                    <ScoreBox label="Main plan" testid="score-plan">
                      <span className="font-head text-lg font-bold">{result.plan}</span>
                    </ScoreBox>
                    <ScoreBox label="Danger" testid="score-danger">
                      <span className="font-head text-lg font-bold">{result.risk.danger}</span>
                    </ScoreBox>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
                  <div className="flex items-baseline justify-between mb-4">
                    <h4 className="font-head text-lg font-bold">Framework classes</h4>
                    <span className="text-xs text-zinc-500">Low · High · Fit · Risk</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard letter="L" name="Low" data={result.low} testid="metric-low" />
                    <MetricCard letter="H" name="High" data={result.high} testid="metric-high" />
                    <MetricCard letter="F" name="Fit" data={result.fit} testid="metric-fit" />
                    <MetricCard letter="R" name="Risk" data={result.risk} testid="metric-risk" />
                  </div>
                </div>
              </div>

              {/* Right column: scoop + teaching */}
              <div className="flex flex-col gap-6">
                <div
                  data-testid="scoop-panel"
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Target className="w-4 h-4 text-[#d4af37]" />
                    <h4 className="font-head text-lg font-bold">Scoop potential</h4>
                  </div>
                  <div className="flex items-end justify-between mb-2">
                    <span className="font-head text-2xl font-extrabold text-[#d4af37]">
                      {result.scoop.label}
                    </span>
                    <span className="font-mono text-sm text-zinc-400">{result.scoop.pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-[#d4af37]"
                      initial={{ width: 0 }}
                      animate={{ width: `${result.scoop.pct}%` }}
                      transition={{ duration: 0.7 }}
                    />
                  </div>
                  <p className="text-xs text-zinc-400 mt-4 leading-relaxed">{result.scoop.text}</p>
                </div>

                <div
                  data-testid="teaching-panel"
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 flex flex-col gap-5"
                >
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
                      Framework line
                    </p>
                    <p data-testid="formula" className="font-mono text-sm text-emerald-300 bg-zinc-950/60 rounded-lg px-3 py-2 border border-zinc-800">
                      {result.formula}
                    </p>
                  </div>
                  {result.tags.good.length > 0 && (
                    <TagGroup title="Working for you" items={result.tags.good} color="good" />
                  )}
                  {result.tags.warn.length > 0 && (
                    <TagGroup
                      title="Watch out"
                      items={result.tags.warn}
                      color={result.action.banner === "bad" ? "bad" : "warn"}
                    />
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
                      Teaching note
                    </p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{result.note}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const ScoreBox = ({ label, children, testid }) => (
  <div data-testid={testid} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3.5">
    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">{label}</p>
    {children}
  </div>
);

const TAG_COLOR = {
  good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

const TagGroup = ({ title, items, color }) => (
  <div>
    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">{title}</p>
    <div className="flex flex-wrap gap-2">
      {items.map((t, i) => (
        <span key={i} className={`rounded-full border px-2.5 py-1 text-xs ${TAG_COLOR[color]}`}>
          {t}
        </span>
      ))}
    </div>
  </div>
);
