import type { CanvasDrawItem, SabotageVisualItem } from '@shared/protocol';
import { STAMP_MAP } from '@shared/stamps';

export interface RenderCanvasOptions {
  drawItems: CanvasDrawItem[];
  sabotageItems: SabotageVisualItem[];
  isGlitching: boolean;
  wipersProgress: number | null; // 0..1 when active, null otherwise
}

export function renderTvCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: RenderCanvasOptions,
): void {
  // 1. Studio white drawing paper background
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Subtle studio grid watermark
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  const step = Math.max(24, height / 9);
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // 2. Layer 1: Artists' strokes and stamps
  for (const item of opts.drawItems) {
    if (item.kind === 'stroke') {
      drawStroke(ctx, width, height, item);
    } else {
      drawStamp(ctx, width, height, item);
    }
  }

  // 3. Layer 2: Sabotage visual items (cleared by Wipers)
  for (const sab of opts.sabotageItems) {
    drawSabotageItem(ctx, width, height, sab);
  }

  // 4. Wipers animation overlay
  if (opts.wipersProgress !== null) {
    drawWipersAnimation(ctx, width, height, opts.wipersProgress);
  }

  // 5. Glitch scanlines overlay
  if (opts.isGlitching) {
    drawGlitchOverlay(ctx, width, height);
  }
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  item: Extract<CanvasDrawItem, { kind: 'stroke' }>,
): void {
  if (item.points.length === 0) return;
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lineWidth = Math.max(2, item.widthNorm * height);
  ctx.lineWidth = lineWidth;

  if (item.points.length === 1) {
    const p = item.points[0];
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(item.points[0].x * width, item.points[0].y * height);
  for (let i = 1; i < item.points.length - 1; i++) {
    const curr = item.points[i];
    const next = item.points[i + 1];
    const midX = ((curr.x + next.x) / 2) * width;
    const midY = ((curr.y + next.y) / 2) * height;
    ctx.quadraticCurveTo(curr.x * width, curr.y * height, midX, midY);
  }
  const last = item.points[item.points.length - 1];
  ctx.lineTo(last.x * width, last.y * height);
  ctx.stroke();
  ctx.restore();
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  item: Extract<CanvasDrawItem, { kind: 'stamp' }>,
): void {
  const def = STAMP_MAP[item.stampId];
  if (!def) return;

  const sizePx = item.scaleNorm * height;
  const cx = item.x * width;
  const cy = item.y * height;

  ctx.save();
  ctx.translate(cx - sizePx / 2, cy - sizePx / 2);
  ctx.scale(sizePx / 100, sizePx / 100);
  ctx.fillStyle = item.color;

  for (const d of def.paths) {
    const p = new Path2D(d);
    ctx.fill(p, def.fillRule ?? 'nonzero');
  }
  ctx.restore();
}

function drawSabotageItem(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sab: SabotageVisualItem,
): void {
  const cx = sab.x * width;
  const cy = sab.y * height;
  const unit = height * 0.14 * sab.scale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(sab.rotation);

  if (sab.type === 'tomato') {
    // Splat blob
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    const lobes = 9;
    for (let i = 0; i <= lobes * 2; i++) {
      const ang = (i * Math.PI) / lobes;
      const r = i % 2 === 0 ? unit * 1.05 : unit * 0.62;
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Juice drips
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.ellipse(-unit * 0.25, unit * 0.9, unit * 0.14, unit * 0.35, 0, 0, Math.PI * 2);
    ctx.ellipse(unit * 0.3, unit * 0.78, unit * 0.1, unit * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    // Seeds & green stem
    ctx.fillStyle = '#fef08a';
    for (let i = 0; i < 5; i++) {
      const ang = (i * Math.PI * 2) / 5 + 0.3;
      ctx.beginPath();
      ctx.ellipse(
        Math.cos(ang) * unit * 0.36,
        Math.sin(ang) * unit * 0.36,
        unit * 0.08,
        unit * 0.04,
        ang,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (sab.type === 'sticker') {
    const emoji = sab.sticker || '🤡';
    const fontSize = Math.round(unit * 1.85);
    ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(4, unit * 0.18);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(emoji, 0, 0);
    ctx.fillText(emoji, 0, 0);
  } else if (sab.type === 'crack') {
    const rays = 10;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.92)';
    ctx.lineWidth = Math.max(2, height * 0.004);
    ctx.shadowColor = 'rgba(15, 23, 42, 0.85)';
    ctx.shadowBlur = 4;
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2 + 0.2;
      const len = unit * (1.2 + (i % 3) * 0.65);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * len * 0.45, Math.sin(ang) * len * 0.45);
      ctx.lineTo(
        Math.cos(ang + 0.12) * len,
        Math.sin(ang + 0.12) * len,
      );
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.9, 0, Math.PI * 1.4);
    ctx.stroke();
  } else if (sab.type === 'censor') {
    const barW = unit * 3.1;
    const barH = unit * 1.15;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(-barW / 2, -barH / 2, barW, barH);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = Math.max(2, height * 0.005);
    ctx.strokeRect(-barW / 2, -barH / 2, barW, barH);

    ctx.fillStyle = '#facc15';
    ctx.font = `900 ${Math.round(barH * 0.46)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ЦЕНЗУРА', 0, 2);
  } else if (sab.type === 'spotlight') {
    // Director's spotlight: a bright studio glare with a lens ring and a star
    // flare. Without this branch the ability consumed 45 energy and drew nothing.
    // Drawn with source-over (not a screen blend) so it also washes out strokes on
    // the white paper background instead of blending into it.
    const radius = unit * 4.2;
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, 'rgba(255, 251, 214, 0.92)');
    glow.addColorStop(0.2, 'rgba(255, 226, 130, 0.6)');
    glow.addColorStop(0.55, 'rgba(255, 205, 60, 0.28)');
    glow.addColorStop(1, 'rgba(255, 190, 0, 0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = Math.max(1.5, height * 0.004);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.32, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.9, radius * 0.06, sab.rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.06, radius * 0.9, sab.rotation, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawWipersAnimation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
): void {
  // Sweep angle oscillates from -0.8 to +0.8 rad
  const angle = Math.sin(progress * Math.PI * 2) * 0.95;
  const bladeLen = height * 0.98;

  ctx.save();
  const pivots = [width * 0.3, width * 0.72];
  for (const px of pivots) {
    ctx.save();
    ctx.translate(px, height + 6);
    ctx.rotate(angle);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = Math.max(6, height * 0.018);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -bladeLen);
    ctx.stroke();

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = Math.max(2, height * 0.006);
    ctx.beginPath();
    ctx.moveTo(0, -bladeLen * 0.2);
    ctx.lineTo(0, -bladeLen * 0.98);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawGlitchOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  for (let i = 0; i < 12; i++) {
    const y = Math.random() * height;
    const h = 4 + Math.random() * (height * 0.06);
    ctx.fillStyle =
      i % 3 === 0
        ? 'rgba(239, 68, 68, 0.25)'
        : i % 3 === 1
          ? 'rgba(6, 182, 212, 0.25)'
          : 'rgba(255, 255, 255, 0.22)';
    ctx.fillRect(0, y, width, h);
  }
  ctx.restore();
}
