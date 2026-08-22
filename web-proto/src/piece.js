// 駒の定義・ジオメトリ・テクスチャ。単位は cm（実寸に合わせてある）。
//
// 見た目は五角柱＋先細りの楔形。衝突形状はこれを使わず単なる箱にする
// （薄い多角形どうしの接触は暴れやすく、駒が増えると破綻するため）。

import * as THREE from "three";

// 駒は種類ごとに大きさが違う。実物の駒尺に近い値。
export const SIZES = {
  L: { w: 3.00, l: 3.20, t: 0.90 }, // 王将・玉将
  A: { w: 2.78, l: 3.05, t: 0.86 }, // 飛車・角行
  B: { w: 2.62, l: 2.92, t: 0.82 }, // 金将・銀将
  C: { w: 2.42, l: 2.80, t: 0.76 }, // 桂馬・香車
  D: { w: 2.20, l: 2.66, t: 0.70 }, // 歩兵
};

// 裏は二字駒でも一字（崩し字）で書くのが普通なので、表だけ切り替える。
export const KINDS = {
  OU: { name: "王将", two: ["王", "将"], one: "王", size: "L", back: null },
  GY: { name: "玉将", two: ["玉", "将"], one: "玉", size: "L", back: null },
  HI: { name: "飛車", two: ["飛", "車"], one: "飛", size: "A", back: "龍" },
  KA: { name: "角行", two: ["角", "行"], one: "角", size: "A", back: "馬" },
  KI: { name: "金将", two: ["金", "将"], one: "金", size: "B", back: null },
  GI: { name: "銀将", two: ["銀", "将"], one: "銀", size: "B", back: "全" },
  KE: { name: "桂馬", two: ["桂", "馬"], one: "桂", size: "C", back: "圭" },
  KY: { name: "香車", two: ["香", "車"], one: "香", size: "C", back: "杏" },
  FU: { name: "歩兵", two: ["歩", "兵"], one: "歩", size: "D", back: "と" },
};

// 平手の初期配置。[駒, 筋, 段]。先手は手前（段7-9）。
export const HIRATE = [
  // 後手
  ["KY", 1, 1], ["KE", 2, 1], ["GI", 3, 1], ["KI", 4, 1], ["GY", 5, 1],
  ["KI", 6, 1], ["GI", 7, 1], ["KE", 8, 1], ["KY", 9, 1],
  ["HI", 8, 2], ["KA", 2, 2],
  ...Array.from({ length: 9 }, (_, i) => ["FU", i + 1, 3]),
  // 先手
  ["KY", 1, 9], ["KE", 2, 9], ["GI", 3, 9], ["KI", 4, 9], ["OU", 5, 9],
  ["KI", 6, 9], ["GI", 7, 9], ["KE", 8, 9], ["KY", 9, 9],
  ["HI", 2, 8], ["KA", 8, 8],
  ...Array.from({ length: 9 }, (_, i) => ["FU", i + 1, 7]),
];

// 駒台に並べるときの順。強い駒から。
export const STAND_ORDER = ["HI", "KA", "KI", "GI", "KE", "KY", "FU"];

// --- ジオメトリ ---------------------------------------------------------

const TIP_RATIO = 0.64;   // 先端の厚み ÷ 底辺の厚み
const SHOULDER_X = 0.70;  // 肩の張り出し（底辺の半幅に対する比）
const SHOULDER_Y = 0.24;  // 肩の位置（先端から長さの何割か）

/**
 * 五角形の肩の位置と、肩から底辺へ下る辺の開き角。
 * 扇の角度は計算で決めるものではなく、この辺の傾きがそのまま隣り合う駒の角度差になる。
 *
 * **接点そのものは肩ではなく足**（下の `footOf`）。この関数は辺の傾きを出すために残してある。
 */
export function shoulderOf(size) {
  const hw = size.w / 2;
  const hl = size.l / 2;
  const sx = hw * SHOULDER_X;
  const sy = hl - size.l * SHOULDER_Y;
  return { sx, sy, edge: Math.atan2(hw - sx, hl + sy) };
}

/**
 * 五角形の「足」（底辺の左右の角）の位置と、足から肩へ上る辺の開き角。
 * **駒を並べるとき人が合わせているのはここ。**
 *
 * **実物は駒の下辺を揃える。** 親指で下辺を支え、人差し指と中指で上部を手前へ倒して
 * 揃えるので、上が揃うのはおかしい。肩で合わせると、**大きさの違う駒を
 * 並べたときに下辺がバラバラになる**（歩 2.66cm と飛 3.06cm では長さが違う）。
 *
 * 辺は肩と足を結ぶ同じ 1 本なので `edge` は肩と共通。つまり**同じ大きさの駒どうしなら
 * 肩で接しても足で接しても結果は変わらない**。差が出るのは大きさが違うときだけ。
 */
export function footOf(size) {
  const hw = size.w / 2;
  const hl = size.l / 2;
  const sx = hw * SHOULDER_X;
  const sy = hl - size.l * SHOULDER_Y;
  return { fx: hw, fy: hl, edge: Math.atan2(hw - sx, hl + sy) };
}

// 形状は「先端が +y」で作る。こうしておくと水平に倒したとき
// 上面のUVが鏡像にならず、文字を素直に描ける。
function pieceShape(w, l) {
  const hw = w / 2;
  const hl = l / 2;
  const shoulderY = hl - l * SHOULDER_Y;
  const shoulderX = hw * SHOULDER_X;

  const s = new THREE.Shape();
  s.moveTo(0, hl);                   // 先端
  s.lineTo(-shoulderX, shoulderY);   // 左肩
  s.lineTo(-hw, -hl);                // 左下
  s.lineTo(hw, -hl);                 // 右下
  s.lineTo(shoulderX, shoulderY);    // 右肩
  s.closePath();
  return s;
}

const geoCache = new Map();

/**
 * マテリアルの割り当ては [0]=表（上面） [1]=裏（下面） [2]=側面。
 * ExtrudeGeometry は上下面をひとつのグループにまとめてしまうので、
 * 成りで裏返せるよう半分に割り直している。
 */
export function getPieceGeometry(sizeKey) {
  if (geoCache.has(sizeKey)) return geoCache.get(sizeKey);

  const { w, l, t } = SIZES[sizeKey];
  const bevel = 0.045;

  const geo = new THREE.ExtrudeGeometry(pieceShape(w, l), {
    depth: t - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });

  // 押し出し方向(+z)を上に向ける。形状の +y（先端）は -z（奥）へ。
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0); // 底面を y=0 に

  // 先端に向かって薄くする。横から見た駒らしさはここで出る。
  const pos = geo.attributes.position;
  const hl = l / 2;
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.clamp((pos.getZ(i) + hl) / l, 0, 1); // 0=先端(奥) 1=底辺(手前)
    pos.setY(i, pos.getY(i) * THREE.MathUtils.lerp(TIP_RATIO, 1, k));
  }

  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.max.y / 2, 0); // 厚みの中心を原点に
  geo.computeVertexNormals();

  // ExtrudeGeometry は Bottom faces → Top faces の順に積む。
  // rotateX(-90°) したので Top（後半）が上を向いている。
  const [lid, side] = geo.groups;
  const half = lid.count / 2;
  geo.clearGroups();
  geo.addGroup(lid.start + half, half, 0); // 表（上）
  geo.addGroup(lid.start, half, 1);        // 裏（下）
  geo.addGroup(side.start, side.count, 2); // 側面

  geoCache.set(sizeKey, geo);
  return geo;
}

// --- テクスチャ ---------------------------------------------------------

/** 木地の下地だけ。木目を入れない小さい絵（ボタンのアイコン）でも使う。 */
function woodGradient(c, w, h) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#e3c286");
  g.addColorStop(0.5, "#d8b271");
  g.addColorStop(1, "#c9a15c");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}

function woodBase(c, w, h, seed) {
  woodGradient(c, w, h);

  let rnd = seed;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 90; i++) {
    const x0 = rand() * w;
    const amp = 3 + rand() * 9;
    const dark = rand() < 0.25;
    c.strokeStyle = dark
      ? `rgba(112,78,36,${0.10 + rand() * 0.16})`
      : `rgba(154,114,60,${0.05 + rand() * 0.09})`;
    c.lineWidth = dark ? 1.2 + rand() * 1.6 : 0.7 + rand();
    c.beginPath();
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y / (26 + rand() * 10) + i) * amp;
      y === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
    c.stroke();
  }
}

function grain(c, w, h) {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}

// 駒字の書体。先頭の KomaFont は index.html の @font-face で読む同梱フォント。
// ファイルが無ければ黙って次に落ちる。以降はローカルにあれば使われるが、
// **配布先の環境に何があるかは当てにできない**ので、本気でやるなら同梱する。
const FONT = `"KomaFont","HGP行書体","HG行書体","HGS行書体","STKaiti","Kaiti SC","BIZ UDMincho","Yu Mincho","YuMincho","MS PMincho",serif`;
const PPC = 110; // テクスチャの解像度 px/cm

// --- 駒字の画像 ---------------------------------------------------------
//
// **フォントではなく画像から字を取る**（しんえれ外部駒、CC 表示-非営利 2.1）。
// 実物の駒書体は商用フォントしか無いが、**駒の画像はありふれている**という発想。
// これで錦旗・水無瀬・巻菱湖・源兵衛清安といった実物の書体が使える。
//
// スプライトは**セルが 8列×2段**（下半分は後手向きの同じ絵で、こちらは使わない。
// 駒ごと回せば済むため）。1段目が表、2段目が裏（成駒）。
//
// **いまの素材は字だけの透過画像**（2026-08-20 に差し替え。1000×837）。
// 木地込みの版だと**こちらが描いた 3D の駒木地と、画像の中の駒の絵が二重に見えていた**
// ので、木地ごと落としてある。
// 木地・木目・光沢・彫りの陰影はこちらで作っているものをそのまま使う。

// セルの数。**大きさは画像から割り出す**ので、素材を差し替えてもそのまま動く。
const SHEET_COLS = 8;
const SHEET_ROWS = 6; // 先手2段・区切り・後手2段。使うのは上の2段だけ
// セルの並び。[kindId, 成っているか]。**金は成らない**ので 2段目の4つ目は空。
const SHEET_MAP = [
  [["OU", 0], ["HI", 0], ["KA", 0], ["KI", 0], ["GI", 0], ["KE", 0], ["KY", 0], ["FU", 0]],
  [["GY", 0], ["HI", 1], ["KA", 1], null, ["GI", 1], ["KE", 1], ["KY", 1], ["FU", 1]],
];

// セルの中で駒がどこにあるか（セルの大きさに対する比）。**字ではなく駒の輪郭**で、
// 字の大きさと位置はここに合わせて決まる。
//
// **測るのではなく持っておく**（2026-08-20）。素材が字だけになって輪郭が写っていないため。
// 字そのものを基準にすると、駒種で字の大きさが違うぶんが消えて（歩も王も同じ大きさになり）、
// **駒いっぱいに字が広がる**。値は木地が写っていた版（344×288、セル 43×48）からの実測で、
// **3書体すべて完全に同じだった**（同じ駒の写真を使い回しているため）。
//
// **左右だけは駒の輪郭ではなくセルの中央に置く。** 旧素材の駒はセル内でわずかに右
// （中心 0.535）にあったのに対し、**新素材の字はセルの中央にある**（実測の平均 0.504）。
// 輪郭どおりに切ると字が駒面の 3% ほど左へ寄る。実物の駒の字は左右中央なので中央に合わせた。
// 上下は素材のまま（駒は五角形で上下非対称なので、字の高さの位置には意味がある）。
const wide = (w, y, h) => [(1 - w) / 2, y, w, h];
const KOMA_BOX = {
  OU: wide(40 / 43, 2 / 48, 46 / 48),
  GY: wide(40 / 43, 2 / 48, 46 / 48),
  HI: wide(40 / 43, 2 / 48, 46 / 48),
  KA: wide(40 / 43, 2 / 48, 46 / 48),
  KI: wide(38 / 43, 4 / 48, 44 / 48),
  GI: wide(38 / 43, 4 / 48, 44 / 48),
  KE: wide(36 / 43, 4 / 48, 44 / 48),
  KY: wide(34 / 43, 4 / 48, 44 / 48),
  FU: wide(34 / 43, 5 / 48, 41 / 48),
};

/** "kindId:0|1" → { cv, x, y, w, h }。x..h は**駒の輪郭**の矩形（字の位置合わせに使う）。 */
const glyphs = new Map();
let glyphName = null;

export function komaImageName() { return glyphName; }

/**
 * スプライト1枚から全駒の「字だけ」を切り出す。
 * 位置と大きさは `KOMA_BOX`（駒の輪郭）で決まる。
 *
 * **木地が写っている素材のときだけ字を抜く。** 字だけの透過素材で抜き処理を通すと、
 * 縁の半透明な画素まで塗り直してしまい、**字が太くなって縁がガタつく**。
 * 抜き方は「暗くて彩度が低い画素＝黒字」「赤い画素＝朱字」で、木地と木目は黄色く彩度が
 * 高いので混ざらない（実測で綺麗に分かれた。手作業の透過処理は要らなかった）。
 */
function cutGlyphs(img) {
  // **セルの大きさは割り切れないことがある**（1000×837 なら 125×139.5）。
  // 丸めた値で切り出し位置を決めると段がずれるので、位置は小数のまま持つ。
  const cw = img.width / SHEET_COLS;
  const ch = img.height / SHEET_ROWS;
  const W = Math.round(cw), H = Math.round(ch);
  const map = new Map();
  for (let row = 0; row < SHEET_MAP.length; row++) {
    for (let col = 0; col < SHEET_MAP[row].length; col++) {
      const slot = SHEET_MAP[row][col];
      if (!slot) continue;
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const c = cv.getContext("2d", { willReadFrequently: true });
      c.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, W, H);
      // セルの左上が塗ってあれば木地込みの素材。透明なら字だけの素材。
      const g = c.getImageData(0, 0, W, H);
      const d = g.data;
      if (d[3] >= 8) {
        // 字だけ残す。**色は元のまま**（その書体の墨と朱をそのまま使う）。
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          const L = r * 0.299 + gg * 0.587 + b * 0.114;
          const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
          if (L < 110 && sat < 70) d[i + 3] = Math.min(255, (110 - L) * 3.4);       // 墨
          else if (L < 150 && r - b > 60 && r > 90) d[i + 3] = Math.min(255, (150 - L) * 2.8); // 朱
          else d[i + 3] = 0;
        }
        c.putImageData(g, 0, 0);
      }
      const b = KOMA_BOX[slot[0]];
      map.set(`${slot[0]}:${slot[1]}`,
        { cv, x: b[0] * W, y: b[1] * H, w: b[2] * W, h: b[3] * H });
    }
  }
  return map;
}

/**
 * 駒字の画像を読み込む。読めたら以降の描画がそちらに切り替わる。
 * **失敗しても黙って諦める**（フォント描画のまま動く）。同梱フォントと同じ扱い。
 */
export function loadKomaImage(name) {
  return new Promise((resolve) => {
    if (!name) { glyphs.clear(); glyphName = null; resolve(false); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const m = cutGlyphs(img);
        glyphs.clear();
        for (const [k, v] of m) glyphs.set(k, v);
        glyphName = name;
        resolve(true);
      } catch { resolve(false); }
    };
    img.onerror = () => resolve(false);
    // ファイル名なら img/ から。パスや blob: をそのまま渡すこともできる（差し替えの確認用）。
    img.src = /^(\.|\/|blob:|data:|https?:)/.test(name) ? name : "./img/" + encodeURIComponent(name);
  });
}

/** 駒字を書く。(0,0)-(W,H) の矩形に収める。テクスチャとボタンのアイコンで共用。 */
function drawChars(c, W, H, chars, promoted, kindId) {
  // **画像があればそちらを使う。** 駒の輪郭どうしを合わせるので、字の大きさと
  // 位置は駒種によらず揃う（セルの中で駒がどこにあるかは駒種で違う）。
  const g = kindId && glyphs.get(`${kindId}:${promoted ? 1 : 0}`);
  if (g) {
    c.drawImage(g.cv, g.x, g.y, g.w, g.h, 0, 0, W, H);
    return;
  }
  c.fillStyle = promoted ? "#a8321f" : "#20170e";
  c.textAlign = "center";
  c.textBaseline = "middle";

  const n = chars.length;
  // 一字駒は大きく、二字駒は詰めて書く
  const size = n === 1 ? H * 0.52 : H * 0.37;
  const top = H * 0.09;
  const span = H * 0.82;

  chars.forEach((ch, i) => {
    c.save();
    c.translate(W * 0.5, n === 1 ? H * 0.52 : top + (span * (i + 0.5)) / n);
    c.scale(0.92, 1.12); // 駒字は少し縦長
    c.font = `${size}px ${FONT}`;
    // 漆は木地に少し染みる。輪郭をぼかした下地の上に本体を重ねると、
    // 単色で塗ったときの「印刷したような」平坦さが取れる。
    c.shadowColor = promoted ? "rgba(150,42,26,0.5)" : "rgba(26,18,10,0.5)";
    c.shadowBlur = size * 0.05;
    c.fillText(ch, 0, 0);
    c.shadowBlur = size * 0.02;
    c.fillText(ch, 0, 0);
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
    c.fillText(ch, 0, 0);
    c.restore();
  });
}

/** 駒の五角形の輪郭。canvas は y が下向きなので、先端を上にするため符号を返す側で合わせる。 */
function komaPath(W, H) {
  const hw = W / 2, hl = H / 2;
  const sx = hw * SHOULDER_X;
  const sy = hl - H * SHOULDER_Y;
  const p = new Path2D();
  p.moveTo(0, -hl);      // 先端（上）
  p.lineTo(-sx, -sy);    // 左肩
  p.lineTo(-hw, hl);     // 左下
  p.lineTo(hw, hl);      // 右下
  p.lineTo(sx, -sy);     // 右肩
  p.closePath();
  return p;
}

/**
 * ボタンに出す駒の絵。**押した後の駒そのもの**を見せるためのもの。
 * 抽象的な記号だと「向きが変わる」のか「裏返る」のかが読めないという結論になった。
 * 盤の駒と同じ書体・同じ字・同じ色で描くので、歩なら「と」が出て成ることが分かる。
 *
 * @param {{ promoted?: boolean, flip?: boolean, oneChar?: boolean, px?: number }} opt
 *   promoted: 裏の字（赤）で書く / flip: 180度回して後手向きにする
 * @returns {HTMLCanvasElement}
 */
export function drawKomaIcon(kindId, { promoted = false, flip = false, oneChar = false, px = 88 } = {}) {
  const kind = KINDS[kindId];
  const size = SIZES[kind.size];
  const cv = document.createElement("canvas");
  cv.width = px; cv.height = px;
  const c = cv.getContext("2d");

  // 長手を基準に正方形へ収める。縁を描くぶんだけ余白を残す。
  const scale = (px * 0.90) / size.l;
  const W = size.w * scale, H = size.l * scale;
  const chars = promoted ? [kind.back] : oneChar ? [kind.one] : kind.two;

  c.translate(px / 2, px / 2);
  if (flip) c.rotate(Math.PI); // 後手向き。字ごと回る
  const path = komaPath(W, H);

  c.save();
  c.clip(path);
  c.translate(-W / 2, -H / 2);
  // 木目は入れない。この大きさだと縮んだ線がただのノイズになる。
  woodGradient(c, W, H);
  drawChars(c, W, H, chars, promoted, kindId);
  c.restore();

  // 縁。木地はボタンの地色と近いので、これが無いと駒の形が溶ける。
  c.lineWidth = Math.max(1, px * 0.014);
  c.strokeStyle = "rgba(58,38,16,0.9)";
  c.stroke(path);
  return cv;
}

// --- 駒の仕上げ（彫・彫埋・盛上） ---------------------------------------
//
// **ジオメトリは触らない。法線マップと粗さマップで出す。**
// 盛り上がりは実物で 0.2〜0.4mm ほど。駒の厚み 7〜9mm の 1/20 以下しかないので、
// **シルエット（駒の輪郭）には出ない＝効くのは光の当たり方だけ**であり、法線マップで足りる。
// `displacementMap`（頂点変位）にすると駒の上面を数万頂点へ割ることになり、
// 40 枚 ×2 面ぶんはタブレットで通らない。
//
// **三段はどれも同じテクスチャから作る。違うのは法線の符号と強さだけ**なので、
// 仕上げの切り替えと強さの調整では**テクスチャを作り直さない**（`normalScale` を書き換えるだけ）。
//   彫   … 凹む（負）
//   彫埋 … 面一（0）。凹凸の無い、これまでの見た目
//   盛上 … 盛り上がる（正）
//
// **艶（roughnessMap）は三段とも同じ。** どの仕上げでも字は漆で、木地より艶やか。
// 既定視点がほぼ真上なので、**法線だけでは弱く、艶の差のほうが「盛り上がっている」の
// 手がかりになる**。
// 数値は `P.relief*` から起動時に入る（`main.js`。実機で見て決めた値）。
const RELIEF = {
  sign: 1,      // -1=彫 0=彫埋 +1=盛上
  height: 0.4,  // 盛り上がりの強さ（normalScale）
  blur: 0.01,   // 漆の丸み。駒の長手に対する比。0 に近いほど角が立つ
  gloss: 0.2,   // 漆の粗さ。小さいほど艶やか
  wood: 0.42,   // 木地の粗さ（これまでの値）
};

// 高さマップは色テクスチャより粗くてよい。法線に効くのはなだらかな傾きだけで、
// 木目や粒子のような細かさは要らない。
const HEIGHT_SCALE = 0.5;
// 傾きの誇張。実寸どおり（駒長の 1/100）だと法線がほとんど倒れず見えない。
// **強さの決め手は `RELIEF.height` のほう**で、こちらはその目盛りを決めているだけ。
const NORMAL_K = 0.12;

export function reliefValues() { return { ...RELIEF }; }

/**
 * 仕上げの値を変える。
 * **法線の符号と強さは焼き込まない**ので、三段の切り替えと強さの調整はここで完結する。
 * 丸みと艶は絵に焼くので、そこを変えたときだけ true を返す（呼んだ側で描き直す）。
 */
export function setRelief(v) {
  const redraw = ["blur", "gloss", "wood"].some(
    (k) => v[k] !== undefined && v[k] !== RELIEF[k]);
  Object.assign(RELIEF, v);
  if (!redraw) applyRelief();
  return redraw;
}

/** いま生きているマテリアルへ法線の強さを配る。テクスチャはそのまま使い回す。 */
function applyRelief() {
  const s = RELIEF.sign * RELIEF.height;
  for (const mats of matCache.values()) {
    for (const m of mats) if (m.userData.koma) m.normalScale.set(s, s);
  }
}

/**
 * 箱ぼかしを3回（≒ガウス）。漆の盛りは断面が蒲鉾型で、縁が立っていない。
 * **`ctx.filter` には頼らない**（機種によって効かないことがあり、効かなければ
 * 角の立った台形になって「印刷した字」に見えてしまう）。
 */
function blurAlpha(a, w, h, r) {
  if (r < 1) return a;
  const b = new Float32Array(w * h);
  for (let i = 0; i < 3; i++) {
    boxBlur(a, b, w, h, r, 1);  // 横
    boxBlur(b, a, w, h, r, w);  // 縦（a へ戻す）
  }
  return a;
}

function boxBlur(src, dst, w, h, r, stride) {
  const lines = stride === 1 ? h : w;
  const len = stride === 1 ? w : h;
  const n = r * 2 + 1;
  for (let li = 0; li < lines; li++) {
    const base = stride === 1 ? li * w : li;
    const at = (k) => src[base + Math.min(len - 1, Math.max(0, k)) * stride];
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += at(k);
    for (let k = 0; k < len; k++) {
      dst[base + k * stride] = sum / n;
      sum += at(k + r + 1) - at(k - r);
    }
  }
}

/**
 * 高さ（0..1）から法線を起こす。
 *
 * **canvas の y は下向き、テクスチャは `flipY` なので v は上向き**。
 * つまり v が増える向きは canvas の y が減る向きで、
 * `ny = -dh/dv = +dh/dy(canvas)`。x はそのまま `nx = -dh/du`。
 *
 * 傾きは**画素あたりではなく駒の長手あたり**で測る（`* h / 2`）。こうしておけば
 * 素材を高画質版に差し替えても、盛り上がりの見え方は変わらない。
 */
function normalCanvas(a, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const img = new ImageData(w, h);
  const d = img.data;
  const k = (NORMAL_K * h) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = a[y * w + Math.min(x + 1, w - 1)] - a[y * w + Math.max(x - 1, 0)];
      const dy = a[Math.min(y + 1, h - 1) * w + x] - a[Math.max(y - 1, 0) * w + x];
      const nx = -dx * k, ny = dy * k, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      d[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      d[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      d[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      d[i * 4 + 3] = 255;
    }
  }
  cv.getContext("2d").putImageData(img, 0, 0);
  return cv;
}

/** 漆の艶。字の所だけ粗さを下げる。**ぼかした後の高さを使う**ので縁がなだらかに移る。 */
function roughCanvas(a, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, a[i] * 1.6); // 縁のごく薄い所まで艶にはしない
    const v = Math.round((RELIEF.wood + (RELIEF.gloss - RELIEF.wood) * t) * 255);
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  cv.getContext("2d").putImageData(img, 0, 0);
  return cv;
}

/** ExtrudeGeometry は上下面のUVに形状座標をそのまま入れるので、実寸で正規化する。 */
function faceTexture(cv, w, l) {
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.repeat.set(1 / w, 1 / l);
  tex.offset.set(0.5, 0.5);
  return tex;
}

/** 駒の面 1 枚ぶんのマテリアル。色・法線・粗さの 3 枚をここで作る。 */
function faceMaterial(sizeKey, chars, { promoted = false, mirror = false, seed = 12345, kindId = null }) {
  const { w, l } = SIZES[sizeKey];
  const W = Math.round(w * PPC);
  const H = Math.round(l * PPC);

  // 字を描く手順は色と高さで共通のものを使う。**画像でもフォントでも、
  // 裏面の左右反転も、これ 1 つを通る**ので、色と高さがずれることがない。
  const ink = (c) => {
    c.save();
    // 裏面は下から見ることになるので、左右を反転しておく
    if (mirror) { c.translate(W, 0); c.scale(-1, 1); }
    drawChars(c, W, H, chars, promoted, kindId);
    c.restore();
  };

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  woodBase(c, W, H, seed);
  ink(c);
  grain(c, W, H);
  const map = faceTexture(cv, w, l);
  map.colorSpace = THREE.SRGBColorSpace;

  // 高さは**字だけを透明な紙に描いてアルファを取る**。木地・木目・粒子は盛り上がらない。
  const hw = Math.max(8, Math.round(W * HEIGHT_SCALE));
  const hh = Math.max(8, Math.round(H * HEIGHT_SCALE));
  const icv = document.createElement("canvas");
  icv.width = W; icv.height = H;
  ink(icv.getContext("2d"));
  const scv = document.createElement("canvas");
  scv.width = hw; scv.height = hh;
  const sc = scv.getContext("2d", { willReadFrequently: true });
  sc.drawImage(icv, 0, 0, hw, hh);
  const d = sc.getImageData(0, 0, hw, hh).data;
  const a = new Float32Array(hw * hh);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  blurAlpha(a, hw, hh, Math.round(RELIEF.blur * hh));

  // roughnessMap は緑を読んで `roughness` に掛けるので、こちらは 1 にしておく。
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap: faceTexture(normalCanvas(a, hw, hh), w, l),
    roughnessMap: faceTexture(roughCanvas(a, hw, hh), w, l),
    roughness: 1,
    metalness: 0,
  });
  const s = RELIEF.sign * RELIEF.height;
  mat.normalScale.set(s, s);
  mat.userData.koma = true;
  return mat;
}

let sideMat = null;
function getSideMaterial() {
  if (sideMat) return sideMat;
  const W = 128, H = 128;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  woodBase(c, W, H, 777);
  grain(c, W, H);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  sideMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
  return sideMat;
}

const matCache = new Map();

/** 同梱フォントが後から届いたときなど、駒の面を描き直したいときに呼ぶ。 */
export function clearMaterialCache() {
  for (const mats of matCache.values()) {
    for (const m of mats) {
      if (m === sideMat) continue; // 側面は字と関係ないので使い回す
      // 面は色・法線・粗さの3枚を持つ。**どれも捨てる**（色だけ捨てると残りが漏れる）
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.dispose();
      m.dispose();
    }
  }
  matCache.clear();
}

/**
 * 駒のマテリアル [表, 裏, 側面]。種類と書体ごとに使い回す。
 * @param {string} kindId KINDS のキー
 * @param {boolean} oneChar 一字駒にする
 */
export function getPieceMaterials(kindId, oneChar) {
  const key = `${kindId}:${oneChar ? 1 : 2}`;
  if (matCache.has(key)) return matCache.get(key);

  const k = KINDS[kindId];
  const mats = [
    faceMaterial(k.size, oneChar ? [k.one] : k.two, { seed: 12345, kindId }),
    // 成らない駒（王・玉・金）の裏は無地
    faceMaterial(k.size, k.back ? [k.back] : [], {
      promoted: true, mirror: true, seed: 4711, kindId: k.back ? kindId : null,
    }),
    getSideMaterial(),
  ];
  matCache.set(key, mats);
  return mats;
}
