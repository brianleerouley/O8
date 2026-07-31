import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Camera, CameraOff, RefreshCw } from "lucide-react";

export const CameraCapture = ({ open, onOpenChange, onCapture }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
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
      }
    } catch (e) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again."
          : "No camera available on this device."
      );
    }
  }, []);

  useEffect(() => {
    if (open) start();
    return stop;
  }, [open, start, stop]);

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `hand-${Date.now()}.jpg`, { type: "image/jpeg" });
        onOpenChange(false);
        onCapture(file);
      },
      "image/jpeg",
      0.92
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-lg"
        data-testid="camera-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-head flex items-center gap-2">
            <Camera className="w-5 h-5 text-[#d4af37]" />
            Snap your four cards
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Capture a photo of your four cards and we'll read the ranks and suits automatically.
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
            </div>
            <p className="text-xs text-zinc-500 text-center">
              Line up all four cards inside the frame, then capture.
            </p>
            <button
              onClick={snap}
              disabled={!ready}
              data-testid="camera-capture-btn"
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-6 py-3 text-sm font-bold text-zinc-900 transition-all hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
            >
              <Camera className="w-4 h-4" /> Capture cards
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
