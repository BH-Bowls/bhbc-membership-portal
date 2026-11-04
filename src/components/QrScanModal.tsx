'use client';

// src/components/QrScanModal.tsx
// Camera modal for scanning a membership card QR (src/lib/bar-card.ts) — used by the
// bar till and by Admin to restore a found card. Decodes with jsQR against captured
// video frames rather than the native BarcodeDetector API, which isn't available on
// iPad Safari. The camera needs HTTPS (or localhost).
//
// Starts on the rear camera (right for the iPad). "Switch camera" steps through the
// others — e.g. on a laptop where Windows offers a phone (Phone Link) as the rear
// camera — and the choice is remembered on this device.

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useCardScanner } from '@/hooks/useCardScanner';

const CAMERA_KEY = 'qr_scan_camera';

function savedCamera(): string | null {
  try { return localStorage.getItem(CAMERA_KEY); } catch { return null; }
}

export default function QrScanModal({ title = 'Scan member QR', onScan, onClose }: {
  title?: string;
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanError, setScanError] = useState('');
  // The camera asked for (null = the rear camera), the cameras there are, and the one in use
  const [deviceId, setDeviceId] = useState<string | null>(savedCamera);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [activeId, setActiveId] = useState('');
  // Kept in a ref so a parent re-render doesn't restart the camera
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; });
  // A plug-in scanner works while the camera is open too
  useCardScanner((code) => onScanRef.current(code));

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let stopped = false;

    function tick() {
      if (stopped) return;
      const video = videoRef.current, canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) { onScanRef.current(code.data); return; }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    (async () => {
      // Browsers only offer the camera on https:// or localhost
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setScanError('The camera only works when this page is opened on https:// or localhost — not an http:// network address.');
        return;
      }
      setScanError('');
      try {
        const video: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' };
        stream = await navigator.mediaDevices.getUserMedia({ video: video });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const track = stream.getVideoTracks()[0];
        setActiveId(track ? track.getSettings().deviceId || '' : '');
        // Device names and ids are only listed once camera access has been given
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === 'videoinput'));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        // The remembered camera has gone (unplugged, phone not connected) — back to the default
        if (deviceId && (name === 'NotFoundError' || name === 'OverconstrainedError')) {
          try { localStorage.removeItem(CAMERA_KEY); } catch { /* ignore */ }
          setDeviceId(null);
          return;
        }
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setScanError('Camera blocked — allow it for this site in the browser (camera icon in the address bar), and on Windows check Settings → Privacy & security → Camera.');
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setScanError('No camera found on this device.');
        } else if (name === 'NotReadableError' || name === 'AbortError') {
          setScanError('The camera is in use by another app (e.g. Teams or Zoom) — close it and try again.');
        } else {
          setScanError(`Camera unavailable${name ? ` (${name})` : ''}.`);
        }
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  function switchCamera() {
    if (cameras.length < 2) return;
    const index = cameras.findIndex((c) => c.deviceId === activeId);
    const next = cameras[(index + 1) % cameras.length];
    try { localStorage.setItem(CAMERA_KEY, next.deviceId); } catch { /* ignore */ }
    setDeviceId(next.deviceId);
  }

  const activeCamera = cameras.find((c) => c.deviceId === activeId);

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="relative aspect-square rounded-lg overflow-hidden bg-black">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
        <canvas ref={canvasRef} className="hidden" />
        {cameras.length > 1 && (
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-xs text-gray-600 truncate">{activeCamera && activeCamera.label ? activeCamera.label : ''}</span>
            <button onClick={switchCamera}
              className="shrink-0 px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white text-gray-900 hover:bg-gray-50">
              Switch camera
            </button>
          </div>
        )}
        {scanError && <p className="text-sm text-red-600 mt-2">{scanError}</p>}
      </div>
    </div>
  );
}
