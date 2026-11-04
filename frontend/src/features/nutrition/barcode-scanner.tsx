"use client";

import { useEffect, useRef, useState } from "react";

import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui/button";

// API Barcode Detection (Chrome et Edge sur Android et ordinateur ; absente de Safari) : pas
// encore dans `lib.dom` de TypeScript, d'où ces types minimaux.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

// Codes des produits alimentaires vendus en magasin.
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const SCAN_INTERVAL_MS = 300;

export const CAMERA_REFUSED =
  "Caméra indisponible ou refusée : autorisez-la dans le navigateur, ou saisissez le code.";

function detectorClass(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return candidate ?? null;
}

/** Le navigateur sait-il lire un code-barres (API native) ? */
export function canScanBarcodes(): boolean {
  return (
    detectorClass() !== null &&
    "mediaDevices" in navigator &&
    "getUserMedia" in navigator.mediaDevices
  );
}

export interface BarcodeScannerProps {
  onDetected: (code: string) => void;
}

/**
 * Scan d'un code-barres par la caméra arrière, avec l'API native du navigateur : aucune image
 * ne quitte l'appareil, le flux est coupé dès qu'un code est lu ou que l'on arrête. Rien n'est
 * affiché si le navigateur ne sait pas lire de code-barres (la saisie au clavier reste).
 */
export function BarcodeScanner({ onDetected }: BarcodeScannerProps) {
  // Après l'hydratation seulement : le rendu serveur ne connaît pas le navigateur.
  const supported = useHydrated() && canScanBarcodes();
  const [scanning, setScanning] = useState(false);
  const [refused, setRefused] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!scanning) return;
    const Detector = detectorClass();
    if (!Detector) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // L'arrêt peut survenir pendant un `await` : lu par une fonction, que TypeScript n'affine pas.
    const run = { stopped: false };
    const isStopped = () => run.stopped;
    const detector = new Detector({ formats: FORMATS });

    const stop = () => {
      run.stopped = true;
      clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };

    const tick = async () => {
      const video = videoRef.current;
      if (run.stopped || !video) return;
      try {
        const found = await detector.detect(video);
        const code = found.find((barcode) => /^\d{8,14}$/.test(barcode.rawValue))?.rawValue;
        if (isStopped()) return;
        if (code) {
          stop();
          setScanning(false);
          onDetectedRef.current(code);
          return;
        }
      } catch {
        // Image pas encore prête : on réessaie au tour suivant.
      }
      timer = setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    };

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(async (media) => {
        stream = media;
        if (isStopped()) {
          stop();
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = media;
          await video.play().catch(() => undefined);
        }
        void tick();
      })
      .catch(() => {
        setRefused(true);
        setScanning(false);
      });

    return stop;
  }, [scanning]);

  if (!supported) return null;

  return (
    <div className="flex flex-col gap-3">
      {scanning ? (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Image de la caméra : visez le code-barres"
            className="rounded-control bg-surface-raised aspect-[4/3] w-full object-cover"
          />
          <p role="status" className="text-ink-muted text-sm">
            Visez le code-barres, bien éclairé, à une dizaine de centimètres.
          </p>
          <Button
            onClick={() => {
              setScanning(false);
            }}
          >
            Arrêter le scan
          </Button>
        </>
      ) : (
        <Button
          onClick={() => {
            setRefused(false);
            setScanning(true);
          }}
        >
          Scanner avec l’appareil photo
        </Button>
      )}
      <p role="alert" className="text-danger text-sm font-semibold empty:hidden">
        {refused ? CAMERA_REFUSED : ""}
      </p>
    </div>
  );
}
