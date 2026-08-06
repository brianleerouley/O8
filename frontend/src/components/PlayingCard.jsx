import { motion } from "framer-motion";
import { SUIT_MAP } from "../lib/cards";

export const PlayingCard = ({ card, index = 0, size = "lg", selected = false, flagged = false }) => {
  const suit = SUIT_MAP[card?.suit];
  const isRed = suit?.color === "red";
  const faceUp = Boolean(card?.rank && card?.suit);
  const dims =
    size === "lg"
      ? "w-[64px] h-[92px] sm:w-[104px] sm:h-[148px] text-[13px] sm:text-[15px]"
      : "w-16 h-24 text-xs";

  const flagRing = flagged ? "ring-2 ring-amber-400 animate-pulse" : "";
  const flagBadge = flagged ? (
    <div className="absolute -top-2 -right-2 z-10 grid place-items-center w-5 h-5 rounded-full bg-amber-400 text-zinc-900 text-[11px] font-extrabold shadow">
      ?
    </div>
  ) : null;

  if (!faceUp) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 24, rotateY: -18 }}
        animate={{ opacity: 1, y: 0, rotateY: 0 }}
        transition={{ delay: index * 0.06, type: "spring", stiffness: 220, damping: 20 }}
        className={`relative ${dims} rounded-xl shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] select-none overflow-hidden ${
          selected ? "ring-2 ring-[#d4af37]" : ""
        }`}
        style={{ background: "linear-gradient(135deg,#7f1d1d,#450a0a)" }}
      >
        <div className="absolute inset-1.5 rounded-lg border border-[#d4af37]/40" />
        <div
          className="absolute inset-2.5 rounded-md opacity-70"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(212,175,55,0.35) 0 4px, transparent 4px 8px), repeating-linear-gradient(-45deg, rgba(212,175,55,0.25) 0 4px, transparent 4px 8px)",
          }}
        />
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-head text-[#d4af37] text-lg sm:text-2xl font-extrabold">O8</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, rotateY: -18 }}
      animate={{ opacity: 1, y: 0, rotateY: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 220, damping: 20 }}
      className={`relative ${dims} rounded-xl bg-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] select-none
        flex flex-col justify-between p-1.5 sm:p-2.5 ${selected ? "ring-2 ring-[#d4af37]" : ""} ${flagRing}`}
    >
      {flagBadge}
      <div className={`font-head leading-none ${isRed ? "text-rose-600" : "text-zinc-900"}`}>
        <div className="text-sm sm:text-lg font-extrabold">{card.rank}</div>
        <div className="text-xs sm:text-base -mt-0.5">{suit?.symbol}</div>
      </div>
      <div
        className={`absolute inset-0 flex items-center justify-center text-3xl sm:text-5xl ${
          isRed ? "text-rose-600" : "text-zinc-900"
        }`}
      >
        {suit?.symbol}
      </div>
      <div
        className={`self-end rotate-180 font-head leading-none ${
          isRed ? "text-rose-600" : "text-zinc-900"
        }`}
      >
        <div className="text-sm sm:text-lg font-extrabold">{card.rank}</div>
        <div className="text-xs sm:text-base -mt-0.5">{suit?.symbol}</div>
      </div>
    </motion.div>
  );
};
