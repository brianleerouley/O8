import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Switch } from "./ui/switch";
import { Camera, CameraOff, RefreshCw, CheckCircle2, Radar } from "lucide-react";
import { scanFrame } from "../lib/api";
import { cardId, SUIT_MAP } from "../lib/cards";

const CAPTURE_EVERY_MS = 3000; // auto-capture cadence while scanning is on
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CameraCapture = ({ open, onOpenChange, onDetected }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const activeRef = useRef(false);
  const scanningRef = useRef(true);
  const lastLockedRef = useRef(null);

  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [confirmed, setConfirmed] = useState(0);
  const [lastHand, setLastHand] = useState(null);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const captureFile = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return Promise.resolve(null);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return new Promise((resolve) =>
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], "frame.jpg", { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.85
      )
    );
  }, []);

  const loop = useCallback(async () => {
    await sleep(800); // camera warm-up
    while (activeRef.current) {
      if (scanningRef.current) {
        const file = await captureFile();
        if (file && activeRef.current) {
          try {
            const cards = await scanFrame(file);
            const seen = new Set();
            const unique = [];
            for (const c of cards) {
              const id = cardId(c);
              if (!seen.has(id)) {
                seen.add(id);
                unique.push(c);
              }
            }
            setConfirmed(unique.length);
            if (unique.length === 4) {
              const sig = unique.map(cardId).sort().join("-");
              if (sig !== lastLockedRef.current) {
                lastLockedRef.current = sig;
                setLastHand(unique);
                onDetected(unique);
              }
            }
          } catch (_) {
            /* ignore transient frame errors */
          }
        }
        await sleep(CAPTURE_EVERY_MS);
      } else {
        await sleep(500);
      }
    }
  }, [captureFile, onDetected]);

  const start = useCallback(async () => {
    setError(null);
    setConfirmed(0);
    setLastHand(null);
    lastLockedRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
        activeRef.current = true;
        loop();
      }
    } catch (e) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "No camera available on this device."
      );
    }
  }, [loop]);

  useEffect(() => {
    if (open) {
      setScanning(true);
      scanningRef.current = true;
      start();
    }
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleScan = (v) => {
    setScanning(v);
    scanningRef.current = v;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg" data-testid="camera-dialog">
        <DialogHeader>
          <DialogTitle className="font-head flex items-center gap-2">
            <Radar className="w-5 h-5 text-[#d4af37]" />
            Hands-free scan
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Leave auto-scan on and hold your cards up — every hand is read and scored automatically. Show a new hand to score it.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <CameraOff className="w-10 h-10 text-rose-400" />
            <p className="text-sm text-zinc-400 max-w-xs">{error}</p>
            <button
              onClick={start}
              data-testid="camera-retry-btn"
              className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-semibold hover:bg-zinc-800"
            >
              <RefreshCw className="w-4 h-4" /> Try again
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video ring-1 ring-zinc-700">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-[#d4af37]/60" />
              {scanning && ready && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur px-2.5 py-1 text-[11px] text-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Scanning
                </div>
              )}
            </div>

            <div
              className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3"
              data-testid="scan-toggle-row"
            >
              <div>
                <p className="text-sm font-semibold">Auto-scan</p>
                <p className="text-xs text-zinc-500">
                  {scanning ? `Capturing every ${CAPTURE_EVERY_MS / 1000}s` : "Paused"}
                </p>
              </div>
              <Switch checked={scanning} onCheckedChange={toggleScan} data-testid="scan-toggle" />
            </div>

            <div className="flex items-center justify-center gap-2" data-testid="scan-progress">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1.5 w-10 rounded-full transition-colors ${
                    i < confirmed ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                />
              ))}
            </div>
            <p className="text-center text-sm text-zinc-300 flex items-center justify-center gap-2">
              <CheckCircle2 className={`w-4 h-4 ${confirmed === 4 ? "text-emerald-400" : "text-zinc-500"}`} />
              <span data-testid="scan-confirmed">{confirmed} of 4 cards confirmed</span>
            </p>

            {lastHand && (
              <p className="text-center text-xs text-emerald-300 flex items-center justify-center gap-2" data-testid="scan-last-hand">
                <CheckCircle2 className="w-3.5 h-3.5" /> Scored:{" "}
                {lastHand.map((c) => `${c.rank}${SUIT_MAP[c.suit]?.symbol}`).join(" ")}
              </p>
            )}

            <button
              onClick={() => onOpenChange(false)}
              data-testid="camera-done-btn"
              className="w-full rounded-full bg-[#d4af37] px-6 py-2.5 text-sm font-bold text-zinc-900 hover:scale-[1.02] transition-transform"
            >
              Done
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
