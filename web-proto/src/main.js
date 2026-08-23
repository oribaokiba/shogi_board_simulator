// フェーズ1：全40駒＋駒台。掴む・運ぶ・置く（吸着）・倒す・成る・向きを変える。
//
// 駒の持ち主は状態として持たせていない。向き（先端がどちらを向いているか）が
// 持ち主そのもの。だから相手の駒を取ったら、運んで向きを変えれば自分の駒になる。

import * as THREE from "three";
import * as CANNON from "cannon-es";
import {
  SIZES, KINDS, HIRATE, STAND_ORDER, shoulderOf, footOf, getPieceGeometry, getPieceMaterials,
  clearMaterialCache, drawKomaIcon, loadKomaImage, setRelief,
} from "./piece.js";
import {
  SQ, BOARD, TOP_Y, STAND, STANDS, createBoard, createStands, createFloor,
  nearestSquare, squareToWorld, nearestStand, STAND_INNER, setStandLayout, createCoords,
  BOX, BOX_INNER, KOMABAKO, nearestBox, insideBox, createBox,
} from "./board.js";
import {
  initAudio, resumeAudio, playClack, playClick, playSlide, playPlace, playSpill, setMasterVolume,
  setSound, isCustomSound,
} from "./sound.js";
import {
  toSfen, fromSfen, checkPosition, parseMove, pvText, scoreText, loadEngine, engineLoaded,
} from "./usi.js";

// --- 調整パラメータ -----------------------------------------------------
const P = {
  followRate: 22,     // 手への追従の速さ。小さいほど駒が遅れてついてくる
  // ここの5つは実際に触って決めた値（2026-08-16）。勝手に変えない
  // （tapTime だけ 2026-08-19 に上げた。理由はその行に書いてある）。
  holdHeight: 3,      // 持ち上げ高さの上限 cm。押している長さでここまで上がる
  liftTime: 0.05,     // 押し続けて上限の高さに達するまでの時間 s
  slideTime: 0.1,     // 掴んでこの時間内に動き出したら「すべらせている」とみなす s
  slideDist: 0.15,    // その間にこれだけ動いたらスライド確定 cm
  // これより短く離したら「ちょんと触った」＝音を鳴らさず、代わりに駒のボタンを出す s。
  // **0.12 では実際のクリック（0.1〜0.15秒）とほぼ同じで、鳴ったり鳴らなかったりしていた。**
  // 2026-08-19 に 0.25 へ。判定パネルに「押した時間」を出したので、そこを見て決め直せる。
  tapTime: 0.25,
  liftPitch: 0.05,    // 高く持ち上げたとき駒音がどれだけ高くなるか（再生速度の増分）
  touchScale: 0.9,    // 手前の駒に「重ねた」とみなす広さ。1.0 で駒の縁がちょうど触れる
  uprightRate: 14,    // 掴んだ駒が正立に戻る速さ
  // **距離と手の速さでは吸着を止めない**（2026-08-19 に廃止）。どちらも「吸着ありなのに
  // 升からズレた位置に置ける」を作っていた。理由は `endGrab` の `gentle` を読む。
  snapMaxTilt: 22,    // 駒がこれより傾いていると吸着しない 度
  snapMaxHeight: 3.8, // 面からこれより高い位置で離すと落ちる cm（持ち上げ高さより大きくないと吸着しない）
  snapTime: 0.085,    // 吸着にかける時間 s
  throwScale: 0.4,    // 離したとき手の速度をどれだけ駒に渡すか
  // 盤面を読むときの判定。吸着とは別物（吸着は駒を動かす、こちらは読むだけ）なので
  // 閾値も別に持つ。吸着「切」でも同じように読める。
  readMaxDist: 1.1,   // 升の中心からこの距離以内なら「その升にある」cm
  readMaxTilt: 12,    // これより傾いていたら読まない 度
  readMaxLift: 0.4,   // 盤面からこれ以上浮いていたら読まない cm（重ねた駒を外す）
  volume: 0.9,
  showLastMove: false, // 最後に動いた駒の升を光らせる。盤に無い情報なので既定は消す
  showCoords: true,    // 盤の端の符号（筋・段）
  standHandles: true,  // 駒台の塊をまとめて動かす取っ手。掴める所が見えないと使えないので出す
  overlap: false,      // 駒を他の駒に重ねられるか。既定は不可（すべらせて指すのを邪魔しない）
  // 吸着は入／切の2つ。**かつての 強／弱 は「揺らぎ」に置き換わった**。
  // 「弱」の主目的は"そっと置いたときだけ吸う"ことではなく、実物のような手触りだったので、
  // 揺らぎを入れたことで分ける理由が消えた。
  snapMode: "on",     // on=盤か駒台の上で離せば升に収まる / off=吸わない（物理のまま）
  // **揺らぎは入／切で選ぶ**（`#wobblemode`）。量のスライダーは開発用に残してあるが、
  // **使う人に何本もスライダーを触らせるものではない**。
  wobbleOn: true,
  // 升の中心にぴたりと置かない量 cm。0 で中心ぴったり。
  // **上限は読み取り（readMaxDist）の内側に必ず収める**（`wobbleOffset`）。
  wobble: 0.35,
  // 駒の仕上げ（彫・彫埋・盛上）の調整。**使う人に出すのは仕上げの三択だけ**で、
  // ここの3つは開発用（`#params-relief`）。見え方は机上で決まらないので触って決める。
  // **この3つは実機で見て決めた値**（2026-08-20）。勝手に変えない。
  // 当初の 1.0 / 0.05 / 0.16 では**漆の光沢が過剰に出るか、逆にまったく分からないかの
  // どちらかになった**。盛りを下げると光沢が落ち着き、字の所だけが
  // 艶やかになる。視点を変えても光が過剰に反射しない。
  reliefHeight: 0.4,  // 盛り上がりの強さ。0 で平ら（＝彫埋と同じ）
  reliefBlur: 0.01,   // 漆の丸み。駒の長手に対する比。0 に近いほど角が立つ
  reliefGloss: 0.2,   // 漆の粗さ。小さいほど艶やか（木地は 0.42）
  captureMode: "hand", // off=重なるだけ / hand=取った駒を手に持つ / stand=駒台へ送る
  // 駒台に乗せたら、その駒台の持ち主の向き・表向きに直すか。
  // 取って駒台へ送る経路（sendToStand）は元から揃えているので、既定 on で揃う。
  standTidy: true,
  mode: "piece",      // 指のドラッグで何を動かすか。piece=駒 / camera=視点
};

// --- 設定を覚える -------------------------------------------------------
//
// カメラの位置・見た目・吸着や音の設定を localStorage に残す。
// **栞は保存しない**（要件どおり。リロードで消えてよい）ので、ここには混ぜない。
//
// **覚えるのは「押したボタン」と「スライダーの値」。** 状態そのものではなく操作を
// 覚えておけば、復元は同じボタンを押すだけで済み、**副作用（影の作り直し、駒台の配置換え、
// 書体の描き直し）も本物のクリックと同じ経路を通る**。状態を直接書き戻す作りにすると、
// その副作用を一つずつ手で呼び直すことになり、必ずどれか忘れる。
//
// **壊れていたら黙って捨てる。** 覚えた設定が読めないせいで盤が出ないほうが困る。

const STORE_KEY = "shogi-proto/settings/v1";
const segValues = {}; // セグメント（#id → data-v）。いま選ばれているもの
let stored = {};
try { stored = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { stored = {}; }

// 数値はここで P へ戻しておく。**スライダーは P を初期値にして組み立てる**ので、
// 先に入れておかないとつまみの位置だけ既定のままになる。
if (stored.num) {
  for (const [k, v] of Object.entries(stored.num)) {
    if (typeof P[k] === "number" && typeof v === "number" && isFinite(v)) P[k] = v;
  }
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer); // カメラは動かすたびに呼ばれるのでまとめる
  saveTimer = setTimeout(() => {
    const num = {};
    for (const [k, v] of Object.entries(P)) if (typeof v === "number") num[k] = v;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        seg: segValues, num, cam: { r: cam.r, theta: cam.theta, phi: cam.phi },
      }));
    } catch {} // 容量切れ・サイトデータ禁止など。覚えられなくても動くほうを取る
  }, 400);
}

let oneChar = false; // 一字駒かどうか

// --- 3D -----------------------------------------------------------------
const app = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// **影は動いたときだけ描き直す。** 既定（autoUpdate）では、駒が1枚も動いていなくても
// 40枚ぶんの影を毎フレーム 2048×2048 のマップへ描き直す。盤を眺めているだけの時間も
// ずっとで、見た目には何も変わらない。更新は tick で立てる（下の `needsUpdate`）。
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#1b1815");
scene.fog = new THREE.Fog("#1b1815", 150, 400);

const camera = new THREE.PerspectiveCamera(38, 1, 1, 800);

// 起動時はほぼ真上から見下ろす（phi は天頂からの角度なので 0.25 で見下ろし約76度）。
// 斜めから始めると毎回まず視点を直すことになるので、盤面が読める向きを既定にする。
// 完全な真上（0.12）にはしない。駒の厚みと影が消えて、駒台の扇が何度開いているか分からなくなる。
const cam = { r: 84, theta: 0, phi: 0.25, target: new THREE.Vector3(0, TOP_Y, 0) };
function applyCamera() {
  cam.phi = THREE.MathUtils.clamp(cam.phi, 0.12, 1.48);
  cam.r = THREE.MathUtils.clamp(cam.r, 22, 220);
  camera.position.set(
    cam.target.x + cam.r * Math.sin(cam.phi) * Math.sin(cam.theta),
    cam.target.y + cam.r * Math.cos(cam.phi),
    cam.target.z + cam.r * Math.sin(cam.phi) * Math.cos(cam.theta)
  );
  camera.lookAt(cam.target);
  // 符号は読める向きに保つ。相手側に回り込んだら上下をひっくり返す。
  if (coords) {
    const flip = Math.cos(cam.theta) < 0;
    for (const m of coords.children) m.rotation.z = flip ? Math.PI : 0;
  }
  saveSettings(); // 視点も覚える。まとめて書くので回している間の負担にはならない
}

scene.add(new THREE.HemisphereLight("#cfd8ff", "#3a3128", 0.42));

const key = new THREE.DirectionalLight("#fff2dc", 1.75);
key.position.set(-40, 72, 46);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 20;
key.shadow.camera.far = 200;
const S = 48;
Object.assign(key.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.04;
scene.add(key);

const fill = new THREE.DirectionalLight("#9fb4ff", 0.35);
fill.position.set(44, 30, -36);
scene.add(fill);

scene.add(createBoard());
scene.add(createStands());
scene.add(createFloor());
const boxNode = createBox();
scene.add(boxNode);

// 吸着先の目印。掴んでいる間だけ出す。棋譜ガイドの下地にもなる。
const marker = new THREE.Mesh(
  new THREE.PlaneGeometry(SQ.w * 0.92, SQ.d * 0.92),
  new THREE.MeshBasicMaterial({ color: "#5ce08a", transparent: true, opacity: 0.3, depthWrite: false })
);
marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

// 最後に動いた駒がいる升。既定は消しておく（盤に無い情報なので邪魔になりうる）。
const lastMoveMark = new THREE.Mesh(
  new THREE.PlaneGeometry(SQ.w * 0.94, SQ.d * 0.94),
  new THREE.MeshBasicMaterial({ color: "#d8b45a", transparent: true, opacity: 0.34, depthWrite: false })
);
lastMoveMark.rotation.x = -Math.PI / 2;
lastMoveMark.visible = false;
scene.add(lastMoveMark);

// 選んだ駒に敷く印。駒を掴んで動かさずに離すと選ばれ、脇に ⟳ ボタンが出る。
const selectMark = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  // ⟳ は駒から離れた所に出る（駒に重ねると掴む操作と食い合う）ので、
  // どの駒を選んだのかは印のほうで見せる。薄いと分からない。
  new THREE.MeshBasicMaterial({ color: "#5ce08a", transparent: true, opacity: 0.42, depthWrite: false })
);
selectMark.rotation.order = "YXZ"; // 先に寝かせてから yaw で回す
selectMark.visible = false;
scene.add(selectMark);

// 盤の端の符号。向きは applyCamera で視点に合わせる。
const coords = createCoords();
coords.visible = P.showCoords;
scene.add(coords);

// --- 物理 ---------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -981, 0) }); // cm/s^2
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 20; // 12 では駒どうしが重なったまま戻らないことがある

const matPiece = new CANNON.Material("piece");
const matBoard = new CANNON.Material("board");
// 摩擦は実測値より高め。木の駒は落としてもその場で止まり、盤の上を滑って行かない。
world.addContactMaterial(new CANNON.ContactMaterial(matPiece, matBoard, { friction: 0.72, restitution: 0.10 }));
// **駒どうしの接触は柔らかくする**（2026-08-20 に 1e8/緩和2 から変更）。
//
// 硬い接触（1e8）は、めり込みを一気に解こうとして**駒を勢いよく弾き飛ばす**。
// 掴んだ駒はすり抜けて運べるので、離した瞬間に隣の駒と食い込んだ状態から始まることが
// あり、そこで暴れる。再現手順（吸着「切」で、玉を金と銀の間・銀桂角の間に
// 置く）で実測すると、**最大 52cm/s で弾かれ、駒音が鳴り、滑り落ちてはひとりでに
// 上へ戻る往復**が起きていた。柔らかくすると 14cm/s まで下がり、音も鳴らなくなる。
//
// **柔らかくしてもめり込みは残らない**（実測で 0 組）。当初「既定の 1e7 では
// めり込みから戻りきらない」として硬くしたが、**解消が遅いのと戻らないのは別**で、
// 反復（`solver.iterations` 20）が効くので時間をかければ戻る。
// 弾き飛ばすほうが実害が大きい。
//
// **反発（restitution）も 0 にする。** 実木の駒は当たっても跳ねない。
world.addContactMaterial(new CANNON.ContactMaterial(matPiece, matPiece, {
  friction: 0.42,
  restitution: 0,
  contactEquationStiffness: 2e6,
  contactEquationRelaxation: 8,
}));

const staticBodies = new Set();
function addStatic(shape, x, y, z) {
  const b = new CANNON.Body({ mass: 0, material: matBoard, shape });
  b.position.set(x, y, z);
  world.addBody(b);
  // **AABB を自分で作り直す。** これが無いと当たり判定の候補に上がらず、
  // **駒がすり抜ける**（駒箱の底で実際に起きた。1.5cm の高さから落としても
  // 接触が 1 度も検出されず、床まで落ちていた）。
  // 剛体の位置は `position.set()` で後から入れているが、これは Vec3 を書き換えるだけで
  // 「AABB を作り直せ」の印が立たない。印は shape を足したときに一度立つきりなので、
  // **物理が最初に AABB を作った時点の位置**（＝原点）で固まったままになる。
  // 盤や駒台で表に出なかったのは、たまたま作り直しの機会があっただけ。
  b.aabbNeedsUpdate = true;
  b.updateAABB();
  return b;
}

addStatic(new CANNON.Box(new CANNON.Vec3(BOARD.w / 2, BOARD.h / 2, BOARD.d / 2)),
  0, BOARD.legH + BOARD.h / 2, 0);
for (const s of STANDS) {
  s.body = addStatic(new CANNON.Box(new CANNON.Vec3(STAND.w / 2, STAND.h / 2, STAND.d / 2)),
    s.x, STAND.topY - STAND.h / 2, s.z);
}

// 駒箱。**底だけでなく壁も要る。** 見た目の板を作っただけでは物理の実体が無く、
// 駒が壁をすり抜けて外へ出ていく（吸着「切」だと箱の外へこぼれて消えたように見える）。
//
// **物理の板は見た目より厚くする。** cannon-es は連続衝突判定をしないので、
// 1 ステップ（1/120 秒）で進む距離が板の厚みを超えると**すり抜ける**。
// 底は 0.9cm しかないのに、12cm の高さから落ちた駒は 153cm/s ＝ 1 ステップ 1.28cm 進み、
// **底を抜けて床に落ちていた**（実測）。当たり面（内側）の位置は変えず、
// 見えない外側へ厚みを足す。
const BOX_SOLID = 4; // 物理の板の厚み cm
const boxBodies = [];
{
  const wallH = BOX.h - BOX.floor;
  // 底。上面を BOX.floor に合わせたまま、下へ伸ばす（床の下は見えない）。
  boxBodies.push(addStatic(
    new CANNON.Box(new CANNON.Vec3(BOX.w / 2, BOX_SOLID / 2, BOX.d / 2)),
    KOMABAKO.x, BOX.floor - BOX_SOLID / 2, KOMABAKO.z));
  // 壁。内面を保ったまま外へ伸ばし、高さも上へ伸ばして飛び越えにくくする。
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const inner = { x: BOX.w / 2 - BOX.wall, z: BOX.d / 2 - BOX.wall };
    const hw = ax ? BOX_SOLID / 2 : BOX.w / 2 + BOX_SOLID;
    const hd = ax ? BOX.d / 2 + BOX_SOLID : BOX_SOLID / 2;
    boxBodies.push(addStatic(
      new CANNON.Box(new CANNON.Vec3(hw, wallH, hd)),
      KOMABAKO.x + ax * (inner.x + BOX_SOLID / 2),
      BOX.floor + wallH,
      KOMABAKO.z + az * (inner.z + BOX_SOLID / 2)));
  }
}

function applyStandLayout(name) {
  clearSelection();
  // 載っている持ち駒は駒台ごと運ぶ。並べ方は崩さない。
  const carried = STANDS.map((s) => ({ s, x: s.x, z: s.z, list: piecesOnStand(s) }));
  setStandLayout(name);
  for (const s of STANDS) s.body.position.set(s.x, STAND.topY - STAND.h / 2, s.z);

  for (const c of carried) {
    const dx = c.s.x - c.x;
    const dz = c.s.z - c.z;
    if (!dx && !dz) continue;
    for (const p of c.list) {
      p.body.position.x += dx;
      p.body.position.z += dz;
      p.mesh.position.copy(p.body.position);
    }
  }
  // 駒台そのものが動く。**駒と違って tick の比較には出ない**（ここでメッシュまで
  // 動かしているので、次のフレームでは剛体と一致してしまう）ので明示的に描き直させる。
  renderer.shadowMap.needsUpdate = true;
}
const floorBody = new CANNON.Body({ mass: 0, material: matBoard, shape: new CANNON.Plane() });
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);
staticBodies.add(floorBody);

// --- 駒 -----------------------------------------------------------------
/** @type {{kindId:string,size:{w:number,l:number,t:number},mesh:THREE.Mesh,body:CANNON.Body,settle:object|null}[]} */
const pieces = [];
const meshes = [];

let lastSoundAt = 0;
// 音の種類ごとの直近再生時刻。指す音と置く音は同時に鳴ってよい。
const lastPlayed = { clack: 0, slide: 0, place: 0 };
const soundLog = [];  // ぶつかって鳴った音の記録（調査用）
const settleLog = []; // 置いて鳴った音の記録（調査用）
let spillQuietUntil = 0; // ぶちまけた駒が落ち着くまで駒音を止める時刻
let calmDeadline = 0;    // ここを過ぎても動いている駒は手で寝かせる（下の tick を読む）

function collisionSound(piece, e) {
  const now = performance.now();
  // **ぶちまけている間は駒音を鳴らさない。**
  // 40 枚が一斉に落ちて跳ね回るので、下の 45ms のクールダウンでは全く追いつかない。
  // 実物でも「ジャラッ」はひと塊の音として聞こえるもので、駒 1 枚ずつの音は要らない。
  // **時間で黙らせる。** 「盤の上か」「まだ動いているか」で判定すると、跳ねて落ち着く
  // までの取りこぼしが必ず出る（すべらせて指すときの音で一度失敗している）。
  if (now < spillQuietUntil) return null;
  if (now - lastSoundAt < 45) return; // 一斉に鳴ると音が潰れる
  // **小さな当たりでは鳴らさない。** 山になった駒は寝るまでのあいだ 5〜9cm/s で
  // 押し合うので、6 のままだとそのあいだ鳴り続ける。
  // 実際に指したときの当たりは 30cm/s 以上あるので、上げても取りこぼさない。
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 12) return;

  // 盤の上か、駒台・駒箱の上でだけ鳴らす。床にこぼれた駒がぶつかるたびに駒音が鳴るのは
  // 変なので、そこは無音でよい。
  const p = piece.body.position;
  const onStand = !!nearestStand(p.x, p.z) || !!nearestBox(p.x, p.z);
  const onBoard = Math.abs(p.x) <= BOARD.w / 2 && Math.abs(p.z) <= BOARD.d / 2 && p.y > TOP_Y - 1;
  if (!onStand && !onBoard) return null;

  lastSoundAt = now;
  const s = THREE.MathUtils.clamp(v / 150, 0.06, 1);
  soundLog.push({
    piece: piece.kindId,
    other: e.body.__piece ? e.body.__piece.kindId : "静止物",
    held: grab.piece ? grab.piece.kindId : null,
    slide: grab.slide,
    v: +v.toFixed(1),
    at: now,
  });
  if (soundLog.length > 60) soundLog.shift();
  if (!staticBodies.has(e.body)) { playClick(s); return "click"; } // 駒どうし
  // 盤に当たれば指す音、駒台・駒箱なら置く音。どちらも静的ボディなので、
  // ここで分けないと吸着「切」のとき駒台に乗せても ﾊﾞﾁｯ と鳴る
  // （吸着したときは endGrab 側で音を決めるが、切だとそこを通らない）。
  if (onStand) { playPlace(s); return "place"; }
  playClack(s);
  return "clack";
}

function createPiece(kindId) {
  const k = KINDS[kindId];
  const size = SIZES[k.size];

  const mesh = new THREE.Mesh(getPieceGeometry(k.size), getPieceMaterials(kindId, oneChar));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const body = new CANNON.Body({
    mass: size.w * size.l * size.t * 0.2, // 実物と同じで王将が重く歩が軽い
    material: matPiece,
    shape: new CANNON.Box(new CANNON.Vec3(size.w / 2, size.t / 2, size.l / 2)),
    linearDamping: 0.14,
    angularDamping: 0.20,
  });
  body.allowSleep = true;
  // **寝る閾値は高めにする。** 1.2cm/s だと、駒が山になったとき押し合いが止まらず
  // **10 秒経っても 40 枚中 5 枚しか寝ない**（実測。速度 3〜5cm/s で蠢き続け、
  // そのあいだ衝突音が鳴り続ける）。4cm/s なら全部寝る。
  // **減衰（damping）はいじらない。** 上げても寝ないものは寝ず、駒を払ったときの
  // 滑りだけが鈍る。効いているのはこの閾値のほう（実測で 40cm/s で払った距離は
  // 0.4cm → 0.2cm しか変わらない）。
  body.sleepSpeedLimit = 4;
  body.sleepTimeLimit = 0.35;
  world.addBody(body);

  const piece = { kindId, size, mesh, body, settle: null };
  body.addEventListener("collide", (e) => {
    if (grab.piece === piece || piece.settle) return;
    // 手に持っている駒・収まりかけの駒は collisionResponse = false ですり抜けるが、
    // ぶつかられた側にはイベントが来る。押しのけてもいないのに鳴るのは変なので黙らせる。
    // （すべらせて指すと周りの駒がいちいち鳴るのはこれが原因）
    const other = e.body.__piece;
    if (other && other.settle) return;
    // 駒を運んでいる間、運んでいる駒**以外**は鳴らさない。
    // 掴んだ駒は collisionResponse = false ですり抜けるので、押しのけて鳴ることはない。
    // 実際に鳴るのは「すり抜けで目を覚ました駒が盤に着地し直す音」だけで、これは要らない。
    // すり抜けた瞬間ではなく少し遅れて着地するので、近さで判定しても取りこぼす。
    if (grab.piece) return;
    collisionSound(piece, e);
  });

  mesh.userData.piece = piece;
  body.__piece = piece; // 衝突相手からも駒を辿れるようにする
  pieces.push(piece);
  meshes.push(mesh);
  return piece;
}

for (const [kindId] of HIRATE) createPiece(kindId);

function setPiecePose(piece, x, y, z, yaw, flipped = false) {
  const b = piece.body;
  piece.settle = null;
  b.type = CANNON.Body.DYNAMIC;
  b.updateMassProperties();
  b.collisionResponse = true;
  b.position.set(x, y, z);
  flatQuaternion(yaw, flipped, tmpQ);
  b.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
  b.velocity.setZero();
  b.angularVelocity.setZero();
  b.wakeUp();
  piece.mesh.position.copy(b.position);
  piece.mesh.quaternion.copy(b.quaternion);
  // ここでメッシュまで動かすので tick の比較には出ない（初期配置・掴む前の位置へ戻す）。
  renderer.shadowMap.needsUpdate = true;
}

// --- 盤面をまるごと控える／戻す -----------------------------------------
//
// 栞と「元に戻す」が共有する土台。どちらも**盤面（readBoard）ではなく駒の姿勢を
// そのまま覚える**。読み取りは升に収まった駒しか見ないので、崩れた盤面も
// 駒台の並びも復元できない。
//
// **使う側（setupPosition）より前に置いてある。** 中の `undoStack` は const なので、
// 起動時の `resetHirate()` がここより先に走ると初期化前に触ることになる。

/**
 * 全駒の姿勢を控える。
 *
 * **収まりかけの駒は行き先（settle.to / toQ）を覚える。** 途中の姿勢を覚えると、
 * 戻したときに升の手前で止まった中途半端な配置になる。
 */
function capturePoses() {
  return pieces.map((p) => ({
    p,
    x: p.settle ? p.settle.to.x : p.body.position.x,
    y: p.settle ? p.settle.to.y : p.body.position.y,
    z: p.settle ? p.settle.to.z : p.body.position.z,
    q: (p.settle ? p.settle.toQ : p.mesh.quaternion).clone(),
  }));
}

/**
 * 控えた姿勢へ一斉に戻す。**瞬間で戻す。音も動きもない。**
 *
 * 盤面がまるごと入れ替わるので、最終手ハイライトと最善手の矢印は捨てる
 * （resetHirate と同じ扱い。戻すのは指し手ではない）。
 */
function applyPoses(poses) {
  if (grab.piece) endGrab();
  if (chainGrab.list) endChainGrab();
  clearSelection();
  for (const s of poses) {
    const b = s.p.body;
    s.p.settle = null;
    // 駒台の持ち駒と駒箱の駒は静止物に戻す（重ねると箱どうしが重なるため）。
    const at = placeAt(s.x, s.z);
    const onStand = !!at && at.stacks;
    b.type = onStand ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.position.set(s.x, s.y, s.z);
    b.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
    b.velocity.setZero();
    b.angularVelocity.setZero();
    s.p.mesh.position.copy(b.position);
    s.p.mesh.quaternion.copy(b.quaternion);
    if (!onStand) b.sleep();
  }
  lastMove = null;
  prevBoard = null;
  clearArrow();
  // ここでメッシュまで直接動かすので tick の比較には出ない。明示的に立てる。
  renderer.shadowMap.needsUpdate = true;
}

// --- 元に戻す -----------------------------------------------------------
//
// 物理サンドボックスは誤操作が起きやすい（払って駒が飛ぶ、置く場所を間違える、
// 塊ごと動かしてしまう）ので、ひとつ前の配置へ戻る口を用意する。
//
// - **絵は持たない。** 一覧しないので姿勢だけでよい（栞は名前が無いぶん絵で見分ける）
// - **積むのは操作の入口。** 掴む・状態を進める・並べ直す・ぶちまける・片付ける
// - **戻すときに「いまと同じ段」は読み飛ばす。** ちょんと触って離しただけ
//   （＝駒のボタンを出しただけ）でも入口は通るので、そのままだと押しても何も
//   変わらない段が挟まる。**積む側で判じるより、戻す側で飛ばすほうが漏れない**
//   （入口では「これから変わるか」がまだ分からない）
// - **Redo は作らない。** 実物の盤に無いし、戻しすぎたら栞で拾える

const UNDO_MAX = 50;
const undoStack = [];
const undoBtn = document.getElementById("btn-undo");

/**
 * 同じ配置か。**物理の微動で「違う」と読まれないよう、駒 1 枚分よりずっと粗く見る。**
 * 駒を動かせば必ず 1cm 以上動くので、0.05cm を境にしても取りこぼさない。
 */
function posesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const s = a[i], t = b[i];
    if (s.p !== t.p) return false;
    if (Math.abs(s.x - t.x) > 0.05) return false;
    if (Math.abs(s.y - t.y) > 0.05) return false;
    if (Math.abs(s.z - t.z) > 0.05) return false;
    // 四元数は符号を反転しても同じ姿勢なので、内積の絶対値で見る
    if (Math.abs(s.q.dot(t.q)) < 0.9995) return false;
  }
  return true;
}

function refreshUndo() {
  if (undoBtn) undoBtn.disabled = !undoStack.length;
}

/** これから盤面が変わる、という所で呼ぶ。 */
function pushUndo() {
  undoStack.push(capturePoses());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  refreshUndo();
}

/** ひとつ前の配置へ戻す。戻る先が無ければ false。 */
function undo() {
  const now = capturePoses();
  let ok = false;
  while (undoStack.length) {
    const poses = undoStack.pop();
    if (posesEqual(poses, now)) continue; // 何も変わらない段は飛ばす
    applyPoses(poses);
    ok = true;
    break;
  }
  refreshUndo();
  return ok;
}

undoBtn?.addEventListener("click", () => undo());

/**
 * 升の並びを一括で置く。**平手も駒落ちも SFEN の読み込みもここを通る。**
 *
 * `list` は `[kindId, file, rank, yaw, flipped]`。うしろ 2 つは省いてよく、
 * `yaw` を省くと**段 1-3 を後手**として向きを決める（平手と駒落ちはこれで足りる。
 * SFEN は駒ごとに先後が決まるので明示して渡す）。
 *
 * **駒の順番は問わない。** 駒種ごとのプールから配るので、同じ種類ならどれでもよい。
 * **リストに入らなかった駒は駒箱へ送る**（駒落ちで外した駒の置き場所）。送る駒が
 * あるのに駒箱がしまってあれば開くが、**設定のボタンを押す経路を通す**
 * （`ensureFit` と物理の実体の出し入れがぶら下がっているので、`KOMABAKO.visible` を
 * 直接触ると必ずどれか忘れる）。
 */
function setupPosition(list, hands = null) {
  pushUndo();
  grab.piece = null;
  // 駒種ごとのプール。pieces は HIRATE の順に作ってあるので、種類さえ合えばどれでもよい。
  const pool = new Map();
  for (const p of pieces) {
    if (!pool.has(p.kindId)) pool.set(p.kindId, []);
    pool.get(p.kindId).push(p);
  }
  // **配る前に全部いったん退ける。** 前の局面の持ち駒が駒台に残っていると、
  // 下の `sendToStand` がそれを既存の駒として拾って寄り添い、あとでその駒が
  // 駒箱へ移って扇が歯抜けになる。同期処理なので画面には出ない。
  for (const p of pieces) {
    p.settle = null;
    p.body.position.set(0, -100, 0);
    p.mesh.position.copy(p.body.position);
  }
  for (const [kindId, file, rank, yaw, flipped = false] of list) {
    const piece = pool.get(kindId)?.pop();
    if (!piece) continue; // 駒が足りない並びは黙って落とす（数の検査は呼ぶ側の仕事）
    const c = squareToWorld(file, rank);
    setPiecePose(piece, c.x, TOP_Y + piece.size.t / 2, c.z,
      yaw === undefined ? (rank <= 3 ? Math.PI : 0) : yaw, flipped);
  }
  // 持ち駒。**駒台へは `sendToStand` で置く**ので扇の並びが自動で組まれる。
  // **1 枚ごとに行き先を確定させる**（そうしないと次の駒が動く前の位置を見て扇が崩れる）。
  // 音は鳴らさない（並べ直しは指し手ではない。枚数ぶん鳴れば連打にもなる）。
  if (hands) {
    for (const owner of [0, 1]) {
      for (const kindId of hands[owner]) {
        const piece = pool.get(kindId)?.pop();
        if (!piece) continue;
        sendToStand(piece, owner, null);
        flushSettles();
      }
    }
  }
  const rest = [...pool.values()].flat();
  if (rest.length) {
    if (!KOMABAKO.visible) setSegment("boxmode", "on");
    putIntoBox(rest);
  }
  marker.visible = false;
  clearSelection();
  // 並べ直しは指し手ではない。差分として拾わせない。
  lastMove = null;
  prevBoard = null;
  // 解析した局面ごと消えるので、最善手の矢印も捨てる。
  clearArrow();
}

/** 平手の初期配置に一括で並べる。 */
function resetHirate() {
  setupPosition(HIRATE);
}

/**
 * 手合い割。**落とすのは上手（後手）の駒**なので、外す升はすべて段 1〜2 にある。
 *
 * 香落ちは**左香**（上手から見て左＝1筋）。四枚から下は落とす駒が増えていくだけで、
 * 上位の手合いは下位を含む。外した駒は `setupPosition` が駒箱へ送る。
 */
const HANDICAPS = {
  hirate: [],
  kyo:    [[1, 1]],
  kaku:   [[2, 2]],
  hisha:  [[8, 2]],
  hikyo:  [[8, 2], [1, 1]],
  "2":    [[8, 2], [2, 2]],
  "4":    [[8, 2], [2, 2], [1, 1], [9, 1]],
  "6":    [[8, 2], [2, 2], [1, 1], [9, 1], [2, 1], [8, 1]],
  "8":    [[8, 2], [2, 2], [1, 1], [9, 1], [2, 1], [8, 1], [3, 1], [7, 1]],
  "10":   [[8, 2], [2, 2], [1, 1], [9, 1], [2, 1], [8, 1], [3, 1], [7, 1], [4, 1], [6, 1]],
};

function setupHandicap(name) {
  const drop = HANDICAPS[name];
  if (!drop) return;
  setupPosition(HIRATE.filter(([, f, r]) => !drop.some(([df, dr]) => df === f && dr === r)));
}

function applyStyle() {
  for (const p of pieces) p.mesh.material = getPieceMaterials(p.kindId, oneChar);
  // ボタンの駒も同じ書体で描いてあるので、フォントが届いたら描き直す。
  // 中身のキーを捨ててから呼ぶ（同じ駒・同じ状態だと描き直さない作りなので）。
  turnBtn.dataset.icon = "";
  promoteBtn.dataset.icon = "";
  placePieceButtons();
}

// 同梱の駒字フォント（fonts/koma.woff2）は canvas に描いた後から届くことがある。
// 届いたら駒の面を描き直す。ファイルが無ければ何もしない。
document.fonts.load('100px "KomaFont"').then((found) => {
  if (!found.length) return;
  clearMaterialCache();
  applyStyle();
}).catch(() => {});

// --- 姿勢のたすけ -------------------------------------------------------
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
// 長手方向まわりの半回転。実際に駒をひっくり返すのと同じで、先端の向きは変わらない。
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

/** 平らに寝ているか。表でも裏でも 0° になる。 */
function tiltDegrees(q) {
  tmpV.set(0, 1, 0).applyQuaternion(q);
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(Math.abs(tmpV.y), 0, 1)));
}

function isFlipped(q) {
  tmpV.set(0, 1, 0).applyQuaternion(q);
  return tmpV.y < 0;
}

function yawOf(q) {
  const f = tmpV.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

/** 盤に平らに置いた姿勢。 */
function flatQuaternion(yaw, flipped, out = new THREE.Quaternion()) {
  out.setFromEuler(new THREE.Euler(0, yaw, 0));
  if (flipped) out.multiply(Q_FLIP);
  return out;
}

/**
 * 升に収まる姿勢。将棋の駒は自分向きか相手向きしかないので向きは180度単位。
 * 90度単位にすると横倒しのまま吸い付いてしまう。
 *
 * ただし丸めてよいのは升に吸着させるときだけ。成りや向き変更でこれを通すと、
 * 駒台で角度をつけて並べてある駒が、裏返した拍子にまっすぐ揃ってしまう（round = false）。
 */
function settledQuaternion(piece, out, extraYaw = 0, round = true) {
  const q = piece.mesh.quaternion;
  const a = yawOf(q) + extraYaw;
  return flatQuaternion(round ? Math.round(a / Math.PI) * Math.PI : a, isFlipped(q), out);
}

/**
 * 位置と姿勢をアニメーションで整える。
 * @param {string} sound 収まった瞬間に鳴らす音（clack / slide / place / null）
 */
function startSettle(piece, to, toQ, sound = "clack", pitch = 1) {
  const b = piece.body;
  b.collisionResponse = false; // 収まるまでは他の駒を押しのけない
  piece.settle = {
    t: 0,
    sound,
    pitch,
    from: new THREE.Vector3(b.position.x, b.position.y, b.position.z),
    to: to.clone(),
    fromQ: piece.mesh.quaternion.clone(),
    toQ: toQ.clone(),
  };
  b.type = CANNON.Body.KINEMATIC;
  b.updateMassProperties();
  b.wakeUp();
  b.velocity.setZero();
  b.angularVelocity.setZero();
}

// --- 置き場所 -----------------------------------------------------------
//
// **場所ごとの性質もここで持たせる。** 面の高さ・重ね方・升へ吸うか・持ち駒として読むかは
// 置き場所で決まるので、呼ぶ側で `kind === "stand"` と書き分けると、**置き場所が増える
// たびに同じ形の分岐が全部に増える**（駒箱を足す前で 27 箇所あった）。見落とすと
// 「駒箱では音が鳴らない」「駒箱の駒が解析で"読めない駒"に数えられる」という形で
// ばらばらに出る。
//
// - `topY`   駒が乗る面の高さ
// - `grid`   升の中心へ吸い込むか（升だけ）
// - `stacks` 重ねたら段が上がる場所か（駒台と駒箱。升は駒の上に乗るので別扱い）
// - `hand`   そこにある駒を持ち駒として読むか（駒台だけ）

/** 盤の升か駒台か駒箱か。どれでもなければ null。 */
function placeAt(x, z) {
  const sq = nearestSquare(x, z);
  if (sq) {
    return { kind: "square", x: sq.x, z: sq.z, dist: sq.dist, file: sq.file, rank: sq.rank,
      baseY: TOP_Y, topY: TOP_Y, grid: true, stacks: false, hand: false };
  }
  // 駒台にも駒箱にも升がないので、置いた場所をそのまま使う
  const st = nearestStand(x, z);
  if (st) {
    return { kind: "stand", x, z, dist: 0, stand: st, baseY: STAND.topY, topY: STAND.topY,
      grid: false, stacks: true, hand: true, stackR: STACK_R };
  }
  const bx = nearestBox(x, z);
  if (bx) {
    return { kind: "box", x, z, dist: 0, box: bx, baseY: BOX.topY, topY: BOX.topY,
      grid: false, stacks: true, hand: false, stackR: BOX_STACK_R };
  }
  return null;
}

/**
 * そこに既に駒があれば、その上に載る高さを返す。ignore は数えない（取ってどける駒）。
 *
 * 重なりは升ではなく実寸で見る。`nearestSquare` は距離を問わず最寄りの升を返すので、
 * 升で見ると升の中心から外れて置かれた駒まで「同じ升にいる」と数えてしまい、
 * 上にも下にも駒がないのに slide（ｶﾁｶﾁ）が鳴る原因になる。
 */
function surfaceY(piece, spot, ignore) {
  let top = spot.baseY;
  for (const p of pieces) {
    if (p === piece || p === ignore) continue;
    const pp = p.body.position;
    if (Math.hypot(pp.x - spot.x, pp.z - spot.z) < (piece.size.w + p.size.w) * 0.38) {
      top = Math.max(top, pp.y + p.size.t / 2);
    }
  }
  return top + piece.size.t / 2;
}

// 駒台で「上に載せた」とみなす中心どうしの近さ。両駒の幅の和に掛ける。
//
// **肩を接して並んだ隣の駒を「下」と数えてはいけない。** 駒台の持ち駒は五角形の肩どうしを
// くっつけて扇に開くので、実寸の箱としては必ず重なる。実測した肩接続の中心間距離は
// 駒幅の 0.79 倍（歩どうしで 1.74cm、飛どうしで 2.20cm）で、盤用 `surfaceY()` の
// 0.38（歩で 1.67cm）とほとんど差がない。**だから盤の判定を流用すると、隣に寄り添った
// だけの駒を下にいる駒と数えて浮かせてしまう。** 半分以下に絞る（歩で 0.88cm）。
const STACK_R = 0.2;
// 駒箱の中には寄り添い（扇）が無いので、**近くに置いたら上に載せてよい**。
// 駒台と同じ 0.2 のままだと、少し離した所に置いた駒が同じ段に並んで**実寸の箱が重なる**
// （駒箱の中に置いた駒どうしが普通に重なってしまう）。歩どうしで 1.98cm、
// 駒の幅 2.2cm より狭ければ重ねる、という見方になる。
const BOX_STACK_R = 0.45;

/** そこが「重ねたら段が上がる場所」なら面の高さと重なりの半径。升や床なら null。 */
function stackSpotAt(x, z) {
  const s = placeAt(x, z);
  return s && s.stacks ? s : null;
}

/**
 * 駒台や駒箱で駒を重ねたときの上面の高さ。下にいる駒を数えて段を上げる。
 *
 * そこに収まった駒は STATIC なので物理では支えられない。ここで高さを決めないと、
 * 何枚重ねても同じ座標に居座る（物理的にありえない）。
 *
 * **下にいるかどうかは輪郭が重なるかで見る**（`pieceOutline`）。中心どうしの近さで
 * 見ていたのは、実寸の箱では扇の隣まで重なって数えてしまうためだったが、
 * 五角形で見れば寄り添った隣は重ならないので、その妥協が要らない。
 * おかげで**押し出しきれずに重なった駒はきちんと上に乗る**（詰まった駒箱で効く）。
 */
function stackSurfaceY(piece, x, z, ignore, yaw = null) {
  const here = stackSpotAt(x, z);
  let top = here ? here.topY : STAND.topY;
  const my = pieceOutline(piece, x, z, yaw === null ? yawOf(piece.mesh.quaternion) : yaw);
  for (const p of pieces) {
    if (p === piece || p === ignore || p === grab.piece) continue;
    const pp = p.body.position;
    if (!stackSpotAt(pp.x, pp.z)) continue; // 盤や床の駒は関係ない
    const hit = outlineSeparation(my, pieceOutline(p, pp.x, pp.z, yawOf(p.mesh.quaternion)));
    if (hit) top = Math.max(top, pp.y + p.size.t / 2);
  }
  return top + piece.size.t / 2;
}

/**
 * 駒台や駒箱の山を下から積み直す。**下の駒を抜いても上の駒は落ちてこない**
 * （そこに収まった駒は STATIC で物理が効かない）ので、抜いた側から並べ直す。
 *
 * 1枚ずつ下ろすのではなく**下から積み直す**。上から順に下ろそうとすると、
 * まだ動いていない下の駒を数えて元の高さのままになり、山が崩れない。
 */
function restackAt(x, z, removed) {
  const here = stackSpotAt(x, z);
  if (!here) return;
  // 抜けた駒の場所と輪郭が重なる駒＝その山にいた駒（`stackSurfaceY` と同じ見方）
  const gone = pieceOutline(removed, x, z, yawOf(removed.mesh.quaternion));
  const list = pieces.filter((q) => {
    if (q === removed || q === grab.piece) return false;
    const qq = q.body.position;
    if (!stackSpotAt(qq.x, qq.z)) return false;
    return !!outlineSeparation(gone, pieceOutline(q, qq.x, qq.z, yawOf(q.mesh.quaternion)));
  }).sort((a, b) => a.body.position.y - b.body.position.y);

  let top = here.topY;
  for (const q of list) {
    const y = top + q.size.t / 2;
    top = y + q.size.t / 2;
    if (Math.abs(q.body.position.y - y) < 0.01) continue;
    // 音は鳴らさない。1枚抜いただけで山のぶん鳴ると連打になる。
    startSettle(q, new THREE.Vector3(q.body.position.x, y, q.body.position.z),
      q.mesh.quaternion.clone(), null);
  }
}

/**
 * その位置に駒を置いたとき、他の駒に重なっているか。すべらせて指した音を出すかの判定。
 *
 * 升では見ない。升で見ると、隣の升をかすめただけで「重なった」ことになり、
 * 上にも下にも駒がないのに ｶﾁｶﾁ が鳴る。実際に駒と駒が重なったときだけ拾う。
 *
 * **円ではなく、駒の向きに沿った楕円で見る。** 駒は縦長（長さ 2.92 > 幅 2.62）なので、
 * 円で見ると縦の重なりを取りこぼす。7八金で7九の銀に乗りかかる置き方がまさにこれで、
 * 見た目には半分重なっているのに拾えない。升は 3.03 × 3.33 なので、
 * きちんと升の中心に置いてある駒どうしは触れない。
 *
 * @param front 手前に重なったときだけ拾う。すべらせて指す動作は手前の駒をこすって
 *   前へ送り出すものなので、奥や左右の駒に重なっただけなら数えない（鳴りすぎる）。
 */
function overPiece(piece, x, z, y, yaw, front = false) {
  for (const p of pieces) {
    if (p === piece || p.settle) continue;
    const pp = p.body.position;
    if (pp.y > y - 0.1) continue; // 自分より上にある駒は下敷きにしていない
    // 取る相手はどくので、かすめたことにならない。実際に駒を取るときは
    // 先に相手の駒を手に取ってから自分の駒を置くので、ぶつけているわけではない。
    if (P.captureMode !== "off" &&
        ownerOfYaw(yawOf(p.mesh.quaternion)) !== ownerOfYaw(yaw)) continue;
    const [dx, dz] = rot2(pp.x - x, pp.z - z, -yaw);
    const nx = dx / ((piece.size.w + p.size.w) * 0.5 * P.touchScale);
    const nz = dz / ((piece.size.l + p.size.l) * 0.5 * P.touchScale);
    if (nx * nx + nz * nz >= 1) continue;
    // 駒の先端はローカル -z を向くので、+z がその駒の持ち主から見た手前。
    // 手前を挟む45度の中にいる駒だけを「こすった」と数える。
    if (front && nz <= Math.abs(nx)) continue;
    return true;
  }
  return false;
}

/**
 * そこには収められないか。重なりを切っていて、その升に自分の駒がいるとき。
 * 相手の駒は取ればどくので邪魔にならない。
 */
function blockedAt(piece, spot, yaw) {
  // 吸着を切っているときは物理のまま。多少重なっても手を出さない。
  if (P.overlap || P.snapMode === "off" || !spot || spot.kind !== "square") return false;
  const t = topPieceAt(spot, piece);
  if (!t) return false;
  if (P.captureMode !== "off" && ownerOfYaw(yawOf(t.mesh.quaternion)) !== ownerOfYaw(yaw)) return false;
  return true;
}

/**
 * 升に収めるときの揺らぎ。**中心ぴったりに置かない。**
 * 升の上寄りで離したら少し上に、下寄りなら少し下に残し、払った勢いも少し乗せる
 * （実物の盤で駒を置いたときのわずかなズレ）。
 *
 * **必ず `readBoard()` が読める範囲に収める。** ここを越えると局面が読めなくなり、
 * 解析も栞も最終手ハイライトも一斉に壊れる。**升の線の近くで離したからといって
 * 線の上に置くのではない**。だから上限は `readMaxDist` の内側で、
 * `P.wobble` を大きくしても、読み取りを狭めても、そこが効く。
 *
 * 傾きと浮きは揺らさない。位置だけで足りるし、`readMaxTilt` / `readMaxLift` を
 * 脅かす理由がない。駒台は升ではない（寄り添いで場所が決まる）ので対象外。
 */
const WOBBLE_SAFE = 0.7;  // 読み取りの何割まで許すか。残りは読み取りの余裕として空ける
const WOBBLE_FLOW = 0.03; // 勢いをどれだけ距離に換える秒。26cm/s で 0.8cm ぶん

function wobbleOffset(spot, x, z, vel) {
  if (!P.wobbleOn || !P.wobble || !spot || spot.kind !== "square") return null;
  const lim = Math.min(P.wobble, P.readMaxDist * WOBBLE_SAFE);
  if (lim <= 0) return null;
  // 離した位置の名残。**升の縁いっぱいのズレがちょうど上限になるよう縮める。**
  // 基準は升そのもの（半升）。かつては `snapMaxDist` だったが、距離で吸着を止めるのを
  // やめたので、升の大きさから決めるほうが素直（升が変われば揺らぎもついてくる）。
  const kx = lim / (SQ.w / 2);
  const kz = lim / (SQ.d / 2);
  let dx = (x - spot.x) * kx + vel.x * WOBBLE_FLOW * kx;
  let dz = (z - spot.z) * kz + vel.z * WOBBLE_FLOW * kz;
  const d = Math.hypot(dx, dz);
  if (d > lim) { dx *= lim / d; dz *= lim / d; }
  return { x: dx, z: dz };
}

/** その升にいる駒のうち、いちばん上のもの。取られる駒。 */
function topPieceAt(spot, exclude) {
  let best = null;
  for (const p of pieces) {
    if (p === exclude) continue;
    const s = nearestSquare(p.body.position.x, p.body.position.z);
    if (!s || s.file !== spot.file || s.rank !== spot.rank) continue;
    if (Math.abs(p.body.position.y - TOP_Y) > 8) continue; // 盤の上に載っている駒だけ
    if (!best || p.body.position.y > best.body.position.y) best = p;
  }
  return best;
}

/** 駒の向きから持ち主を決める。向きが持ち主そのもの。 */
function ownerOfYaw(yaw) {
  const a = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return Math.abs(a) < Math.PI / 2 ? 0 : 1;
}

/** その駒台に載っている駒。 */
function piecesOnStand(stand) {
  return pieces.filter((p) => nearestStand(p.body.position.x, p.body.position.z) === stand);
}

/** xz平面の回転。three の Y軸回転と同じ向き。 */
function rot2(x, z, th) {
  const c = Math.cos(th), s = Math.sin(th);
  return [x * c + z * s, -x * s + z * c];
}

/**
 * 隣の駒に寄り添わせたときの置き場所。
 * base の足の角に piece の反対側の足の角を合わせるだけ。
 * 開く角度は五角形の辺の傾きがそのまま決めるので、こちらで角度を作らない。
 *
 * **接するのは足（底辺の左右の角）。** 実物は下辺を揃えて並べるため（`footOf` を読む）。
 * 辺は肩と足を結ぶ同じ 1 本なので、**同じ大きさの駒どうしでは肩で接しても結果は同じ**。
 * 差が出るのは大きさが違うときで、肩で接すると下辺がバラバラになる。
 * @param {number} side +1 なら base の右、-1 なら左
 */
function attachPose(bx, bz, byaw, bsize, piece, side) {
  const a = footOf(bsize);
  const b = footOf(piece.size);
  // 辺どうしが平行に重なる角度差。ここは接点を肩から足へ移しても変わらない。
  const yaw = byaw + side * (a.edge + b.edge);
  // ローカルは x=幅、z=長手（先端が -z）。**底辺は +z 側**なので足の z は +fy。
  const [ax, az] = rot2(side * a.fx, a.fy, byaw);
  const [px, pz] = rot2(-side * b.fx, b.fy, yaw);
  return { x: bx + ax - px, z: bz + az - pz, yaw };
}

function insideStand(stand, x, z) {
  return Math.abs(x - stand.x) <= STAND_INNER.w / 2
      && Math.abs(z - stand.z) <= STAND_INNER.d / 2;
}

/**
 * 駒が水平面で占める五角形。**実寸の箱ではなく実際の形で見る。**
 *
 * 扇は五角形の角どうしを接するので、**箱で見ると寄り添っただけの隣まで
 * 「重なっている」と読んでしまう**（そのために `STACK_R` を駒幅の半分以下まで
 * 絞ってあった）。実測すると、寄り添った扇は歩 5 枚でも 7 種混在でも
 * 五角形としては**一切重ならない**ので、形で見れば妥協が要らない。
 *
 * ジオメトリは `rotateX(-90°)` 済みで、**形状の +y（先端）はローカル -z を向く**。
 */
function pieceOutline(piece, x, z, yaw) {
  const s = piece.size, hw = s.w / 2, hl = s.l / 2;
  const sh = shoulderOf(s);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  return [[0, hl], [-sh.sx, sh.sy], [-hw, -hl], [hw, -hl], [sh.sx, sh.sy]]
    .map(([lx, ly]) => {
      const pz = -ly;
      return [x + lx * c + pz * sn, z - lx * sn + pz * c];
    });
}

/**
 * 2 つの輪郭が重なっていれば、A を離す向きと深さ（分離軸定理）。離れていれば null。
 * どちらも凸なので、辺の法線だけ調べれば足りる。
 */
function outlineSeparation(A, B) {
  let best = null;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      let ax = -(y2 - y1), ay = x2 - x1;
      const len = Math.hypot(ax, ay) || 1;
      ax /= len; ay /= len;
      let mnA = Infinity, mxA = -Infinity, mnB = Infinity, mxB = -Infinity;
      for (const [x, y] of A) { const d = x * ax + y * ay; if (d < mnA) mnA = d; if (d > mxA) mxA = d; }
      for (const [x, y] of B) { const d = x * ax + y * ay; if (d < mnB) mnB = d; if (d > mxB) mxB = d; }
      const o = Math.min(mxA, mxB) - Math.max(mnA, mnB);
      if (o <= 0) return null; // 分離軸が見つかった＝離れている
      if (!best || o < best.depth) {
        const dir = mnA + mxA < mnB + mxB ? -1 : 1; // A を B から遠ざける向き
        best = { depth: o, x: ax * dir, z: ay * dir };
      }
    }
  }
  return best;
}

/**
 * 置こうとした場所で他の駒と重なっていたら、重ならない所まで押し出す。
 *
 * **段を上げるのは「ほぼ真上に置いた」ときだけ**（`spot.stackR` の内側）。
 * 横からぶつかっただけなら、**押し出すほうが物として自然**
 * （高さで逃がすと、塊の端だけが乗ったときに反対側が宙に浮く）。
 *
 * 1 回で解けないことがあるので何度か繰り返す。深いものから順に解く。
 */
function pushOutOfPieces(piece, x, z, yaw, others, stackR) {
  let px = x, pz = z;
  for (let iter = 0; iter < 12; iter++) {
    const poly = pieceOutline(piece, px, pz, yaw);
    let hit = null;
    for (const q of others) {
      const qp = q.body.position;
      // ほぼ真上なら「上に乗せた」。押し出さず段に任せる。
      // **`stackSurfaceY` と同じ基準**（駒幅の和に掛ける）。駒箱は寄り添いが無いぶん
      // 広く（歩どうし 1.98cm）、駒台は扇を優先して狭く（同 0.88cm）取る。
      if (Math.hypot(qp.x - px, qp.z - pz) < (piece.size.w + q.size.w) * stackR) continue;
      const sep = outlineSeparation(poly, pieceOutline(q, qp.x, qp.z, yawOf(q.mesh.quaternion)));
      if (sep && (!hit || sep.depth > hit.depth)) hit = sep;
    }
    if (!hit) break;
    px += hit.x * (hit.depth + 0.02);
    pz += hit.z * (hit.depth + 0.02);
  }
  return { x: px, z: pz };
}

/**
 * 入れ物（駒台・駒箱）の内側に駒を収める。
 *
 * **駒の中心ではなく、駒が実際に占める広がりで見る。** 場所の判定（`nearestBox` /
 * `insideStand`）はどれも中心座標しか見ていないので、そのまま置くと**駒の半分が
 * 壁にめり込む**。駒箱は壁があるぶん目に見えて分かる（歩でも 1cm 以上刺さる）。
 *
 * 向きによって占める広がりが変わるので、回した矩形の外接で測る。
 */
function fitInside(spot, piece, x, z, yaw) {
  let cx, cz, hw, hd;
  if (spot.kind === "box") {
    cx = KOMABAKO.x; cz = KOMABAKO.z;
    hw = BOX.w / 2 - BOX.wall;  // 壁の内面まで
    hd = BOX.d / 2 - BOX.wall;
  } else if (spot.kind === "stand") {
    cx = spot.stand.x; cz = spot.stand.z;
    // 際ぴったりに寄せない。誤差で「駒台の外」と読まれて寄り添い先から外れる。
    hw = STAND_INNER.w / 2 - 0.05;
    hd = STAND_INNER.d / 2 - 0.05;
  } else {
    return { x, z };
  }
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
  const pw = (piece.size.w * c + piece.size.l * s) / 2;
  const pd = (piece.size.w * s + piece.size.l * c) / 2;
  const limX = Math.max(0, hw - pw), limZ = Math.max(0, hd - pd);
  return {
    x: cx + Math.max(-limX, Math.min(limX, x - cx)),
    z: cz + Math.max(-limZ, Math.min(limZ, z - cz)),
  };
}

/**
 * 駒台に置くときの落とし所。
 * 隣の駒の肩の近くで手を離せばそこに寄り添い、離れた所で離せばそのまま置かれる。
 * 並べ方に決まりはないので、勝手に整列させない。
 */
function standPlacement(piece, stand, x, z) {
  let best = null;
  for (const p of piecesOnStand(stand)) {
    if (p === piece) continue;
    const bp = p.body.position;
    for (const side of [1, -1]) {
      const pose = attachPose(bp.x, bp.z, yawOf(p.mesh.quaternion), p.size, piece, side);
      if (!insideStand(stand, pose.x, pose.z)) continue;
      // そこが既に埋まっていたら寄り添えない
      const blocked = piecesOnStand(stand).some((q) =>
        q !== piece && q !== p &&
        Math.hypot(q.body.position.x - pose.x, q.body.position.z - pose.z) < piece.size.w * 0.55);
      if (blocked) continue;
      const d = Math.hypot(pose.x - x, pose.z - z);
      // base と side は、くっついた後に並び全体の角度を揃えるのに要る
      if (!best || d < best.d) best = { ...pose, d, base: p, side };
    }
  }
  // 肩ひとつ分ぐらいまで近づけたら、くっつける
  if (best && best.d <= piece.size.w * 0.75) return best;
  return { x, z, yaw: null, base: null, side: 0 };
}

// --- 駒台の塊 -----------------------------------------------------------
//
// 駒台の駒は肩を接して扇状につながる。この一続きを「塊」として扱い、まとめて動かす。
// 「歩歩歩香桂桂」から香を打つと「歩歩歩」と「桂桂」に分かれるので、桂桂をまとめて
// 歩歩歩へ寄せられないと実物の感覚から離れる。扇は駒台からはみ出しやすく、
// 並びを崩さずに位置だけ直したい、というのも同じ話。
//
// 駒そのものを掴めば今までどおり1枚だけ動く。塊が動くのは取っ手を掴んだときだけで、
// 取っ手は駒に重ならない位置（並びの真ん中の駒の、先端側に少し出た所）に置く。
// 駒に重ねると1枚掴む操作と食い合う。取っ手は見えないと掴みようがないので出しっぱなしにする。

const ATTACH_TOL = 0.35;                            // つながっているとみなす位置のずれ cm
const ATTACH_TOL_YAW = THREE.MathUtils.degToRad(7); // 同じく向きのずれ
const HANDLE_R = 1.15;                              // 取っ手の半径 cm
const HANDLE_OPACITY = 0.20;

/** -π..π に畳んだ角度差。 */
function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** b が a の肩に寄り添っているか。a から見て右なら +1、左なら -1、離れていれば 0。 */
/**
 * 塊を判じるときの駒の姿勢。**収まりかけの駒は行き先を見る**
 * （`capturePoses` と同じ考え方）。
 *
 * 途中の姿勢で見ると、**まだ動いている駒だけ肩がつながっていないと読まれ、
 * そこで塊が割れる**。続けて駒を摘まむと前の駒が収まりきる前に次の判定が走るので、
 * 実際に起きる。
 */
function standPose(p) {
  return p.settle
    ? { x: p.settle.to.x, z: p.settle.to.z, yaw: yawOf(p.settle.toQ) }
    : { x: p.body.position.x, z: p.body.position.z, yaw: yawOf(p.mesh.quaternion) };
}

function attachedSide(a, b) {
  const ap = standPose(a), bp = standPose(b);
  for (const side of [1, -1]) {
    const pose = attachPose(ap.x, ap.z, ap.yaw, a.size, b, side);
    if (Math.hypot(pose.x - bp.x, pose.z - bp.z) > ATTACH_TOL) continue;
    if (Math.abs(angleDiff(pose.yaw, bp.yaw)) > ATTACH_TOL_YAW) continue;
    return side;
  }
  return 0;
}

/**
 * 駒台の駒を、肩でつながった一続きごとにまとめる。左端から右端の並び順で返す。
 * 状態は持たない。読むたびに駒の姿勢から作り直す（盤面の読み取りと同じ考え方）。
 * 記録方式にすると、掴んだ・打った・押されてズレた、をいちいち無効化して回る必要がある。
 */
function chainsOnStand(stand) {
  // **収まりかけの駒も数える**（`standPose` が行き先を見る）。除いてしまうと、
  // 続けて駒を摘まんだとき前の駒が抜けた形になり、そこで塊が割れる。
  const list = piecesOnStand(stand).filter((p) => p !== grab.piece);
  const right = new Map(), left = new Map();
  for (const a of list) {
    for (const b of list) {
      if (a === b) continue;
      const side = attachedSide(a, b);
      if (side > 0) { if (!right.has(a)) right.set(a, b); }
      else if (side < 0) { if (!left.has(a)) left.set(a, b); }
    }
  }
  const seen = new Set();
  const chains = [];
  for (const p of list) {
    if (seen.has(p)) continue;
    // 左端まで戻ってから右へ辿る。輪になっていても止まるよう通った駒を覚えておく。
    let head = p;
    const walked = new Set([p]);
    while (left.has(head) && !walked.has(left.get(head))) { head = left.get(head); walked.add(head); }
    const chain = [];
    for (let cur = head; cur && !seen.has(cur); cur = right.get(cur)) { chain.push(cur); seen.add(cur); }
    chains.push(chain);
  }
  return chains;
}

/** 塊の取っ手の置き所。並びの真ん中の駒の、先端側へ少し出た所。 */
function chainHandle(chain) {
  const n = chain.length;
  const a = chain[Math.floor((n - 1) / 2)];
  const b = chain[Math.ceil((n - 1) / 2)];
  const ay = yawOf(a.mesh.quaternion);
  const yaw = ay + angleDiff(yawOf(b.mesh.quaternion), ay) / 2;
  const cx = (a.body.position.x + b.body.position.x) / 2;
  const cz = (a.body.position.z + b.body.position.z) / 2;
  // 駒の先端はローカルの -z 側（形状の +y がこちらを向く）
  const [ox, oz] = rot2(0, -(a.size.l / 2 + HANDLE_R * 0.85), yaw);
  return { x: cx + ox, z: cz + oz, yaw };
}

const handles = [];
const handleGeo = new THREE.CircleGeometry(HANDLE_R, 24);
function handleMesh(i) {
  while (handles.length <= i) {
    const m = new THREE.Mesh(handleGeo, new THREE.MeshBasicMaterial({
      color: "#d8b45a", transparent: true, opacity: HANDLE_OPACITY, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    handles.push(m);
  }
  return handles[i];
}

// 取っ手に指が乗っている間、どの駒が一緒に動くのかを見せる。取っ手だけでは
// 塊の範囲が分からず、掴んでよいのか判断できない。駒より一回り大きい板を敷いて縁を見せる。
const chainMarks = [];
const chainMarkGeo = new THREE.PlaneGeometry(1, 1);
function chainMark(i) {
  while (chainMarks.length <= i) {
    const m = new THREE.Mesh(chainMarkGeo, new THREE.MeshBasicMaterial({
      color: "#d8b45a", transparent: true, opacity: 0.30, depthWrite: false,
    }));
    m.rotation.order = "YXZ"; // 先に寝かせてから yaw で回す
    m.visible = false;
    scene.add(m);
    chainMarks.push(m);
  }
  return chainMarks[i];
}

function showChainMarks(chain) {
  let i = 0;
  for (const p of chain || []) {
    const m = chainMark(i++);
    m.position.set(p.body.position.x, STAND.topY + 0.03, p.body.position.z);
    m.rotation.set(-Math.PI / 2, yawOf(p.mesh.quaternion), 0);
    m.scale.set(p.size.w * 1.28, p.size.l * 1.22, 1);
    m.visible = true;
  }
  for (let k = i; k < chainMarks.length; k++) chainMarks[k].visible = false;
}

// 取っ手を掴んで塊を動かしている間の状態。持ち上げず、駒台の上をすべらせる。
// 実物でも複数枚を一度に持ち上げることはしない。
const chainGrab = {
  list: null,
  stand: null,
  handle: null,
  rel: null,                   // 取っ手から見た各駒の相対位置
  offset: new THREE.Vector3(), // 掴んだ位置と取っ手の中心のずれ
};

/** 駒台の塊を数え直して、取っ手を置き直す。毎フレームは要らない。 */
function refreshHandles() {
  let i = 0;
  // 「視点」では掴めないので出さない。触れないものが見えていると紛らわしい。
  if (!chainGrab.list && P.standHandles && P.mode === "piece") {
    for (const stand of STANDS) {
      for (const chain of chainsOnStand(stand)) {
        if (chain.length < 2) continue; // 1枚なら駒そのものを掴めばよい
        const h = chainHandle(chain);
        const m = handleMesh(i++);
        m.position.set(h.x, STAND.topY + 0.05, h.z);
        m.userData.chain = chain;
        m.userData.stand = stand;
        m.material.opacity = HANDLE_OPACITY;
        m.visible = true;
      }
    }
  }
  for (let k = i; k < handles.length; k++) {
    handles[k].visible = false;
    handles[k].userData.chain = null;
  }
}

function beginChainGrab(handle, point) {
  const list = handle.userData.chain;
  if (!list) return;
  pushUndo();
  chainGrab.list = list;
  chainGrab.stand = handle.userData.stand;
  chainGrab.handle = handle;
  chainGrab.rel = list.map((p) => ({
    p,
    dx: p.body.position.x - handle.position.x,
    dz: p.body.position.z - handle.position.z,
  }));
  chainGrab.offset.set(handle.position.x - point.x, 0, handle.position.z - point.z);
  // 動かしている間は物理を止める。駒台の持ち駒はもともと静止物。
  for (const p of list) {
    p.settle = null;
    p.body.type = CANNON.Body.STATIC;
    p.body.updateMassProperties();
    p.body.velocity.setZero();
    p.body.angularVelocity.setZero();
  }
  handle.material.opacity = 0.5;
  showChainMarks(list);
}

/** 取っ手の中心をここへ。塊は並びを崩さずについてくる。 */
function moveChainTo(x, z) {
  for (const r of chainGrab.rel) {
    r.p.body.position.x = x + r.dx;
    r.p.body.position.z = z + r.dz;
    r.p.mesh.position.copy(r.p.body.position);
  }
  chainGrab.handle.position.x = x;
  chainGrab.handle.position.z = z;
  showChainMarks(chainGrab.list);
  renderer.shadowMap.needsUpdate = true; // ここもメッシュまで動かすので tick の比較には出ない
}

/**
 * 駒台からはみ出た分を押し戻す平行移動。両側に出ていて入りきらないなら諦める。
 * 内寸のちょうど際に寄せると、誤差で「駒台の外」と読まれて寄り添い先から外れる。少し内側で止める。
 */
function fitOffset(points, stand) {
  const hw = STAND_INNER.w / 2 - 0.05, hd = STAND_INNER.d / 2 - 0.05;
  let over = 0, under = 0, far = 0, near = 0;
  for (const pt of points) {
    const px = pt.x - stand.x;
    const pz = pt.z - stand.z;
    over = Math.max(over, px - hw);
    under = Math.max(under, -hw - px);
    far = Math.max(far, pz - hd);
    near = Math.max(near, -hd - pz);
  }
  return {
    dx: over > 0 && under > 0 ? 0 : over > 0 ? -over : under,
    dz: far > 0 && near > 0 ? 0 : far > 0 ? -far : near,
  };
}

function fitIntoStand(list, stand) {
  return fitOffset(list.map((p) => p.body.position), stand);
}

/**
 * 並びの角度を左右に振り分け直す。
 *
 * 肩をつなぐと駒は必ず片側へ開いていくので、同じ駒に足し続けると扇が一方向に倒れ、
 * すぐ駒台から溢れる。**駒の角度は指では選べない**（置いた駒は必ずまっすぐ立つ）ので、
 * くっつけた側で振り分けてやるしかない。歩を3枚つなげば真ん中の歩がまっすぐを向く。
 *
 * 並べ直すのは角度と、それに伴う位置だけ。**anchor の駒はその場から動かさない。**
 * ここを塊の中心にしてはいけない。中心は駒を1枚足すと半駒分ずれるので、
 * 右から足し続けると既存の駒が1枚ごとに左へ押し出され、そのぶんが累積する。
 * 戻り値は各駒の行き先で、まだ動かしてはいない。
 */
function alignedPoses(list, stand, anchor) {
  const rel = [{ x: 0, z: 0, yaw: 0 }];
  for (let i = 1; i < list.length; i++) {
    const prev = rel[i - 1];
    rel.push(attachPose(prev.x, prev.z, prev.yaw, list[i - 1].size, list[i], 1));
  }
  const last = rel[rel.length - 1];
  // 扇の真ん中。両端の平均でよい（肩の角度は駒の形が決めるので等間隔に開く）。
  const cyaw = (rel[0].yaw + last.yaw) / 2;
  const baseYaw = stand.owner === 1 ? Math.PI : 0;
  const turn = baseYaw - cyaw;

  // 動かさない駒。そこを原点にして並びを組み直す。
  const ai = Math.max(0, list.indexOf(anchor));
  const ax = rel[ai].x, az = rel[ai].z;
  const at = list[ai].body.position;

  const poses = list.map((p, i) => {
    const [rx, rz] = rot2(rel[i].x - ax, rel[i].z - az, turn);
    return { p, x: at.x + rx, z: at.z + rz, yaw: baseYaw + rel[i].yaw - cyaw };
  });
  // 振り分けた結果が駒台からはみ出るなら、その分だけ寄せる
  const fit = fitOffset(poses, stand);
  if (fit.dx || fit.dz) for (const q of poses) { q.x += fit.dx; q.z += fit.dz; }
  return poses;
}

/**
 * 並べ直しで動かさない駒。**足した駒から遠い端**を選ぶ。
 * 近い端を固定すると、足した駒に押される形で並び全体が反対側へずれていく。
 */
function anchorFor(list, added) {
  const i = list.indexOf(added);
  return i * 2 < list.length - 1 ? list[list.length - 1] : list[0];
}

/**
 * base に piece をくっつけた並びを作る。base を含む塊に piece を差し込むだけ。
 * side が +1 なら base の右、-1 なら左。
 */
function chainWith(stand, base, side, piece) {
  const chain = chainsOnStand(stand).find((c) => c.includes(base)) || [base];
  // **置こうとしている駒が塊に残っていることがある。** `chainsOnStand` は
  // `grab.piece` を塊から外すが、`endGrab` は先頭で `grab.piece = null` にするので
  // そこを通ったときは除外が効かない。取り除かずに差し込むと**同じ駒が二重に入り**、
  // 1 枚多い扇として角度が割り振られて**塊が割れる**
  // （歩 5 枚の端を摘まみ直すと ±37.1° の扇が ±46.4°＝6 枚分に広がっていた）。
  const list = chain.filter((p) => p !== piece);
  const i = list.indexOf(base);
  list.splice(side > 0 ? i + 1 : i, 0, piece);
  return { list, anchor: anchorFor(list, piece) };
}

/**
 * 塊の端を、別の駒の空いている肩へ繋ぐ。届かなければ null。
 * 塊の左端は相手の右肩に、右端は相手の左肩に付く。逆にすると塊が相手に重なる。
 */
function chainJoin(list, stand) {
  const others = piecesOnStand(stand).filter((p) => !list.includes(p) && !p.settle);
  if (!others.length) return null;
  let best = null;
  for (const b of others) {
    const byaw = yawOf(b.mesh.quaternion);
    for (const side of [1, -1]) {
      const end = side > 0 ? list[0] : list[list.length - 1];
      const pose = attachPose(b.body.position.x, b.body.position.z, byaw, b.size, end, side);
      if (!insideStand(stand, pose.x, pose.z)) continue;
      // そこが既に埋まっていたら繋げない
      if (others.some((q) => q !== b &&
          Math.hypot(q.body.position.x - pose.x, q.body.position.z - pose.z) < end.size.w * 0.55)) continue;
      const d = Math.hypot(pose.x - end.body.position.x, pose.z - end.body.position.z);
      if (d > end.size.w * 0.75) continue; // 1枚を寄り添わせるときと同じ寛さ
      if (!best || d < best.d) best = { d, end, base: b, side };
    }
  }
  return best;
}

/**
 * 塊を相手の塊に繋ぐ。1枚くっつけるときと同じで、繋いだ並び全体で角度を振り分ける。
 * 動かさないのは相手側の端（寄っていくのはこちらなので、相手を大きく動かさない）。
 */
function joinChain(list, join, stand) {
  const other = chainsOnStand(stand).find((c) => c.includes(join.base)) || [join.base];
  const next = join.side > 0 ? [...other, ...list] : [...list, ...other];
  for (const m of alignedPoses(next, stand, anchorFor(next, join.end))) {
    startSettle(m.p,
      new THREE.Vector3(m.x, STAND.topY + m.p.size.t / 2, m.z),
      flatQuaternion(m.yaw, isFlipped(m.p.mesh.quaternion)),
      m.p === join.end ? "place" : null); // 音は1回だけ。枚数ぶん鳴らすと連打になる
  }
}

function endChainGrab() {
  const list = chainGrab.list;
  const stand = chainGrab.stand;
  if (!list) return;

  // 扇は駒台からはみ出しやすい。並びを崩さず位置だけ戻す。
  const fit = fitIntoStand(list, stand);
  if (fit.dx || fit.dz) {
    moveChainTo(chainGrab.handle.position.x + fit.dx, chainGrab.handle.position.z + fit.dz);
  }

  // **塊の外の駒と重なっていたら、塊ごと押し出す。**
  // 高さで逃がすと、端の 1 枚だけが乗ったときに反対側が宙に浮く。
  // 塊は平行移動だけなので、並びも高さも崩れない。
  const outside = piecesOnStand(stand).filter((p) => !list.includes(p));
  if (outside.length) {
    for (let iter = 0; iter < 12; iter++) {
      let hit = null;
      for (const p of list) {
        const pp = p.body.position;
        const poly = pieceOutline(p, pp.x, pp.z, yawOf(p.mesh.quaternion));
        for (const q of outside) {
          const qp = q.body.position;
          const sep = outlineSeparation(poly,
            pieceOutline(q, qp.x, qp.z, yawOf(q.mesh.quaternion)));
          if (sep && (!hit || sep.depth > hit.depth)) hit = sep;
        }
      }
      if (!hit) break;
      moveChainTo(
        chainGrab.handle.position.x + hit.x * (hit.depth + 0.02),
        chainGrab.handle.position.z + hit.z * (hit.depth + 0.02));
      // 押し出した先が駒台から出たら戻す（出たまま置かない）
      const back = fitIntoStand(list, stand);
      if (back.dx || back.dz) {
        moveChainTo(chainGrab.handle.position.x + back.dx, chainGrab.handle.position.z + back.dz);
        break; // 壁と駒に挟まれた。これ以上は動かせない
      }
    }
  }
  // 別の駒の肩に届いていれば繋げる。すべらせただけなら音は鳴らさない。
  const join = chainJoin(list, stand);
  if (join) joinChain(list, join, stand);

  chainGrab.list = null;
  chainGrab.stand = null;
  chainGrab.handle = null;
  chainGrab.rel = null;
  showChainMarks(null);
  refreshHandles();
}

/**
 * 収まりかけの駒を、アニメーションを待たずに行き先へ置いてしまう。
 *
 * **瞬間で並べる経路（SFEN の読み込み）のためのもの。** tick の収まり処理と同じことを
 * するが、音は鳴らさない。駒台と駒箱の駒を静止物に戻すのも忘れない
 * （そこを落とすと持ち駒が物理で押し合う）。
 */
function flushSettles() {
  let moved = false;
  for (const piece of pieces) {
    const s = piece.settle;
    if (!s) continue;
    piece.settle = null;
    moved = true;
    const b = piece.body;
    b.position.set(s.to.x, s.to.y, s.to.z);
    b.quaternion.set(s.toQ.x, s.toQ.y, s.toQ.z, s.toQ.w);
    const here = placeAt(b.position.x, b.position.z);
    const onStand = !!here && here.stacks;
    b.type = onStand ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.velocity.setZero();
    b.angularVelocity.setZero();
    if (!onStand) b.sleep();
    piece.mesh.position.copy(b.position);
    piece.mesh.quaternion.copy(b.quaternion);
  }
  // ここでメッシュまで直接動かすので tick の比較には出ない。
  if (moved) renderer.shadowMap.needsUpdate = true;
}

/**
 * 取った駒を持ち主の駒台へ送る。空いている所を探して置く。
 * `sound` を null にすると無音（並べ直しのように、指し手でないときに使う）。
 */
function sendToStand(piece, owner, sound = "place") {
  const stand = STANDS.find((s) => s.owner === owner) || STANDS[0];
  const baseYaw = stand.owner === 1 ? Math.PI : 0;
  const here = piecesOnStand(stand).filter((p) => p !== piece);

  // 既にある駒の隣に寄り添えるならそこへ
  for (const p of here) {
    for (const side of [1, -1]) {
      const pose = attachPose(p.body.position.x, p.body.position.z,
        yawOf(p.mesh.quaternion), p.size, piece, side);
      if (!insideStand(stand, pose.x, pose.z)) continue;
      const blocked = here.some((q) => q !== p &&
        Math.hypot(q.body.position.x - pose.x, q.body.position.z - pose.z) < piece.size.w * 0.55);
      if (blocked) continue;
      // くっつけたら並び全体で角度を振り分ける（手で寄せたときと同じ扱い）
      const { list, anchor } = chainWith(stand, p, side, piece);
      for (const m of alignedPoses(list, stand, anchor)) {
        startSettle(m.p,
          new THREE.Vector3(m.x, STAND.topY + m.p.size.t / 2, m.z),
          flatQuaternion(m.yaw, isFlipped(m.p.mesh.quaternion)),
          m.p === piece ? sound : null);
      }
      return;
    }
  }
  // 誰もいなければ手前寄りに置く。空いた肩が無くてここへ来ることもあるので、
  // 先客がいれば段を上げる。
  const flip = stand.owner === 1 ? -1 : 1;
  const hx = stand.x - 3.2 * flip, hz = stand.z + 3.6 * flip;
  startSettle(piece,
    new THREE.Vector3(hx, stackSurfaceY(piece, hx, hz, null, baseYaw), hz),
    flatQuaternion(baseYaw, false), sound);
}

// --- 掴み ---------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const grab = {
  piece: null,
  sticky: false, // 取った駒を手に持っている状態。ボタンを押していなくても付いてくる。
  grazed: false, // 他の駒の上をかすめて運んだか
  downAt: 0,     // 掴んだ時刻。押している長さで持ち上げ高さが決まる
  slide: false,  // すべらせている。浮かせないし音も鳴らさない
  noSlide: false, // 駒台から掴んだ駒。すべらせる動作がないので必ず持ち上げる
  lift: 0,       // いま浮いている高さ cm。指したときの音の高さに使う
  origin: new THREE.Vector3(), // 掴んだときの駒の位置。動かした距離をここから測る
  offset: new THREE.Vector3(),
  target: new THREE.Vector3(),
  baseY: 0,
  planeY: 0,
  yaw: 0,
  flipped: false,
  prev: new THREE.Vector3(),
  vel: new THREE.Vector3(),
};

function pointerToNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function pickPiece() {
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? { piece: hit.object.userData.piece, point: hit.point } : null;
}

function planeHitAt(y, out) {
  ray.setFromCamera(ndc, camera);
  dragPlane.constant = -y;
  return ray.ray.intersectPlane(dragPlane, out);
}

function planeHit(out) {
  return planeHitAt(grab.planeY, out);
}

/** 駒台の塊の取っ手を指しているか。駒に当たらなかったときだけ見る。 */
function pickHandle() {
  const vis = handles.filter((m) => m.visible);
  if (!vis.length) return null;
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(vis, false)[0];
  return hit ? { handle: hit.object, point: hit.point } : null;
}

/** 取っ手に指が乗ったら濃くして、一緒に動く駒も見せる。掴める所が見えないと塊は動かせない。 */
function hoverHandle() {
  const vis = handles.filter((m) => m.visible);
  if (!vis.length) { showChainMarks(null); return; }
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(vis, false)[0];
  for (const m of vis) m.material.opacity = hit && hit.object === m ? 0.5 : HANDLE_OPACITY;
  showChainMarks(hit ? hit.object.userData.chain : null);
}

function beginGrab(piece, hitPoint) {
  pushUndo();
  grab.piece = piece;
  piece.settle = null;
  const b = piece.body;
  b.type = CANNON.Body.KINEMATIC;
  b.updateMassProperties();
  b.wakeUp();
  b.velocity.setZero();
  b.angularVelocity.setZero();
  // 手に持っている駒は他の駒を押しのけない。
  // 高さを指で調節できない以上、隣にぶつけて弾き飛ばすほうが不自然。
  b.collisionResponse = false;

  // 駒台か駒箱か（どちらも「置いてあるだけ」の場所）。升や床なら null。
  const from = placeAt(b.position.x, b.position.z);
  const onStand = !!from && from.stacks;
  // 駒台・駒箱から取った駒はすべらせようがない。持ち駒は必ず持ち上げて打つ。
  grab.noSlide = onStand;

  // 掴んだ高さを基準にする。駒台や駒箱の駒はその面の高さから持ち上がる。
  const floor = onStand ? from.topY : TOP_Y;
  grab.baseY = Math.max(floor + piece.size.t / 2, Math.min(hitPoint.y, floor + 10));
  grab.planeY = grab.baseY + P.holdHeight;

  // **手に取った駒はまっすぐ持つ**（2026-08-20 に「駒台から掴んだとき」から
  // **どこから掴んでも**に広げた）。扇の端の駒も、駒箱の中で寝ている駒も、吸着「切」で
  // 斜めになった駒も、手に取った時点でまっすぐになる。傾いたまま持ち上がるのは
  // 駒が指に貼り付いているように見える。
  //
  // **落とすのは傾きだけで、向き（先手か後手か）は駒のもの**なので保つ。
  // だから 180 度単位に丸める（`ownerOfYaw` と同じ見方）。
  // tick が `uprightRate` で slerp するので、水平に起き上がるのと同じ動きで回る。
  //
  // 離したあとの角度はここでは決まらない。駒台に置き直せば `standTidy` と
  // `standPlacement` が並びから作り直すので、**扇の中で摘まみ直しても扇は崩れない**。
  const yaw = yawOf(piece.mesh.quaternion);
  grab.yaw = ownerOfYaw(yaw) === 1 ? Math.PI : 0;
  grab.flipped = isFlipped(piece.mesh.quaternion); // 裏返したまま運べる

  const p = new THREE.Vector3();
  if (planeHit(p)) {
    // 掴んだ位置関係を保つ。駒の端を摘まめば端を持ったまま動く。
    grab.offset.set(b.position.x - p.x, 0, b.position.z - p.z);
    grab.target.copy(p);
  } else {
    grab.offset.set(0, 0, 0);
    grab.target.set(b.position.x, grab.planeY, b.position.z);
  }
  grab.prev.set(b.position.x, b.position.y, b.position.z);
  grab.origin.set(b.position.x, b.position.y, b.position.z);
  grab.vel.set(0, 0, 0);
  grab.grazed = false;
  grab.downAt = performance.now();
  grab.slide = false;
  grab.lift = 0;

  // 駒台や駒箱で下の駒を抜いたら、上に乗っていた駒を下ろす。
  if (onStand) restackAt(grab.origin.x, grab.origin.z, piece);
}

/** 取った駒を手に持つ。次にクリックするまで付いてくる。 */
function takeIntoHand(piece) {
  piece.settle = null;
  const b = piece.body;
  b.type = CANNON.Body.KINEMATIC;
  b.updateMassProperties();
  b.wakeUp();
  b.velocity.setZero();
  b.angularVelocity.setZero();
  b.collisionResponse = false;

  grab.piece = piece;
  grab.sticky = true;
  grab.offset.set(0, 0, 0);
  grab.baseY = TOP_Y + piece.size.t / 2;
  grab.planeY = grab.baseY + P.holdHeight;
  // 取った駒も手の中ではまっすぐ（`beginGrab` と同じ扱い）。
  grab.yaw = ownerOfYaw(yawOf(piece.mesh.quaternion)) === 1 ? Math.PI : 0;
  grab.flipped = false; // 成駒を取ったら元の駒に戻る
  grab.target.set(b.position.x, grab.planeY, b.position.z);
  grab.prev.set(b.position.x, b.position.y, b.position.z);
  grab.origin.set(b.position.x, b.position.y, b.position.z);
  grab.vel.set(0, 0, 0);
  grab.grazed = false;
  grab.downAt = performance.now();
  grab.slide = false;
  grab.lift = 0;
  grab.noSlide = true; // 手に持った駒を打つときもすべらせない
}

function endGrab() {
  const piece = grab.piece;
  grab.piece = null;
  grab.sticky = false;
  marker.visible = false;
  if (!piece) return;

  const b = piece.body;
  // 手の速さ。**吸着の可否には使っていない**（`gentle` を読む）。吸着「切」で駒に渡す
  // 勢いと、判定パネルの表示に使う。**水平だけで見る**のは、持ち上げが押している長さで
  // 勝手に上がる（`liftTime` 0.05 秒で 3cm ＝ 60cm/s）ため。垂直を数えると
  // 「ちょんと触っただけ」が高速に見える。
  const speed = Math.hypot(grab.vel.x, grab.vel.z);
  const tilt = tiltDegrees(piece.mesh.quaternion);
  const spot = placeAt(b.position.x, b.position.z);

  // 置こうとしている升に既にいる駒。相手の駒なら取る、自分の駒なら重ねることになる。
  // 持ち主は向きで決まる。
  const occupied = spot && spot.kind === "square" ? topPieceAt(spot, piece) : null;
  let captured = null;
  if (occupied && P.captureMode !== "off") {
    const mine = ownerOfYaw(grab.yaw);
    if (ownerOfYaw(yawOf(occupied.mesh.quaternion)) !== mine) captured = occupied;
  }

  // 重なりを切っているとき、駒がいる升には置かせない。
  // 取るときは相手の駒がどくので重ならない。**取る＝重ねる、ではない。**
  // 盤にも駒台にも属さない場所も同じ扱いで、吸着ありのときは床にこぼさない。
  const outside = P.snapMode !== "off" && !spot;
  const blocked = outside || blockedAt(piece, spot, grab.yaw);

  // 駒台や駒箱は升のように駒の上へ載せる場所ではないので、高さの基準はその面。
  // （重ねたときに段が上がるのは `stackSurfaceY` の役目で、単独で置く経路だけが通る）
  const restY = !spot ? 0
    : spot.stacks
      ? spot.topY + piece.size.t / 2
      : surfaceY(piece, spot, captured);
  // 運んでいる高さの下限。**`tick` の `grab.baseY` と同じ基準でなければいけない。**
  // ここがずれると、その差をまるごと「高く持ち上げすぎ」と数えてしまい、
  // 吸着に失敗して駒が物理で落ち、面にぶつかる音（ﾊﾞﾁｯ）になる。
  //
  // 駒台と駒箱は**その面から**測る（`tick` も `under.topY` を使う）。
  // かつてどちらも盤面（TOP_Y）にしていたが、**駒箱は畳に直置きで底が 0.9cm しかない**ので
  // 持つ高さが 20cm 以上浮き、狙った所に置けなくなっていた。
  //
  // 盤では**取る駒の上まで手が上がっている**（`tick` の `grab.baseY` が `surfaceY` で、
  // そこは取る駒を除かない）。ここを `restY`（取る駒はどくので低い）で測ると、その差＝
  // **取られる駒の厚みぶん**だけ高く見え、`snapMaxHeight`(3.8) を超えて吸着に失敗する。
  // 失敗すると `captured` の処理ごと飛ばされるので、**相手の駒を取らずにその上に落ちる**。
  // 歩(0.70)と香桂(0.76)は 3.8 に収まるが、銀金(0.82)・飛角(0.86)・王玉(0.90)は超える
  // ＝「銀で歩は取れるのに角交換ができない」。取る駒も数えて基準を揃える。
  const floorY = !spot ? 0
    : spot.stacks
      ? restY
      : surfaceY(piece, spot, null);
  const height = spot ? b.position.y - floorY : 0;
  // 面にめり込んでいないか。**基準は駒が実際に乗る面（restY）**で、高さの上限とは別に見る。
  // 沈み込みまで floorY で測ると、駒台は盤より 2cm 低い（駒箱は床置きなのでもっと低い）ので、
  // その面に置いてある駒がつねに沈んでいると読まれる。掴んだ直後は tick がまだ駒を盤面の高さまで
  // 上げていないので、**ちょんと触って離すとそのまま吸着に失敗**し、駒台の駒（STATIC で
  // 隣と箱が重なっている）が剛体に戻って弾かれ、駒台から落ちていた。
  const sunk = spot ? b.position.y - restY : 0;

  // **入＝盤・駒台・駒箱の上で離せばそこに収まる / 切＝物理のまま。**
  //
  // **距離と手の速さは見ない**（2026-08-19 に外した）。どちらも
  // 「吸着ありなのに升からズレた位置に置ける」を作っていた。外れた駒はその場に落ちるので、
  // **升の線をまたいだまま残る**。
  //
  // - 距離（`snapMaxDist` 1.5cm）は**升の中心から縁までとほぼ同じ**。升は 3.03×3.33cm で、
  //   角のあたりは中心から 1.7cm あるので、**升と升の間を狙うとどの升にも入らない**
  // - 速さは「速く払って離したら駒が滑る」の判定だったが、**滑った先がズレた配置になる**。
  //   駒台では既に見ないことにしてあり（駒台へポンと置く動作は 49cm/s ほど出る）、
  //   盤でも同じ理由で邪魔になっていた
  //
  // **残すのは傾きと高さと沈み込み。** 高く持ち上げて落とす・傾けて落とすのは意図の
  // はっきりした操作で、物理としても自然。
  // 払って滑らせたいときは吸着を「切」にする。
  const gentle = !!spot &&
    tilt <= P.snapMaxTilt &&
    height <= P.snapMaxHeight &&
    sunk > -0.4;
  const ok = !blocked && !!spot && P.snapMode !== "off" && gentle;

  // 駒台に乗せたら、その駒台の持ち主の向き・表向きに直す（設定で切れる）。
  // **手元の値を先に直してしまう。** 以降の寄り添い・単独配置・音の判定が
  // すべて `grab.yaw` / `grab.flipped` を見るので、ここ 1 箇所で揃う。
  //
  // 肩をつないだ並びの**向き**は、揃えなくても持ち主の向きになる
  // （`alignedPoses()` が `baseYaw` から角度を割り振るため）。だからここが効くのは
  // 主に**単独で置いたとき**の向きと、**成ったまま置いたとき**の表裏。
  if (P.standTidy && ok && spot.kind === "stand") {
    grab.yaw = spot.stand.owner === 1 ? Math.PI : 0;
    grab.flipped = false;
  }

  // 駒台に寄り添う先。音の判定でも使うので先に出しておく。
  const pl = ok && spot.kind === "stand"
    ? standPlacement(piece, spot.stand, spot.x, spot.z)
    : null;
  // 単独で置くときに収まる先。**音の判定で使う移動距離もここから測る**
  // （壁や隣の駒で押し戻された分を数えないと、動いた距離が実際とずれる）。
  //
  // 順に「壁の内側へ」「他の駒から押し出す」「もう一度壁の内側へ」。
  // 最後にもう一度収めるのは、押し出した先が壁を越えることがあるため。
  // それでもまだ重なるほど詰まっているときは、`stackSurfaceY` が段を上げて逃がす。
  const solo = (() => {
    if (!ok || !spot.stacks || (pl && pl.base)) return null;
    let s = fitInside(spot, piece, pl ? pl.x : spot.x, pl ? pl.z : spot.z, grab.yaw);
    const others = (spot.kind === "box"
      ? pieces.filter((p) => nearestBox(p.body.position.x, p.body.position.z))
      : piecesOnStand(spot.stand)).filter((p) => p !== piece && p !== captured);
    s = pushOutOfPieces(piece, s.x, s.z, grab.yaw, others, spot.stackR ?? 0);
    return fitInside(spot, piece, s.x, s.z, grab.yaw);
  })();

  // 升に収めるときの揺らぎ。中心ぴったりには置かない（`wobbleOffset` を読む）。
  const wob = ok && !pl ? wobbleOffset(spot, b.position.x, b.position.z, grab.vel) : null;

  // 駒が実際に動いた距離。手の経路長ではない。
  // 経路長で測ると、升の隅で掴んで隣の升へ吸着させたとき「ほとんど動かしていない」
  // ことになって無音になる（駒は1升動いているのに）。
  const endX = solo ? solo.x : pl ? pl.x : ok ? spot.x + (wob ? wob.x : 0) : b.position.x;
  const endZ = solo ? solo.z : pl ? pl.z : ok ? spot.z + (wob ? wob.z : 0) : b.position.z;
  const moved = Math.hypot(endX - grab.origin.x, endZ - grab.origin.z);

  // ちょんと触って離しただけなら、持ち上げていないものとして扱う。
  // 持ち上げ高さは押している長さで決まるので、普通のクリック（0.1秒前後）でも 2cm ほど上がる。
  // **音の判定でだけ 0 とみなす。** 持ち上げもスライドも吸着も、動きは一切変えない。
  const heldFor = (performance.now() - grab.downAt) / 1000;
  const tapped = heldFor < P.tapTime;
  const liftForSound = tapped ? 0 : grab.lift;

  // どの音で置くか。指し手として動かしたときだけ鳴らす。
  // 高く持ち上げて指すほど高い音になる。すべらせたときは鳴らさない。
  const pitch = 1 + P.liftPitch * (P.holdHeight > 0 ? liftForSound / P.holdHeight : 0);

  // つまみ直しただけ。**動かしておらず、ちょんと触っただけ**のとき。
  // **持ち上げたら指し手として扱う**（音が鳴り、ボタンは出ない）。実物でも持ち上げて
  // 同じ場所に戻せばパチンと鳴る。**無音の条件とボタンを出す条件は同じもの**。
  const idle = moved < 1.5 && tapped;

  // すべらせて指したか。**手を離した位置**が手前の駒に重なっていれば、そこから吸着で
  // 升へ滑り込む＝駒をこすりながら指したことになる（7九の銀に乗りかかる辺りで離して7八金、
  // 8八の角に重ねて離して8七歩、など。持ち上げて運んできてもこの指し方になる）。
  // 経路では見ない。斜めに動かせば必ず駒の角を通るので、経路で見ると鳴りすぎる。
  const onPiece = !!spot && spot.kind === "square" &&
    overPiece(piece, b.position.x, b.position.z, b.position.y, grab.yaw, true);

  let sound;
  // **ボタンが出るなら鳴らさない。ボタンが出ないなら鳴らす。** 要件はこれだけ。
  // だから `idle`（＝下の selectPiece と同じ条件）は**必ず最優先**で見る。
  // すべらせた判定（grab.slide）を先に置いていたため、ちょんと触っただけでも
  // 手ぶれで slide 扱いになり（slideDist 0.15cm は画面上わずか数 px）、
  // 駒が詰まっている所では ｶﾁｶﾁ が鳴っていた。**ボタンは出ているのに鳴る**状態で、
  // 「音とボタンは同じ条件」という約束がここで破れていた。
  if (idle) sound = null;                   // つまみ直しただけ。この下の selectPiece と対になる
  else if (blocked) sound = null;                                       // 置けずに戻すので鳴らさない
  // すべらせて運んだ。**駒台に置いたなら置く音は鳴る。**
  // 音は「どこに置いたか」で決まるもので、運び方で消えてよいものではない。
  // ここで `grazed || onPiece` だけを見ていたため、駒台では `onPiece` を見ない
  // （盤の上にいるときだけ数える）ぶん null に落ちて無音になっていた。
  else if (grab.slide) {
    sound = spot && spot.stacks ? "place"
      : (grab.grazed || onPiece) ? "slide" : null;
  }
  else if (!spot || spot.stacks) sound = "place";
  else if (restY > TOP_Y + piece.size.t / 2 + 0.05) sound = "place";    // 駒の上に重ねるので打ち付けられない
  else if (onPiece) sound = "slide";
  else sound = "clack";

  if (blocked) {
    // 重ねられない升、または盤の外で離した。ここで落とすと駒の上に乗るか床にこぼれるので、
    // 掴む前の位置へ戻す（指し手として成立していない）。
    setPiecePose(piece, grab.origin.x, grab.origin.y, grab.origin.z, grab.yaw, grab.flipped);
    piece.body.sleep();
  } else if (ok) {
    if (spot.kind === "stand" && pl.base) {
      // 隣にくっついた。並び全体で角度を振り分け直すので、隣の駒も一緒に動く。
      // 片側に足し続けると扇が一方向に倒れて駒台から溢れるため。
      const { list, anchor } = chainWith(spot.stand, pl.base, pl.side, piece);
      for (const m of alignedPoses(list, spot.stand, anchor)) {
        // 置く駒の表裏は**手元の値が正**。駒側（mesh）を見ると、揃えるモードで
        // いま裏返したぶんが間に合わず、成ったまま並んでしまう。
        const back = m.p === piece ? grab.flipped : isFlipped(m.p.mesh.quaternion);
        startSettle(m.p,
          new THREE.Vector3(m.x, STAND.topY + m.p.size.t / 2, m.z),
          flatQuaternion(m.yaw, back),
          m.p === piece ? sound : null, pitch);
      }
    } else if (spot.stacks) {
      // 誰の肩にも寄らず単独で置いた（駒箱はいつもこちら。中に並べ方の決まりは無い）。
      // **下に駒がいれば段が上がる。** 寄り添う側（上の分岐）は肩を接して**同じ段**に
      // 並ぶので、台の上面のままでよい。
      // **入れ物の内側に収める**（`fitInside`。壁にめり込ませない）。上で出してある。
      const px = solo ? solo.x : pl ? pl.x : spot.x;
      const pz = solo ? solo.z : pl ? pl.z : spot.z;
      startSettle(piece,
        new THREE.Vector3(px, stackSurfaceY(piece, px, pz, captured, grab.yaw), pz),
        // **駒台では手元の値から作る。** 駒側（`settledQuaternion`）を見ると、
        // 揃えるモードでいま裏返したぶんが間に合わないうえ、**180度単位に丸めてしまう**ので
        // 駒台でつけた角度が消える（「成りと向き変更で角度を消さない」と同じ話）。
        // 丸めてよいのは升に吸着させるときだけ。
        flatQuaternion(grab.yaw, grab.flipped),
        sound, pitch);
    } else {
      // 升へ。**中心ぴったりではなく、離した位置の名残を少し残す**（`wobbleOffset`）。
      startSettle(piece,
        new THREE.Vector3(endX, restY, endZ),
        settledQuaternion(piece, new THREE.Quaternion()),
        sound, pitch);
    }
    if (captured) {
      if (P.captureMode === "hand") takeIntoHand(captured);
      else sendToStand(captured, ownerOfYaw(grab.yaw));
    }
  } else {
    b.type = CANNON.Body.DYNAMIC;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.wakeUp();
    // 手の速度を渡す。速く振って離せば飛ぶし、横に払えば倒れる。
    b.velocity.set(grab.vel.x * P.throwScale, grab.vel.y * P.throwScale, grab.vel.z * P.throwScale);
    const spin = speed * 0.05;
    b.angularVelocity.set(
      (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin * 0.4, (Math.random() - 0.5) * spin
    );
  }

  // つまみ直しただけなら、その駒を選ぶ。脇に 成／⟳ が出る。
  // 動かしたときも、持ち上げて同じ場所に戻したときも出さない（どちらも指し手なので）。
  if (idle) selectPiece(piece);
}

// --- 駒の状態を進める ---------------------------------------------------
//
// 成りと向き変更を一つの操作にまとめてある。押すたびに
// 先手 → 先手成 → 後手 → 後手成 → 先手 と回る（将棋GUIなどと同じ形）。
// ダブルクリックの成りは廃止した（1回目のクリックで駒を掴んで離すため、
// 駒音が二度鳴り、吸着も一度走るのが嫌だったという理由）。
//
// 持ち上げないので音は鳴らさない。

/** 成っているか。掴んでいる駒と収まりかけの駒は、駒側を見ても遅れるので手元の値を見る。 */
function pieceFlipped(piece) {
  if (grab.piece === piece) return grab.flipped;   // 毎フレーム駒へ書き戻されるので手の中が正
  if (piece.settle) return isFlipped(piece.settle.toQ); // 収まりかけ。行き先で答える
  return isFlipped(piece.mesh.quaternion);
}

/** いまの向き。pieceFlipped と同じ理由で、掴んでいる駒と収まりかけの駒は手元の値を見る。 */
function pieceYaw(piece) {
  if (grab.piece === piece) return grab.yaw;
  if (piece.settle) return yawOf(piece.settle.toQ);
  return yawOf(piece.mesh.quaternion);
}

function canPromote(piece) {
  return !!KINDS[piece.kindId].back;
}

/** 駒を裏返す／向きを変える。turn は yaw に足す角度。 */
function setPieceState(piece, nextFlip, turn) {
  if (grab.piece === piece) {
    // 掴んでいる駒は「掴む前」を beginGrab が既に積んである。ここで積むと段が二重になる。
    grab.flipped = nextFlip;
    grab.yaw += turn;
    return;
  }
  pushUndo();
  // **基準は行き先の姿勢**（`pieceYaw`）。収まりかけの駒は途中の姿勢を持っているので、
  // そこから作ると連続で押したときに角度が巻き戻る（後手成へ進まず先手成に戻る）。
  // 180度**足す**だけにする。0/180度に丸めると、駒台でつけてある角度が消えてしまう。
  settleInPlace(piece, flatQuaternion(pieceYaw(piece) + turn, nextFlip), null);
}

/**
 * 駒の状態を1つ進める（右クリック）。
 * 成りの無い駒（金・王）は成を飛ばして 先手 → 後手 の2つだけを回る。
 */
function cyclePiece(piece) {
  if (!piece) return;
  const ok = canPromote(piece);
  const flipped = pieceFlipped(piece);
  // 表→裏は裏返すだけ。裏→表は裏返したうえで向きも変える。
  setPieceState(piece, ok ? !flipped : false, ok ? (flipped ? Math.PI : 0) : Math.PI);
}

/** 成／不成だけを切り替える（向きは変えない）。 */
function promotePiece(piece) {
  if (!piece || !canPromote(piece)) return;
  setPieceState(piece, !pieceFlipped(piece), 0);
}

/** 向きだけを変える（成／不成はそのまま）。 */
function turnPiece(piece) {
  if (!piece) return;
  setPieceState(piece, pieceFlipped(piece), Math.PI);
}

// --- 駒を選ぶ -----------------------------------------------------------
//
// 指には右ボタンが無いので、押せる形のボタンを出す。**成／不成と向き変更は別のボタンにする。**
// 循環（先手 → 先手成 → 後手 → 後手成）だと、歩を後手にするだけで2回、
// 後手成を戻すのに3回押すことになる。右クリックは押す場所が1つしかないので循環のまま。
//
// **掴み続けている間には出さない。** ポインタは1つしかないので、駒を掴んだままでは
// どのボタンも押しに行けない。駒を離してから出せば、駒もボタンも
// 止まっているのでマウスでも指でも押せる。
//
// 出る条件は endGrab の `idle`＝つまみ直しただけのとき。持ち上げて同じ場所に戻したときは
// 出さない（それは指し手で、駒音も鳴っている）。判定は音と共通で、新しい閾値は増やさない。

let selected = null;
const promoteBtn = document.getElementById("btn-promote");
const turnBtn = document.getElementById("btn-turn");
const projV = new THREE.Vector3();

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // 駒の四隅（ローカル x=幅、z=長手）

// **ボタンの大きさそのものを駒の見かけに合わせる。**
// 駒の投影サイズは視点の角度とズームで 3 倍以上変わる（既定 98cm で歩 31×36px、
// 半分に寄ると 62×69px、引くと 19×23px）。**位置だけ合わせても釣り合わない**
// ―― 引くと駒より大きなボタンが浮き、寄ると駒に対して豆粒になる。
//
// 下限は**指で押せる大きさ**。タブレットが主な相手なのでここは下げられない
// （駒がいくら小さく写っても、押せないボタンでは意味がない）。
const BTN_SCALE = 1.28;    // 駒の長手の見かけに対するボタンの径。既定の距離で 46px になる値
const BTN_SIZE_MIN = 40;
const BTN_SIZE_MAX = 76;
const BTN_ICON = 0.74;     // ボタンの中に描く駒の絵の割合（CSS の 34/46 と同じ）

function selectPiece(piece) {
  selected = piece;
  placePieceButtons();
}

function clearSelection() {
  if (!selected) return;
  selected = null;
  promoteBtn.hidden = true;
  turnBtn.hidden = true;
  selectMark.visible = false;
}

/**
 * 駒が画面上で占める矩形。
 * 真上から見れば縦に縮み、斜めから見れば伸び、引けば小さくなる。
 * 固定の px でボタンをずらすと、その都度どこかで駒に被るので毎回投影して測る。
 */
function screenBox(piece) {
  const p = piece.body.position;
  const yaw = pieceYaw(piece);
  const r = renderer.domElement.getBoundingClientRect();
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const [sx, sz] of CORNERS) {
    const [dx, dz] = rot2((sx * piece.size.w) / 2, (sz * piece.size.l) / 2, yaw);
    projV.set(p.x + dx, p.y + piece.size.t / 2, p.z + dz).project(camera);
    const x = r.left + ((projV.x + 1) / 2) * r.width;
    const y = r.top + (1 - (projV.y + 1) / 2) * r.height;
    box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
  }
  return box;
}

/**
 * ボタンの中に駒の絵を描く。同じ絵なら描き直さない
 * （placePieceButtons は吸着が終わるたびにも呼ばれるので、毎回作ると無駄）。
 *
 * 一字／二字は盤の設定に合わせる（そのほうが「その駒がこうなる」がそのまま伝わる）。
 */
function setButtonIcon(btn, kindId, promoted, flip, size) {
  // 絵の実解像度は表示サイズの 2 倍。**丸めてからキーにする**（8px 刻み）。
  // 丸めないとズームのたびに描き直すことになる。
  const icon = Math.round((size * BTN_ICON) / 8) * 8;
  const key = `${kindId}/${promoted ? 1 : 0}/${flip ? 1 : 0}/${oneChar ? 1 : 0}/${icon}`;
  if (btn.dataset.icon === key) return;
  btn.dataset.icon = key;
  btn.replaceChildren(drawKomaIcon(kindId, { promoted, flip, oneChar, px: Math.max(88, icon * 2) }));
}

/** ボタンを画面内に収めて置く。大きさもここで決める。 */
function putButton(btn, x, y, size) {
  const half = size / 2;
  btn.style.width = btn.style.height = `${size}px`;
  const cv = btn.firstElementChild;
  if (cv) cv.style.width = cv.style.height = `${size * BTN_ICON}px`;
  btn.style.left = `${THREE.MathUtils.clamp(x, half, innerWidth - half)}px`;
  btn.style.top = `${THREE.MathUtils.clamp(y, half, innerHeight - half)}px`;
  btn.hidden = false;
}

/**
 * 選んだ駒の右上（成／不成）と左上（向き変更）へ。
 * 駒に重なるとその駒が掴めなくなるので、必ず駒の外に出す。
 *
 * **成りの無い駒（金・王）は向きボタンを真上に1つだけ出す**（2026-08-19。それまでは
 * 「残る側の位置は動かさない」として左上に出していた）。片側だけ出ていると、
 * 成ボタンを押し損ねたのか元から無いのかが見て分からない。
 */
function placePieceButtons() {
  if (!selected || P.mode !== "piece") { clearSelection(); return; }
  const box = screenBox(selected);
  const promo = canPromote(selected);
  // 駒の見かけの大きさから、ボタンの径と駒の角からの距離を出す。上の BTN_SCALE の注記を読む。
  const seen = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  const size = THREE.MathUtils.clamp(seen * BTN_SCALE, BTN_SIZE_MIN, BTN_SIZE_MAX);
  // 角から**斜め 45 度**に出すので、中心間の距離は √2 倍になる。
  // ボタンの縁が駒の角にちょうど触れるのが size/2 で、そこに 1px の余白を足した値。
  const off = size * 0.354 + 1;
  // ボタンの絵は**押した後の駒そのもの**。いまの状態から行き先を作って描く。
  const back = pieceFlipped(selected);
  const rev = ownerOfYaw(pieceYaw(selected)) === 1;

  // 向き：面はそのままで、向きだけ逆にした駒
  setButtonIcon(turnBtn, selected.kindId, back, !rev, size);
  turnBtn.title = rev ? "向きを変える（先手へ）" : "向きを変える（後手へ）";
  if (promo) putButton(turnBtn, box.x0 - off, box.y0 - off, size);
  // 真上は斜めに逃げられないので、垂直に半径ぶん取る
  else putButton(turnBtn, (box.x0 + box.x1) / 2, box.y0 - (size / 2 + 3), size);

  if (promo) {
    // 成：向きはそのままで、裏返した駒（歩なら「と」）
    setButtonIcon(promoteBtn, selected.kindId, !back, rev, size);
    promoteBtn.title = back ? "不成（表へ戻す）" : "成";
    putButton(promoteBtn, box.x1 + off, box.y0 - off, size);
  } else {
    promoteBtn.hidden = true;
  }

  const p = selected.body.position;

  // 印は駒の**下**に敷く（駒の上に重ねると字が読めなくなる）。
  // 駒より一回り大きくして、縁だけがはみ出して見えるようにする。塊の印と同じ作り。
  const here = placeAt(p.x, p.z);
  const baseY = here ? here.topY : TOP_Y;
  selectMark.position.set(p.x, baseY + 0.03, p.z);
  selectMark.rotation.set(-Math.PI / 2, yawOf(selected.mesh.quaternion), 0);
  selectMark.scale.set(selected.size.w * 1.32, selected.size.l * 1.24, 1);
  selectMark.visible = true;
}

function settleInPlace(piece, toQ, sound = "clack") {
  const b = piece.body;
  const spot = placeAt(b.position.x, b.position.z);
  // 駒台や駒箱では、肩を接した隣の駒を「下にいる駒」と数えて浮かせてしまわないよう、
  // 高さはその面から数える（endGrab と同じ扱い）。
  const to = !spot
    ? new THREE.Vector3(b.position.x, b.position.y, b.position.z)
    : spot.stacks
      // 重ねてある駒はその段に留まる（自分は数えないので、下の駒だけで高さが決まる）
      ? new THREE.Vector3(spot.x, stackSurfaceY(piece, spot.x, spot.z, null), spot.z)
      : new THREE.Vector3(spot.x, surfaceY(piece, spot), spot.z);
  startSettle(piece, to, toQ, sound);
}

// --- 駒箱 ---------------------------------------------------------------
//
// 駒落ちで外した駒の置き場所であり、**盤に駒をぶちまけて自分で並べる**ための入れ物。
// 置き場所としての扱いは `placeAt` の `stacks` が持っているので、
// ここにあるのは「出す／しまう」と「盤にあける」だけ。

const boxNote = document.getElementById("box-note");

function showBox(on) {
  // **中身が入ったまましまわせない。** 箱ごと消すと駒の行き場が無くなり、
  // 床に浮いたまま置き場所を失う（掴んで離しても「盤の外」で戻されるだけになる）。
  if (!on) {
    const inside = pieces.filter((q) => nearestBox(q.body.position.x, q.body.position.z));
    if (inside.length) {
      boxNote.textContent =
        `駒箱に ${inside.length} 枚入っています。先に「盤にあける」で出してからしまってください。`;
      boxNote.hidden = false;
      setSegment("boxmode", "on"); // 押されたボタンを戻す
      return;
    }
  }
  boxNote.hidden = true;
  KOMABAKO.visible = on;
  boxNode.visible = on;
  // **物理の実体も一緒に出し入れする。** 見えない壁や底が残っていると、そこで駒が
  // 引っかかったり宙に浮いたりする。
  for (const b of boxBodies) {
    const has = world.bodies.includes(b);
    if (on && !has) { world.addBody(b); b.aabbNeedsUpdate = true; b.updateAABB(); }
    if (!on && has) world.removeBody(b);
  }
  world.broadphase.dirty = true; // 当たり判定の並びを作り直させる
  // 画面に入る距離が変わる。**切れているときだけ引く**ので、しまっても勝手には寄らない。
  ensureFit();
  renderer.shadowMap.needsUpdate = true;
}

/**
 * 駒箱の中身を盤にあける。**物理でばらまく**（ジャラっと出して自分で並べる）。
 *
 * - 盤の中央の少し上から、散らばるように落とす。**同じ点から落とすと山が高く積み上がって
 *   崩れにくい**ので、初速を少し散らす
 * - 駒箱の駒は STATIC なので、剛体に戻してから落とす
 * - 音は1回だけ（枚数ぶん鳴らすと連打になる。駒台の塊と同じ考え方）
 */
function spillBox() {
  const list = pieces.filter((p) => nearestBox(p.body.position.x, p.body.position.z));
  if (!list.length) return;
  pushUndo();
  clearSelection();
  clearArrow(); // 盤面が変わる
  // **重ならないように並べてから落とす。** ここが跳ねの正体だった。
  // 同じ場所へまとめて生成すると駒どうしが重なった状態で始まり、**物理がめり込みを
  // 解こうとして勢いよく弾き飛ぶ**（実測：跳ね上がり 10.6cm、最大 158cm/s）。
  // 落とす高さや初速を下げても、重なっている限り収まらない（7.5cm、96cm/s）。
  // 格子に置いて高さを段でずらすと、落ちながら自然に広がる（3.1cm、54cm/s）。
  //
  // **剛性や反発（ContactMaterial）はいじっていない。** そちらを触っても効きは小さく
  // （169 → 134cm/s）、駒どうしのめり込みの戻り方が変わってしまう。
  // **正方形に近い格子にする。** 7×2 のような細長い並べ方だと、そのまま落ちて
  // **横一線に並んだまま**になる。4×4 の 3 段なら中央 9cm 四方から
  // 広がるので、ぶちまけた形になる。
  // **置き場所はランダムに散らす。格子に並べてはいけない。** 落ちる距離が短いので
  // **並べた形がそのまま盤に残る**（格子状の山になってしまう）。
  // かといって重なった状態から始めると弾き飛ぶので、**重ならないランダム**が要る。
  //
  // 円の中に点を投げ、既に置いた点から `SPILL_MIN` 以上離れていたら採る（棄却法）。
  // 1 層に入りきらない分は次の層へ。層ごとに投げ直すので、上下でも揃わない。
  const SPILL_MIN = 3.0;  // 駒が重ならない中心間距離
  const SPILL_R = 7.6;    // まく円の半径。盤からこぼれない大きさ
  const spots = [];
  for (let layer = 0; spots.length < list.length && layer < 8; layer++) {
    const here = [];
    for (let t = 0; t < 600 && spots.length + here.length < list.length; t++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPILL_R; // 円内で一様に散る
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (here.every((s) => Math.hypot(s.x - x, s.z - z) >= SPILL_MIN)) here.push({ x, z, layer });
    }
    if (!here.length) break;
    spots.push(...here);
  }

  const order = list.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  order.forEach((p, i) => {
    p.settle = null;
    const b = p.body;
    b.type = CANNON.Body.DYNAMIC;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.wakeUp();
    const s = spots[i] || { x: 0, z: 0, layer: 0 };
    const x = s.x, z = s.z;
    b.position.set(x, TOP_Y + 1.2 + s.layer * 1.0, z);
    b.quaternion.setFromEuler(
      (Math.random() - 0.5) * 0.3,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.3
    );
    // 中心から外へ少しだけ流す。山の真ん中に固まらず、自然に広がる。
    const away = Math.hypot(x, z) || 1;
    b.velocity.set((x / away) * 4 + (Math.random() - 0.5) * 3, 0,
                   (z / away) * 4 + (Math.random() - 0.5) * 3);
    b.angularVelocity.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
    p.mesh.position.copy(b.position);
    p.mesh.quaternion.copy(b.quaternion);
  });
  playSpill();
  // 落ちて跳ねている間の駒音は鳴らさない（`collisionSound` の先頭を読む）。
  spillQuietUntil = performance.now() + 2000;
  calmDeadline = performance.now() + 6000;
  renderer.shadowMap.needsUpdate = true;
}

/**
 * 渡した駒を駒箱へ入れる。片付けも、駒落ちで外した駒の行き先もここを通る。
 *
 * **格子に並べて入れる。** 散らして入れると偏って高く積み上がり、**箱の高さを超えて
 * 駒が壁からはみ出す**（実測 6.73cm。箱は 5.4cm）。40 枚を 4×4 の 3 段に収める。
 * 位置と向きに少しだけ揺らぎを足して、整列しきった見た目にはしない。
 */
function putIntoBox(list) {
  const COLS = 4, ROWS = 4, PER = COLS * ROWS;
  const cw = BOX_INNER.w / COLS, cd = BOX_INNER.d / ROWS;
  const LAYER = 0.92; // 段の間隔。いちばん厚い駒（王 0.90）より少し広く
  list.forEach((p, i) => {
    p.settle = null;
    const b = p.body;
    const n = i % PER;
    const layer = Math.floor(i / PER);
    const x = KOMABAKO.x - BOX_INNER.w / 2 + cw * ((n % COLS) + 0.5) + (Math.random() - 0.5) * 0.5;
    const z = KOMABAKO.z - BOX_INNER.d / 2 + cd * (Math.floor(n / COLS) + 0.5) + (Math.random() - 0.5) * 0.5;
    const y = BOX.topY + p.size.t / 2 + layer * LAYER;
    setPiecePose(p, x, y, z, (Math.random() - 0.5) * 0.25, false);
    b.type = CANNON.Body.STATIC;
    b.updateMassProperties();
    b.collisionResponse = true;
  });

  // **格子に置いただけでは、揺らぎのぶん隣とわずかに触れることがある。**
  // 王（3.0×3.2）だと格子の余白は 0.1cm しかないので、向きの揺らぎだけで超える。
  // 同じ段の駒どうしで押し出して解く（起きるのは 0.5cm 以下の浅い重なり）。
  for (let iter = 0; iter < 8; iter++) {
    let moved = false;
    for (const p of list) {
      const pp = p.body.position;
      const yaw = yawOf(p.mesh.quaternion);
      const same = list.filter((q) => q !== p && Math.abs(q.body.position.y - pp.y) < 0.3);
      // stackR に 0 を渡す＝真上でも押し出す（同じ段しか相手にしていないので当然）
      let s = pushOutOfPieces(p, pp.x, pp.z, yaw, same, 0);
      s = fitInside({ kind: "box" }, p, s.x, s.z, yaw);
      if (Math.hypot(s.x - pp.x, s.z - pp.z) < 0.001) continue;
      pp.x = s.x; pp.z = s.z;
      p.mesh.position.copy(pp);
      moved = true;
    }
    if (!moved) break;
  }
  renderer.shadowMap.needsUpdate = true;
}

// --- 短い知らせ ---------------------------------------------------------
//
// **盤を見ながら読むものなので幕は張らない**（振り駒の結果は盤の駒そのものだし、
// 読み込みの失敗もその場で直せる）。数秒で消える。

const toastEl = document.getElementById("toast");
let toastTimer = 0;
function toast(text, ms = 4000) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}

// --- 振り駒 -------------------------------------------------------------
//
// **物理でしか作れない操作。** 歩 5 枚を盤にまいて、表（歩）が多ければ先手、
// 裏（と）が多ければ後手。
//
// - **結果は数えて見せるだけで、手番は設定しない**（ルールは強制しない）
// - 駒は**駒箱から取り、足りなければ盤の歩を借りる**。借りると並びは崩れるが
//   「元に戻す」で戻せる
// - **5 枚揃わなければ振らない。** 4 枚では 2 対 2 で決まらない
// - **立った駒があれば振り直し**（実物と同じ）
// - **表裏は初期姿勢もランダムにする。** 落とすだけだと初期の向きが結果に残る。
//   実物でも手の中で混ぜてから振る
// - まく前に**重ならないように散らす**。重なった状態から始めると物理がめり込みを
//   解こうとして弾き飛ぶ（駒箱の「盤にあける」と同じ）

const FURI_N = 5;
let furigoma = null; // { list, borrowed, deadline } 落ち着くまで tick が見張る

function furigomaSource() {
  const fu = pieces.filter((p) => p.kindId === "FU");
  const list = fu.filter((p) => nearestBox(p.body.position.x, p.body.position.z)).slice(0, FURI_N);
  if (list.length < FURI_N) {
    const onBoard = fu.filter((p) => {
      if (list.includes(p)) return false;
      const at = placeAt(p.body.position.x, p.body.position.z);
      return !!at && at.kind === "square";
    });
    list.push(...onBoard.slice(0, FURI_N - list.length));
  }
  return list;
}

function furigomaStart() {
  const list = furigomaSource();
  if (list.length < FURI_N) {
    toast(`振るには歩が ${FURI_N} 枚要ります（いま ${list.length} 枚）。駒箱か盤に歩を用意してください。`);
    return;
  }
  const borrowed = list.filter((p) => !nearestBox(p.body.position.x, p.body.position.z)).length;
  pushUndo();
  clearSelection();
  clearArrow();
  showSettings(false); // 盤を見せる

  // 重ならない場所を投げて選ぶ（棄却法。駒箱の「盤にあける」と同じ考え方）。
  // **狭くしすぎない。** 3.8cm では落ちながら寄って駒の上に乗り上がる（実測で 5 枚中 2 枚）。
  // 盤は半径 16.5cm あるので、5.2cm でも端までは十分余る。
  const R = 5.2, MIN = 3.0;
  const spots = [];
  for (let t = 0; t < 600 && spots.length < list.length; t++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (spots.every((s) => Math.hypot(s.x - x, s.z - z) >= MIN)) spots.push({ x, z });
  }

  const tilt = new THREE.Quaternion();
  const q = new THREE.Quaternion();
  list.forEach((p, i) => {
    p.settle = null;
    const b = p.body;
    b.type = CANNON.Body.DYNAMIC;
    b.updateMassProperties();
    b.collisionResponse = true;
    b.wakeUp();
    const s = spots[i] || { x: 0, z: 0 };
    // 段でずらして落とす（同じ高さから落とすと落ち際で当たる）
    b.position.set(s.x, TOP_Y + 3.2 + i * 0.8, s.z);
    // 表裏と向きをランダムに作り、そこへ少し傾きを掛ける
    flatQuaternion(Math.random() * Math.PI * 2, Math.random() < 0.5, q);
    tilt.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7));
    q.premultiply(tilt);
    b.quaternion.set(q.x, q.y, q.z, q.w);
    // **勢いは控えめにする。** 散らして落としても、着地後に転がって寄れば駒の上に
    // 乗り上がる（±9cm/s・±14rad/s では 50 枚中 12 枚が乗った）。
    // 表裏は初期姿勢で既にランダムなので、回して混ぜる必要はない。
    b.velocity.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
    b.angularVelocity.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    p.mesh.position.copy(b.position);
    p.mesh.quaternion.copy(b.quaternion);
  });
  playSpill();
  // 落ちて跳ねている間の駒音は鳴らさない（`collisionSound` の先頭を読む）。
  spillQuietUntil = performance.now() + 1200;
  calmDeadline = performance.now() + 5000;
  furigoma = { list, borrowed, deadline: performance.now() + 6500 };
  renderer.shadowMap.needsUpdate = true;
}

/** 落ち着いたら数える。tick から呼ばれる。 */
function furigomaFinish() {
  const { list, borrowed } = furigoma;
  furigoma = null;
  // **立った駒は数えない。** 実物でも振り直す
  const standing = list.filter((p) => tiltDegrees(p.mesh.quaternion) > 45).length;
  if (standing) {
    toast(`駒が ${standing} 枚立ちました。もう一度振ってください。`);
    return;
  }
  const back = list.filter((p) => isFlipped(p.mesh.quaternion)).length;
  const face = list.length - back;
  let msg = `歩 ${face} 枚・と ${back} 枚 → ${face > back ? "先手" : "後手"}`;
  if (borrowed) msg += `（盤の歩を ${borrowed} 枚使いました）`;
  toast(msg, 6000);
  return { face, back, standing: 0 };
}

/**
 * 盤と駒台にある駒を駒箱へ片付ける。**升の駒も持ち駒も全部**。
 *
 * **箱に入っている駒も含めて並べ直す。** 外の駒だけを格子に入れると、
 * 既に入っている駒と同じ場所に重なる（片付けたのにめり込む）。
 */
function boxAll() {
  if (!KOMABAKO.visible) return;
  pushUndo();
  clearSelection();
  clearArrow();
  putIntoBox(pieces.slice());
  playPlace(0.8);
  renderer.shadowMap.needsUpdate = true;
}

// --- 整列 ---------------------------------------------------------------

/** 散らばった駒を升と駒台に整える。使わなければ物理のまま。 */
function tidyAll() {
  pushUndo();
  clearSelection(); // 駒が動くので ⟳ の位置が合わなくなる
  // 散らばった駒が升に収まる＝局面が変わりうるので、解析した最善手は捨てる。
  clearArrow();
  const taken = new Set();

  // 低い駒（下に埋もれている駒）から決めていくと、積み重なりが自然に解ける
  const order = [...pieces].sort((a, b) => a.body.position.y - b.body.position.y);

  for (const piece of order) {
    const pos = piece.body.position;
    const at = placeAt(pos.x, pos.z);
    if (at && at.kind === "stand") continue; // 駒台はあとでまとめて並べ直す
    if (at && at.kind === "box") continue;   // 駒箱の中は並べ方の決まりが無いので触らない

    const sq = nearestSquare(pos.x, pos.z);
    if (!sq) continue; // 盤にも駒台にも乗っていない駒は触らない

    const free = findFreeSquare(sq.file, sq.rank, taken);
    taken.add(free.key);
    const c = squareToWorld(free.file, free.rank);
    startSettle(piece, new THREE.Vector3(c.x, TOP_Y + piece.size.t / 2, c.z),
      settledQuaternion(piece, new THREE.Quaternion()));
  }

  for (const s of STANDS) tidyStand(s);
}

/** 駒台の持ち駒を、強い駒から順に肩をつないで並べる。入らない分は次の行へ。 */
function tidyStand(stand) {
  const list = piecesOnStand(stand);
  if (!list.length) return;
  list.sort((a, b) => {
    const ia = STAND_ORDER.indexOf(a.kindId);
    const ib = STAND_ORDER.indexOf(b.kindId);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const rows = [];
  let cur = [], span = 0;
  for (const p of list) {
    const add = cur.length ? p.size.w * 0.82 : p.size.w;
    if (cur.length && span + add > STAND_INNER.w) { rows.push(cur); cur = []; span = 0; }
    cur.push(p);
    span += cur.length === 1 ? p.size.w : p.size.w * 0.82;
  }
  if (cur.length) rows.push(cur);

  // 扇は弧の分だけ奥行きを食うので、行の間隔は駒の長さより広く取る
  const rowH = Math.min(4.6, STAND_INNER.d / rows.length);
  const z0 = -(rowH * (rows.length - 1)) / 2;
  const flip = stand.owner === 1 ? -1 : 1;
  const baseYaw = stand.owner === 1 ? Math.PI : 0;

  rows.forEach((row, ri) => {
    // 一枚目を置いて、あとは肩をつないでいくだけ。扇の角度は駒の形が決める。
    const poses = [{ p: row[0], x: 0, z: 0, yaw: 0 }];
    for (let i = 1; i < row.length; i++) {
      const prev = poses[i - 1];
      poses.push({ p: row[i], ...attachPose(prev.x, prev.z, prev.yaw, prev.p.size, row[i], 1) });
    }
    // 行の真ん中がまっすぐ前を向くように、行ごと回して中央へ寄せる
    const last = poses[poses.length - 1];
    const cyaw = (poses[0].yaw + last.yaw) / 2;
    const cx = (poses[0].x + last.x) / 2;
    const cz = (poses[0].z + last.z) / 2;

    for (const q of poses) {
      const [rx, rz] = rot2(q.x - cx, q.z - cz, -cyaw);
      startSettle(q.p,
        new THREE.Vector3(
          stand.x + rx * flip,
          STAND.topY + q.p.size.t / 2,
          stand.z + (rz + z0 + rowH * ri) * flip
        ),
        flatQuaternion(baseYaw + q.yaw - cyaw, false), "place");
    }
  });
}

/** 埋まっている升からいちばん近い空き升を探す。 */
function findFreeSquare(file, rank, taken) {
  for (let r = 0; r < 9; r++) {
    for (let df = -r; df <= r; df++) {
      for (let dr = -r; dr <= r; dr++) {
        if (Math.max(Math.abs(df), Math.abs(dr)) !== r) continue;
        const f = file + df, k = rank + dr;
        if (f < 1 || f > 9 || k < 1 || k > 9) continue;
        const key = f * 10 + k;
        if (!taken.has(key)) return { file: f, rank: k, key };
      }
    }
  }
  return { file, rank, key: file * 10 + rank };
}

// --- 入力 ---------------------------------------------------------------
const orbit = { active: false, mode: "rotate", x: 0, y: 0 };
const down = { x: 0, y: 0, button: 0 };
const panRight = new THREE.Vector3();
const panFwd = new THREE.Vector3();

// 触っている指は一度に1本だけ見る。2本目を触ると掴んだ駒や視点が2本目へ飛ぶので、
// 先に触った指が離れるまで後から来た指は無視する。
// 例外は「視点」モードのピンチだけ（下の touches / pinch）。
let activePointer = null;

// 2本指で寄る／引く。指では他に寄せる手段が無いので「視点」モードにだけ入れてある。
// 「駒」モードでは2本目を無視したまま（駒と視点は排他なので）。
const touches = new Map(); // pointerId → 画面座標
const pinch = { on: false, dist: 0, x: 0, y: 0 };

function beginPinch() {
  const [a, b] = [...touches.values()];
  pinch.on = true;
  pinch.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  pinch.x = (a.x + b.x) / 2;
  pinch.y = (a.y + b.y) / 2;
  orbit.active = false; // 1本指の回転は止める。ピンチ中に盤が回ると狙えない。
}

function updatePinch() {
  if (touches.size < 2) return;
  const [a, b] = [...touches.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

  cam.r *= pinch.dist / d; // 指の間を広げたら寄る
  // 2本指の中点が動いた分は平行移動。1本指の pan と同じ計算。
  const k = cam.r * 0.0017;
  panRight.setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
  panFwd.crossVectors(panRight, new THREE.Vector3(0, 1, 0)).normalize();
  cam.target.addScaledVector(panRight, -(mx - pinch.x) * k).addScaledVector(panFwd, -(my - pinch.y) * k);
  cam.target.x = THREE.MathUtils.clamp(cam.target.x, -60, 60);
  cam.target.z = THREE.MathUtils.clamp(cam.target.z, -60, 60);

  pinch.dist = d; pinch.x = mx; pinch.y = my;
  applyCamera();
}

function endPinch() {
  pinch.on = false;
  orbit.active = false;
  activePointer = null;
  touches.clear();
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  // 「視点」の2本目の指。ピンチに使う。
  if (P.mode === "camera" && activePointer !== null && !pinch.on) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) beginPinch();
    return;
  }
  if (activePointer !== null) return;
  activePointer = e.pointerId;
  touches.clear();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  initAudio(); resumeAudio();
  renderer.domElement.setPointerCapture(e.pointerId);
  pointerToNdc(e);
  down.x = e.clientX; down.y = e.clientY; down.button = e.button;

  // 「駒」のときだけ駒に触れる。「視点」では掴みも状態変更も起きない。
  if (P.mode === "piece") {
    // 運びながら状態を進めるのは **pointermove** で拾う。ここには来ない
    // （マウスの2つ目のボタンは pointerdown を出さない。下の pointermove の注記を読む）。

    // 取った駒を手に持っている状態。クリックで置く。
    if (grab.sticky) { endGrab(); return; }

    if (e.button === 0) {
      const hit = pickPiece();
      // 選び直すので、いま選んでいる駒の ⟳ は引っ込める（離したときに出し直す）
      if (hit) { clearSelection(); beginGrab(hit.piece, hit.point); return; }
      // 駒に当たらなければ駒台の塊の取っ手を見る。駒より後に見るので、1枚掴む操作を邪魔しない。
      const h = pickHandle();
      if (h) { clearSelection(); beginChainGrab(h.handle, h.point); return; }
      clearSelection(); // 何も無い所を触ったら選択をやめる
    }
    // 「駒」では視点は動かさない。マウスのボタンも使わない。
    // 掴み損ねるたびに盤が回ると、升の間や駒の縁を触りやすいタブレットでは駒を並べていられない。
    return;
  }
  orbit.active = true;
  orbit.mode = (e.button === 1 || e.shiftKey) ? "pan" : "rotate";
  orbit.x = e.clientX;
  orbit.y = e.clientY;
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (pinch.on) {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    updatePinch();
    return;
  }
  if (activePointer !== null && e.pointerId !== activePointer) return;
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // **駒を運びながら右クリックで状態を進める。**
  // **左を押したまま右を押しても `pointerdown` は来ない。** Pointer Events が pointerdown を
  // 出すのは「ボタンが1つも押されていない状態」から押された瞬間だけで、2つ目以降のボタンは
  // **pointermove** として報告される（`button` に状態が変わったボタン、`buttons` に現在の
  // 全ボタン）。ただの移動では `button` は -1 なので、ここで押した瞬間だけを拾える。
  // 離した側も同じく pointermove（`button` は 2、`buttons` から 2 が消える）で来るので、
  // `buttons` を見て押下だけに絞る。**pointerdown 側に書いても一度も動かない。**
  if (P.mode === "piece" && e.button === 2 && (e.buttons & 2) && grab.piece) {
    cyclePiece(grab.piece);
    return;
  }
  // 塊は持ち上げない。駒台の面をすべらせるだけなので、取っ手の高さで指を追う。
  if (chainGrab.list) {
    pointerToNdc(e);
    const p = new THREE.Vector3();
    if (planeHitAt(chainGrab.handle.position.y, p)) {
      moveChainTo(p.x + chainGrab.offset.x, p.z + chainGrab.offset.z);
    }
    return;
  }
  if (grab.piece) {
    pointerToNdc(e);
    const p = new THREE.Vector3();
    if (planeHit(p)) grab.target.copy(p);
    return;
  }
  if (!orbit.active) {
    // 「視点」では取っ手を掴めないので、指を乗せても光らせない
    if (P.mode === "piece") { pointerToNdc(e); hoverHandle(); }
    return;
  }
  if (orbit.active) {
    const dx = e.clientX - orbit.x;
    const dy = e.clientY - orbit.y;
    if (orbit.mode === "pan") {
      // 盤をつまんで動かす感覚。カメラの向きに沿って水平に平行移動する。
      const k = cam.r * 0.0017;
      panRight.setFromMatrixColumn(camera.matrix, 0).setY(0).normalize();
      panFwd.crossVectors(panRight, new THREE.Vector3(0, 1, 0)).normalize();
      cam.target.addScaledVector(panRight, -dx * k).addScaledVector(panFwd, -dy * k);
      cam.target.x = THREE.MathUtils.clamp(cam.target.x, -60, 60);
      cam.target.z = THREE.MathUtils.clamp(cam.target.z, -60, 60);
    } else {
      cam.theta -= dx * 0.008;
      cam.phi -= dy * 0.006;
    }
    orbit.x = e.clientX;
    orbit.y = e.clientY;
    applyCamera();
  }
});

function release(e) {
  touches.delete(e.pointerId);
  // ピンチ中はどちらの指が離れても終わりにする。残った指で回り出すと不意に視点が動く。
  if (pinch.on) {
    endPinch();
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
  // **同じ pointerup が canvas と窓の両方に届く**（窓側は下の登録＝取りこぼしの保険）。
  // `activePointer` が残っているときだけ処理する。null のときも通していると、
  // バブリングした二度目で右クリックの状態変更がもう一度走り、2段進んでしまう
  // （先手 → 先手成 → 後手 と回って「反転しかしない」ように見える）。
  if (activePointer === null || e.pointerId !== activePointer) return;
  activePointer = null;
  // 右クリック（動かさずに離す）で駒の状態を進める。
  // 先手 → 先手成 → 後手 → 後手成 → 先手。
  if (P.mode === "piece" && down.button === 2 && !grab.piece &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
    pointerToNdc(e);
    const hit = pickPiece();
    if (hit) cyclePiece(hit.piece);
  }
  if (chainGrab.list) endChainGrab();
  if (grab.piece && !grab.sticky) endGrab();
  orbit.active = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
}
renderer.domElement.addEventListener("pointerup", release);
renderer.domElement.addEventListener("pointercancel", release);
// キャプチャ中に取りこぼしても掴んだままにならないよう、窓側でも拾う
addEventListener("pointerup", release);
addEventListener("blur", () => {
  if (chainGrab.list) endChainGrab();
  if (grab.piece) endGrab();
  orbit.active = false;
  activePointer = null;
  pinch.on = false;
  touches.clear();
});

renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// ボタンは canvas の外にあるので、押しても駒を掴む処理には入らない。
// 押したあと選択は保ったまま。ラベル（成／不成）と位置を置き直す。
promoteBtn.addEventListener("click", () => {
  if (!selected) return;
  promotePiece(selected);
  placePieceButtons();
});
turnBtn.addEventListener("click", () => {
  if (!selected) return;
  turnPiece(selected);
  placePieceButtons();
});

renderer.domElement.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (P.mode !== "camera") return; // 「駒」では視点を動かさない
  cam.r *= 1 + Math.sign(e.deltaY) * 0.08;
  applyCamera();
}, { passive: false });

addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "t") {
    tidyAll();
  } else if (k === "1") {
    resetHirate();
  }
});

// --- ループ -------------------------------------------------------------
const settleQ = new THREE.Quaternion();
let last = performance.now();
let lastReadAt = 0;
let shadowHold = 2; // 影を描き直すフレームがあと何回残っているか

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  const held = grab.piece;
  if (held) {
    // 運んでいる先に駒があれば、その分だけ手を高く上げる。
    // これが無いと相手の駒を取るとき（相手駒の升に自分の駒を置くとき）に置けない。
    const under = placeAt(held.body.position.x, held.body.position.z);
    if (under) {
      // 駒台や駒箱の上では、そこにある駒に乗り上げない。盤の上だけ、駒があれば手を上げる。
      //
      // **持つ高さはその場所の面から測る。** かつてはどこでも盤面（TOP_Y）を下限に
      // していたが、**駒箱は畳に直に置いてあるので底が 0.9cm しかなく、盤と同じ高さで
      // 持つと箱の底から 20.45cm も浮いていた**（盤なら 3.35cm）。
      // 高く浮くほど、指の光線と運ぶ平面の交点が奥へずれるので、
      // **狙った場所に置けなくなる**（駒箱の中で駒をどかしたいときに特に困る）。
      //
      // 場所が変わっても駒が飛ばないのは、下の追従（`followRate`）が
      // 滑らかに寄せるため。駒台から盤へ移すときも 0.1 秒ほどで上がりきる。
      grab.baseY = under.stacks
        ? under.topY + held.size.t / 2
        : surfaceY(held, under);
    }
    // 掴んですぐ動き出したら、持ち上げずにすべらせているとみなす。
    // 指で高さを決められない以上、押している長さを高さの代わりにする。
    const heldFor = (now - grab.downAt) / 1000;
    if (!grab.slide && !grab.noSlide && heldFor <= P.slideTime) {
      const dx = held.body.position.x - grab.origin.x;
      const dz = held.body.position.z - grab.origin.z;
      if (Math.hypot(dx, dz) >= P.slideDist) grab.slide = true;
    }
    // 押し続けた分だけ上がる。上限は holdHeight。すべらせているなら上げない。
    grab.lift = grab.slide ? 0 : P.holdHeight * Math.min(heldFor / P.liftTime, 1);
    grab.planeY = grab.baseY + grab.lift;

    const a = 1 - Math.exp(-P.followRate * dt);
    const gx = grab.target.x + grab.offset.x;
    const gz = grab.target.z + grab.offset.z;
    const b = held.body;
    const p = b.position;
    const px = p.x, py = p.y, pz = p.z;

    p.x += (gx - p.x) * a;
    p.y += (grab.planeY - p.y) * a;
    p.z += (gz - p.z) * a;

    // KINEMATIC でも速度を持たせておく（他の駒を押しのけるため）
    b.velocity.set((p.x - px) / dt, (p.y - py) / dt, (p.z - pz) / dt);

    // 摘まんだ駒は指の中で水平になる（裏返していればその向きのまま）
    flatQuaternion(grab.yaw, grab.flipped, settleQ);
    const cur = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    cur.slerp(settleQ, 1 - Math.exp(-P.uprightRate * dt));
    b.quaternion.set(cur.x, cur.y, cur.z, cur.w);

    // 手の速度は駒の実移動から測る（追従の遅れ込みの値になる）
    grab.vel.set((p.x - grab.prev.x) / dt, (p.y - grab.prev.y) / dt, (p.z - grab.prev.z) / dt)
      .lerp(grab.vel, 0.35);
    grab.prev.set(p.x, p.y, p.z);

    // 吸着圏内かを見せる
    const spot = placeAt(p.x, p.z);
    const onStand = spot && spot.kind === "stand";
    const standPl = onStand ? standPlacement(held, spot.stand, spot.x, spot.z) : null;
    const rest = !spot ? 0
      : spot.stacks ? spot.topY + held.size.t / 2
      : surfaceY(held, spot);
    // 重なりを切っているとき、駒がいる升には収まらない。目印の色でそれを見せる。
    // 収まる先を目印で見せる。**距離では切らない**（盤の上ならどこで離しても最寄りの升に入る）。
    const within = !blockedAt(held, spot, grab.yaw) && spot && P.snapMode === "on" &&
      (p.y - rest) <= P.snapMaxHeight;

    marker.visible = !!spot && P.snapMode !== "off";
    if (marker.visible) {
      if (onStand) {
        // 隣の肩に寄り添う先を見せる。単独で置くならその場所を指す。
        marker.position.set(standPl.x, spot.topY + 0.03, standPl.z);
        marker.scale.set((held.size.w / SQ.w) * 1.1, 1, (held.size.l / SQ.d) * 1.1);
      } else if (spot.stacks) {
        // 駒箱。並べ方の決まりが無いので、置いた場所をそのまま指す。
        marker.position.set(spot.x, spot.topY + 0.03, spot.z);
        marker.scale.set((held.size.w / SQ.w) * 1.1, 1, (held.size.l / SQ.d) * 1.1);
      } else {
        marker.position.set(spot.x, TOP_Y + 0.03, spot.z);
        marker.scale.set(1, 1, 1);
      }
      marker.material.color.set(within ? "#5ce08a" : "#e0725c");
      marker.material.opacity = within ? 0.32 : 0.16;
    }

    // すべらせて指しているときだけ、手前の駒をこすったかを見る。持ち上げて運んでいるなら
    // 上を通っても触れていないので数えない（駒台から打つときに必ず鳴ってしまう）。
    // 盤の上にいるときだけ見るのも同じ理由。
    if (grab.slide && spot && spot.kind === "square" &&
        overPiece(held, p.x, p.z, p.y, grab.yaw)) grab.grazed = true;
  }

  for (const piece of pieces) {
    const s = piece.settle;
    if (!s) continue;
    s.t += dt;
    const k = THREE.MathUtils.clamp(s.t / P.snapTime, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const b = piece.body;
    b.position.set(
      THREE.MathUtils.lerp(s.from.x, s.to.x, e),
      THREE.MathUtils.lerp(s.from.y, s.to.y, e),
      THREE.MathUtils.lerp(s.from.z, s.to.z, e)
    );
    settleQ.copy(s.fromQ).slerp(s.toQ, e);
    b.quaternion.set(settleQ.x, settleQ.y, settleQ.z, settleQ.w);

    if (k >= 1) {
      piece.settle = null;
      const drop = Math.max(0, s.from.y - s.to.y);
      const now2 = performance.now();
      // クールダウンは音の種類ごとに持つ。駒を取って駒台へ送るときは
      // 「指す音」と「置く音」が同時に鳴るべきで、片方に潰されては困る。
      // 種類が同じもの（整列で駒台に並べるなど）はまとめて鳴らない。
      if (s.sound && now2 - lastPlayed[s.sound] > 30) {
        lastPlayed[s.sound] = now2;
        lastSoundAt = now2; // 直後の物理的な接触音は抑える
        const strength = THREE.MathUtils.clamp(0.35 + drop / 3.5, 0.35, 1);
        if (s.sound === "place") playPlace(strength);
        else if (s.sound === "slide") playSlide(strength);
        else playClack(strength, s.pitch);
        settleLog.push({ sound: s.sound, piece: piece.kindId, at: now2 });
        if (settleLog.length > 20) settleLog.shift();
      }
      // 駒台の持ち駒は肩を接して並び、駒箱の駒は重ねて入れる。どちらも実寸の箱どうしが
      // 重なるので、置いたら物理から外す。盤の駒は升に離れて座るので、
      // そのまま剛体に戻して寝かせる。
      const here = placeAt(b.position.x, b.position.z);
      const onStand = !!here && here.stacks;
      b.type = onStand ? CANNON.Body.STATIC : CANNON.Body.DYNAMIC;
      b.updateMassProperties();
      b.collisionResponse = true;
      b.velocity.setZero();
      b.angularVelocity.setZero();
      if (!onStand) b.sleep(); // 置いた駒は寝かせる。当たれば起きる。
      // 収まった先に合わせてボタンを置き直す（吸着で少し動くので）
      if (piece === selected) placePieceButtons();
    }
  }

  // **山になった駒は放っておくと永久に蠢く。** 押し合いが解けず、寝る条件を満たさない
  // まま微妙に動き続ける（実測で 15 秒後も 3〜4 枚）。物理としては正しくても、盤の上で
  // 駒がいつまでも身じろぎしているのは見た目が悪い。頃合いで手で寝かせる。
  // **掴んでいる駒と収まりかけの駒は触らない。**
  if (calmDeadline && now > calmDeadline) {
    for (const p of pieces) {
      if (p === grab.piece || p.settle || p.body.type !== CANNON.Body.DYNAMIC) continue;
      if (p.body.sleepState !== 2) p.body.sleep();
    }
    calmDeadline = 0;
  }

  // 振り駒。**全部寝てから数える**（転がっている途中の表裏は当てにならない）。
  // 上の `calmDeadline` が先に手で寝かせるので、期限は保険。
  if (furigoma) {
    const done = furigoma.list.every((p) => p.body.sleepState === 2) || now > furigoma.deadline;
    if (done) furigomaFinish();
  }

  world.step(1 / 120, dt, 6);

  // **影を描き直すかどうかは「駒が実際に動いたか」で決める。**
  // 状態（掴んでいる・収まりかけ・寝ている）で判定すると、初期配置や整列のように
  // 姿勢を直接置き換える経路を取りこぼし、影だけが古い場所に残る。
  // ここは書き写す直前なので、メッシュ（前フレーム）と剛体（今フレーム）を比べれば
  // 「見た目が変わるか」がそのまま出る。寝ている駒は完全に同じ値になる。
  let moved = false;
  for (const piece of pieces) {
    const p = piece.body.position, q = piece.body.quaternion, m = piece.mesh;
    if (!moved &&
      (m.position.x !== p.x || m.position.y !== p.y || m.position.z !== p.z ||
       m.quaternion.x !== q.x || m.quaternion.y !== q.y ||
       m.quaternion.z !== q.z || m.quaternion.w !== q.w)) moved = true;
    m.position.copy(p);
    m.quaternion.copy(q);
  }
  // 動きが止まった後にもう1回描く。最後の1フレームぶんの位置が反映されないと、
  // 影だけが半駒ずれた所に残る。
  if (moved) shadowHold = 2;
  if (shadowHold > 0) { renderer.shadowMap.needsUpdate = true; shadowHold--; }

  // 盤面の読み取りは毎フレーム要らない。目で追える程度に間引く。
  if (now - lastReadAt > 150) {
    lastReadAt = now;
    refreshHandles();
    // 取っ手を作り直すと濃さが戻ってしまう。指が乗ったままなら当て直す。
    if (!grab.piece && !chainGrab.list) hoverHandle();
    refreshBoardState();
  }

  renderer.render(scene, camera);
}

// --- 画面まわり ---------------------------------------------------------
//
// カメラの画角（fov）は**縦**方向なので、縦長の画面ほど横の視野が狭くなる。
// 距離を固定にしていると、タブレットを縦に持った時点で盤の左右が切れる。

/** 盤と駒台の隅。床から上面まで取る（見下ろすと脚が画面の下へ伸びるため）。 */
function extentPoints() {
  const pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, TOP_Y]) {
    pts.push(new THREE.Vector3((sx * BOARD.w) / 2, y, (sz * BOARD.d) / 2));
  }
  for (const s of STANDS) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, STAND.topY]) {
      pts.push(new THREE.Vector3(s.x + (sx * STAND.w) / 2, y, s.z + (sz * STAND.d) / 2));
    }
  }
  // 駒箱は出しているときだけ数える。しまえば今までどおりの見え方に戻る。
  if (KOMABAKO.visible) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, BOX.h]) {
      pts.push(new THREE.Vector3(KOMABAKO.x + (sx * BOX.w) / 2, y, KOMABAKO.z + (sz * BOX.d) / 2));
    }
  }
  return pts;
}

/**
 * 盤と駒台が画面に収まる最小のカメラ距離。
 *
 * 三角関数で出そうとすると透視の効き（手前の物ほど大きく写る）を落として必ず足りなくなる。
 * 実際に隅を投影して二分探索する。呼ぶのは起動時とリサイズ時だけなので重さは問題にならない。
 */
function fitDistance(margin = 1.06) {
  const pts = extentPoints();
  const keep = cam.r;

  // 画面からいちばんはみ出している量。1 を超えていたら切れている。
  const over = (r) => {
    cam.r = r;
    applyCamera();
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    let m = 0;
    for (const p of pts) {
      const v = p.clone().project(camera);
      m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
    }
    return m;
  };

  let lo = 22, hi = 220;
  let out = hi;
  if (over(hi) <= 1) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (over(mid) > 1) lo = mid; else hi = mid;
    }
    out = Math.min(hi * margin, 220);
  }
  cam.r = keep;
  applyCamera();
  return out;
}

/** 盤が切れているときだけ引く。使う人が寄せた状態を勝手に戻さない。 */
function ensureFit() {
  const need = fitDistance();
  if (cam.r < need) { cam.r = need; applyCamera(); }
}

function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // 画面の形が変わると入る範囲も変わる。切れたぶんだけ引く。
  ensureFit();
  clearSelection(); // ⟳ の画面座標がずれるので引っ込める
}
addEventListener("resize", resize);

// --- 盤面を読む ---------------------------------------------------------
//
// 物理サンドボックスなので「9三に何があるか」は自明でない。ここでは推定をしない。
// ちゃんと升に収まっている駒だけを読み、曖昧なものは読まない。升の交点に置いた駒・
// 倒れた駒・他の駒に重ねた駒は、距離／傾き／高さのどれかで勝手に外れる。
//
// 状態は持たない。読むたびに全駒の姿勢から作り直す。掴んだ・倒した・隣に押されてズレた、
// をいちいち無効化して回らずに済む（記録方式だと駒が動いても古い升に居座る）。
// 吸着モードとは無関係に働く。吸着は駒を動かす処理、これは読むだけの処理。

const KAN = "一二三四五六七八九";

function readBoard() {
  const board = new Map(); // "筋,段" → 升にある駒
  const hands = [[], []];  // 駒台に載っている駒。駒台の持ち主ごと
  const box = [];          // 駒箱に入っている駒。局面には関わらない
  const loose = [];        // どこにも属さない駒

  for (const piece of pieces) {
    const b = piece.body;
    const q = piece.mesh.quaternion;

    // 手の中・移動中は読まない
    if (grab.piece === piece || piece.settle) { loose.push(piece); continue; }
    // 倒れている駒は読まない
    if (tiltDegrees(q) > P.readMaxTilt) { loose.push(piece); continue; }

    const owner = Math.abs(yawOf(q)) < Math.PI / 2 ? 0 : 1;
    // 裏のない駒（王・金）は裏返っていても成りではない
    const promoted = isFlipped(q) && !!KINDS[piece.kindId].back;
    const entry = { piece, kindId: piece.kindId, owner, promoted };

    const stand = nearestStand(b.position.x, b.position.z);
    if (stand) { hands[stand.owner].push(entry); continue; }

    // **駒箱の駒は局面に数えない。** 持ち駒でもなければ「読めない駒」でもない
    // （駒落ちで外した駒なので、解析で警告を出されては困る）。
    if (nearestBox(b.position.x, b.position.z)) { box.push(entry); continue; }

    const sq = nearestSquare(b.position.x, b.position.z);
    if (!sq || sq.dist > P.readMaxDist) { loose.push(piece); continue; }

    // 盤面から浮いている＝他の駒の上に載っている
    if (Math.abs(b.position.y - (TOP_Y + piece.size.t / 2)) > P.readMaxLift) {
      loose.push(piece); continue;
    }

    const key = `${sq.file},${sq.rank}`;
    if (board.has(key)) {
      // 同じ升に2枚。どちらとも決められないので両方読まない
      loose.push(piece, board.get(key).piece);
      board.delete(key);
      continue;
    }
    board.set(key, Object.assign(entry, { file: sq.file, rank: sq.rank }));
  }
  return { board, hands, box, loose };
}

// --- 最終手 -------------------------------------------------------------
//
// 盤面を2回ぶん比べて、新しく駒が入った升を最後の手とみなす。
// 駒を持ち上げている間・吸着の途中は盤面が欠けるので、落ち着くまで比べない。
// 「動かした駒」を追いかけるのではなく、あくまで盤面の差から出す（readBoard と同じ考え方）。

let prevBoard = null;
let lastMove = null;

function updateLastMove(board) {
  // 運んでいる最中は盤面が欠けるので比べない。
  // ただし「取った駒を手に持っている」状態（sticky）は指し終わっているので数える。
  if ((grab.piece && !grab.sticky) || pieces.some((p) => p.settle)) return;
  if (prevBoard) {
    let appeared = null;
    let count = 0;
    for (const [key, e] of board) {
      const before = prevBoard.get(key);
      if (!before || before.piece !== e.piece) { appeared = e; count++; }
    }
    // 2箇所以上が同時に変わったときはどれが最後の手か決められないので触らない
    if (count === 1) lastMove = appeared;
  }
  prevBoard = board;
}

/**
 * 盤面を読み直して、最終手ハイライトを今の局面に合わせる。
 *
 * **`readBoard()` を呼ぶだけの関数ではない。** 最終手は盤面の差から出すので、
 * ここを止めるとハイライトが更新されなくなる（`updateLastMove`）。
 */
function refreshBoardState() {
  const { board } = readBoard();

  updateLastMove(board);
  lastMoveMark.visible = P.showLastMove && !!lastMove;
  if (lastMoveMark.visible) {
    const c = squareToWorld(lastMove.file, lastMove.rank);
    lastMoveMark.position.set(c.x, TOP_Y + 0.02, c.z);
  }
}

/** セグメントの選択を外から変える。**押したのと同じ経路を通す**（保存も副作用も同じ）。 */
function setSegment(id, v) {
  document.querySelector(`#${id} button[data-v="${v}"]`)?.click();
}

function segment(id, onPick) {
  const buttons = [...document.querySelectorAll(`#${id} button`)];
  if (!buttons.length) return;
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      buttons.forEach((x) => x.classList.toggle("on", x === b));
      segValues[id] = b.dataset.v;
      onPick(b.dataset.v);
      saveSettings();
    });
  });
  // 覚えている選択があれば、そこから始める。**押したときと同じ経路を通す**（`saveSettings` を
  // 読む）。既定と同じなら `onPick` は呼ばない（起動時に書体やシャドウを作り直さない）。
  const now = buttons.find((x) => x.classList.contains("on"));
  segValues[id] = now?.dataset.v;
  const want = buttons.find((x) => x.dataset.v === stored.seg?.[id]);
  if (want && want !== now) {
    buttons.forEach((x) => x.classList.toggle("on", x === want));
    segValues[id] = want.dataset.v;
    onPick(want.dataset.v);
  }
}

// --- 操作モード ---------------------------------------------------------
//
// 指は1本しかないので、同じドラッグが駒にも視点にも使えると必ずどちらかを誤爆する。
// 「いま何を動かすか」を先に決める方式にした。タブレットではこれが無いと成立しない。
//
// **排他にする。**「駒」では視点はどのボタンでも動かず、
// 「視点」では駒に触れない。マウスには余ったボタンがあるが、そちらだけ例外にすると
// 同じ操作の意味が入力機器で変わる。
const modeButtons = document.querySelectorAll("#topbar button[data-mode]");
function setMode(v) {
  P.mode = v;
  modeButtons.forEach((b) => b.classList.toggle("on", b.dataset.mode === v));
  if (v !== "piece") {
    // 手を空にしてから移る。掴んだまま視点を回すと駒が付いて回る。
    // 取った駒を手に持っている状態（sticky）もここで置かれる。
    if (chainGrab.list) endChainGrab();
    if (grab.piece) endGrab();
    showChainMarks(null);
  }
  clearSelection(); // 視点を動かすと ⟳ の位置がずれる。駒へ戻るときも選び直す
  orbit.active = false;
  refreshHandles();
  // 視点のプリセットは「視点」のときだけ出す（駒モードでは視点が動かないので）
  presetBar.hidden = v !== "camera";
}
modeButtons.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

// --- 視点のプリセット ---------------------------------------------------
//
// 真上／斜め × 近／中／遠。
//
// **距離は `fitDistance()` の倍率で持つ。** 固定の cm にすると、縦持ちの端末や
// 細い窓で盤がはみ出す（画角は縦方向なので、画面が縦長なほど横が狭くなる）。
// **`fitDistance()` は今の角度で測る**ので、角度を先に入れてから距離を出すこと。
// 真上のほうが必要な距離は短い（実測 95.7cm 対 109.5cm。斜めは手前の駒台が画面を食う）。
//
// **左右の回り込み（`theta`）は変えない。** 後手側から見ている人が「真上」を押したときに
// 手前と奥が入れ替わったら、盤の見え方が別物になってしまう。
//
// **覚えない。** 選んだ結果の視点そのものは `saveSettings()` が覚えるので、
// プリセットの選択まで保存すると、起動時に押し直して覚えた視点を上書きしてしまう。
const CAM_ANGLE = { top: 0.25, tilt: 0.92 }; // 起動時と同じ「ほぼ真上」＋斜め
const CAM_ZOOM = { near: 0.75, mid: 1, far: 1.4 };
const presetBar = document.getElementById("campreset");
const preset = { angle: "top", zoom: "mid" };

function applyPreset() {
  cam.phi = CAM_ANGLE[preset.angle];
  applyCamera(); // 角度を反映してから測る
  cam.r = fitDistance() * CAM_ZOOM[preset.zoom];
  applyCamera();
  clearSelection(); // 駒のボタンは画面座標で置いてあるので、動いたら引っ込める
}

presetBar.querySelectorAll("button[data-angle], button[data-zoom]").forEach((b) => {
  const kind = b.dataset.angle ? "angle" : "zoom";
  b.addEventListener("click", () => {
    preset[kind] = b.dataset[kind];
    presetBar.querySelectorAll(`button[data-${kind}]`)
      .forEach((x) => x.classList.toggle("on", x === b));
    applyPreset();
  });
});

// **盤の辺を画面と平行に戻す。** 指で回すと必ず斜めになり、**そこから水平に合わせ直すのは
// 骨が折れる**。ワンボタンで揃える。
//
// **0 度に固定はしない。いちばん近い直角に丸める。** 後手側から見ている人を先手側へ
// 引き戻したら、手前と奥が入れ替わって別の盤になってしまう（プリセットで `theta` を
// 変えないのと同じ理由）。
document.getElementById("btn-square").addEventListener("click", () => {
  const q = Math.PI / 2;
  cam.theta = Math.round(cam.theta / q) * q;
  applyCamera();
  clearSelection();
});

// 設定は普段しまっておく。盤を広く使うため。
const settings = document.getElementById("settings");
const scrim = document.getElementById("scrim");
const bookmarksPanel = document.getElementById("bookmarks");
const analysisPanel = document.getElementById("analysis");
const panels = [settings, bookmarksPanel, analysisPanel];
// 幕はパネルで使い回す。どれか開いていれば出す。
function showPanel(which) {
  for (const p of panels) p.hidden = p !== which;
  scrim.hidden = !which;
}
function showSettings(on) { showPanel(on ? settings : null); }
function showBookmarks(on) { showPanel(on ? bookmarksPanel : null); if (on) renderMarks(); }
function showAnalysis(on) { showPanel(on ? analysisPanel : null); }
document.getElementById("btn-settings").addEventListener("click", () => showSettings(true));
document.getElementById("btn-close").addEventListener("click", () => showSettings(false));
document.getElementById("btn-marks").addEventListener("click", () => showBookmarks(true));
document.getElementById("btn-marks-close").addEventListener("click", () => showBookmarks(false));
document.getElementById("btn-analysis").addEventListener("click", () => showAnalysis(true));
document.getElementById("btn-analysis-close").addEventListener("click", () => showAnalysis(false));
scrim.addEventListener("click", () => showPanel(null));

// --- 局面の栞 -----------------------------------------------------------
//
// **戻れるだけでよい。** 本に栞を挟むのと同じ感覚で、複数登録でき、
// 名前は付けない。終了後に覚えている必要もないので保存もしない（リロードで消える）。
//
// 姿勢の控えと戻しは上の `capturePoses` / `applyPoses`。
//
// 見分けるのは**挟んだ瞬間の画面そのもの**。名前が無い以上、絵で見分ける
// しかない。9×9 の図を起こす手もあるが、それだと readBoard と同じ弱点を抱える。

const bookmarks = [];
const markList = document.getElementById("marklist");

// 栞の絵の大きさ。**4:3 で持つ。**
// 画面の形のまま持つと、縦持ちのときに 1 枚が長すぎて一覧にならない。
// **切り出しはここでやる。CSS の object-fit に任せてはいけない。**
// 画面の形のまま小さく保存してから枠に合わせて伸ばすことになり、1.5 倍ほど引き伸ばされて
// 画がガビガビになる。ここで切っておけば、持っている画素がそのまま表示に使われる。
// 一覧の幅は 328px 前後なので、640 あれば dpr 2 の画面でも足りる。
const MARK_W = 640, MARK_H = 480;

/**
 * いまの盤面を canvas に描く。栞の絵も画像の保存もここを通る。
 *
 * **描画バッファは合成のあと捨てられる**ので、その場で描き直してすぐ読む
 * （`preserveDrawingBuffer` を立てれば要らないが、そのぶん常に遅くなる）。
 *
 * 画面より大きい大きさを渡されたら、**描画バッファを一時的にそこまで広げて描き直す**。
 * 画面の画素を引き伸ばしても粗いままなので、保存用にはこれが要る。
 * **カメラの縦横比も一緒に変える**（変えないと写る範囲がずれる）。
 * 元に戻したあともう一度描くのは、次のフレームまで壊れた絵を残さないため。
 */
function renderToCanvas(w, h) {
  const src = renderer.domElement;
  const keepW = src.width, keepH = src.height;
  const keepRatio = renderer.getPixelRatio();
  const keepAspect = camera.aspect;
  const bigger = w > keepW || h > keepH;
  if (bigger) {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false); // false ＝ CSS の大きさは触らない
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  // 画面の中央から求める形に切る。盤は中央にあるので、どちらの持ち方でも残る。
  const sw = Math.min(src.width, (src.height * w) / h);
  const sh = Math.min(src.height, (src.width * h) / w);
  cv.getContext("2d").drawImage(
    src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);

  if (bigger) {
    renderer.setPixelRatio(keepRatio);
    renderer.setSize(keepW / keepRatio, keepH / keepRatio, false);
    camera.aspect = keepAspect;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  return cv;
}

/** 挟んだ瞬間の画面を切り出して取っておく。 */
function snapshot() {
  return renderToCanvas(MARK_W, MARK_H).toDataURL("image/jpeg", 0.86);
}

// 保存する画像の長辺。**画面の縦横比は保つ**（見えているものをそのまま大きく出す）。
const SHOT_LONG = 1920;

/**
 * いまの盤面を PNG で保存する。
 *
 * **data URL ではなく Blob で渡す。** 1920px の PNG は数 MB あり、data URL にすると
 * 文字列として全部メモリに載る。
 */
let saving = false;

function saveImage() {
  if (saving) return; // エンコード中の連打で何枚も落とさない
  const src = renderer.domElement;
  const ratio = src.width / src.height || 1;
  const w = ratio >= 1 ? SHOT_LONG : Math.round(SHOT_LONG * ratio);
  const h = ratio >= 1 ? Math.round(SHOT_LONG / ratio) : SHOT_LONG;
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const name = `shogi-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
  // **押した手応えを先に出す。** 1920px の PNG は書き出しに 1 秒ほどかかるので
  // （実測 1.05 秒）、黙って止まっていると効かなかったように見える。
  saving = true;
  toast("画像を作っています…", 30000);
  renderToCanvas(w, h).toBlob((blob) => {
    saving = false;
    if (!blob) { toast("画像を作れませんでした"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    // すぐ捨てるとダウンロードが始まる前に消えることがある
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`${name}（${w}×${h}）を保存しました`);
  }, "image/png");
}

function addBookmark() {
  // 手に持ったままだと、その駒だけ宙に浮いた姿勢で覚えることになる
  if (grab.piece) endGrab();
  if (chainGrab.list) endChainGrab();
  bookmarks.unshift({ img: snapshot(), poses: capturePoses() });
  renderMarks();
}

function restoreBookmark(bm) {
  // 栞へ跳んだこと自体も戻せるようにする（**`applyPoses` では積まない**。
  // `undo` がそこを通るので、積むと戻るたびに段が増えて出られなくなる）。
  pushUndo();
  applyPoses(bm.poses);
}

function renderMarks() {
  markList.replaceChildren();
  if (!bookmarks.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "まだ挟んでいません";
    markList.append(empty);
    return;
  }
  // **番号は並びから毎回つけ直す**（栞そのものには持たせない）。
  // 通し番号にすると、捨てたぶんが飛んで 1・2 を捨てた次が 3 になる。
  // 名前を付けない以上ただの目印なので、常に 1 から並ぶほうがよい。
  bookmarks.forEach((bm, i) => {
    const el = document.createElement("button");
    el.className = "mark";
    el.title = "この局面へ戻る";
    const img = document.createElement("img");
    img.src = bm.img;
    img.alt = "";
    const no = document.createElement("span");
    no.className = "no";
    no.textContent = bookmarks.length - i; // 新しいものほど大きい番号
    // ボタンの中にボタンは置けないので span にして、押されたら親へ伝えない
    const del = document.createElement("span");
    del.className = "del";
    del.textContent = "×";
    del.title = "この栞を捨てる";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      const i = bookmarks.indexOf(bm);
      if (i >= 0) bookmarks.splice(i, 1);
      renderMarks();
    });
    el.append(img, no, del);
    el.addEventListener("click", () => { restoreBookmark(bm); showBookmarks(false); });
    markList.append(el);
  });
}
document.getElementById("btn-mark").addEventListener("click", addBookmark);
document.getElementById("btn-shot").addEventListener("click", saveImage);
renderMarks();

// --- 解析（USI エンジン） -----------------------------------------------
//
// **押した時点の局面だけを読む。** 駒を持ち上げただけで盤面は変わるので、
// リアルタイムに追わない（「何をもって指したか」が決められないため）。
//
// エンジンは重い（1.5MB の wasm）ので、**最初に解析を押したときだけ読み込む**。
// 使わない人には落ちてこない。

const analyseBtn = document.getElementById("btn-analyse");
const analysisOut = document.getElementById("analysis-out");
let analysisSide = 0;   // 0=先手番 / 1=後手番
let analysisDepth = 16;
let showArrow = true;
let analysing = false;

segment("side", (v) => { analysisSide = v === "w" ? 1 : 0; });

// --- 局面の受け渡し（SFEN） ---------------------------------------------
//
// **局面ひとつだけ。棋譜は扱わない**（「何をもって指したか」が決められないため）。
// 読み込んだらそこで終わりで、あとは今までどおり手で触る。
//
// - **駒箱の駒は局面に数えない**（`readBoard` の `box`）ので、駒落ちがそのまま
//   SFEN として出入りする。読み書きが対称になる
// - 手番は盤面からは決まらないので、解析パネルの「手番」と共有する。
//   読み込んだら**そのボタンを押す**（`setSegment`）ので、そのまま解析にかけられる
// - 手数は持たない（棋譜が無い）ので、出すときは常に 1

const sfenBox = document.getElementById("sfen");

/** いまの盤面を SFEN にしてテキスト欄へ出す。 */
function dumpSfen() {
  const read = readBoard();
  const text = toSfen(read, analysisSide);
  if (sfenBox) {
    sfenBox.value = text;
    sfenBox.select();
  }
  // **読めない駒があっても出す。** ただし黙って落とすと、欠けた局面を
  // 正しいものとして持ち出してしまう。
  const { problems, loose } = checkPosition(read);
  const notes = [];
  if (loose) notes.push(`升に収まっていない駒が ${loose} 枚あります（SFEN には入りません）`);
  if (problems.length) notes.push(problems[0]);
  navigator.clipboard?.writeText(text).then(
    () => toast(notes.length ? `コピーしました。ただし ${notes.join("／")}` : "SFEN をコピーしました", notes.length ? 6000 : 3000),
    () => toast(notes.length ? `テキスト欄に出しました。ただし ${notes.join("／")}` : "テキスト欄に出しました", notes.length ? 6000 : 3000)
  );
}

/** テキスト欄の SFEN を盤に並べる。 */
function loadSfen() {
  const res = fromSfen(sfenBox ? sfenBox.value : "");
  if (res.error) {
    toast(`読み込めません：${res.error}`, 6000);
    return false;
  }
  // 盤の向きは駒の持ち主で決まる（段では決まらない。SFEN は駒ごとに先後を持つ）
  const list = res.board.map((e) => [e.kindId, e.file, e.rank, e.owner === 1 ? Math.PI : 0, e.promoted]);
  setupPosition(list, res.hands);
  setSegment("side", res.turn === 1 ? "w" : "b");
  showSettings(false); // 並んだ盤を見せる
  const held = res.hands[0].length + res.hands[1].length;
  toast(`並べました（盤 ${list.length} 枚・持ち駒 ${held} 枚・${res.turn === 1 ? "後手番" : "先手番"}）`);
  return true;
}

document.getElementById("btn-sfen-load")?.addEventListener("click", loadSfen);
document.getElementById("btn-sfen-dump")?.addEventListener("click", dumpSfen);

/**
 * いまの局面を指す URL を作る。**局面を人に渡すための口**で、受け取った側は
 * 開くだけでその局面から触れる（そこから先は今までどおり手で並べる）。
 *
 * SFEN は空白と `/` を含むので `encodeURIComponent` を通す。
 */
function shareUrl() {
  const text = toSfen(readBoard(), analysisSide);
  const url = `${location.origin}${location.pathname}?sfen=${encodeURIComponent(text)}`;
  if (sfenBox) { sfenBox.value = url; sfenBox.select(); }
  const { loose } = checkPosition(readBoard());
  const note = loose ? `。ただし升に収まっていない駒が ${loose} 枚あります（入りません）` : "";
  navigator.clipboard?.writeText(url).then(
    () => toast(`リンクをコピーしました${note}`, loose ? 6000 : 3000),
    () => toast(`テキスト欄に出しました${note}`, loose ? 6000 : 3000)
  );
}
document.getElementById("btn-sfen-url")?.addEventListener("click", shareUrl);

/**
 * `?sfen=…` 付きで開かれたら、その局面から始める。
 *
 * **読めなければ平手のまま黙って始める**（理由は知らせに出すが、盤は普通に使える）。
 * リンクを踏んだ人にとっては、盤が出ないことのほうが困る。
 * **読み込みは起動時の 1 回だけ**で、そのあとは今までどおり手で触る（棋譜にはしない）。
 */
function applyUrlPosition() {
  let text = null;
  try {
    text = new URLSearchParams(location.search).get("sfen");
  } catch { return false; }
  if (!text) return false;
  const res = fromSfen(text);
  if (res.error) {
    toast(`リンクの局面を読めません：${res.error}`, 6000);
    return false;
  }
  const list = res.board.map((e) => [e.kindId, e.file, e.rank, e.owner === 1 ? Math.PI : 0, e.promoted]);
  setupPosition(list, res.hands);
  setSegment("side", res.turn === 1 ? "w" : "b");
  if (sfenBox) sfenBox.value = toSfen(readBoard(), res.turn);
  // **起動そのものは戻せる操作ではない。** ここで積まれた段は捨てる（`resetHirate` と同じ扱い）
  undoStack.length = 0;
  refreshUndo();
  toast(`リンクの局面を並べました（${res.turn === 1 ? "後手番" : "先手番"}）`);
  return true;
}
segment("depth", (v) => { analysisDepth = +v; });
segment("arrow", (v) => { showArrow = v === "on"; if (!showArrow) hideArrow(); else redrawArrow(); });

/** 引っかかった点を解析パネルに出して、そのまま読むかどうかを聞く。 */
function renderProblems(problems) {
  analysisOut.replaceChildren();
  const box = document.createElement("div");
  box.className = "warn";
  box.innerHTML = `この局面はそのままでは読めません。<ul>${
    problems.map((p) => `<li>${p}</li>`).join("")}</ul>`;
  const btn = document.createElement("button");
  btn.className = "go";
  btn.textContent = "それでも読める駒だけで解析する";
  btn.addEventListener("click", () => runAnalysis(true));
  box.append(btn);
  analysisOut.append(box);
}

function renderError(message) {
  analysisOut.replaceChildren();
  const box = document.createElement("div");
  box.className = "warn";
  box.textContent = message;
  analysisOut.append(box);
}

async function runAnalysis(force = false) {
  if (analysing) return;
  const rb = readBoard();
  const check = checkPosition(rb);
  const problems = [...check.problems];
  if (check.loose) problems.unshift(`升に収まっていない駒が ${check.loose} 枚あります`);
  if (problems.length && !force) {
    renderProblems(problems);
    return;
  }

  analysing = true;
  analyseBtn.disabled = true;
  analysisOut.replaceChildren();
  const sfen = toSfen(rb, analysisSide);
  // **前の解析の矢印は先に消す。** 新しい結果が出るまで残っていると、いまの局面の
  // 最善手のように見える。
  clearArrow();
  // 結果は札のほうに出す。**幕を閉じて盤を見えるようにする**（読み筋を見ながら並べたい）。
  showPanel(null);
  showEval(true);
  // **初回はエンジン（1.5MB）を落としてくるので待たされる。**
  // 黙って止まっていると壊れたように見えるので、何を待っているかを札に出す。
  const first = !engineLoaded();
  analyseBtn.textContent = first ? "エンジンを準備中…" : "読んでいます…";
  const blank = { depth: 0, pv: [], score: null };
  renderEval({
    thinking: true, info: blank, sfen,
    note: first ? "エンジンを読み込んでいます…（初回だけ約 1.5MB。少し時間がかかります）" : null,
  });
  try {
    const engine = await loadEngine();
    if (first) {
      analyseBtn.textContent = "読んでいます…";
      renderEval({ thinking: true, info: blank, sfen, note: "エンジンを起動しています…" });
    }
    const info = await engine.analyse(sfen, {
      depth: analysisDepth,
      onInfo: (partial) => renderEval({ thinking: true, info: partial, sfen }),
    });
    lastAnalysis = { move: info.bestmove, side: analysisSide };
    renderEval({ thinking: false, info, sfen });
    redrawArrow();
  } catch (e) {
    renderError(String(e.message || e));
    showEval(false);
    showAnalysis(true);
  } finally {
    analysing = false;
    analyseBtn.disabled = false;
    analyseBtn.textContent = "この局面を解析";
  }
}
analyseBtn.addEventListener("click", () => runAnalysis(false));

// --- 評価値の札 ---------------------------------------------------------
//
// **盤を触りながら読み筋を見たい**ので、幕を張るダイアログにはしない。
// 半透明の小さな札にして、掴んで好きな所へ動かせるようにする。

const evalBox = document.getElementById("eval");
const evalScore = document.getElementById("eval-score");
const evalMeta = document.getElementById("eval-meta");
const evalPv = document.getElementById("eval-pv");

/**
 * 評価値の札。**閉じたら矢印も消す。** 矢印は解析の結果であって
 * 盤にあるものではないので、札を片付けたのに盤に残っているのはおかしい。
 */
function showEval(on) {
  evalBox.hidden = !on;
  if (!on) clearArrow();
}

function renderEval({ thinking, info, sfen, note }) {
  evalScore.textContent = scoreText(info.score, analysisSide);
  evalScore.classList.toggle("think", !!thinking);
  // `note` は「まだ読み始めていない」ときの断り書き（エンジンの読み込み中など）。
  evalMeta.textContent = note
    || `深さ ${info.depth}${thinking ? "（読んでいます…）" : ""}`
      + (info.nodes ? `　${info.nodes.toLocaleString()} 手` : "");
  // **升だけでは読めない**ので、局面を進めて駒の種類まで出す。
  const text = pvText(sfen, info.pv || [], 12);
  evalPv.replaceChildren();
  text.forEach((m, i) => {
    const el = document.createElement(i === 0 ? "b" : "span");
    el.textContent = m + " ";
    evalPv.append(el);
  });
}

document.getElementById("eval-close").addEventListener("click", () => showEval(false));

// 掴んで動かす。**画面の外へは出さない**（つまみ所を失うと戻せなくなる）。
{
  const head = evalBox.querySelector(".head");
  let dragging = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.id === "eval-close") return;
    const r = evalBox.getBoundingClientRect();
    dragging = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    // 下と右の指定を捨てて、左上で位置を決める形に切り替える
    evalBox.style.right = "auto";
    evalBox.style.bottom = "auto";
    evalBox.style.left = `${r.left}px`;
    evalBox.style.top = `${r.top}px`;
  });
  head.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const r = evalBox.getBoundingClientRect();
    const x = THREE.MathUtils.clamp(e.clientX - dragging.dx, 0, innerWidth - r.width);
    const y = THREE.MathUtils.clamp(e.clientY - dragging.dy, 0, innerHeight - r.height);
    evalBox.style.left = `${x}px`;
    evalBox.style.top = `${y}px`;
  });
  const end = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    try { head.releasePointerCapture(e.pointerId); } catch {}
    dragging = null;
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

// --- 最善手の矢印 -------------------------------------------------------
//
// 盤の上に置く板。打つ手は出どころが無いので、打つ升に印だけ出す。
//
// **駒の下に敷いてはいけない。** 指し手は移動元にも移動先にも駒がいるので、
// 盤面に敷くとほとんど隠れて見えない（最初そう作って見えなかった）。
// `depthTest: false` で常に手前に描き、半透明にして駒の字を透かす。

let lastAnalysis = null;
let arrowMesh = null;
// 裏返っても消えないよう両面にしてある（安全側。回転順を直したいまは法線は常に上を向く）。
const arrowMat = new THREE.MeshBasicMaterial({
  color: 0x39a0ea, transparent: true, opacity: 0.55,
  depthWrite: false, depthTest: false, side: THREE.DoubleSide,
});

function hideArrow() { if (arrowMesh) arrowMesh.visible = false; }

/**
 * 矢印を結果ごと捨てる。**盤面が入れ替わる所では必ず呼ぶ**（初期配置・栞・整列）。
 * 消さずに残すと、いまの盤とは関係のない手が最善手のように見える。
 * `hideArrow()` だけでは足りない（表示の切り替えで復活してしまう）。
 */
function clearArrow() { lastAnalysis = null; hideArrow(); }

/**
 * 打つ手の出どころ。**駒台のその駒種のうち、打つ升にいちばん近い1枚**から引く
 * （歩を全部つなぐと線だらけになる）。
 *
 * **駒台を記録せず、そのつど読み直す**（`readBoard()`。読み取りと同じ考え方）。
 * 持ち駒は動かせるので、覚えておくと矢印だけ古い場所から伸びる。
 * 該当する駒が駒台に見当たらなければ null ＝ 打つ升に丸を出す形に落ちる。
 */
function dropSource(kindId, owner, to) {
  if (!kindId) return null;
  let best = null;
  for (const e of readBoard().hands[owner] || []) {
    if (e.kindId !== kindId) continue; // 持ち駒に成りは無いので表裏は見ない
    const p = e.piece.body.position;
    const d = Math.hypot(p.x - to.x, p.z - to.z);
    if (!best || d < best.d) best = { d, x: p.x, z: p.z };
  }
  return best;
}

function redrawArrow() {
  hideArrow();
  if (!showArrow || !lastAnalysis) return;
  const m = parseMove(lastAnalysis.move);
  if (!m) return;
  const to = squareToWorld(m.to.file, m.to.rank);

  // 打つ手は駒台の駒から引く。見つからないときだけ、打つ升に丸を出す
  const from = m.drop
    ? dropSource(m.dropKind, lastAnalysis.side, to)
    : squareToWorld(m.from.file, m.from.rank);
  const shape = new THREE.Shape();
  if (!from) {
    shape.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
  } else {
    const len = Math.hypot(to.x - from.x, to.z - from.z);
    // 升は 3cm 角。1 升の移動でも見える太さにする。
    const w = 0.75, head = 1.45, hw = 1.75;
    const body = Math.max(0.1, len - head);
    shape.moveTo(-w / 2, 0);
    shape.lineTo(-w / 2, body);
    shape.lineTo(-hw / 2, body);
    shape.lineTo(0, len);
    shape.lineTo(hw / 2, body);
    shape.lineTo(w / 2, body);
    shape.lineTo(w / 2, 0);
    shape.closePath();
  }
  if (arrowMesh) { arrowMesh.geometry.dispose(); scene.remove(arrowMesh); }
  arrowMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), arrowMat);
  arrowMesh.renderOrder = 20; // depthTest を切ってあるので、描く順で前後が決まる
  // 駒の上に浮かせる。駒の厚みは 0.9cm まで。
  const y = TOP_Y + 1.4;
  if (from) {
    // 形状は +y を先端にして作ってある（駒と同じ約束）。yaw=0 が -z 向き。
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    arrowMesh.position.set(from.x, y, from.z);
    // **回転順は YXZ。既定の XYZ では向きが付かない。** XYZ は Rx·Ry·Rz ＝ **Y 回転が先**に
    // 効くので、まだ立っている板を Y 軸で回すことになる。矢印の長さ方向（ローカル +y）は
    // Y 軸に沿ったままなので回らず、そのあとの Rx(-90°) で必ず -z 向きに倒れる
    // ＝ **どの手も奥へまっすぐ伸びる**（桂も飛車の横移動も）。回るのは板の幅だけで、
    // yaw の分だけ板が垂直に立ち上がり、法線も下を向く（後手の矢印が消えて見えたのはこれ）。
    // YXZ なら先に倒して寝かせてから Y 軸で回すので、盤の上で向きが付く。
    arrowMesh.rotation.set(-Math.PI / 2, yaw, 0, "YXZ");
  } else {
    arrowMesh.position.set(to.x, y, to.z);
    arrowMesh.rotation.set(-Math.PI / 2, 0, 0, "YXZ");
  }
  arrowMesh.visible = true;
  scene.add(arrowMesh);
  renderer.shadowMap.needsUpdate = true;
}

segment("snapmode", (v) => {
  P.snapMode = v;
  document.getElementById("params").classList.toggle("dim", v === "off");
});
segment("wobblemode", (v) => { P.wobbleOn = v === "on"; });
segment("lastmove", (v) => { P.showLastMove = v === "on"; });
segment("coords", (v) => { coords.visible = P.showCoords = v === "on"; });
segment("standhandles", (v) => { P.standHandles = v === "on"; refreshHandles(); });
segment("overlap", (v) => { P.overlap = v === "on"; });
segment("standtidy", (v) => { P.standTidy = v === "on"; });

// --- 描画品質 -----------------------------------------------------------
//
// **公開する以上、相手のスペックは分からない**（タブレットも主な相手）。
// 見た目だけを落とす手を用意しておく。**駒の動きや音には一切触らない。**
// 物理（`solver.iterations`）はここに出さない。下げると駒のめり込みが再発するが、
// それは画質ではなく**挙動が変わる**ことで、使う人には原因が見えない。
//
// **自動では落とさない**（勝手に見た目が変わるのは、この企画で一貫して避けてきた方向）。
segment("shadowq", (v) => {
  if (v === "off") {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    const n = v === "high" ? 2048 : 1024;
    if (key.shadow.mapSize.width !== n) {
      key.shadow.mapSize.set(n, n);
      // 大きさを変えたら作り直させる。捨てないと古いマップを使い続ける。
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
  }
  // enabled を切り替えたらシェーダを組み直す必要がある（three.js の決まり）。
  // **盤も駒も多マテリアル（配列）。** 配列にそのまま needsUpdate を立てても
  // 配列オブジェクトにプロパティが付くだけで中身には効かず、組み直しが起きない。
  // そのまま古いシャドウマップを参照し続けるので、**影を切っても盤に焼き付いたまま残る**
  // 43 個中 43 個が配列で、中身は 138 枚ある。
  scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
    else m.needsUpdate = true;
  });
  renderer.shadowMap.needsUpdate = true;
});

segment("resolution", (v) => {
  renderer.setPixelRatio(v === "auto" ? Math.min(devicePixelRatio, 2) : 1);
  resize();
  renderer.shadowMap.needsUpdate = true;
});
// 駒の仕上げ（彫・彫埋・盛上）。**書体とは別の軸**なので設定も分けてある。
// 中身は法線の符号だけで、**三段ともテクスチャは同じもの**（`piece.js` の `RELIEF` を読む）。
// だから切り替えで駒の絵を描き直さない。
const FINISH_SIGN = { hori: -1, ume: 0, moriage: 1 };
function applyFinish(v) { setRelief({ sign: FINISH_SIGN[v] ?? 1 }); }

// 開発用スライダーの分。**丸みと艶は絵に焼く**ので、そこを動かしたときだけ描き直す。
let reliefTimer = 0;
function applyReliefParams() {
  const redraw = setRelief({
    height: P.reliefHeight, blur: P.reliefBlur, gloss: P.reliefGloss,
  });
  if (!redraw) return;
  // スライダーを動かすたびに 18 面ぶん描き直さない
  clearTimeout(reliefTimer);
  reliefTimer = setTimeout(() => { clearMaterialCache(); applyStyle(); }, 200);
}
// **駒を作る前に値を入れておく。** 丸みと艶はマテリアルを作るときに焼き込むので、
// 後から入れると初回だけ既定の絵になる（書体の画像と同じ話）。
setRelief({ height: P.reliefHeight, blur: P.reliefBlur, gloss: P.reliefGloss });
segment("finish", applyFinish);

// 駒字。**実物の駒書体は画像から取る**（`img/` のスプライト。しんえれ外部駒）。
// 「文字」だけがフォント描画で、画像が読めないときの落ち先でもある。
const KOMA_IMAGES = {
  kinki: "錦旗 柾目 裏朱字.png",
  minase: "水無瀬-柾目-裏朱字.png",
  ryoko: "巻菱湖-柾目-裏朱字.png",
  seian: "源兵衛清安-柾目-裏朱字.png",
  ichiji: "一字A-柾目-裏朱字.png",
  font: null,
};
function applyKomaStyle(v) {
  oneChar = v === "ichiji" || v === "one";
  // **読み込みは非同期。** 届くまではいまの絵のまま動き、届いたら描き直す
  // （同梱フォントと同じ扱い）。読めなければフォント描画のまま。
  return loadKomaImage(KOMA_IMAGES[v] ?? null).then(() => {
    clearMaterialCache();
    applyStyle();
  });
}
segment("style", applyKomaStyle);
// **起動時は `segment` が `onPick` を呼ばない**（既定と同じ選択なら副作用を起こさない作り）。
// 駒字の画像は最初から要るので、ここで一度読む。
applyKomaStyle(segValues.style || "kinki");
segment("capture", (v) => { P.captureMode = v; });
segment("standlayout", applyStandLayout);
segment("boxmode", (v) => showBox(v === "on"));
document.getElementById("btn-spill").addEventListener("click", spillBox);
document.getElementById("btn-boxall").addEventListener("click", boxAll);

// 覚えた設定を捨てて初期状態から開き直す。**変な設定のまま覚えてしまうと、
// リロードしても直らない**ので、逃げ道は要る。消すのは設定だけ（栞はもともと残らない）。
document.getElementById("btn-forget").addEventListener("click", () => {
  const ok = confirm("覚えている設定と視点を消して、最初の状態で開き直します。よろしいですか。");
  if (!ok) return;
  clearTimeout(saveTimer); // 消したそばから書き戻さない
  try { localStorage.removeItem(STORE_KEY); } catch {}
  location.reload();
});

document.getElementById("btn-tidy").addEventListener("click", tidyAll);
document.getElementById("btn-furigoma").addEventListener("click", furigomaStart);
for (const b of document.querySelectorAll("#handicaps button")) {
  b.addEventListener("click", () => setupHandicap(b.dataset.h));
}

// スライダー
const defs = [
  ["followRate", "追従の速さ", 3, 60, 1, "小さいほど駒が手に遅れてついてくる"],
  ["uprightRate", "起こす速さ", 2, 40, 1, "掴んだ駒が水平に戻る速さ"],
  // **揺らぎの上限は読み取り（readMaxDist）の内側で頭打ちになる**（wobbleOffset）。
  // スライダーをいっぱいに振っても、局面が読めなくなる所までは行かない。
  ["wobble", "揺らぎ", 0, 0.8, 0.05, "升の中心からどれだけ外して置くか cm。0 で中心ぴったり"],
  ["snapMaxTilt", "吸着する傾き", 2, 60, 1, "これより傾いていると吸わない 度"],
  ["snapMaxHeight", "吸着する高さ", 0.2, 8, 0.1, "これより高い位置で離すと落ちる cm"],
  ["snapTime", "吸着の速さ", 0.02, 0.4, 0.005, "升に収まるまでの時間 s"],
  ["throwScale", "手の勢い", 0, 2, 0.05, "離したとき駒に渡る速度の倍率"],
];

// 音量だけは使う人のもの。**開発用の `#params` に混ぜない**
// （まとめて畳んだときに音量まで隠れてしまう）。
const volumeDefs = [
  ["volume", "音量", 0, 1.5, 0.05, ""],
];

// 持ち上げとスライドの分かれ目。吸着とは無関係なので別枠。
// 閾値は触ってみないと決まらないので、全部動かせるようにしてある。
const holdDefs = [
  ["holdHeight", "持ち上げ高さの上限", 0, 8, 0.1, "押し続けたときここまで上がる cm"],
  ["liftTime", "上限に達するまで", 0.05, 1.2, 0.01, "押し続けて上限の高さになるまでの秒"],
  ["slideTime", "すべりとみなす早さ", 0.02, 0.5, 0.01, "掴んでこの時間内に動き出したらスライド 秒"],
  ["slideDist", "すべりとみなす距離", 0.1, 3, 0.05, "その間にこれだけ動いたらスライド cm"],
  ["tapTime", "つまむ時間", 0, 0.5, 0.01, "これより短く離したら持ち上げていない扱い。音の高さにだけ効く 秒"],
  ["liftPitch", "高さで音が高くなる量", 0, 0.4, 0.01, "高く持つほど駒音が高くなる"],
];

// 盤面の読み取りは吸着とは別物なので、スライダーも別枠にする
// （#params は吸着が「切」のとき暗くなる。読み取りはそれに従わない）
const readDefs = [
  ["readMaxDist", "読む距離", 0.2, 2.5, 0.05, "升の中心からこの範囲なら その升にあると読む cm"],
  ["readMaxTilt", "読む傾き", 2, 45, 1, "これより傾いていたら読まない 度"],
  ["readMaxLift", "読む高さ", 0.1, 2, 0.05, "盤面からこれ以上浮いていたら読まない cm"],
];

// 駒の仕上げ。**使う人に出すのは三択（彫・彫埋・盛上）だけ**で、こちらは開発用。
// 見え方は机上で決まらないので、触って決める（吸着の閾値と同じ扱い）。
const reliefDefs = [
  ["reliefHeight", "盛りの強さ", 0, 3, 0.05, "盛り上がりの強さ。0 で平ら（彫埋と同じ）"],
  ["reliefBlur", "漆の丸み", 0, 0.15, 0.005, "漆の断面の丸み。駒の長手に対する比。0 に近いほど角が立つ"],
  ["reliefGloss", "漆の艶", 0.02, 0.6, 0.01, "字の粗さ。小さいほど艶やか。木地は 0.42"],
];

function buildSliders(containerId, list) {
  const panel = document.getElementById(containerId);
  for (const [key, label, min, max, step, help] of list) {
    const row = document.createElement("label");
    row.className = "p";
    row.title = help;
    row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${P[key]}"><b>${P[key]}</b>`;
    const input = row.querySelector("input");
    const out = row.querySelector("b");
    input.addEventListener("input", () => {
      P[key] = parseFloat(input.value);
      out.textContent = input.value;
      if (key === "volume") setMasterVolume(P.volume);
      if (key.startsWith("relief")) applyReliefParams();
      saveSettings();
    });
    panel.appendChild(row);
  }
}
buildSliders("params-volume", volumeDefs);

// --- 効果音の差し替え ---------------------------------------------------
//
// 実物の盤を持っている人が、自分の駒音で遊べるようにする。
//
// - **置き場所は IndexedDB。** localStorage（5MB）に wav は入らないし、設定の
//   `STORE_KEY` に混ぜると音が読めないだけで設定ごと壊れかねない
// - **`sound.js` の `FILES` は触らない。** 同梱の音は公開用と個人用で本数が違うので、
//   そこを書き換えると版どうしの差が広がる（差し替えは別に持って上書きするだけ）
// - **1 種類に何本でも入れられる。** 鳴るたびにその中から選ばれるので、
//   同じ音の繰り返しに聞こえない（同梱の駒音と同じ考え方）
// - **「最初の状態に戻す」では消さない。** あれは設定を捨てるボタンで、
//   差し替えた音は設定ではなく素材

const SOUND_KINDS = [
  ["clack", "駒を指す音"],
  ["slide", "すべらせる音"],
  ["place", "駒台に置く音"],
  ["spill", "ぶちまける音"],
];
const SOUND_DB = "shogi-sounds";
const SOUND_STORE = "files";
const SOUND_MAX = 4 * 1024 * 1024; // 1 本の上限。効果音にこれ以上は要らない

/** **読めなければ黙って諦める。** 音が入れられないせいで盤が出ないほうが困る。 */
function soundDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("indexedDB がありません")); return; }
    const req = indexedDB.open(SOUND_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(SOUND_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function soundTx(mode, run) {
  return soundDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SOUND_STORE, mode);
    const req = run(tx.objectStore(SOUND_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

const dbGetSound = (kind) => soundTx("readonly", (s) => s.get(kind));
const dbPutSound = (kind, list) => soundTx("readwrite", (s) => s.put(list, kind));
const dbDelSound = (kind) => soundTx("readwrite", (s) => s.delete(kind));

const soundsPanel = document.getElementById("sounds");

function renderSoundRows() {
  if (!soundsPanel) return;
  soundsPanel.replaceChildren();
  for (const [kind, label] of SOUND_KINDS) {
    const row = document.createElement("div");
    row.className = "sndrow";
    const name = document.createElement("span");
    name.className = "lb";
    name.textContent = label;
    const state = document.createElement("span");
    state.className = "st";
    state.textContent = isCustomSound(kind) ? "差し替え済み" : "同梱の音";
    const pick = document.createElement("button");
    pick.textContent = "選ぶ";
    const reset = document.createElement("button");
    reset.textContent = "戻す";
    reset.disabled = !isCustomSound(kind);

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.multiple = true; // 何本入れてもよい（鳴るたびに選ばれる）
    input.hidden = true;
    pick.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = [...input.files];
      input.value = ""; // 同じファイルをもう一度選べるように
      if (!files.length) return;
      const big = files.find((f) => f.size > SOUND_MAX);
      if (big) { toast(`${big.name} が大きすぎます（1 本 4MB まで）`); return; }
      initAudio(); // 音を鳴らす前でも復号できるように起こしておく
      const list = await Promise.all(files.map((f) => f.arrayBuffer()));
      // **復号できるか先に確かめる**（`setSound` は駄目なら元の音へ戻す）
      const ok = await setSound(kind, list);
      if (!ok) { toast("その音は読めませんでした（wav・mp3・ogg などを選んでください）"); return; }
      await dbPutSound(kind, list).catch(() => {}); // 残せなくても今回は鳴る
      renderSoundRows();
      toast(`${label}を差し替えました（${files.length} 本）`);
    });

    row.append(name, state, pick, reset, input);
    reset.addEventListener("click", async () => {
      await setSound(kind, null);
      await dbDelSound(kind).catch(() => {});
      renderSoundRows();
      toast(`${label}を同梱の音に戻しました`);
    });
    soundsPanel.append(row);
  }
}

/** 前に差し替えた音があれば読み直す。**駄目なら黙って同梱の音のまま。** */
async function restoreSounds() {
  for (const [kind] of SOUND_KINDS) {
    try {
      const list = await dbGetSound(kind);
      if (list && list.length) await setSound(kind, list);
    } catch { /* 読めなければ同梱の音のまま */ }
  }
  renderSoundRows();
}

renderSoundRows();
restoreSounds();
buildSliders("params", defs);
buildSliders("params-hold", holdDefs);
buildSliders("params-read", readDefs);
buildSliders("params-relief", reliefDefs);


// 調整中に外から数値をいじれるようにしておく（プロトタイプ用）
window.__proto = {
  P, grab, pieces, cam, applyCamera, resetHirate, tidyAll, readBoard, setMode,
  // 音や吸着の判定を画面操作なしで確かめるための入口
  beginGrab, endGrab, placeAt, surfaceY, overPiece, squareToWorld,
  lastMoveMark, getLastMove: () => lastMove, refreshBoardState, collisionSound, STANDS, soundLog,
  world, settleLog,
  // 駒台の寄り添い判定
  standPlacement, attachPose, piecesOnStand, insideStand, shoulderOf, footOf,
  // 駒の輪郭と押し出し（壁・駒どうしのめり込みを解く）
  pieceOutline, outlineSeparation, pushOutOfPieces, fitInside,
  // 盤面をまるごと控える／戻す（栞と「元に戻す」が共有する土台）
  capturePoses, applyPoses, setupPosition, putIntoBox,
  // 手合い割
  setupHandicap, HANDICAPS,
  // 振り駒
  furigomaStart, furigomaSource, furigomaFinish, getFurigoma: () => furigoma, toast,
  // 局面の受け渡し（SFEN）
  loadSfen, dumpSfen, fromSfen, toSfen, flushSettles, sendToStand,
  shareUrl, applyUrlPosition,
  // 盤面の画像
  renderToCanvas, saveImage, snapshot,
  // 効果音の差し替え
  setSound, isCustomSound, dbGetSound, dbPutSound, dbDelSound, restoreSounds, SOUND_KINDS,
  initAudio, renderSoundRows,
  // 元に戻す
  undo, pushUndo, posesEqual, undoStack,
  // 局面の栞
  bookmarks, addBookmark, restoreBookmark, showBookmarks,
  // 駒台・駒箱で重ねたときの段
  stackSurfaceY, restackAt,
  // 駒箱
  KOMABAKO, nearestBox, insideBox, showBox, spillBox, boxAll,
  // 駒台の塊（まとめて動かす）
  chainsOnStand, chainHandle, chainGrab, handles, chainMarks, refreshHandles, showChainMarks,
  beginChainGrab, moveChainTo, endChainGrab, chainJoin, fitIntoStand,
  alignedPoses, chainWith, anchorFor,
  // 駒の状態。右クリックは循環、ボタンは成／不成と向き変更に分かれている
  cyclePiece, promotePiece, turnPiece, pieceFlipped, pieceYaw, canPromote,
  selectPiece, clearSelection, placePieceButtons, screenBox, getSelected: () => selected,
  // 駒の仕上げ（彫・彫埋・盛上）。sign だけ変えれば描き直さずに三段を行き来できる
  setRelief, applyFinish, applyReliefParams,
  // 画面まわり
  camera, renderer, yawOf, fitDistance, ensureFit, showSettings, pinch, touches,
  preset, applyPreset, // 視点のプリセット（真上/斜め × 近/中/遠）
  // 最善手の矢印（エンジンを通さずに向きを確かめられるように）
  redrawArrow, hideArrow, clearArrow, arrow: () => arrowMesh,
  getAnalysis: () => lastAnalysis,
  showBestMove: (move, side = 0) => { lastAnalysis = { move, side }; redrawArrow(); },
};

resetHirate();
// 起動そのものは「戻せる操作」ではない。並べた拍子に積まれた 1 段を捨てる
// （残すと最初から「戻す」が押せる形になり、押しても何も起きない）。
undoStack.length = 0;
refreshUndo();
// `?sfen=…` 付きで開かれたら、その局面から始める（読めなければ平手のまま）
applyUrlPosition();
resize();
// 覚えている視点があればそこから始める。無ければ盤と駒台が入る距離。
//
// **覚えた視点に `ensureFit()` はかけない。** 寄せて見ていた状態も覚えているので、
// 起動のたびに引き戻すと「使う人が寄せた状態を勝手に戻さない」という約束を破る。
// 画面の形が変わったときは、そのあとのリサイズで `ensureFit()` が効く。
const sc = stored.cam;
if (sc && ["r", "theta", "phi"].every((k) => typeof sc[k] === "number" && isFinite(sc[k]))) {
  cam.r = sc.r; cam.theta = sc.theta; cam.phi = sc.phi;
} else {
  cam.r = fitDistance();
}
applyCamera();
requestAnimationFrame(tick);
