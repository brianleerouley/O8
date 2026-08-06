import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Camera, CameraOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { scanFrame } from "../lib/api";
import { cardId } from "../lib/cards";

const SCAN_SECONDS = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CameraCapture = ({ open, onOpenChange, onDetected, onExpire }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const activeRef = useRef(false);
  const finishedRef = useRef(false);
  const detectedRef = useRef([]);
  const timerRef = useRef(null);

  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [countdown, setCountdown] = useState(SCAN_SECONDS);
  const [confirmed, setConfirmed] = useState(0);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const finish = useCallback(
    (mode) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const cards = detectedRef.current;
      stopCamera();
      onOpenChange(false);
      if (mode === "locked") onDetected(cards);
      else onExpire(cards);
    },
    [onDetected, onExpire, onOpenChange, stopCamera]
  );

  const captureFile = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
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

  const scanLoop = useCallback(async () => {
    while (activeRef.current) {
      const file = await captureFile();
      if (file) {
        try {
          const cards = await scanFrame(file);
          if (!activeRef.current) break;
          const unique = [];
          const seen = new Set();
          for (const c of cards) {
            const id = cardId(c);
            if (!seen.has(id)) {
              seen.add(id);
              unique.push(c);
            }
          }
          detectedRef.current = unique;
          setConfirmed(unique.length);
          if (unique.length === 4) {
            finish("locked");
            return;
          }
        } catch (_) {
          /* ignore transient frame errors */
        }
      }
      await sleep(500);
    }
  }, [captureFile, finish]);

  const start = useCallback(async () => {
    setError(null);
    finishedRef.current = false;
    detectedRef.current = [];
    setConfirmed(0);
    setCountdown(SCAN_SECONDS);
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
        timerRef.current = setInterval(() => {
          setCountdown((c) => {
            if (c <= 1) {
              clearInterval(timerRef.current);
              finish("expired");
              return 0;
            }
            return c - 1;
          });
        }, 1000);
        scanLoop();
      }
    } catch (e) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "No camera available on this device."
      );
    }
  }, [finish, scanLoop]);

  useEffect(() => {
    if (open) start();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg" data-testid="camera-dialog">
        <DialogHeader>
          <DialogTitle className="font-head flex items-center gap-2">
            <Camera className="w-5 h-5 text-[#d4af37]" />
            Scanning your hand
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Hold all four cards steady in the frame — scoring runs automatically once four are confirmed.
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
              <div
                className="absolute top-3 right-3 grid place-items-center w-11 h-11 rounded-full bg-black/60 backdrop-blur text-[#d4af37] font-head font-extrabold text-lg"
                data-testid="scan-countdown"
              >
                {countdown}
              </div>
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
            <p className="text-center text-xs text-zinc-500">
              {ready ? "Scanning\u2026 keep the cards flat and well lit." : "Starting camera\u2026"}
            </p>
            <button
              onClick={() => finish("expired")}
              data-testid="camera-cancel-btn"
              className="w-full rounded-full border border-zinc-700 px-6 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              Cancel scan
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
