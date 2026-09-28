/** Original, resolution-independent FoxBeat characters. No remote images or fonts. */
export type Animal = 'fox' | 'emojiFox' | 'girl' | 'cat' | 'capybara';
export type Dance = 'sway' | 'step' | 'wave';

export interface RenderOptions {
  animal: Animal;
  dance: Dance;
  /** Radians; one choreography cycle is 2π. */
  phase: number;
  energy: number;
  state: 'idle' | 'dancing' | 'settling' | 'sleeping';
  reducedMotion?: boolean;
  /** A transient affection value from 0 to 1, controlled by the caller. */
  petting?: number;
}

interface Pose {
  x: number;
  y: number;
  body: number;
  head: number;
  headY: number;
  leftArm: number;
  rightArm: number;
  leftLeg: number;
  rightLeg: number;
  leftLift: number;
  rightLift: number;
  tail: number;
  leftEar: number;
  rightEar: number;
  eyes: number;
  breath: number;
  affection: number;
  sleeping: boolean;
  happy: boolean;
}

interface Palette {
  fur: string;
  light: string;
  shade: string;
  ink: string;
  pink: string;
  paw: string;
}

const COLORS: Record<Animal, Palette> = {
  fox: {
    fur: '#F3A35C', light: '#FFF3DC', shade: '#DC8144',
    ink: '#624333', pink: '#EAAD9D', paw: '#79523D',
  },
  cat: {
    fur: '#AAB8CA', light: '#F2F1EC', shade: '#8797B1',
    ink: '#4E5A70', pink: '#DEADB7', paw: '#EFF0EE',
  },
  capybara: {
    fur: '#C5A17E', light: '#E4C5A3', shade: '#AD8967',
    ink: '#644D3F', pink: '#DCAA99', paw: '#A38265',
  },
  emojiFox: {
    fur: '#F6A34F', light: '#FFF1D2', shade: '#D97438',
    ink: '#5A3B32', pink: '#F0A7A2', paw: '#86513B',
  },
  girl: {
    fur: '#473653', light: '#FFF2F5', shade: '#8D5B82',
    ink: '#34283D', pink: '#E9A1B5', paw: '#C983A6',
  },
};

const TAU = Math.PI * 2;
const bounded = (value: number, min = 0, max = 1): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

function getPose(options: RenderOptions): Pose {
  const t = Number.isFinite(options.phase) ? options.phase : 0;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const twice = Math.sin(t * 2);
  const personality = options.animal === 'capybara' ? 0.67 : options.animal === 'cat' ? 0.84 : options.animal === 'girl' ? 1.08 : options.animal === 'emojiFox' ? 1.12 : 1;
  const motion = options.reducedMotion ? 0.2 : 1;
  const strength = bounded(options.energy) * personality * motion;
  const affection = bounded(options.petting ?? 0);
  // A brief blink once per cycle; outside that interval the eyes stay open.
  const cycle = ((t % TAU) + TAU) % TAU;
  const blink = Math.abs(cycle - 5.75) < 0.13 ? 0.13 : 1;
  const pose: Pose = {
    x: 0, y: 0, body: 0, head: 0, headY: 0,
    leftArm: 16, rightArm: -16, leftLeg: 4, rightLeg: -4,
    leftLift: 0, rightLift: 0, tail: 0, leftEar: 0, rightEar: 0,
    eyes: blink, breath: 1, affection,
    sleeping: options.state === 'sleeping',
    happy: affection > 0.1,
  };

  if (pose.sleeping) {
    pose.y = 12;
    pose.headY = 12;
    pose.head = -9;
    pose.leftArm = 29;
    pose.rightArm = -29;
    pose.tail = -9;
    pose.eyes = 0;
    pose.breath = 1 + Math.sin(t) * 0.008 * motion;
    pose.leftEar = -7;
    pose.rightEar = 5;
  } else if (options.state === 'idle') {
    pose.y = Math.sin(t) * 0.9 * motion;
    pose.head = Math.sin(t * 0.5) * 2.2 * motion;
    pose.tail = s * 5 * motion;
    pose.leftEar = Math.max(0, Math.sin(t * 2 - 0.6)) ** 8 * 7 * motion;
    pose.rightEar = -(Math.max(0, Math.sin(t * 2 + 1.1)) ** 8) * 5 * motion;
    pose.breath = 1 + s * 0.005 * motion;
  } else {
    // Settling runs this same choreography with a caller-supplied fading energy.
    pose.tail = Math.sin(t - 0.7) * 12 * strength;
    pose.leftEar = Math.sin(t + 0.7) * 5 * strength;
    pose.rightEar = Math.sin(t - 0.7) * -5 * strength;
    pose.happy = strength > 0.55 && options.dance === 'wave';
    if (options.animal === 'emojiFox') pose.breath = 1 + twice * 0.035 * strength;
    pose.headY = -Math.max(0, Math.sin(t * 2)) * 2 * strength;
    if (options.dance === 'sway') {
      pose.x = s * 7 * strength;
      pose.y = -Math.abs(s) * 2 * strength;
      pose.body = s * 9 * strength;
      pose.head = -s * 12 * strength;
      pose.leftArm = 16 + (33 + s * 25) * strength;
      pose.rightArm = -16 + (-33 + s * 25) * strength;
      pose.leftLeg = 4 - s * 12 * strength;
      pose.rightLeg = -4 - s * 12 * strength;
      pose.leftLift = Math.max(0, s) * 4 * strength;
      pose.rightLift = Math.max(0, -s) * 4 * strength;
    } else if (options.dance === 'step') {
      pose.x = s * 3 * strength;
      pose.y = -Math.abs(c) * 7 * strength;
      pose.body = s * 5 * strength;
      pose.head = -s * 6 * strength;
      pose.leftArm = 16 + (23 + s * 39) * strength;
      pose.rightArm = -16 + (-23 + s * 39) * strength;
      pose.leftLeg = 4 + s * 23 * strength;
      pose.rightLeg = -4 - s * 23 * strength;
      pose.leftLift = Math.max(0, s) * 17 * strength;
      pose.rightLift = Math.max(0, -s) * 17 * strength;
      pose.tail = Math.sin(t + 0.6) * 17 * strength;
    } else {
      pose.y = -Math.max(0, twice) * 8 * strength;
      pose.body = s * 4 * strength;
      pose.head = -s * 8 * strength;
      pose.leftArm = 16 + (101 + Math.sin(t + 0.5) * 25) * strength;
      pose.rightArm = -16 + (-101 + Math.sin(t - 0.5) * 25) * strength;
      pose.leftLeg = 4 + c * 9 * strength;
      pose.rightLeg = -4 - c * 9 * strength;
      pose.leftLift = Math.max(0, twice) * 3 * strength;
      pose.rightLift = Math.max(0, twice) * 3 * strength;
      pose.leftEar += Math.sin(t * 2) * 4 * strength;
      pose.rightEar -= Math.sin(t * 2) * 4 * strength;
    }
  }
  if (affection > 0) {
    pose.head += -8 * affection;
    pose.headY -= 2 * affection;
    pose.eyes = Math.min(pose.eyes, 1 - affection * 0.9);
    pose.tail += Math.sin(t * 3) * 8 * affection * motion;
    if (options.animal === 'girl') {
      pose.leftArm += 36 * affection * motion;
      pose.rightArm -= 36 * affection * motion;
    } else if (options.animal === 'emojiFox') {
      pose.leftEar -= 12 * affection * motion;
      pose.rightEar += 12 * affection * motion;
      pose.y -= Math.sin(affection * Math.PI) * 6 * motion;
    }
  }
  return pose;
}

function rotate(ctx: CanvasRenderingContext2D, degrees: number): void {
  ctx.rotate(degrees * Math.PI / 180);
}

function ellipse(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
  fill: string, stroke?: string, angle = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawPath(ctx: CanvasRenderingContext2D, data: string, fill: string, stroke?: string): void {
  const path = new Path2D(data);
  ctx.fillStyle = fill;
  ctx.fill(path);
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(path); }
}

function line(ctx: CanvasRenderingContext2D, data: string, color: string, width = 2.5): void {
  const oldWidth = ctx.lineWidth;
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke(new Path2D(data));
  ctx.lineWidth = oldWidth;
}

function drawTail(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  ctx.save();
  ctx.translate(31, 4);
  rotate(ctx, pose.tail);
  if (animal === 'fox') {
    const outline = 'M-5 14 C21 30 58 28 77 1 C97-27 82-59 89-83 C52-67 51-44 36-35 C24-26 7-24-5-10 Z';
    drawPath(ctx, outline, p.fur, p.ink);
    ctx.save();
    ctx.clip(new Path2D(outline));
    drawPath(ctx, 'M34-82 L105-102 L109-16 L72-16 L61-28 L55-23 L54-40 L44-37 L47-52 L33-55 Z', p.light);
    ctx.restore();
    line(ctx, 'M10 12 C38 20 58 12 66-4', p.shade, 3);
    ctx.strokeStyle = p.ink;
    ctx.stroke(new Path2D(outline));
  } else if (animal === 'cat') {
    const outline = 'M-2 12 C24 28 55 21 58-7 C60-22 52-30 42-27 C31-24 35-9 39-5 C34 6 15 5 5-4 Z';
    drawPath(ctx, outline, p.fur, p.ink);
    ctx.save();
    ctx.clip(new Path2D(outline));
    line(ctx, 'M33-24 L57-20 M37-7 L61-2 M24 10 L29 26', p.shade, 7);
    ctx.restore();
  } else {
    // Capybaras do not have a visible tail. A little haunch peeks behind the body.
    ellipse(ctx, 5, 22, 14, 19, p.shade, p.ink);
  }
  ctx.restore();
}

function drawLeg(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number,
  lift: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * 23, 31 - lift);
  rotate(ctx, angle);
  drawPath(ctx, 'M-12-4 C-14 6-12 15-12 24 C-6 33 10 33 14 24 L13 2 Z', p.fur, p.ink);
  ellipse(ctx, side * 2, 24, 18, 10, p.paw, p.ink);
  const toes = animal === 'fox' ? '#AC8060' : p.shade;
  line(ctx, 'M-5 25 L-5 29 M2 26 L2 30', toes, 1.5);
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, animal: Animal, p: Palette): void {
  if (animal === 'capybara') {
    drawPath(ctx, 'M-32-34 C-53-14-50 29-32 43 C-16 55 23 53 38 35 C51 17 46-20 28-35 Z', p.fur, p.ink);
    ellipse(ctx, 0, 13, 27, 31, p.light);
    line(ctx, 'M-7 30 Q0 34 7 30', p.shade, 2);
  } else {
    drawPath(ctx, 'M-27-37 C-41-29-46-4-43 21 C-42 44-24 50 0 49 C29 50 45 40 44 16 C44-10 37-32 24-38 Z', p.fur, p.ink);
    if (animal === 'fox') {
      drawPath(ctx, 'M-26-30 C-35-14-27-1-27 10 L-17 6 L-14 19 L-5 14 L0 25 L8 14 L16 19 L19 6 L28 9 C30-8 29-24 23-31 Z', p.light);
      ellipse(ctx, 0, 28, 18, 14, p.light);
    } else {
      ellipse(ctx, 0, 10, 28, 34, p.light);
      line(ctx, 'M-41-5 L-30 0 M-43 8 L-31 12 M40-5 L30 0 M43 8 L32 12', p.shade, 4);
    }
  }
}

function drawArm(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * 34, -16);
  rotate(ctx, angle);
  drawPath(ctx, 'M-10-2 C-15 6-15 21-12 32 C-9 43 10 43 13 32 C16 19 14 8 10-2 Z', p.fur, p.ink);
  ellipse(ctx, 0, 33, 13, 12, p.paw, p.ink);
  const toes = animal === 'fox' ? '#B48B6B' : p.shade;
  line(ctx, 'M-4 35 L-4 39 M3 35 L3 39', toes, 1.5);
  ctx.restore();
}

function drawEar(
  ctx: CanvasRenderingContext2D, animal: Animal, side: number, angle: number, p: Palette,
): void {
  ctx.save();
  ctx.translate(side * (animal === 'capybara' ? 43 : 38), animal === 'capybara' ? -31 : -33);
  rotate(ctx, angle);
  if (animal === 'fox') {
    ctx.scale(side, 1);
    drawPath(ctx, 'M-21 12 C-24-8-9-39 7-52 C16-39 25-10 20 12 Z', p.fur, p.ink);
    drawPath(ctx, 'M-10 4 C-9-10-1-28 7-36 C13-25 17-9 12 4 Z', p.pink);
    drawPath(ctx, 'M0-40 L7-52 C12-45 16-37 17-30 L9-31 Z', p.paw);
  } else if (animal === 'cat') {
    ctx.scale(side, 1);
    drawPath(ctx, 'M-20 12 C-24-5-17-30-5-39 C11-34 23-11 23 11 Z', p.fur, p.ink);
    drawPath(ctx, 'M-11 5 C-14-6-10-20-5-25 C5-20 13-8 14 4 Z', p.pink);
  } else {
    ellipse(ctx, 0, -2, 15, 18, p.fur, p.ink, side * 0.2);
    ellipse(ctx, 0, -3, 7, 10, p.shade, undefined, side * 0.2);
  }
  ctx.restore();
}

function drawEyes(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  const spread = animal === 'capybara' ? 32 : 25;
  const y = animal === 'capybara' ? -2 : 2;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * spread, y);
    if (pose.eyes < 0.3) {
      const curve = pose.happy ? 'M-7 3 Q0-5 7 3' : 'M-7 0 Q0 6 7 0';
      line(ctx, curve, p.ink, 3);
    } else if (animal === 'capybara') {
      ellipse(ctx, 0, 1, 4.5, 5.1 * pose.eyes, p.ink);
      ellipse(ctx, -1.2, -0.8, 1.1, 1.3, '#FFFFFF');
      line(ctx, 'M-6-6 Q0-8 5-6', p.shade, 2);
    } else {
      ellipse(ctx, 0, 0, 5.8, 8 * pose.eyes, p.ink);
      ellipse(ctx, -1.8, -3.1, 1.8, 2.2, '#FFFDF5');
      ellipse(ctx, 2, 3.8, 0.9, 1.1, '#FFFDF5');
    }
    ctx.restore();
  }
}

function drawFace(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  if (animal === 'fox') {
    const face = 'M-59-22 C-63-43-34-54 0-50 C32-54 61-39 59-20 L68 0 L59 3 L65 13 L52 13 C40 35 13 49 0 47 C-22 48-42 33-53 18 L-66 17 L-59 7 L-69 5 Z';
    drawPath(ctx, face, p.fur, p.ink);
    // Two cream cheek patches converge in a fox's narrow muzzle.
    drawPath(ctx, 'M-57-8 C-37-12-25-2-12 12 Q0 24 12 12 C27-3 39-12 58-8 C62 5 47 29 30 35 Q0 57-29 36 C-45 28-61 8-57-8 Z', p.light);
    drawPath(ctx, 'M-17-46 Q-10-39-7-29 Q-2-36 0-42 Q3-32 8-28 Q11-40 18-45', p.shade);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    drawPath(ctx, 'M-6 18 Q0 15 6 18 Q6 22 0 25 Q-6 22-6 18', p.ink);
    line(ctx, 'M0 25 L0 29 M-9 28 Q-5 35 0 29 Q5 35 9 28', p.ink, 2.3);
  } else if (animal === 'cat') {
    drawPath(ctx, 'M-57-27 C-43-46-21-49 0-47 C29-49 53-36 59-17 C66 7 58 33 38 41 C16 52-19 50-39 41 C-61 32-66 1-57-27 Z', p.fur, p.ink);
    drawPath(ctx, 'M-39 16 C-25 3-13 7 0 14 C15 6 31 5 42 20 C36 39 14 45 0 44 C-16 45-33 34-39 16 Z', p.light);
    line(ctx, 'M-15-43 L-12-29 M0-46 L0-28 M15-42 L12-29', p.shade, 5);
    ellipse(ctx, -43, 15, 10, 5.5, p.pink);
    ellipse(ctx, 43, 15, 10, 5.5, p.pink);
    drawEyes(ctx, animal, pose, p);
    drawPath(ctx, 'M-6 18 Q0 14 6 18 Q3 24 0 24 Q-3 24-6 18', '#BA8B91');
    line(ctx, 'M0 24 L0 29 M-10 27 Q-6 35 0 29 Q6 35 10 27', p.ink, 2.2);
    line(ctx, 'M-43 23 L-66 19 M-42 29 L-64 31 M43 23 L66 19 M42 29 L64 31', p.ink, 1.6);
  } else {
    drawPath(ctx, 'M-60-23 C-48-41-21-42 0-40 C24-41 50-37 59-18 C68-6 71 16 61 31 C51 46 29 49 0 48 C-28 49-53 44-62 30 C-73 14-69-10-60-23 Z', p.fur, p.ink);
    // Capybara's broad, blunt muzzle and separated nostrils give it its silhouette.
    drawPath(ctx, 'M-43 10 C-32-3 31-4 45 11 C53 20 45 39 29 42 C9 47-18 45-34 39 C-47 34-52 19-43 10 Z', p.light);
    ellipse(ctx, -48, 15, 9, 5, p.pink);
    ellipse(ctx, 48, 15, 9, 5, p.pink);
    drawEyes(ctx, animal, pose, p);
    ellipse(ctx, -11, 17, 3.4, 2.8, p.ink, undefined, -0.4);
    ellipse(ctx, 11, 17, 3.4, 2.8, p.ink, undefined, 0.4);
    line(ctx, 'M0 23 L0 28 M-9 28 Q0 33 9 28', p.ink, 2.4);
    line(ctx, 'M-15-32 Q-8-36-3-32 M4-32 Q10-35 15-31', p.shade, 2);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, animal: Animal, pose: Pose, p: Palette): void {
  ctx.save();
  ctx.translate(0, (animal === 'capybara' ? -70 : -77) + pose.headY);
  rotate(ctx, pose.head);
  drawEar(ctx, animal, -1, pose.leftEar, p);
  drawEar(ctx, animal, 1, pose.rightEar, p);
  drawFace(ctx, animal, pose, p);
  ctx.restore();
}

/** An original chibi companion inspired by the reference's braid and violet palette. */
function drawGirl(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette): void {
  const skin = '#FFE5D9';
  ctx.save();
  rotate(ctx, pose.tail * 0.22);
  drawPath(ctx, 'M-54-118 C-70-161-29-179 4-174 C62-178 78-133 65-93 L70 24 Q43 38 21 17 L-39 27 Q-73 35-67 3 Z', p.fur, p.ink);
  line(ctx, 'M-48-97 Q-62-36-49 13 M51-102 Q65-42 54 16', '#65506F', 4);
  ctx.restore();
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 16, 32 - (side < 0 ? pose.leftLift : pose.rightLift) * 0.6);
    rotate(ctx, (side < 0 ? pose.leftLeg : pose.rightLeg) * 0.7);
    drawPath(ctx, 'M-7 0 L8 0 L7 28 Q0 33-7 28 Z', skin, p.ink);
    drawPath(ctx, 'M-7 18 L7 18 L7 33 L-7 33 Z', '#FFF4F3', p.ink);
    ellipse(ctx, side * 3, 34, 12, 7, '#674566', p.ink);
    ellipse(ctx, side * 4, 32, 5, 2, '#CEA0BC');
    ctx.restore();
  }
  drawPath(ctx, 'M-19-52 Q0-43 19-52 L29-16 L23 12 L-24 12 L-29-16 Z', '#FFF6EF', p.ink);
  ctx.save(); rotate(ctx, pose.tail * 0.18);
  drawPath(ctx, 'M-23-12 Q0-5 23-12 L42 39 Q0 57-42 39 Z', '#C17FAD', p.ink);
  line(ctx, 'M-18-3 L-27 38 M0 0 L0 45 M18-3 L27 38', '#9B6494', 2);
  drawPath(ctx, 'M-43 38 Q0 53 43 38 L41 44 Q0 59-41 44 Z', '#FFF1F1', p.ink);
  ctx.restore();
  drawPath(ctx, 'M-18-46 L0-30 L18-46 L11-50 L0-41 L-11-50 Z', '#E7B8CE', p.ink);
  drawPath(ctx, 'M0-32 L-13-39 L-12-25 Z M0-32 L13-39 L12-25 Z', '#A15D96', p.ink);
  ellipse(ctx, 0, -32, 3, 4, '#F2BDD7');
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 26, -37);
    rotate(ctx, (side < 0 ? pose.leftArm : pose.rightArm) * 0.85);
    drawPath(ctx, 'M-9-3 Q-15 6-9 18 L9 18 Q15 6 9-3 Z', '#FFF6EF', p.ink);
    drawPath(ctx, 'M-7 16 L7 16 L7 34 Q0 41-7 34 Z', skin, p.ink);
    ellipse(ctx, 0, 35, 8, 8, skin, p.ink);
    line(ctx, 'M-2 34 L-2 38 M2 34 L2 38', '#D79C96', 1);
    ctx.restore();
  }
  ctx.save();
  ctx.translate(0, -94 + pose.headY);
  rotate(ctx, pose.head);
  drawPath(ctx, 'M-56-7 C-70-64-23-76 9-70 C56-70 72-39 61 8 L52 38 L-54 36 Z', p.fur, p.ink);
  ellipse(ctx, -48, 9, 8, 13, skin, p.ink);
  ellipse(ctx, 48, 9, 8, 13, skin, p.ink);
  drawPath(ctx, 'M-48-29 Q0-55 48-29 L47 11 Q42 44 0 53 Q-42 44-47 11 Z', skin, p.ink);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 23, 9);
    if (pose.eyes < 0.3) {
      line(ctx, pose.happy ? 'M-11 2 Q0-9 11 2' : 'M-11 0 Q0 7 11 0', p.ink, 3);
    } else {
      ellipse(ctx, 0, 0, 11.5, 14 * pose.eyes, '#FFFFFF', p.ink);
      ellipse(ctx, 1, 1, 8.5, 12 * pose.eyes, '#875DA4');
      ellipse(ctx, 1, 4, 6, 7 * pose.eyes, '#C489BC');
      ellipse(ctx, 1, 1, 3.8, 8 * pose.eyes, '#422A56');
      ellipse(ctx, -3, -6, 3.8, 4.2, '#FFFFFF');
      ellipse(ctx, 5, 5, 1.9, 2.1, '#FFF3FC');
      line(ctx, 'M-12-7 Q0-16 11-8', p.ink, 3.5);
      line(ctx, side < 0 ? 'M-11-7 L-16-11' : 'M11-7 L16-11', p.ink, 2);
    }
    ctx.restore();
  }
  ctx.save(); ctx.globalAlpha *= 0.45 + pose.affection * 0.5;
  ellipse(ctx, -34, 28, 10, 4.5, p.pink);
  ellipse(ctx, 34, 28, 10, 4.5, p.pink); ctx.restore();
  if (pose.happy) drawPath(ctx, 'M-7 32 Q0 36 7 32 Q5 44 0 44 Q-5 44-7 32', '#C56B8B', p.ink);
  else line(ctx, 'M-5 35 Q0 39 5 35', '#AB6D7E', 2);
  // Uneven bangs, side locks and a loose braid move as independent pieces.
  drawPath(ctx, 'M-52-34 Q-39-65 5-61 Q42-64 55-28 L50 8 L36-4 L30-34 L24-6 L11-18 L4-39 L-3-13 L-17-21 L-27-42 L-30-9 L-44 1 Z', p.fur, p.ink);
  drawPath(ctx, 'M-53-20 Q-62 22-44 45 Q-54 19-43-7 Z M53-21 Q65 24 46 44 Q55 16 44-8 Z', p.fur, p.ink);
  line(ctx, 'M-37-45 Q-34-52-29-55 M-22-58 L-15-61 M4-60 L10-56 M30-53 L35-47', '#8D779D', 4);
  ctx.save(); ctx.translate(52, -8); rotate(ctx, pose.tail * 0.55);
  for (let i = 0; i < 6; i++) {
    ellipse(ctx, i % 2 ? 3 : -1, i * 12, 8, 10, i % 2 ? '#594163' : '#6D5078', p.ink, i % 2 ? -0.5 : 0.5);
  }
  drawPath(ctx, 'M0 66 L-13 60 L-11 76 Z M0 66 L13 60 L11 76 Z', '#DDA5CC', p.ink);
  ellipse(ctx, 0, 67, 3.5, 4, '#F6D4E9'); ctx.restore();
  drawPath(ctx, 'M-43-30 L-51-40 L-40-37 L-36-47 L-32-36 L-20-36 L-30-29 L-27-19 L-37-25 L-46-19 Z', '#ECC9A0', '#B99576');
  ctx.restore();
}

/** Bold emoji-like silhouette with oversized ears and a tiny elastic body. */
function drawEmojiFox(ctx: CanvasRenderingContext2D, pose: Pose, p: Palette): void {
  ctx.save(); ctx.translate(-7, 1); ctx.scale(0.8, 0.8);
  drawTail(ctx, 'fox', { ...pose, tail: pose.tail * 1.35 }, p); ctx.restore();
  ellipse(ctx, 0, 20, 33, 34, p.fur, p.ink);
  ellipse(ctx, 0, 25, 22, 24, p.light);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 18, 51 - (side < 0 ? pose.leftLift : pose.rightLift) * 0.45);
    rotate(ctx, (side < 0 ? pose.leftLeg : pose.rightLeg) * 0.8);
    ellipse(ctx, 0, 0, 15, 8, p.paw, p.ink); ctx.restore();
    ctx.save(); ctx.translate(side * 29, 3);
    rotate(ctx, (side < 0 ? pose.leftArm : pose.rightArm));
    ellipse(ctx, 0, 16, 10, 20, p.fur, p.ink);
    ellipse(ctx, 0, 31, 10, 9, p.paw, p.ink); ctx.restore();
  }
  ctx.save(); ctx.translate(0, -69 + pose.headY); rotate(ctx, pose.head);
  for (const side of [-1, 1]) {
    ctx.save(); ctx.translate(side * 39, -32); ctx.scale(side, 1);
    rotate(ctx, side < 0 ? pose.leftEar : pose.rightEar);
    drawPath(ctx, 'M-19 18 L-11-49 Q-9-58-2-48 L30 7 Z', p.fur, p.ink);
    drawPath(ctx, 'M-10 7 L-7-35 L15 3 Z', '#6D4141');
    drawPath(ctx, 'M-7 0 L-5-24 L9 0 Z', p.pink); ctx.restore();
  }
  drawPath(ctx, 'M-63-35 Q0-56 63-35 L71 0 L64-4 L72 13 L58 13 Q31 56 0 62 Q-31 56-58 13 L-72 13 L-64-4 L-71 0 Z', p.fur, p.ink);
  drawPath(ctx, 'M-63 3 Q-40-4-16 22 Q0 38 16 22 Q40-4 63 3 Q39 46 0 58 Q-39 46-63 3 Z', p.light);
  for (const side of [-1, 1]) {
    if (pose.eyes < 0.3) line(ctx, `M${side*27-7} 4 Q${side*27} ${pose.happy?-3:11} ${side*27+7} 4`, p.ink, 3.4);
    else {
      ellipse(ctx, side * 27, 3, 6, 8 * pose.eyes, '#342D2E');
      ellipse(ctx, side * 27 - 2, 0, 2, 2.5, '#FFFFFF');
    }
  }
  ellipse(ctx, -46, 19, 9, 4.5, p.pink); ellipse(ctx, 46, 19, 9, 4.5, p.pink);
  drawPath(ctx, 'M-9 29 Q0 25 9 29 Q7 37 0 38 Q-7 37-9 29', '#342D2E');
  if (pose.happy) drawPath(ctx, 'M-9 41 Q0 46 9 41 Q7 54 0 54 Q-7 54-9 41 Z', '#D57C89', p.ink);
  else line(ctx, 'M0 38 L0 43 M-10 41 Q-5 48 0 43 Q5 48 10 41', p.ink, 2);
  ctx.restore();
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  drawPath(ctx, 'M0 0 C-14-9-12-22-4-22 Q0-22 3-17 Q6-22 10-22 C19-22 21-9 3 2 Z', '#EBA7AB');
  ctx.restore();
}

function drawAffection(ctx: CanvasRenderingContext2D, amount: number, reduced: boolean): void {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalAlpha *= amount;
  const drift = reduced ? 0 : (1 - amount) * 23;
  heart(ctx, 82, 103 - drift, 0.58);
  heart(ctx, 237, 78 - drift, 0.76);
  ellipse(ctx, 250, 112 - drift, 2.5, 2.5, '#ECC78C');
  ellipse(ctx, 68, 87 - drift, 2, 2, '#ECC78C');
  ctx.restore();
}

function drawSleepBubble(ctx: CanvasRenderingContext2D, phase: number, reduced: boolean): void {
  ctx.save();
  const float = reduced ? 0 : Math.sin(phase) * 2;
  ctx.globalAlpha *= 0.72;
  ellipse(ctx, 225, 124 + float, 4, 4, '#F8EFE4', '#B49E87');
  ellipse(ctx, 237, 112 + float, 6, 6, '#F8EFE4', '#B49E87');
  ellipse(ctx, 254, 92 + float, 15, 13, '#FFF7EA', '#B49E87');
  // A tiny sleeping crescent, drawn geometrically instead of depending on a font.
  drawPath(ctx, 'M257 83 C244 82 243 99 257 102 C248 101 249 87 257 83 Z', '#D1B581');
  ctx.restore();
}

/**
 * Draw into a transparent canvas. The caller owns clearing, DPR, and the clock.
 * Every local transform is restored, including when the destination is empty.
 */
export function renderPet(
  ctx: CanvasRenderingContext2D, width: number, height: number, options: RenderOptions,
): void {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width + height)) return;
  const animal = Object.prototype.hasOwnProperty.call(COLORS, options.animal) ? options.animal : 'fox';
  const p = COLORS[animal];
  const pose = getPose({ ...options, animal });
  ctx.save();
  const scale = Math.min(width, height) / 320;
  ctx.translate((width - 320 * scale) / 2, (height - 320 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;

  // The only scenery is a soft, translucent grounding shadow.
  ellipse(ctx, 160, 284, 50, 7, 'rgba(104, 83, 64, 0.085)');
  ellipse(ctx, 160, 284, 36, 4, 'rgba(104, 83, 64, 0.045)');
  ctx.save();
  ctx.translate(151 + pose.x, 215 + pose.y);
  rotate(ctx, pose.body);
  ctx.scale(1, pose.breath);
  if (animal === 'girl') drawGirl(ctx, pose, p);
  else if (animal === 'emojiFox') drawEmojiFox(ctx, pose, p);
  else {
    drawTail(ctx, animal, pose, p);
    drawLeg(ctx, animal, -1, pose.leftLeg, pose.leftLift, p);
    drawLeg(ctx, animal, 1, pose.rightLeg, pose.rightLift, p);
    drawBody(ctx, animal, p);
    drawArm(ctx, animal, -1, pose.leftArm, p);
    drawArm(ctx, animal, 1, pose.rightArm, p);
    drawHead(ctx, animal, pose, p);
  }
  ctx.restore();

  if (pose.sleeping) drawSleepBubble(ctx, Number.isFinite(options.phase) ? options.phase : 0, !!options.reducedMotion);
  drawAffection(ctx, pose.affection, !!options.reducedMotion);
  ctx.restore();
}
