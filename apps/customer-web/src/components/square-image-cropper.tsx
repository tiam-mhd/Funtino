'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerIcon } from './customer-icons';

const VIEWPORT_SIZE = 320;
const OUTPUT_SIZE = 512;

type ImageSize = { width: number; height: number };
type Point = { x: number; y: number };

export function SquareImageCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dragStart = useRef<{ pointer: Point; offset: Point } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (!active) return;
      setSourceUrl(url);
      setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setError('');
    };
    image.onerror = () => active && setError('تصویر قابل خواندن نیست. یک تصویر دیگر انتخاب کنید.');
    image.src = url;
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const baseScale = useMemo(() => {
    if (!imageSize) return 1;
    return Math.max(VIEWPORT_SIZE / imageSize.width, VIEWPORT_SIZE / imageSize.height);
  }, [imageSize]);
  const scale = baseScale * zoom;
  const renderedSize = imageSize
    ? { width: imageSize.width * scale, height: imageSize.height * scale }
    : null;

  function updateOffset(next: Point, nextZoom = zoom) {
    setOffset(clampOffset(next, imageSize, baseScale * nextZoom));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!renderedSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragStart.current = {
      pointer: { x: event.clientX, y: event.clientY },
      offset,
    };
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    updateOffset({
      x: dragStart.current.offset.x + event.clientX - dragStart.current.pointer.x,
      y: dragStart.current.offset.y + event.clientY - dragStart.current.pointer.y,
    });
  }

  function stopDragging() {
    dragStart.current = null;
    setDragging(false);
  }

  function handleZoomChange(nextZoom: number) {
    setZoom(nextZoom);
    updateOffset(offset, nextZoom);
  }

  function handleConfirm() {
    if (!sourceUrl || !imageSize || saving) return;
    setSaving(true);
    const image = new Image();
    image.onload = () => {
      const renderedWidth = imageSize.width * scale;
      const renderedHeight = imageSize.height * scale;
      const left = (VIEWPORT_SIZE - renderedWidth) / 2 + offset.x;
      const top = (VIEWPORT_SIZE - renderedHeight) / 2 + offset.y;
      const sourceSize = VIEWPORT_SIZE / scale;
      const sourceX = clamp(-left / scale, 0, imageSize.width - sourceSize);
      const sourceY = clamp(-top / scale, 0, imageSize.height - sourceSize);
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        setError('امکان آماده‌سازی تصویر وجود ندارد.');
        setSaving(false);
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE,
      );
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setError('امکان ساخت تصویر برش‌خورده وجود ندارد.');
            setSaving(false);
            return;
          }
          onConfirm(new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.9,
      );
    };
    image.onerror = () => {
      setError('تصویر قابل آماده‌سازی نیست.');
      setSaving(false);
    };
    image.src = sourceUrl;
  }

  return (
    <div className="customer-crop-modal" role="presentation">
      <section
        className="customer-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
      >
        <div className="customer-crop-dialog__header">
          <div>
            <span className="customer-auth-hero__eyebrow">
              <CustomerIcon name="sparkles" size={14} /> تصویر پروفایل
            </span>
            <h2 id="crop-title">کادر مربعی تصویر را تنظیم کن</h2>
          </div>
          <button
            type="button"
            className="customer-crop-dialog__close"
            onClick={onCancel}
            aria-label="بستن"
          >
            <CustomerIcon name="close" size={18} />
          </button>
        </div>

        <div
          className={dragging ? 'customer-crop-viewport is-dragging' : 'customer-crop-viewport'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onPointerLeave={stopDragging}
          aria-label="جابجایی تصویر برای برش مربعی"
        >
          {sourceUrl && renderedSize && (
            // The crop source is a local object URL; Next Image cannot represent this interactive crop surface.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sourceUrl}
              alt="پیش‌نمایش برش تصویر"
              draggable={false}
              style={{
                width: `${renderedSize.width}px`,
                height: `${renderedSize.height}px`,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
          <span className="customer-crop-viewport__guide" aria-hidden="true" />
        </div>

        <label className="customer-crop-zoom">
          <span>بزرگ‌نمایی</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => handleZoomChange(Number(event.target.value))}
            aria-label="بزرگ‌نمایی تصویر"
          />
        </label>
        <p className="customer-crop-dialog__hint">
          تصویر را بکش و قسمت موردنظر را داخل کادر ۱:۱ قرار بده.
        </p>
        {error && (
          <p className="customer-auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="customer-crop-dialog__actions">
          <button
            type="button"
            className="customer-secondary-button"
            onClick={onCancel}
            disabled={saving}
          >
            انصراف
          </button>
          <button
            type="button"
            className="customer-primary-button"
            onClick={handleConfirm}
            disabled={!imageSize || saving}
          >
            {saving ? 'در حال آماده‌سازی...' : 'تأیید برش'} <CustomerIcon name="check" size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}

function clampOffset(value: Point, imageSize: ImageSize | null, scale: number): Point {
  if (!imageSize) return value;
  const maxX = Math.max(0, (imageSize.width * scale - VIEWPORT_SIZE) / 2);
  const maxY = Math.max(0, (imageSize.height * scale - VIEWPORT_SIZE) / 2);
  return { x: clamp(value.x, -maxX, maxX), y: clamp(value.y, -maxY, maxY) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
