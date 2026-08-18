import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraOff, CheckCircle2, Loader2, Radar, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { CardSelector } from "./CardSelector";
import { recognizeCards } from "../lib/api";
import { cardId } from "../lib/cards";
import { addTemporalVotes, chooseRecognitionCards, EMPTY_SCAN_SLOTS, EMPTY_TEMPORAL_VOTES, forceConfirmSlot, frameSlotsFromCards, mapDisplayRectToSource, needsRemoteRecognition, normalizeScanDelayMs, scanValidation, shouldAutoStartScan, shouldSkipVerification, temporalCards } from "../lib/cardScan";
import { frameQualityScore, recognizeFannedCardFrame } from "../lib/localCardRecognition";

export const CAPTURE_GUIDE = { left: 0.04, top: 0.04, width: 0.92, height: 0.72 };

const EMPTY_TIMINGS = { capture_ms: 0, local_ms: 0, fallback_ms: 0, total_ms: 0 };
const DEFAULT_SCAN_DELAY_MS = normalizeScanDelayMs(process.env.REACT_APP_SCAN_START_DELAY_MS);
const SCAN_DELAY_OPTIONS = [0, 1000, 2000, 3000, 5000];

const canvasFile = (canvas, name) =>
  new Promise((resolve) =>
    canvas.toBlob(
      (blob) => resolve(blob ? new File([blob], name, { type: "image/jpeg" }) : null),
      "image/jpeg",
      0.86
    )
  );

export const CameraCapture = ({ open, onOpenChange, onDetected }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraSessionRef = useRef(0);
  const autoScanStartedRef = useRef(false);

  const [phase, setPhase] = useState("preview");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [slots, setSlots] = useState(() => EMPTY_SCAN_SLOTS());
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [timings, setTimings] = useState(EMPTY_TIMINGS);
  const [scanDelayMs, setScanDelayMs] = useState(() =>
    normalizeScanDelayMs(window.localStorage.getItem("omaha8ScanDelayMs"), DEFAULT_SCAN_DELAY_MS)
  );
  const [scanStartsInMs, setScanStartsInMs] = useState(scanDelayMs);

  const validation = useMemo(() => scanValidation(slots), [slots]);
  const usedIds = validation.cards.filter((card) => card?.rank && card?.suit).map(cardId);
  const detectedCount = validation.cards.filter((card) => card?.rank && card?.suit).length;
  const needsVerification = slots.some((slot) => slot.card?.rank && slot.card?.suit && !slot.locked);

  const stopCamera = useCallback(() => {
    cameraSessionRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    const session = ++cameraSessionRef.current;
    setError(null);
    setScanError(null);
    setCapturedImage(null);
    setSlots(EMPTY_SCAN_SLOTS());
    setTimings(EMPTY_TIMINGS);
    setPhase("preview");
    autoScanStartedRef.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (cameraSessionRef.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (!videoRef.current) {
        stopCamera();
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (cameraSessionRef.current !== session) return;
      setReady(true);
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "No camera is available. You can continue with manual entry."
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    if (open) startCamera();
    return stopCamera;
  }, [open, startCamera, stopCamera]);

  const captureDisplayedFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight || !video.clientWidth || !video.clientHeight) return null;
    const source = mapDisplayRectToSource(
      { left: 0, top: 0, width: 1, height: 1 },
      video.videoWidth,
      video.videoHeight,
      video.clientWidth,
      video.clientHeight
    );
    if (!source) return null;
    const frame = document.createElement("canvas");
    frame.width = 960;
    frame.height = Math.round(frame.width * (video.clientHeight / video.clientWidth));
    frame.getContext("2d", { alpha: false }).drawImage(
      video,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      frame.width,
      frame.height
    );
    return frame;
  }, []);

  const extractGuide = useCallback((frame) => {
    const guide = document.createElement("canvas");
    guide.width = Math.round(frame.width * CAPTURE_GUIDE.width);
    guide.height = Math.round(frame.height * CAPTURE_GUIDE.height);
    guide.getContext("2d", { alpha: false }).drawImage(
      frame,
      frame.width * CAPTURE_GUIDE.left,
      frame.height * CAPTURE_GUIDE.top,
      frame.width * CAPTURE_GUIDE.width,
      frame.height * CAPTURE_GUIDE.height,
      0,
      0,
      guide.width,
      guide.height
    );
    return guide;
  }, []);

  const capture = useCallback(async () => {
    const started = performance.now();
    if (!captureDisplayedFrame()) {
      setScanError("The camera frame is not ready yet. Hold steady and try again.");
      return;
    }
    setPhase("processing");
    setScanError(null);
    const localStarted = performance.now();
    let votes = EMPTY_TEMPORAL_VOTES();
    let cards = [];
    let bestGuide = null;
    let bestQuality = -1;
    let acceptedFrames = 0;

    const scanDeadline = performance.now() + 4000;
    for (let sample = 0; sample < 80 && performance.now() < scanDeadline; sample += 1) {
      const frame = captureDisplayedFrame();
      if (frame) {
        const guide = extractGuide(frame);
        const quality = frameQualityScore(guide);
        if (quality > bestQuality) {
          bestQuality = quality;
          bestGuide = guide;
          setCapturedImage(frame.toDataURL("image/jpeg", 0.82));
        }
        if (quality >= 0.18) {
          const localResult = recognizeFannedCardFrame(guide);
          votes = addTemporalVotes(votes, localResult.cards, quality);
          cards = temporalCards(votes);
          acceptedFrames += 1;
          setSlots(frameSlotsFromCards(cards));
          if (cards.length === 4 && cards.every((card) => card?.confidence === "high")) break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    stopCamera();
    if (!bestGuide) {
      setScanError("No usable camera frames were available. Hold steady and try again.");
      setPhase("results");
      return;
    }
    const captureMs = performance.now() - started;
    const localMs = performance.now() - localStarted;
    let fallbackMs = 0;
    let fallbackError = null;
    const localUncertain = needsRemoteRecognition(cards);

    if (fallbackEnabled && localUncertain) {
      const fallbackStarted = performance.now();
      try {
        const file = await canvasFile(bestGuide, "fanned-hand.jpg");
        if (!file) throw new Error("Could not encode captured frame.");
        cards = chooseRecognitionCards(cards, await recognizeCards(file));
      } catch (err) {
        fallbackError = err?.response?.data?.detail
          || "Remote recognition is unavailable. Correct the cards manually or retake the photo.";
      }
      fallbackMs = performance.now() - fallbackStarted;
    }

    setSlots(frameSlotsFromCards(cards));
    setTimings({
      capture_ms: Math.round(captureMs),
      local_ms: Math.round(localMs),
      fallback_ms: Math.round(fallbackMs),
      total_ms: Math.round(performance.now() - started),
    });
    setScanError(fallbackError || (acceptedFrames < 2 ? "Too few sharp, glare-free frames were found. Verify the cards or retake the scan." : null));
    if (shouldSkipVerification(cards)) {
      onDetected(cards.map(({ rank, suit, confidence }) => ({ rank, suit, confidence })));
      onOpenChange(false);
      return;
    }
    setPhase("results");
  }, [captureDisplayedFrame, extractGuide, fallbackEnabled, onDetected, onOpenChange, stopCamera]);

  useEffect(() => {
    if (!shouldAutoStartScan({ open, ready, phase, started: autoScanStartedRef.current })) return;
    autoScanStartedRef.current = true;
    setScanStartsInMs(scanDelayMs);
    const startedAt = performance.now();
    const countdown = window.setInterval(() => {
      setScanStartsInMs(Math.max(0, scanDelayMs - (performance.now() - startedAt)));
    }, 100);
    const timer = window.setTimeout(() => {
      window.clearInterval(countdown);
      setScanStartsInMs(0);
      capture();
    }, scanDelayMs);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(timer);
    };
  }, [capture, open, phase, ready, scanDelayMs]);

  const changeScanDelay = (event) => {
    const next = normalizeScanDelayMs(event.target.value, DEFAULT_SCAN_DELAY_MS);
    autoScanStartedRef.current = false;
    setScanDelayMs(next);
    window.localStorage.setItem("omaha8ScanDelayMs", String(next));
  };

  const correctSlot = (index, card) => {
    setSlots((current) =>
      current.map((slot, slotIndex) => (slotIndex === index ? forceConfirmSlot(slot, card) : slot))
    );
  };

  const confirm = () => {
    if (!validation.ready) return;
    onDetected(validation.cards.map(({ rank, suit, confidence }) => ({ rank, suit, confidence })));
    onOpenChange(false);
  };

  const manualEntry = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-4xl overflow-y-auto overscroll-contain bg-zinc-900 p-4 text-zinc-100 border-zinc-700 sm:p-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        data-testid="camera-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-head flex items-center gap-2">
            <Radar className="w-5 h-5 text-[#d4af37]" />
            Capture your Omaha8 hand
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Fan 4 cards in the highlighted area. Scanning begins after your positioning delay.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <CameraOff className="w-10 h-10 text-rose-400" />
            <p className="text-sm text-zinc-400 max-w-xs">{error}</p>
            <div className="flex gap-2">
              <button onClick={startCamera} data-testid="camera-retry-btn" className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-800">
                Try again
              </button>
              <button onClick={manualEntry} className="rounded-full bg-[#d4af37] px-5 py-2.5 text-sm font-bold text-zinc-900">
                Manual Entry
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-center text-xs font-semibold text-[#f4d66d]">
              Keep all 4 rank/suit corners visible
            </p>
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video ring-1 ring-zinc-700">
              {phase !== "results" ? (
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              ) : (
                <img src={capturedImage || ""} alt="Captured four-card hand" className="w-full h-full object-cover" />
              )}
              <div
                data-testid="camera-capture-guide"
                className="pointer-events-none absolute rounded-2xl border-2 border-dashed border-[#d4af37] bg-[#d4af37]/10 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]"
                style={{
                  left: `${CAPTURE_GUIDE.left * 100}%`,
                  top: `${CAPTURE_GUIDE.top * 100}%`,
                  width: `${CAPTURE_GUIDE.width * 100}%`,
                  height: `${CAPTURE_GUIDE.height * 100}%`,
                }}
              />
              {phase === "processing" && (
                <div className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2 rounded-full bg-black/75 px-4 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-[#d4af37]" />
                  <span className="text-xs font-semibold">Hold the four card corners steady — scanning automatically…</span>
                </div>
              )}
            </div>

            {phase === "preview" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <Switch checked={fallbackEnabled} onCheckedChange={setFallbackEnabled} />
                  AI recognition available when needed
                </div>
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  Positioning time
                  <select
                    value={scanDelayMs}
                    onChange={changeScanDelay}
                    aria-label="Positioning time before scan"
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-200"
                  >
                    {SCAN_DELAY_OPTIONS.map((delay) => (
                      <option key={delay} value={delay}>{delay === 0 ? "None" : `${delay / 1000} sec`}</option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2 ml-auto">
                  <button onClick={manualEntry} className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-800">
                    Manual Entry
                  </button>
                  <span data-testid="camera-auto-scan-status" className="inline-flex items-center gap-2 rounded-full bg-[#d4af37]/15 px-5 py-2.5 text-sm font-semibold text-[#f4d66d]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {scanStartsInMs > 0 ? `Position cards — scanning in ${Math.ceil(scanStartsInMs / 1000)}…` : "Starting automatic scan…"}
                  </span>
                </div>
              </div>
            ) : phase === "results" ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="scan-progress">
                  {slots.map((slot, index) => (
                    <div key={index} className={`rounded-xl border p-3 ${slot.locked ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500">Card {index + 1}</span>
                        <span className={`text-[10px] font-semibold uppercase ${slot.locked ? "text-emerald-300" : "text-amber-300"}`}>
                          {slot.locked ? "ready" : slot.card?.rank ? "verify" : "select"}
                        </span>
                      </div>
                      <CardSelector card={slot.card} index={index} onChange={(card) => correctSlot(index, card)} usedIds={usedIds} />
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs text-zinc-400" data-testid="scan-confirmed">
                      <CheckCircle2 className={`inline w-4 h-4 mr-1.5 ${validation.ready ? "text-emerald-400" : "text-zinc-600"}`} />
                      {detectedCount} of 4 cards detected
                    </p>
                    {needsVerification && <p className="text-xs text-amber-300">Tap highlighted cards to verify or correct them.</p>}
                    {!validation.unique && validation.complete && <p className="text-xs text-rose-300">Duplicate card detected — correct the hand before confirming.</p>}
                    {detectedCount < 4 && <p className="text-xs text-amber-300">Not all cards were clear. Retake or select missing cards manually.</p>}
                    {scanError && <p className="text-xs text-rose-300">{scanError}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <button onClick={manualEntry} className="rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold hover:bg-zinc-800">Manual Entry</button>
                    <button onClick={startCamera} className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold hover:bg-zinc-800">
                      <RefreshCw className="w-3.5 h-3.5" /> Retake
                    </button>
                    <button onClick={confirm} disabled={!validation.ready} data-testid="camera-confirm-btn" className="w-full rounded-full bg-[#d4af37] px-5 py-2.5 text-xs font-bold text-zinc-900 disabled:opacity-30 sm:w-auto">
                      Confirm Hand
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-zinc-500" data-testid="scan-timings">
                  <span>Capture <b className="text-zinc-300">{timings.capture_ms} ms</b></span>
                  <span>Local recognition <b className="text-zinc-300">{timings.local_ms} ms</b></span>
                  <span>Fallback <b className="text-zinc-300">{timings.fallback_ms} ms</b></span>
                  <span>Total <b className="text-zinc-300">{timings.total_ms} ms</b></span>
                </div>
              </>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
