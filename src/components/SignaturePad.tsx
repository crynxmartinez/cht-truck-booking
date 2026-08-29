'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draw with a finger or type a name. Both produce a PNG data URL, so the PDF
 * and the audit record do not care which one somebody chose.
 */
export function SignaturePad({
  defaultName,
  onChange,
}: {
  defaultName: string;
  onChange: (dataUrl: string | null, typedName: string) => void;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState(defaultName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Size the bitmap to the element so lines are not blurry on a phone.
  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (rect.width === 0) return;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (c.width === w && c.height === h) return;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17181a';
  }, []);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [fit]);

  const point = (e: PointerEvent | React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const emitDrawn = () => {
    const c = canvasRef.current;
    if (!c || !dirty.current) return onChange(null, typed);
    onChange(c.toDataURL('image/png'), typed);
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const c = canvasRef.current!;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d');
    if (!ctx || !last.current) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    dirty.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    emitDrawn();
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange(null, typed);
  };

  /** Render the typed name to a canvas so it becomes an image like a drawn one. */
  const emitTyped = (value: string) => {
    setTyped(value);
    if (!value.trim()) return onChange(null, value);
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#17181a';
    ctx.font = 'italic 58px "Segoe Script", "Brush Script MT", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, 320, 84);
    onChange(c.toDataURL('image/png'), value);
  };

  return (
    <div className="sigwrap">
      <div className="sigtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'draw'}
          onClick={() => {
            setMode('draw');
            emitDrawn();
          }}
        >
          Draw it
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'type'}
          onClick={() => {
            setMode('type');
            emitTyped(typed);
          }}
        >
          Type it
        </button>
      </div>

      {mode === 'draw' ? (
        <>
          <canvas
            ref={canvasRef}
            className="sigpad"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerLeave={end}
            aria-label="Signature drawing area"
          />
          <div className="sigclear">
            <button type="button" className="btn ghost small" onClick={clear}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <div className="sigtype">
          <input
            type="text"
            value={typed}
            onChange={(e) => emitTyped(e.target.value)}
            placeholder="Type your full name"
            aria-label="Typed signature"
          />
        </div>
      )}
    </div>
  );
}
