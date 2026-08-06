import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { PlayingCard } from "./PlayingCard";
import { RANKS, SUITS } from "../lib/cards";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export const CardSelector = ({ card, index, onChange, usedIds }) => {
  const [open, setOpen] = useState(false);

  const flagged = Boolean(card?.rank && card?.suit && card?.confidence && card.confidence !== "high");

  // Any manual pick confirms the card, so clear the confidence flag.
  const pick = (patch) => onChange({ ...card, ...patch, confidence: "high" });

  return (
    <div className="flex flex-col items-center gap-3" data-testid={`card-slot-${index + 1}`}>
      <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500 font-semibold">
        Card {index + 1}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            data-testid={`card-trigger-${index + 1}`}
            data-flagged={flagged ? "true" : "false"}
            className="group relative outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] rounded-xl transition-transform hover:-translate-y-1"
          >
            <PlayingCard card={card} index={index} flagged={flagged} />
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
              {flagged ? "verify" : "edit"} <ChevronDown className="w-3 h-3" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-64 bg-zinc-900 border-zinc-700 text-zinc-100 p-4"
          data-testid={`card-popover-${index + 1}`}
        >
          <div className="space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 font-semibold">
                Rank
              </p>
              <div className="grid grid-cols-7 gap-1.5">
                {RANKS.map((r) => (
                  <button
                    key={r}
                    data-testid={`rank-${index + 1}-${r}`}
                    onClick={() => pick({ rank: r })}
                    className={`h-8 rounded-md text-xs font-semibold font-head transition-colors ${
                      card.rank === r
                        ? "bg-[#d4af37] text-zinc-900"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2 font-semibold">
                Suit
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {SUITS.map((s) => {
                  const dup = usedIds.includes(`${card.rank}${s.code}`) && card.suit !== s.code;
                  return (
                    <button
                      key={s.code}
                      data-testid={`suit-${index + 1}-${s.code}`}
                      onClick={() => pick({ suit: s.code })}
                      disabled={dup}
                      className={`h-10 rounded-md text-lg font-bold transition-colors disabled:opacity-25 disabled:cursor-not-allowed ${
                        card.suit === s.code
                          ? "bg-[#d4af37] text-zinc-900"
                          : "bg-zinc-800 hover:bg-zinc-700"
                      } ${s.color === "red" && card.suit !== s.code ? "text-rose-500" : ""}`}
                    >
                      {s.symbol}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
