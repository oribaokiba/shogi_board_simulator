// 効果音。
//
//   clack … 高く上げて指す、通常の駒音（ﾊﾞﾁｯ）
//   slide … 盤の上をすべらせながら指す音（ｶﾁｶﾁ）
//   place … 取った駒を駒台に置く音
//   spill … 駒箱から盤へ駒をぶちまける音
//
// 同じ音の繰り返しに聞こえないよう、鳴らすたびに候補から選び、
// 再生速度をわずかに散らす。slide と place は 1 本しかないので、
// 散らすのは再生速度だけになる。

const FILES = {
  clack: ["audio/clack1.wav", "audio/clack2.wav"],
  slide: ["audio/slide.wav"],
  place: ["audio/place.wav"],
  spill: ["audio/spill1.wav", "audio/spill2.wav"],
};

let ctx = null;
let master = null;
const raw = {};    // 種類 → ArrayBuffer[]（同梱の音）
const custom = {}; // 種類 → ArrayBuffer[]（使う人が差し替えた音。あればこちらが優先）
const buf = {};    // 種類 → AudioBuffer[]（鳴らすもの）

// AudioContext は最初の操作までは作れないが、読み込みだけは先に始めておく
const loading = Promise.all(
  Object.entries(FILES).map(async ([kind, list]) => {
    raw[kind] = await Promise.all(list.map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.arrayBuffer();
    }));
  })
).catch((e) => { console.warn("効果音を読み込めませんでした:", e); });

export function initAudio() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // 一度に何枚も鳴っても潰れないよう、出口で軽く圧縮する
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 3.5;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  comp.connect(ctx.destination);

  master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(comp);

  loading.then(async () => {
    for (const kind of Object.keys(FILES)) await decodeKind(kind);
  }).catch((e) => { console.warn("効果音を復号できませんでした:", e); });

  return ctx;
}

/** その種類の音を鳴らせる形にする。差し替えた音があればそちらを使う。 */
async function decodeKind(kind) {
  if (!ctx) return;
  const src = custom[kind] || raw[kind];
  if (!src || !src.length) { delete buf[kind]; return; }
  // decodeAudioData は元の ArrayBuffer を空にするので複製を渡す
  buf[kind] = await Promise.all(src.map((ab) => ctx.decodeAudioData(ab.slice(0))));
}

/**
 * 効果音を差し替える。`list` は wav などの ArrayBuffer の配列で、
 * null か空を渡すと同梱の音に戻る。
 *
 * **`FILES` は触らない。** 同梱の音は公開用と個人用で本数が違うので、
 * そこを書き換えると版どうしの差が広がる。差し替えは別に持って上書きするだけにする。
 *
 * 読めない音を渡されたら false（呼んだ側が知らせる）。**そのとき元の音は壊さない。**
 */
export async function setSound(kind, list) {
  if (!FILES[kind]) return false;
  const before = custom[kind];
  if (!list || !list.length) delete custom[kind];
  else custom[kind] = list;
  try {
    await decodeKind(kind);
    return true;
  } catch (e) {
    console.warn(`効果音（${kind}）を復号できませんでした:`, e);
    if (before) custom[kind] = before; else delete custom[kind];
    await decodeKind(kind).catch(() => {});
    return false;
  }
}

/** その種類が差し替えられているか。 */
export function isCustomSound(kind) { return !!custom[kind]; }

export function resumeAudio() {
  if (ctx && ctx.state === "suspended") ctx.resume();
}

export function setMasterVolume(v) {
  if (master) master.gain.value = v;
}

function play(kind, gain = 1, rate = 1) {
  const list = buf[kind];
  if (!ctx || !list || !list.length) return;

  const src = ctx.createBufferSource();
  src.buffer = list[(Math.random() * list.length) | 0];
  src.playbackRate.value = rate * (1 + (Math.random() * 0.06 - 0.03));

  const g = ctx.createGain();
  g.gain.value = gain;

  src.connect(g);
  g.connect(master);
  src.start();
}

const clamp01 = (v) => Math.max(0.05, Math.min(1, v));

/**
 * 盤に指す音。strength は当たりの強さ 0..1。
 * pitch は再生速度の倍率。高く持ち上げて指すほど高い音にするために外から渡す。
 */
export function playClack(strength = 1, pitch = 1) {
  const s = clamp01(strength);
  play("clack", 0.30 + 0.70 * s, pitch * (1 + (1 - s) * 0.04));
}

/** 駒どうしがぶつかる音。乾いた高めの音にする。 */
export function playClick(strength = 1) {
  const s = clamp01(strength);
  play("clack", 0.18 + 0.42 * s, 1.09);
}

/** 盤の上をすべらせて指した音。 */
export function playSlide(strength = 1) {
  play("slide", 0.55 + 0.45 * clamp01(strength));
}

/** 駒台に置く音。 */
export function playPlace(strength = 1) {
  play("place", 0.55 + 0.45 * clamp01(strength));
}

/** 駒箱から盤へぶちまける音。 */
export function playSpill() {
  play("spill", 1.0);
}
