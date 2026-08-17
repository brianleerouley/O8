import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { CameraOff, RefreshCw, CheckCircle2, Radar, Lock, Unlock, ScanLine } from "lucide-react";
import { scanCardZones } from "../lib/api";
import { cardId, SUIT_MAP } from "../lib/cards";
import { CardSelector } from "./CardSelector";
import {
  CARD_ZONES,
  EMPTY_SCAN_SLOTS,
  forceConfirmSlot,
  scanValidation,
  stabilizeSlots,
} from "../lib/cardScan";

const SAMPLE_GAP_MS = 140;
const RESCAN_DELAY_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const blobFromCanvas = (canvas, name) =>
  new Promise((resolve) =>
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], name, { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.82
    )
  );

export const CameraCapture = ({ open, onOpenChange, onDetected }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const activeRef = useRef(false);
  const scanningRef = useRef(true);
  const slotsRef = useRef(EMPTY_SCAN_SLOTS());

  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [slots, setSlots] = useState(() => EMPTY_SCAN_SLOTS());
  const [latency, setLatency] = useState(null);
  const [scanError, setScanError] = useState(null);

  const validation = useMemo(() => scanValidation(slots), [slots]);
  const usedIds = validation.cards.filter((card) => card?.rank && card?.suit).map(cardId);
  const lockedCount = slots.filter((slot) => slot.locked).length;

  const setScanSlots = useCallback((next) => {
    slotsRef.current = typeof next === "function" ? next(slotsRef.current) : next;
    setSlots(slotsRef.current);
  }, []);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const captureZones = useCallback(async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) return [];
    return Promise.all(
      CARD_ZONES.map(async (zone, index) => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(180, Math.round(video.videoWidth * zone.width));
        canvas.height = Math.max(260, Math.round(video.videoHeight * zone.height));
        canvas
          .getContext("2d", { alpha: false })
          .drawImage(
            video,
            Math.round(video.videoWidth * zone.left),
            Math.round(video.videoHeight * zone.top),
            Math.round(video.videoWidth * zone.width),
            Math.round(video.videoHeight * zone.height),
            0,
            0,
            canvas.width,
            canvas.height
          );
        return blobFromCanvas(canvas, `slot-${index + 1}.jpg`);
      })
    );
  }, []);

  const captureBurst = useCallback(async () => {
    const first = await captureZones();
    await sleep(SAMPLE_GAP_MS);
    const second = await captureZones();
    return [...first, ...second].filter(Boolean);
  }, [captureZones]);

  const loop = useCallback(async () => {
    await sleep(450);
    while (activeRef.current) {
      if (!scanningRef.current || slotsRef.current.every((slot) => slot.locked)) {
        await sleep(RESCAN_DELAY_MS);
        continue;
      }
      try {
        const files = await captureBurst();
        if (files.length !== 8 || !activeRef.current) {
          await sleep(RESCAN_DELAY_MS);
          continue;
        }
        const started = performance.now();
        const data = await scanCardZones(files);
        if (!activeRef.current) return;
        setLatency(data.latency_ms || Math.round(performance.now() - started));
        setScanError(null);
        setScanSlots((current) => stabilizeSlots(current, data.cards || []));
      } catch (err) {
        if (!activeRef.current) return;
        setScanError(err?.response?.data?.detail || "Recognition paused. Retrying…");
      }
      await sleep(RESCAN_DELAY_MS);
    }
  }, [captureBurst, setScanSlots]);

  const start = useCallback(async () => {
    setError(null);
    setScanError(null);
    setLatency(null);
    const empty = EMPTY_SCAN_SLOTS();
    setScanSlots(empty);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        activeRef.current = true;
        scanningRef.current = true;
        setScanning(true);
        loop();
      }
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "No camera available on this device."
      );
    }
  }, [loop, setScanSlots]);

  useEffect(() => {
    if (open) start();
    return stopCamera;
  }, [open, start, stopCamera]);

  const rescan = () => {
    setScanSlots(EMPTY_SCAN_SLOTS());
    setScanError(null);
    setLatency(null);
    scanningRef.current = true;
    setScanning(true);
  };

  const unlockSlot = (index) => {
    setScanSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, locked: false, matches: 0, candidateId: null } : slot
      )
    );
    scanningRef.current = true;
    setScanning(true);
  };

  const correctSlot = (index, card) => {
    setScanSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? forceConfirmSlot(slot, card) : slot))
    );
  };

  const confirm = () => {
    if (!validation.ready) return;
    scanningRef.current = false;
    setScanning(false);
    onDetected(validation.cards.map(({ rank, suit, confidence }) => ({ rank, suit, confidence })));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-4xl" data-testid="camera-dialog">
        <DialogHeader>
          <DialogTitle className="font-head flex items-center gap-2">
            <Radar className="w-5 h-5 text-[#d4af37]" />
            V4 four-zone scanner
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Center one card in each zone. Two rapid cropped samples are compared before a card locks.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <CameraOff className="w-10 h-10 text-rose-400" />
            <p className="text-sm text-zinc-400 max-w-xs">{error}</p>
            <button onClick={start} data-testid="camera-retry-btn" className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-800">
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video ring-1 ring-zinc-700">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="pointer-events-none absolute inset-0">
                {CARD_ZONES.map((zone, index) => {
                  const slot = slots[index];
                  return (
                    <div
                      key={index}
                      data-testid={`camera-zone-${index + 1}`}
                      className={`absolute rounded-lg border-2 transition-colors ${
                        slot.locked ? "border-emerald-400 bg-emerald-400/10" : slot.card.rank ? "border-amber-300 bg-amber-300/10" : "border-dashed border-[#d4af37]/70"
                      }`}
                      style={{ left: `${zone.left * 100}%`, top: `${zone.top * 100}%`, width: `${zone.width * 100}%`, height: `${zone.height * 100}%` }}
                    >
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold">
                        {slot.locked ? <Lock className="inline w-3 h-3 mr-1 text-emerald-300" /> : index + 1}
                        {slot.card.rank ? `${slot.card.rank}${SUIT_MAP[slot.card.suit]?.symbol || ""}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
              {scanning && ready && lockedCount < 4 && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-emerald-300">
                  <ScanLine className="w-3.5 h-3.5 animate-pulse" /> Reading cropped zones
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="scan-progress">
              {slots.map((slot, index) => (
                <div key={index} className={`rounded-xl border p-3 ${
                  slot.locked ? "border-emerald-500/40 bg-emerald-500/10" : "border-zinc-700 bg-zinc-950/40"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500">Card {index + 1}</span>
                    <span className={`text-[10px] font-semibold uppercase ${
                      slot.confidence === "high" ? "text-emerald-300" : slot.confidence === "medium" ? "text-amber-300" : "text-zinc-500"
                    }`}>{slot.confidence}</span>
                  </div>
                  <CardSelector card={slot.card} index={index} onChange={(card) => correctSlot(index, card)} usedIds={usedIds} />
                  <button onClick={() => unlockSlot(index)} disabled={!slot.locked} className="mt-2 w-full inline-flex items-center justify-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-30">
                    <Unlock className="w-3 h-3" /> Unlock / rescan
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <p className="text-xs text-zinc-400" data-testid="scan-confirmed">
                <CheckCircle2 className={`inline w-4 h-4 mr-1.5 ${lockedCount === 4 ? "text-emerald-400" : "text-zinc-600"}`} />
                {lockedCount} of 4 locked
                {latency ? <span className="ml-2 text-zinc-600">· last read {latency} ms</span> : null}
              </p>
              {scanError ? <p className="text-xs text-rose-300">{scanError}</p> : null}
              {!validation.unique && validation.complete ? <p className="text-xs text-rose-300">Duplicate card detected — correct or rescan.</p> : null}
              <div className="flex gap-2 ml-auto">
                <button onClick={rescan} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold hover:bg-zinc-800">
                  <RefreshCw className="w-3.5 h-3.5" /> Rescan all
                </button>
                <button onClick={confirm} disabled={!validation.ready} data-testid="camera-confirm-btn" className="rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-zinc-900 disabled:opacity-30">
                  Confirm & score
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
