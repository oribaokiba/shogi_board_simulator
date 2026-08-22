// 盤。単位は cm。寸法は脚付き本榧盤に近い値にしてある。

import * as THREE from "three";

export const SQ = { w: 3.03, d: 3.33 }; // 一升
export const BOARD = {
  w: 33.0,      // 盤の幅
  d: 36.0,      // 盤の奥行
  h: 12.0,      // 盤の厚み
  legH: 6.0,    // 脚の高さ
};
export const TOP_Y = BOARD.legH + BOARD.h; // 盤面の高さ

/** 筋(1-9) 段(1-9) → 盤面上のワールド座標。先手は +z 側に座る。 */
export function squareToWorld(file, rank) {
  return { x: (5 - file) * SQ.w, z: (rank - 5) * SQ.d };
}

/** ワールド座標 → 最寄りの升。盤の外なら null。 */
export function nearestSquare(x, z) {
  const file = Math.round(5 - x / SQ.w);
  const rank = Math.round(5 + z / SQ.d);
  if (file < 1 || file > 9 || rank < 1 || rank > 9) return null;
  const c = squareToWorld(file, rank);
  return { file, rank, x: c.x, z: c.z, dist: Math.hypot(x - c.x, z - c.z) };
}

function makeTopTexture() {
  const PPC = 24;
  const W = Math.round(BOARD.w * PPC);
  const H = Math.round(BOARD.d * PPC);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");

  const g = c.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, "#f0dcae");
  g.addColorStop(0.45, "#e8cf9a");
  g.addColorStop(1, "#dcbf86");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // 榧の柾目。細かく真っ直ぐな縦目。
  let rnd = 4242;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    const x0 = rand() * W;
    c.strokeStyle = `rgba(150,112,58,${0.04 + rand() * 0.10})`;
    c.lineWidth = 0.6 + rand() * 1.7;
    c.beginPath();
    for (let y = 0; y <= H; y += 10) {
      c.lineTo(x0 + Math.sin(y / 90 + i) * (1.5 + rand()), y);
    }
    c.stroke();
  }

  // 盤面の線。中心を原点として cm → px に写す。
  const cx = W / 2, cy = H / 2;
  const toPx = (x, z) => [cx + x * PPC, cy + z * PPC];
  const hx = (SQ.w * 9) / 2;
  const hz = (SQ.d * 9) / 2;

  c.strokeStyle = "#241a10";
  c.lineWidth = 1.6;
  c.beginPath();
  for (let i = 0; i <= 9; i++) {
    const x = -hx + i * SQ.w;
    c.moveTo(...toPx(x, -hz)); c.lineTo(...toPx(x, hz));
    const z = -hz + i * SQ.d;
    c.moveTo(...toPx(-hx, z)); c.lineTo(...toPx(hx, z));
  }
  c.stroke();

  // 星（4つ）
  c.fillStyle = "#241a10";
  for (const f of [3.5, 6.5]) {
    for (const r of [3.5, 6.5]) {
      const p = toPx((5 - f) * SQ.w, (r - 5) * SQ.d);
      c.beginPath();
      c.arc(p[0], p[1], 3.2, 0, Math.PI * 2);
      c.fill();
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** 駒台の天板。盤と同じ榧の柾目だが、盤面の線は入らない。 */
function makeStandTopTexture() {
  const W = 384, H = 384;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");

  const g = c.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, "#eedaa8");
  g.addColorStop(0.5, "#e4c992");
  g.addColorStop(1, "#d6b57e");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  let rnd = 8123;
  const rand = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 170; i++) {
    const x0 = rand() * W;
    c.strokeStyle = `rgba(148,110,56,${0.05 + rand() * 0.12})`;
    c.lineWidth = 0.6 + rand() * 1.9;
    c.beginPath();
    for (let y = 0; y <= H; y += 10) {
      c.lineTo(x0 + Math.sin(y / 80 + i) * (1.4 + rand()), y);
    }
    c.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeSideTexture() {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#d9bd85";
  c.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 70; i++) {
    c.strokeStyle = `rgba(146,108,56,${0.05 + Math.random() * 0.14})`;
    c.lineWidth = 0.5 + Math.random() * 2;
    const y = Math.random() * 128;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(85, y + (Math.random() - 0.5) * 9, 170, y + (Math.random() - 0.5) * 9, 256, y);
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBoard() {
  const group = new THREE.Group();

  const top = new THREE.MeshStandardMaterial({
    map: makeTopTexture(), roughness: 0.52, metalness: 0,
  });
  const side = new THREE.MeshStandardMaterial({
    map: makeSideTexture(), roughness: 0.6, metalness: 0,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD.w, BOARD.h, BOARD.d),
    [side, side, top, side, side, side]
  );
  body.position.y = BOARD.legH + BOARD.h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 脚。実物は「くちなしの実」型だが、ここでは丸みのある円柱で済ませる。
  const legMat = new THREE.MeshStandardMaterial({ color: "#c9a870", roughness: 0.6 });
  const legGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(2.0, 0),
      new THREE.Vector2(2.5, BOARD.legH * 0.35),
      new THREE.Vector2(2.3, BOARD.legH * 0.8),
      new THREE.Vector2(2.5, BOARD.legH),
      new THREE.Vector2(0.01, BOARD.legH),
    ],
    24
  );
  const lx = BOARD.w / 2 - 4.2;
  const lz = BOARD.d / 2 - 4.2;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(sx * lx, 0, sz * lz);
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

// --- 駒台 ---------------------------------------------------------------

export const STAND = {
  w: 14.5,   // 天板の幅
  d: 14.5,   // 天板の奥行
  h: 2.2,    // 天板の厚み
  topY: 16.0, // 上面の高さ。盤面より少し低い
};

// owner 0 = 先手（手前）、1 = 後手（奥）
// 対局なら駒台は斜向かい。棋譜を並べるだけなら手前側に揃っている方が扱いやすい。
// 盤の手前／奥の辺と駒台の辺が揃う位置。盤の半分18cm、駒台の半分7.25cm。
const SX = BOARD.w / 2 + 2.0 + STAND.w / 2;
const SZ = BOARD.d / 2 - STAND.d / 2;

// 縦長の画面向け。**盤の奥に横並び**にする。
// 駒台を左右に置くと 33 + 14.5×2 ＝ 62cm の横幅が要り、スマホを縦に持つと盤が小さくなる。
// 奥にまとめれば横幅は盤のまま（33cm）で済み、伸びるのは縦だけ。
const TX = STAND.w / 2 + 1.0;
const TZ = -(BOARD.d / 2 + 2.0 + STAND.d / 2);

export const STAND_LAYOUTS = {
  match: [{ x: SX, z: SZ }, { x: -SX, z: -SZ }],
  study: [{ x: SX, z: SZ }, { x: SX, z: -SZ }],
  // 先手を右、後手を左に。**盤を挟んだ位置関係（先手が右手前）はそのまま**なので、
  // 縦長でも駒台の持ち主が入れ替わって見えない。
  tall: [{ x: TX, z: TZ }, { x: -TX, z: TZ }],
};

export const STANDS = [
  { owner: 0, x: SX, z: SZ, node: null },
  { owner: 1, x: -SX, z: -SZ, node: null },
];

export function setStandLayout(name) {
  const L = STAND_LAYOUTS[name] || STAND_LAYOUTS.match;
  STANDS.forEach((s, i) => {
    s.x = L[i].x;
    s.z = L[i].z;
    if (s.node) s.node.position.set(s.x, 0, s.z);
  });
}

/** その座標が駒台の上か。外なら null。 */
export function nearestStand(x, z) {
  for (const s of STANDS) {
    if (Math.abs(x - s.x) <= STAND.w / 2 && Math.abs(z - s.z) <= STAND.d / 2) return s;
  }
  return null;
}

// 駒台で使える範囲（縁の余白を除いた内寸）
export const STAND_INNER = { w: STAND.w - 1.2, d: STAND.d - 1.2 };

export function createStands() {
  const group = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ map: makeSideTexture(), roughness: 0.6 });
  const plain = new THREE.MeshStandardMaterial({ map: makeStandTopTexture(), roughness: 0.52 });

  const legGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(1.5, 0),
      new THREE.Vector2(1.8, (STAND.topY - STAND.h) * 0.4),
      new THREE.Vector2(1.6, (STAND.topY - STAND.h) * 0.85),
      new THREE.Vector2(1.8, STAND.topY - STAND.h),
      new THREE.Vector2(0.01, STAND.topY - STAND.h),
    ],
    20
  );

  for (const s of STANDS) {
    // 駒台ごとにまとめておき、配置を切り替えたら丸ごと動かす
    const node = new THREE.Group();
    node.position.set(s.x, 0, s.z);
    s.node = node;
    group.add(node);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(STAND.w, STAND.h, STAND.d),
      [side, side, plain, side, side, side]
    );
    board.position.set(0, STAND.topY - STAND.h / 2, 0);
    board.castShadow = true;
    board.receiveShadow = true;
    node.add(board);

    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = new THREE.Mesh(legGeo, side);
      leg.position.set(sx * (STAND.w / 2 - 2.6), 0, sz * (STAND.d / 2 - 2.6));
      leg.castShadow = true;
      node.add(leg);
    }
  }
  return group;
}

// --- 駒箱 ---------------------------------------------------------------
//
// 駒落ちで外した駒の置き場所であり、**盤に駒をぶちまけて自分で並べる**ための入れ物。
// 実物と同じく畳（床）に直接置く。上は開いていて、真上から中が見える。
//
// **駒台とは別の場所として扱う**（`placeAt` の3つ目）。持ち駒ではないので、
// 駒箱の駒は局面に数えない。並べ方の決まりも無い（扇にしない）。

export const BOX = {
  w: 15.5,    // 外寸の幅
  d: 15.5,    // 外寸の奥行
  h: 5.4,     // 箱の高さ
  wall: 0.7,  // 壁の厚み
  floor: 0.9, // 底板の厚み
};
// 駒が乗る面（底の内側）。駒台の `topY` にあたるもの。
BOX.topY = BOX.floor;
// 中で使える範囲。壁の内側から駒の半分ぶん余裕を見る。
export const BOX_INNER = { w: BOX.w - BOX.wall * 2 - 0.6, d: BOX.d - BOX.wall * 2 - 0.6 };

// 置き場所は盤の左手前。駒台は match で右手前と左奥、study で右に2つなので、
// **どちらのレイアウトでも空いている**のがここ。
export const KOMABAKO = {
  x: -(BOARD.w / 2 + 2.0 + BOX.w / 2),
  z: BOARD.d / 2 - BOX.d / 2,
  node: null,
  visible: true,
};

/** その座標が駒箱の上か。外なら null。 */
export function nearestBox(x, z) {
  if (!KOMABAKO.visible) return null;
  return Math.abs(x - KOMABAKO.x) <= BOX.w / 2 && Math.abs(z - KOMABAKO.z) <= BOX.d / 2
    ? KOMABAKO : null;
}

export function insideBox(x, z) {
  return Math.abs(x - KOMABAKO.x) <= BOX_INNER.w / 2
      && Math.abs(z - KOMABAKO.z) <= BOX_INNER.d / 2;
}

export function createBox() {
  const group = new THREE.Group();
  group.position.set(KOMABAKO.x, 0, KOMABAKO.z);
  KOMABAKO.node = group;

  const side = new THREE.MeshStandardMaterial({ map: makeSideTexture(), roughness: 0.62 });
  const inner = new THREE.MeshStandardMaterial({ map: makeStandTopTexture(), roughness: 0.6 });

  const floor = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.floor, BOX.d),
    [side, side, inner, side, side, side]);
  floor.position.y = BOX.floor / 2;
  floor.receiveShadow = true;
  floor.castShadow = true;
  group.add(floor);

  // 四方の壁。内側にも木口が見えるよう、板を4枚立てるだけにする。
  const wallH = BOX.h - BOX.floor;
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const w = ax ? BOX.wall : BOX.w;
    const d = ax ? BOX.d : BOX.wall;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), side);
    wall.position.set(ax * (BOX.w / 2 - BOX.wall / 2), BOX.floor + wallH / 2,
      az * (BOX.d / 2 - BOX.wall / 2));
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }
  return group;
}

// --- 符号 ---------------------------------------------------------------

const KAN = "一二三四五六七八九";

function makeLabelTexture(text) {
  const S = 64;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const c = cv.getContext("2d");
  c.fillStyle = "#3b2c1a";
  c.font = `${S * 0.7}px "Yu Mincho","MS PMincho",serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, S / 2, S / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * 盤の端の符号。筋は算用数字（右が1）、段は漢数字（奥が一）。
 * 実物の盤には無いものなので、出すかどうかは呼ぶ側が決める。
 * 向きは視点で変わるので、盤のテクスチャには焼き込めない（個別の板にする理由）。
 */
export function createCoords() {
  const group = new THREE.Group();
  const edgeX = (SQ.w * 9) / 2 + 1.4;
  const edgeZ = (SQ.d * 9) / 2 + 1.3;
  const add = (text, x, z) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(text), transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, TOP_Y + 0.02, z);
    group.add(m);
  };
  for (let file = 1; file <= 9; file++) add(String(file), squareToWorld(file, 1).x, -edgeZ);
  for (let rank = 1; rank <= 9; rank++) add(KAN[rank - 1], edgeX, squareToWorld(1, rank).z);
  return group;
}

export function createFloor() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const c = cv.getContext("2d");
  c.fillStyle = "#4a4038";
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`;
    c.fillRect(Math.random() * 128, Math.random() * 128, 2, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 14);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}
