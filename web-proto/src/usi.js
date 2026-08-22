/**
 * USI エンジン（YaneuraOu.wasm）との受け渡し。
 *
 * **押したときの局面だけを解析する。** 駒を持ち上げただけで局面が変わったと読まれるので、
 * リアルタイムには走らせない（「何をもって指したか」が決められないため）。
 *
 * エンジンは `vendor/engine/` に置く（GPLv3）。**公開する版には同梱しない**ので、
 * 無ければ置き方を案内して終わる（下の `ENGINE_DIR` を読む）。盤のほうは普通に動く。
 * 評価関数は wasm に内蔵（SuishoPetite 2021-11）なので、別ファイルの取得は要らない。
 *
 * **SharedArrayBuffer が要る。** サーバーが COOP/COEP を返していないと起動できない。
 * ローカルは serve.py が返す。GitHub Pages はヘッダを設定できないので
 * coi-serviceworker で後付けする（初回に自動リロードが一度入る）。
 */

import { KINDS } from "./piece.js";

// kindId → SFEN の1文字。玉と王はどちらも K。
const SFEN_CHAR = {
  FU: "P", KY: "L", KE: "N", GI: "S", KI: "G", KA: "B", HI: "R", OU: "K", GY: "K",
};
// 逆引き。K は玉に寄せる（読み筋に出すだけなので王と区別しなくてよい）。
const KIND_OF = { P: "FU", L: "KY", N: "KE", S: "GI", G: "KI", B: "KA", R: "HI", K: "GY" };
const KAN = "一二三四五六七八九";
// 持ち駒を並べる順。強い駒から（USI の慣例）。
const HAND_ORDER = ["HI", "KA", "KI", "GI", "KE", "KY", "FU"];

/**
 * `readBoard()` の結果から SFEN を作る。
 *
 * **手番は盤面からは決まらない**ので引数で受ける（パネルのボタンで選ぶ）。
 * 手数は解析に効かないので 1 で固定。
 *
 * 持ち駒は**駒台の持ち主**で決まる（駒の向きではない）。向きを揃えない設定でも、
 * 相手の駒台に置いた駒はその人の持ち駒として読む。
 * **持ち駒に成りは無い**ので `promoted` は捨てる。
 */
export function toSfen({ board, hands }, turn) {
  const rows = [];
  for (let rank = 1; rank <= 9; rank++) {
    let row = "";
    let empty = 0;
    for (let file = 9; file >= 1; file--) {
      const e = board.get(`${file},${rank}`);
      if (!e) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const c = SFEN_CHAR[e.kindId];
      row += (e.promoted ? "+" : "") + (e.owner === 1 ? c.toLowerCase() : c);
    }
    if (empty) row += empty;
    rows.push(row);
  }

  let hand = "";
  for (const owner of [0, 1]) {
    const count = new Map();
    for (const e of hands[owner]) count.set(e.kindId, (count.get(e.kindId) || 0) + 1);
    for (const k of HAND_ORDER) {
      const n = count.get(k);
      if (!n) continue;
      const c = SFEN_CHAR[k];
      hand += (n > 1 ? n : "") + (owner === 1 ? c.toLowerCase() : c);
    }
  }

  return `${rows.join("/")} ${turn === 1 ? "w" : "b"} ${hand || "-"} 1`;
}

/**
 * 解析にかけられる局面か。**駄目な理由を返すだけで、直したりはしない。**
 * 読めない駒があるときは呼び出し側で確認を取る。
 */
export function checkPosition({ board, hands, loose }) {
  const problems = [];
  const kings = [0, 0];
  for (const e of board.values()) if (e.kindId === "OU" || e.kindId === "GY") kings[e.owner]++;
  if (kings[0] !== 1) problems.push(`先手の玉が${kings[0] === 0 ? "ありません" : `${kings[0]}枚あります`}`);
  if (kings[1] !== 1) problems.push(`後手の玉が${kings[1] === 0 ? "ありません" : `${kings[1]}枚あります`}`);

  // 二歩。エンジンに渡すと不正局面として扱われる。
  for (const owner of [0, 1]) {
    const files = new Map();
    for (const e of board.values()) {
      if (e.kindId !== "FU" || e.promoted || e.owner !== owner) continue;
      files.set(e.file, (files.get(e.file) || 0) + 1);
    }
    const dup = [...files].filter(([, n]) => n > 1).map(([f]) => f);
    if (dup.length) problems.push(`${owner === 0 ? "先手" : "後手"}の二歩（${dup.join("・")}筋）`);
  }

  // **行き場のない駒。** 一番奥の段に成らずに置かれた歩・香、奥から2段の桂。
  // 反則なのでエンジンは不正局面として扱う。
  // 先手は段が小さいほど奥、後手は逆。
  for (const e of board.values()) {
    if (e.promoted) continue;
    const depth = e.owner === 0 ? e.rank : 10 - e.rank; // 1 が一番奥
    const who = e.owner === 0 ? "先手" : "後手";
    const where = `${e.file}${"一二三四五六七八九"[e.rank - 1]}`;
    if ((e.kindId === "FU" || e.kindId === "KY") && depth === 1) {
      problems.push(`${who}の${e.kindId === "FU" ? "歩" : "香"}が${where}にあります（行き場がありません）`);
    }
    if (e.kindId === "KE" && depth <= 2) {
      problems.push(`${who}の桂が${where}にあります（行き場がありません）`);
    }
  }

  return { problems, loose: loose.length, hands: hands[0].length + hands[1].length };
}

/** USI の指し手（"7g7f" / "P*5e" / "8h2b+"）を、盤の升と打つ駒に分ける。 */
export function parseMove(move) {
  if (!move || move === "resign" || move === "win") return null;
  const promote = move.endsWith("+");
  const body = promote ? move.slice(0, -1) : move;
  const to = { file: +body[2], rank: body.charCodeAt(3) - 96 }; // a=1
  // 打つ手は駒台のどの駒から引くかを決めたいので、kindId まで出しておく。
  if (body[1] === "*") return { drop: body[0], dropKind: KIND_OF[body[0].toUpperCase()], to, promote };
  return { from: { file: +body[0], rank: body.charCodeAt(1) - 96 }, to, promote };
}

/** SFEN の盤面を 9×9 の配列にする。`grid[rank-1][file-1]`。 */
function parseSfenBoard(sfen) {
  const grid = Array.from({ length: 9 }, () => Array(9).fill(null));
  const rows = sfen.split(/\s+/)[0].split("/");
  for (let r = 0; r < 9 && r < rows.length; r++) {
    let file = 9;
    let promoted = false;
    for (const ch of rows[r]) {
      if (ch === "+") { promoted = true; continue; }
      if (ch >= "1" && ch <= "9") { file -= +ch; continue; }
      const kindId = KIND_OF[ch.toUpperCase()];
      if (kindId && file >= 1) {
        grid[r][file - 1] = { kindId, owner: ch === ch.toLowerCase() ? 1 : 0, promoted };
      }
      promoted = false;
      file--;
    }
  }
  return grid;
}

/** 一字の駒名。成っていれば裏の字（と・龍・馬など）。 */
function pieceName(kindId, promoted) {
  const k = KINDS[kindId];
  if (!k) return "?";
  return promoted && k.back ? k.back : k.one;
}

/**
 * 読み筋を将棋の書き方にする。**升だけでは読めない**ので、
 * 局面を1手ずつ進めて駒の種類を出す。エンジンは升しか返さないため、
 * こちら側で盤面を持って追いかけるしかない。
 *
 * 追えなくなったら（読み筋が途中で壊れているなど）そこで打ち切る。**推測はしない。**
 */
export function pvText(sfen, moves, limit = 12) {
  if (!sfen) return moves.slice(0, limit);
  const grid = parseSfenBoard(sfen);
  let side = sfen.split(/\s+/)[1] === "w" ? 1 : 0;
  const out = [];
  let prev = null;
  for (const mv of moves.slice(0, limit)) {
    const m = parseMove(mv);
    if (!m) break;
    const mark = side === 0 ? "☗" : "☖";
    const same = prev && prev.file === m.to.file && prev.rank === m.to.rank;
    const to = same ? "同" : `${m.to.file}${KAN[m.to.rank - 1]}`;
    if (m.drop) {
      const kindId = KIND_OF[m.drop.toUpperCase()];
      out.push(`${mark}${to}${pieceName(kindId, false)}打`);
      grid[m.to.rank - 1][m.to.file - 1] = { kindId, owner: side, promoted: false };
    } else {
      const src = grid[m.from.rank - 1]?.[m.from.file - 1];
      if (!src) break; // 追えなくなった
      out.push(`${mark}${to}${pieceName(src.kindId, src.promoted)}${m.promote ? "成" : ""}`);
      grid[m.from.rank - 1][m.from.file - 1] = null;
      grid[m.to.rank - 1][m.to.file - 1] =
        { kindId: src.kindId, owner: side, promoted: src.promoted || m.promote };
    }
    prev = m.to;
    side = 1 - side;
  }
  return out;
}

/**
 * 評価値の読み方。手番から見た値なので、先手から見た値に直す。
 *
 * **符号で表す（＋が先手、−が後手）。** 駒のマーク（☗☖）では先後が読み取りづらい。
 * 数字の前に付くのは符号のほうが自然でもある。
 */
export function scoreText(score, turn) {
  if (!score) return "—";
  if (score.mate !== undefined) {
    // mate 0 は「手番側が詰んでいる」。符号だけでは表せないのでここだけ別に見る。
    if (score.mate === 0) return turn === 1 ? "＋詰" : "−詰";
    const n = turn === 1 ? -score.mate : score.mate;
    // 他の GUI と同じ「詰 5手」。必至も区別しない。
    return `${n > 0 ? "＋" : "−"}詰 ${Math.abs(n)}手`;
  }
  const cp = turn === 1 ? -score.cp : score.cp;
  return (cp > 0 ? "＋" : cp < 0 ? "−" : "±") + Math.abs(cp);
}

// --- エンジン -----------------------------------------------------------

// エンジンの置き場所。**公開する版には同梱しない**（2026-08-20）。
// YaneuraOu.wasm は GPLv3 で、同梱すると配布物全体に GPL の条件が及ぶ。ところが駒字の
// 画像は CC 表示 - 非営利で、**GPLv3 が禁じる「追加の制限」にあたる**ので両立しない。
// エンジンを外せば GPL の義務そのものが無くなる。
// 使いたい人は自分でここへ置く。開発用のリポジトリには置いたままにしてある。
const ENGINE_DIR = "./vendor/engine/";
const MISSING = [
  "USI エンジンが入っていません。",
  "解析を使うには、下の 3 つのファイルを web-proto/vendor/engine/ に置いてください。",
  "　yaneuraou.k-p.js / yaneuraou.k-p.wasm / yaneuraou.k-p.worker.js",
  "入手先： https://github.com/mizar/YaneuraOu.wasm",
  "（npm の @mizarjp/yaneuraou.k-p 7.6.3-alpha.0。GPLv3）",
].join("\n");

let booting = null;
let loaded = false;

/**
 * エンジンの wasm がもう手元にあるか。**初回だけ 1.5MB を落とすので待たせる**ことになり、
 * 黙って止まっていると壊れたように見える。呼び出し側が読み込み中だと
 * 伝えるために使う。
 */
export function engineLoaded() { return loaded; }

/**
 * エンジンを起動する。2回目以降は同じものを使い回す。
 * **UMD なので import できない。** script タグで読み込んでグローバルを拾う。
 */
export function loadEngine() {
  if (booting) return booting;
  booting = (async () => {
    if (!self.crossOriginIsolated) {
      throw new Error("SharedArrayBuffer が使えません（COOP/COEP が出ていない）");
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ENGINE_DIR + "yaneuraou.k-p.js";
      s.onload = resolve;
      // **無いことは異常ではない**（公開版には同梱しない。上の ENGINE_DIR を読む）。
      // 置き方が分からないと詰むので、案内をそのまま札に出す。
      s.onerror = () => reject(new Error(MISSING));
      document.head.append(s);
    });
    const mod = await self.YaneuraOu_K_P();
    loaded = true;
    return new Engine(mod);
  })();
  booting.catch(() => { booting = null; }); // 失敗したら次でやり直せるように
  return booting;
}

class Engine {
  constructor(mod) {
    this.mod = mod;
    this.listeners = new Set();
    this.busy = false;
    mod.addMessageListener((line) => {
      for (const fn of [...this.listeners]) fn(line);
    });
  }

  send(command) { this.mod.postMessage(command); }

  /** ある行が来るまで待つ。 */
  until(test) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (!test(line)) return;
        this.listeners.delete(fn);
        resolve(line);
      };
      this.listeners.add(fn);
    });
  }

  async ready() {
    if (this.inited) return;
    this.send("usi");
    await this.until((l) => l === "usiok");
    // 1手ごとに待たされると解析にならないので、待ち時間の下限を外す
    this.send("setoption name MinimumThinkingTime value 1000");
    this.send("setoption name NetworkDelay value 0");
    this.send("setoption name NetworkDelay2 value 0");
    this.send("isready");
    await this.until((l) => l === "readyok");
    this.inited = true;
  }

  /**
   * 局面をひとつ解析する。`onInfo` には読みの途中経過が渡る。
   * **`go` の最中に次を投げない**（エンジンは1つずつしか受けない）。
   */
  async analyse(sfen, { depth = 14, onInfo } = {}) {
    await this.ready();
    this.busy = true;
    let best = null;
    const info = { score: null, pv: [], depth: 0, nodes: 0 };
    const watch = (line) => {
      if (line.startsWith("info ") && line.includes(" pv ")) {
        const m = line.match(/ depth (\d+)/);
        const n = line.match(/ nodes (\d+)/);
        const cp = line.match(/ score cp (-?\d+)/);
        const mate = line.match(/ score mate ([+-]?\d+)/);
        if (m) info.depth = +m[1];
        if (n) info.nodes = +n[1];
        if (cp) info.score = { cp: +cp[1] };
        if (mate) info.score = { mate: +mate[1] };
        info.pv = line.slice(line.indexOf(" pv ") + 4).trim().split(/\s+/);
        onInfo?.({ ...info, pv: [...info.pv] });
      }
    };
    this.listeners.add(watch);
    this.send("usinewgame");
    this.send(`position sfen ${sfen}`);
    this.send(`go depth ${depth}`);
    best = await this.until((l) => l.startsWith("bestmove"));
    this.listeners.delete(watch);
    this.busy = false;
    return { ...info, bestmove: best.split(/\s+/)[1] };
  }

  /** 読みを打ち切る。bestmove は返ってくるので analyse 側で受け取れる。 */
  stop() { if (this.busy) this.send("stop"); }
}
