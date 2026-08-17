import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { CameraOff, RefreshCw, CheckCircle2, Radar, Lock, Unlock, ScanLine } from "lucide-react";
import { fallbackCardZones } from "../lib/api";
import { cardId, SUIT_MAP } from "../lib/cards";
import { CardSelector } from "./CardSelector";
import {
  CARD_ZONES,
  EMPTY_SCAN_SLOTS,
  forceConfirmSlot,
  mapDisplayRectToSource,
  scanValidation,
  stabilizeSlots,
  unresolvedFallbackPositions,
} from "../lib/cardScan";
import { recognizeCornerSamples } from "../lib/localCardRecognition";

const SAMPLE_GAP_MS = 140;
const RESCAN_DELAY_MS = 250;
const CORNER_WIDTH = 0.42;
const CORNER_HEIGHT = 0.5;
const FALLBACK_RETRY_MS = 5000;
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
  const unresolvedAttemptsRef = useRef([0, 0, 0, 0]);
  const fallbackInFlightRef = useRef(false);
  const fallbackEnabledRef = useRef(true);
  const lastFallbackAtRef = useRef([0, 0, 0, 0]);
  const recognitionStartedAtRef = useRef(null);
  const cameraSessionRef = useRef(0);

  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [slots, setSlots] = useState(() => EMPTY_SCAN_SLOTS());
  const [latency, setLatency] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [timings, setTimings] = useState({
    crop_ms: 0,
    local_ms: 0,
    fallback_ms: 0,
    stabilization_ms: 0,
    total_ms: 0,
  });

  const validation = useMemo(() => scanValidation(slots), [slots]);
  const usedIds = validation.cards.filter((card) => card?.rank && card?.suit).map(cardId);
  const lockedCount = slots.filter((slot) => slot.locked).length;

  const setScanSlots = useCallback((next) => {
    slotsRef.current = typeof next === "function" ? next(slotsRef.current) : next;
    setSlots(slotsRef.current);
  }, []);

  useEffect(() => {
    fallbackEnabledRef.current = fallbackEnabled;
  }, [fallbackEnabled]);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const captureCorners = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) return [];
    const displayWidth = video.clientWidth;
    const displayHeight = video.clientHeight;
    if (!displayWidth || !displayHeight) return [];
    return CARD_ZONES.map((zone) => {
      const canvas = document.createElement("canvas");
      const source = mapDisplayRectToSource(
        {
          left: zone.left,
          top: zone.top,
          width: zone.width * CORNER_WIDTH,
          height: zone.height * CORNER_HEIGHT,
        },
        video.videoWidth,
        video.videoHeight,
        displayWidth,
        displayHeight
      );
      if (!source) return null;
      canvas.width = 72;
      canvas.height = 96;
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
      return { canvas, imageData: context.getImageData(0, 0, canvas.width, canvas.height) };
    });
  }, []);

  const captureBurst = useCallback(async () => {
    const firstStarted = performance.now();
    const first = await captureCorners();
    const firstMs = performance.now() - firstStarted;
    await sleep(SAMPLE_GAP_MS);
    const secondStarted = performance.now();
    const second = await captureCorners();
    return { first, second, cropMs: firstMs + performance.now() - secondStarted };
  }, [captureCorners]);

  const loop = useCallback(async () => {
    await sleep(450);
    while (activeRef.current) {
      if (!scanningRef.current || slotsRef.current.every((slot) => slot.locked)) {
        await sleep(RESCAN_DELAY_MS);
        continue;
      }
      try {
        const cycleStarted = performance.now();
        const { first, second, cropMs } = await captureBurst();
        if (first.length !== 4 || second.length !== 4 || first.some((sample) => !sample) || second.some((sample) => !sample) || !activeRef.current) {
          await sleep(RESCAN_DELAY_MS);
          continue;
        }
        const localStarted = performance.now();
        let detected = recognizeCornerSamples(
          first.map((sample) => sample.imageData),
          second.map((sample) => sample.imageData)
        );
        const localMs = performance.now() - localStarted;
        if (recognitionStartedAtRef.current === null && detected.some(Boolean)) {
          recognitionStartedAtRef.current = cycleStarted;
        }
        detected.forEach((card, index) => {
          unresolvedAttemptsRef.current[index] = card?.stable_samples === 2
            ? 0
            : unresolvedAttemptsRef.current[index] + 1;
        });

        let fallbackMs = 0;
        let fallbackError = null;
        const now = performance.now();
        const fallbackPositions = unresolvedFallbackPositions(slotsRef.current, detected, unresolvedAttemptsRef.current)
          .filter((index) => now - lastFallbackAtRef.current[index] >= FALLBACK_RETRY_MS);
        if (fallbackEnabledRef.current && fallbackPositions.length && !fallbackInFlightRef.current) {
          fallbackInFlightRef.current = true;
          fallbackPositions.forEach((index) => { lastFallbackAtRef.current[index] = now; });
          const fallbackStarted = performance.now();
          try {
            const fallbackFiles = await Promise.all(
              fallbackPositions.map((index) => blobFromCanvas(second[index].canvas, `corner-${index + 1}.jpg`))
            );
            if (fallbackFiles.some((file) => !file)) throw new Error("Could not encode fallback card crop.");
            const data = await fallbackCardZones(
              fallbackFiles,
              fallbackPositions
            );
            fallbackMs = performance.now() - fallbackStarted;
            data.positions.forEach((position, resultIndex) => {
              if (data.cards[resultIndex]) {
                detected[position] = data.cards[resultIndex];
                unresolvedAttemptsRef.current[position] = 0;
              }
            });
          } catch (err) {
            fallbackMs = performance.now() - fallbackStarted;
            fallbackError = err?.response?.data?.detail || "Remote fallback unavailable; local scanning continues.";
          } finally {
            fallbackInFlightRef.current = false;
          }
        }

        const stabilizationStarted = performance.now();
        const nextSlots = stabilizeSlots(slotsRef.current, detected);
        const stabilizationMs = performance.now() - stabilizationStarted;
        setScanSlots(nextSlots);
        const totalMs = nextSlots.every((slot) => slot.locked) && recognitionStartedAtRef.current !== null
          ? performance.now() - recognitionStartedAtRef.current
          : 0;
        setTimings({
          crop_ms: Math.round(cropMs),
          local_ms: Math.round(localMs),
          fallback_ms: Math.round(fallbackMs),
          stabilization_ms: Number(stabilizationMs.toFixed(1)),
          total_ms: Math.round(totalMs),
        });
        setLatency(Math.round(cropMs + localMs + fallbackMs + stabilizationMs));
        setScanError(fallbackError);
      } catch (err) {
        if (!activeRef.current) return;
        setScanError(err?.response?.data?.detail || "Recognition paused. Retrying…");
      }
      await sleep(RESCAN_DELAY_MS);
    }
  }, [captureBurst, setScanSlots]);

  const start = useCallback(async () => {
    const session = ++cameraSessionRef.current;
    setError(null);
    setScanError(null);
    setLatency(null);
    setTimings({ crop_ms: 0, local_ms: 0, fallback_ms: 0, stabilization_ms: 0, total_ms: 0 });
    unresolvedAttemptsRef.current = [0, 0, 0, 0];
    lastFallbackAtRef.current = [0, 0, 0, 0];
    recognitionStartedAtRef.current = null;
    fallbackInFlightRef.current = false;
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
      if (cameraSessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (cameraSessionRef.current !== session) return;
        setReady(true);
        activeRef.current = true;
        scanningRef.current = true;
        setScanning(true);
        loop();
      } else {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
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
    setTimings({ crop_ms: 0, local_ms: 0, fallback_ms: 0, stabilization_ms: 0, total_ms: 0 });
    unresolvedAttemptsRef.current = [0, 0, 0, 0];
    lastFallbackAtRef.current = [0, 0, 0, 0];
    recognitionStartedAtRef.current = null;
    scanningRef.current = true;
    setScanning(true);
  };

  const unlockSlot = (index) => {
    setScanSlots((current) =>
      current.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, locked: false, matches: 0, candidateId: null } : slot
      )
    );
    unresolvedAttemptsRef.current[index] = 0;
    lastFallbackAtRef.current[index] = 0;
    recognitionStartedAtRef.current = null;
    scanningRef.current = true;
    setScanning(true);
  };

  const correctSlot = (index, card) => {
    setScanSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? forceConfirmSlot(slot, card) : slot))
    );
    unresolvedAttemptsRef.current[index] = 0;
    lastFallbackAtRef.current[index] = 0;
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
                  <ScanLine className="w-3.5 h-3.5 animate-pulse" /> Local corner matching
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
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Switch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} />
                GPT fallback for unresolved slots
              </div>
              <div className="flex gap-2 ml-auto">
                <button onClick={rescan} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold hover:bg-zinc-800">
                  <RefreshCw className="w-3.5 h-3.5" /> Rescan all
                </button>
                <button onClick={confirm} disabled={!validation.ready} data-testid="camera-confirm-btn" className="rounded-full bg-[#d4af37] px-5 py-2 text-xs font-bold text-zinc-900 disabled:opacity-30">
                  Confirm & score
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] text-zinc-500" data-testid="scan-timings">
              <span>Crop/preprocess <b className="text-zinc-300">{timings.crop_ms} ms</b></span>
              <span>Local recognition <b className="text-zinc-300">{timings.local_ms} ms</b></span>
              <span>Fallback network <b className="text-zinc-300">{timings.fallback_ms} ms</b></span>
              <span>Stabilization <b className="text-zinc-300">{timings.stabilization_ms} ms</b></span>
              <span>Recognition-to-lock <b className="text-zinc-300">{timings.total_ms} ms</b></span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
