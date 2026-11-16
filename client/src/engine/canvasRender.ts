import type { CanvasDrawItem, SabotageVisualItem } from '@shared/protocol';
import { STAMP_MAP } from '@shared/stamps';

export interface RenderCanvasOptions {
  drawItems: CanvasDrawItem[];
  sabotageItems: SabotageVisualItem[];
  isGlitching: boolean;
  wipersProgress: number | null; // 0..1 when active, null otherwise
  isShielded?: boolean;
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

  // 6. Shield forcefield overlay
  if (opts.isShielded) {
    drawShieldOverlay(ctx, width, height);
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
  const isRainbow = item.color.toLowerCase() === '#rainbow' || item.color.toLowerCase() === 'rainbow';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lineWidth = Math.max(2, item.widthNorm * height);
  ctx.lineWidth = lineWidth;

  if (isRainbow) {
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#06b6d4';
  } else {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
  }

  if (item.points.length === 1) {
    const p = item.points[0];
    ctx.beginPath();
    ctx.fillStyle = isRainbow ? '#06b6d4' : item.color;
    ctx.arc(p.x * width, p.y * height, lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (isRainbow) {
    for (let i = 0; i < item.points.length - 1; i++) {
      const p1 = item.points[i];
      const p2 = item.points[i + 1];
      ctx.beginPath();
      ctx.strokeStyle = `hsl(${(i * 18) % 360}, 100%, 50%)`;
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }
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
    // 1. Sauce splatters & droplets (outer background layer)
    ctx.fillStyle = '#b91c1c';
    const droplets = [
      { x: -unit * 1.15, y: -unit * 0.5, r: unit * 0.14 },
      { x: unit * 1.1, y: -unit * 0.65, r: unit * 0.12 },
      { x: -unit * 1.25, y: unit * 0.45, r: unit * 0.15 },
      { x: unit * 1.2, y: unit * 0.55, r: unit * 0.18 },
      { x: -unit * 0.45, y: -unit * 1.05, r: unit * 0.13 },
      { x: unit * 0.5, y: -unit * 0.95, r: unit * 0.14 },
      { x: -unit * 0.8, y: unit * 1.05, r: unit * 0.1 },
      { x: unit * 0.85, y: unit * 1.0, r: unit * 0.12 },
    ];
    for (const d of droplets) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dripping sauce trails downwards
    ctx.beginPath();
    ctx.moveTo(-unit * 0.45, unit * 0.4);
    ctx.quadraticCurveTo(-unit * 0.55, unit * 0.95, -unit * 0.38, unit * 1.2);
    ctx.arc(-unit * 0.38, unit * 1.25, unit * 0.12, 0, Math.PI * 2);
    ctx.quadraticCurveTo(-unit * 0.25, unit * 0.85, -unit * 0.15, unit * 0.5);

    ctx.moveTo(unit * 0.25, unit * 0.4);
    ctx.quadraticCurveTo(unit * 0.45, unit * 0.85, unit * 0.4, unit * 1.1);
    ctx.arc(unit * 0.4, unit * 1.15, unit * 0.1, 0, Math.PI * 2);
    ctx.quadraticCurveTo(unit * 0.25, unit * 0.8, unit * 0.1, unit * 0.5);
    ctx.fill();

    // 2. Main Plump Tomato Body with radial gradient
    const bw = unit * 0.82;
    const bh = unit * 0.68;
    const bodyGrad = ctx.createRadialGradient(
      -bw * 0.25,
      -bh * 0.25,
      unit * 0.08,
      0,
      bh * 0.1,
      unit * 0.95,
    );
    bodyGrad.addColorStop(0, '#f43f5e'); // bright ripe red highlight
    bodyGrad.addColorStop(0.5, '#dc2626'); // juicy tomato red
    bodyGrad.addColorStop(1, '#991b1b'); // deep shadow rim

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -bh * 0.7);
    ctx.bezierCurveTo(bw * 0.55, -bh * 1.05, bw * 1.05, -bh * 0.2, bw * 0.95, bh * 0.45);
    ctx.bezierCurveTo(bw * 0.85, bh * 0.95, bw * 0.3, bh * 1.05, 0, bh * 0.92);
    ctx.bezierCurveTo(-bw * 0.3, bh * 1.05, -bw * 0.85, bh * 0.95, -bw * 0.95, bh * 0.45);
    ctx.bezierCurveTo(-bw * 1.05, -bh * 0.2, -bw * 0.55, -bh * 1.05, 0, -bh * 0.7);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = Math.max(1.5, unit * 0.04);
    ctx.stroke();

    // 3. Glossy Specular Highlight (3D fruit reflection)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.beginPath();
    ctx.ellipse(
      -bw * 0.38,
      -bh * 0.35,
      bw * 0.26,
      bh * 0.18,
      -Math.PI / 5,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(-bw * 0.16, -bh * 0.45, unit * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // Seeds in the splat edges
    ctx.fillStyle = '#fef08a';
    const seeds = [
      { x: unit * 0.62, y: unit * 0.45, ang: 0.6 },
      { x: -unit * 0.68, y: unit * 0.35, ang: -0.4 },
      { x: unit * 0.28, y: unit * 0.72, ang: 1.2 },
    ];
    for (const s of seeds) {
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, unit * 0.08, unit * 0.04, s.ang, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Distinct 5-Lobe Organic Green Tomato Calyx & Stem on top
    ctx.fillStyle = '#16a34a';
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = Math.max(1, unit * 0.03);

    const stemCenterX = 0;
    const stemCenterY = -bh * 0.62;
    const sepalAngles = [-1.57, -0.32, 0.95, 2.2, 3.45]; // 5 natural organic sepal directions
    const sepalLengths = [unit * 0.44, unit * 0.38, unit * 0.42, unit * 0.4, unit * 0.46];

    ctx.beginPath();
    for (let s = 0; s < 5; s++) {
      const ang = sepalAngles[s];
      const len = sepalLengths[s];
      const tipX = stemCenterX + Math.cos(ang) * len;
      const tipY = stemCenterY + Math.sin(ang) * (len * 0.7);
      const baseLeftX = stemCenterX + Math.cos(ang - 0.45) * (unit * 0.12);
      const baseLeftY = stemCenterY + Math.sin(ang - 0.45) * (unit * 0.1);
      const baseRightX = stemCenterX + Math.cos(ang + 0.45) * (unit * 0.12);
      const baseRightY = stemCenterY + Math.sin(ang + 0.45) * (unit * 0.1);

      if (s === 0) ctx.moveTo(baseLeftX, baseLeftY);
      else ctx.lineTo(baseLeftX, baseLeftY);
      ctx.quadraticCurveTo(
        stemCenterX + Math.cos(ang - 0.15) * (len * 0.6),
        stemCenterY + Math.sin(ang - 0.15) * (len * 0.5),
        tipX,
        tipY,
      );
      ctx.quadraticCurveTo(
        stemCenterX + Math.cos(ang + 0.15) * (len * 0.6),
        stemCenterY + Math.sin(ang + 0.15) * (len * 0.5),
        baseRightX,
        baseRightY,
      );
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Leaf vein accents
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = Math.max(1, unit * 0.02);
    for (let s = 0; s < 5; s++) {
      const ang = sepalAngles[s];
      const len = sepalLengths[s] * 0.72;
      ctx.beginPath();
      ctx.moveTo(stemCenterX, stemCenterY);
      ctx.lineTo(stemCenterX + Math.cos(ang) * len, stemCenterY + Math.sin(ang) * (len * 0.65));
      ctx.stroke();
    }

    // Little central green stalk (pedicel) curving up
    ctx.fillStyle = '#15803d';
    ctx.strokeStyle = '#14532d';
    ctx.lineWidth = Math.max(1, unit * 0.025);
    ctx.beginPath();
    ctx.moveTo(stemCenterX - unit * 0.05, stemCenterY);
    ctx.quadraticCurveTo(
      stemCenterX - unit * 0.08,
      stemCenterY - unit * 0.22,
      stemCenterX + unit * 0.02,
      stemCenterY - unit * 0.32,
    );
    ctx.lineTo(stemCenterX + unit * 0.07, stemCenterY - unit * 0.3);
    ctx.quadraticCurveTo(
      stemCenterX + unit * 0.01,
      stemCenterY - unit * 0.2,
      stemCenterX + unit * 0.05,
      stemCenterY,
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
    // Sharp shattered glass fracture system (sharp angular zig-zag fissures, ZERO spiderweb rings)
    const crackRays = [
      // Fissure 1: Upper-Right high velocity fracture
      [
        { x: 0, y: 0 },
        { x: unit * 0.28, y: -unit * 0.35 },
        { x: unit * 0.58, y: -unit * 0.48 },
        { x: unit * 0.92, y: -unit * 0.82 },
        { x: unit * 1.38, y: -unit * 0.95 },
      ],
      // Fissure 2: Lower-Right fracture
      [
        { x: 0, y: 0 },
        { x: unit * 0.38, y: unit * 0.22 },
        { x: unit * 0.72, y: unit * 0.55 },
        { x: unit * 1.15, y: unit * 0.75 },
        { x: unit * 1.52, y: unit * 0.88 },
      ],
      // Fissure 3: Downwards jagged fracture
      [
        { x: 0, y: 0 },
        { x: -unit * 0.12, y: unit * 0.42 },
        { x: -unit * 0.25, y: unit * 0.88 },
        { x: -unit * 0.32, y: unit * 1.48 },
      ],
      // Fissure 4: Left jagged fracture
      [
        { x: 0, y: 0 },
        { x: -unit * 0.45, y: unit * 0.15 },
        { x: -unit * 0.82, y: -unit * 0.08 },
        { x: -unit * 1.35, y: unit * 0.12 },
      ],
      // Fissure 5: Upper-Left fracture
      [
        { x: 0, y: 0 },
        { x: -unit * 0.22, y: -unit * 0.42 },
        { x: -unit * 0.52, y: -unit * 0.78 },
        { x: -unit * 0.75, y: -unit * 1.38 },
      ],
    ];

    // Dendritic secondary branch forks
    const forkFissures = [
      // Fork from Fissure 1
      [
        { x: unit * 0.58, y: -unit * 0.48 },
        { x: unit * 0.85, y: -unit * 0.32 },
        { x: unit * 1.28, y: -unit * 0.22 },
      ],
      // Fork from Fissure 2
      [
        { x: unit * 0.72, y: unit * 0.55 },
        { x: unit * 0.98, y: unit * 0.38 },
        { x: unit * 1.42, y: unit * 0.42 },
      ],
      // Fork from Fissure 4
      [
        { x: -unit * 0.82, y: -unit * 0.08 },
        { x: -unit * 1.12, y: -unit * 0.38 },
        { x: -unit * 1.48, y: -unit * 0.55 },
      ],
      // Fork from Fissure 5
      [
        { x: -unit * 0.52, y: -unit * 0.78 },
        { x: -unit * 0.88, y: -unit * 0.95 },
        { x: -unit * 1.22, y: -unit * 1.15 },
      ],
    ];

    // Sharp acute transverse fracture chords creating wedge shards (NO concentric web rings!)
    const shardChords = [
      [ { x: unit * 0.28, y: -unit * 0.35 }, { x: unit * 0.85, y: -unit * 0.32 } ],
      [ { x: unit * 0.38, y: unit * 0.22 }, { x: unit * 0.98, y: unit * 0.38 } ],
      [ { x: -unit * 0.12, y: unit * 0.42 }, { x: -unit * 0.45, y: unit * 0.15 } ],
      [ { x: -unit * 0.82, y: -unit * 0.08 }, { x: -unit * 0.52, y: -unit * 0.78 } ],
      [ { x: unit * 0.92, y: -unit * 0.82 }, { x: unit * 1.28, y: -unit * 0.22 } ],
    ];

    // 1. Shard refraction fills (translucent icy glass wedge facets)
    ctx.fillStyle = 'rgba(224, 242, 254, 0.2)';
    ctx.beginPath();
    ctx.moveTo(unit * 0.28, -unit * 0.35);
    ctx.lineTo(unit * 0.58, -unit * 0.48);
    ctx.lineTo(unit * 0.85, -unit * 0.32);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-unit * 0.45, unit * 0.15);
    ctx.lineTo(-unit * 0.22, -unit * 0.42);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(186, 230, 253, 0.15)';
    ctx.beginPath();
    ctx.moveTo(unit * 0.38, unit * 0.22);
    ctx.lineTo(unit * 0.72, unit * 0.55);
    ctx.lineTo(unit * 0.98, unit * 0.38);
    ctx.closePath();
    ctx.fill();

    const drawPathList = (paths: Array<Array<{ x: number; y: number }>>) => {
      for (const p of paths) {
        ctx.beginPath();
        for (let i = 0; i < p.length; i++) {
          if (i === 0) ctx.moveTo(p[i].x, p[i].y);
          else ctx.lineTo(p[i].x, p[i].y);
        }
        ctx.stroke();
      }
    };

    // 2. Dark refraction line layer (deep shadow under fractures)
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.lineWidth = Math.max(3, height * 0.006);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    drawPathList(crackRays);
    drawPathList(forkFissures);
    drawPathList(shardChords);

    // 3. Bright sharp white fractured edge layer
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.lineWidth = Math.max(1.5, height * 0.003);
    ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
    ctx.shadowBlur = 2;

    drawPathList(crackRays);
    drawPathList(forkFissures);
    drawPathList(shardChords);
    ctx.shadowBlur = 0;

    // 4. Pulverized impact epicenter: Frosted crushed glass halo FIRST
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    const rimPoints = 11;
    for (let i = 0; i < rimPoints; i++) {
      const a = (i * Math.PI * 2) / rimPoints;
      const r = unit * (0.16 + (i % 3) * 0.06);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Radiating high-speed micro-spall fractures
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, height * 0.0025);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8 + 0.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * unit * 0.07, Math.sin(a) * unit * 0.07);
      ctx.lineTo(Math.cos(a) * unit * 0.28, Math.sin(a) * unit * 0.28);
      ctx.stroke();
    }

    // Epicenter impact puncture hole SECOND (sharp dark hole in center of white crater)
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    const corePoints = 7;
    for (let i = 0; i < corePoints; i++) {
      const a = (i * Math.PI * 2) / corePoints;
      const r = unit * (0.07 + (i % 2) * 0.03);
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
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
  } else if (sab.type === 'ink_splat') {
    // Jet black viscous ink splat with droplets and glossy specular
    ctx.fillStyle = '#090d16';
    ctx.beginPath();
    ctx.arc(0, 0, unit * 0.72, 0, Math.PI * 2);
    ctx.fill();

    const lobes = [
      { x: unit * 0.7, y: -unit * 0.35, r: unit * 0.3 },
      { x: -unit * 0.65, y: -unit * 0.45, r: unit * 0.34 },
      { x: unit * 0.45, y: unit * 0.72, r: unit * 0.36 },
      { x: -unit * 0.52, y: unit * 0.62, r: unit * 0.3 },
      { x: 0, y: unit * 0.96, r: unit * 0.25 },
      { x: -unit * 0.92, y: 0, r: unit * 0.24 },
      { x: unit * 0.88, y: unit * 0.18, r: unit * 0.28 },
      { x: unit * 1.15, y: -unit * 0.6, r: unit * 0.12 },
      { x: -unit * 1.2, y: unit * 0.4, r: unit * 0.14 },
    ];
    for (const d of lobes) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Glossy oily highlights
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.ellipse(-unit * 0.22, -unit * 0.22, unit * 0.22, unit * 0.1, -Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(unit * 0.25, unit * 0.25, unit * 0.08, 0, Math.PI * 2);
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

function drawShieldOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.save();
  // Glowing cyan protective forcefield border
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = Math.max(4, height * 0.012);
  ctx.shadowColor = '#06b6d4';
  ctx.shadowBlur = 14;
  ctx.strokeRect(6, 6, width - 12, height - 12);

  // Corner tech brackets
  const bracketLen = Math.max(30, width * 0.05);
  ctx.lineWidth = Math.max(6, height * 0.018);
  ctx.strokeStyle = '#38bdf8';
  // Top-left
  ctx.beginPath();
  ctx.moveTo(12, 12 + bracketLen);
  ctx.lineTo(12, 12);
  ctx.lineTo(12 + bracketLen, 12);
  ctx.stroke();
  // Top-right
  ctx.beginPath();
  ctx.moveTo(width - 12 - bracketLen, 12);
  ctx.lineTo(width - 12, 12);
  ctx.lineTo(width - 12, 12 + bracketLen);
  ctx.stroke();
  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(12, height - 12 - bracketLen);
  ctx.lineTo(12, height - 12);
  ctx.lineTo(12 + bracketLen, height - 12);
  ctx.stroke();
  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(width - 12 - bracketLen, height - 12);
  ctx.lineTo(width - 12, height - 12);
  ctx.lineTo(width - 12, height - 12 - bracketLen);
  ctx.stroke();

  // Subtle forcefield tint
  ctx.fillStyle = 'rgba(6, 182, 212, 0.06)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
