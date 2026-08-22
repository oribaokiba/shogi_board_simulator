# 3D将棋盤シミュレーター

実際の将棋盤で駒を並べている**物理的な感覚**を再現する体験ソフトです。

将棋GUI でも棋譜学習ツールでもありません。駒はモノとして存在し、掴んで運べて、倒すことも
積むこともできる 3D 物理サンドボックスです。**物理が主役、ルールや棋譜は従**。

## 動かす

ビルドは要りません。静的ファイルを配信するだけです。

```bash
python serve.py 5180 web-proto
```

素の `python -m http.server` は使わないでください。ブラウザが JavaScript をキャッシュして、
**直したのに変わらない**状態にはまります。`serve.py` はキャッシュ無効ヘッダと COOP/COEP を
足すだけのものです。

## できること

- 40 枚の駒を掴んで運んで置く。持ち上げとスライドで音が変わり、駒台では扇形に寄り添う
- 駒台の並びをまとめて動かす、重ねて段を上げる、整列する
- 盤面の読み取り、最終手ハイライト、符号の表示
- **局面の栞** — 気になった局面を挟んで、あとで戻る
- **駒箱** — 駒をぶちまける／片付ける。駒落ちで外した駒の置き場所にも
- 書体 5 種（錦旗・水無瀬・巻菱湖・源兵衛清安・一字）と、駒の仕上げ 3 種（彫・彫埋・盛上）
- 視点のプリセット、駒台の配置 3 種（左上・右下／右上・右下／真上）、設定の保存
- USI エンジンによる解析（エンジンは別途用意します。下記）

操作は画面上部の ☗（駒を動かす）／🎥（視点を動かす）で切り替えます。**排他**で、
指が 1 本しかない環境でも誤爆しません。

## USI エンジンを使う（任意）

**ライセンスの都合で同梱していません。** YaneuraOu.wasm は GPLv3 で、同梱すると
駒字画像の非営利条項（GPLv3 が禁じる「追加の制限」）と両立しなくなるためです。

使いたい場合は、下の 3 つを `web-proto/vendor/engine/` に置いてください。

```
yaneuraou.k-p.js
yaneuraou.k-p.wasm
yaneuraou.k-p.worker.js
```

入手先： https://github.com/mizar/YaneuraOu.wasm
（npm の `@mizarjp/yaneuraou.k-p`。GPLv3。評価関数は wasm に内蔵）

置かなくても盤は普通に動きます。解析ボタンを押すと置き方の案内が出るだけです。
なお `SharedArrayBuffer` が要るので、COOP/COEP が出ている必要があります
（`serve.py` は返します。GitHub Pages では同梱の `coi-serviceworker.js` が後付けします）。

## ライセンス

コードと文書は **MIT** です。同梱の素材はそれぞれ次のとおりです。

| | ライセンス | 出どころ |
|---|---|---|
| 駒字の画像 `web-proto/img/` | **CC BY-NC 2.1 JP（非営利限定）** | [しんえれ外部駒](http://shineleckoma.web.fc2.com/) を改変 |
| `audio/spill1.wav` `spill2.wav` | CC BY 3.0 | [ノタの森](http://notanomori.net/) 音No.1726 / 音No.1724 |
| `audio/place.wav` | MIT | このソフトのために録音 |
| `audio/clack1.wav` `clack2.wav` `slide.wav` | このソフトの一部としてのみ再配布可 | 著作権フリー素材（YouTube・Pixabay）を加工・合成 |
| `web-proto/vendor/` のライブラリ | MIT | three.js / cannon-es / coi-serviceworker |

**駒字の画像だけが非営利限定**なので、この配布物を**そのまま**利用・再配布する場合は
非営利に限られます。画像を取り除けば、残りは商用でも扱えます。

`clack1` `clack2` `slide` は商用でも使えますが、**wav ファイルだけを取り出して配り直す
ことはできません**（元素材の配布条件が素材単独の再配布を禁じているため）。
詳しくは [LICENSE](LICENSE) を読んでください。

クレジットと改変内容は [web-proto/img/CREDITS.txt](web-proto/img/CREDITS.txt) と
[web-proto/audio/CREDITS.txt](web-proto/audio/CREDITS.txt) にあります。

## 依存

three.js と cannon-es を `web-proto/vendor/` に置いて、importmap から参照しています。
**`npm install` は要りません**（`package.json` はコピー元のバージョンを記録してあるだけです）。
