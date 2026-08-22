"""開発用サーバー。http.server にキャッシュ無効ヘッダと COOP/COEP を足すだけ。

素の `python -m http.server` だとブラウザが main.js をキャッシュし、
ファイルを直してもリロードで古いコードが動き続ける（更新したのに変化しない、
という形で出る）。原因が分かりにくいのでサーバー側で止める。

COOP/COEP は USI エンジン（YaneuraOu.wasm）が要求する SharedArrayBuffer のため。
これが無いと `crossOriginIsolated` が false になり、エンジンを起動できない。
**GitHub Pages ではこのヘッダを出せない**ので、公開時は coi-serviceworker で
後付けする（初回に自動リロードが一度入る）。ここで出しておけば、
ローカルでは公開先と同じ条件（crossOriginIsolated === true）で試せる。

`--no-coop-coep` を付けるとヘッダを出さない。**coi-serviceworker が本当に効くかは
これでしか確かめられない**（ヘッダが出ていると素通りするので、普段の起動では
登録すらされない）。localhost は secure context 扱いなので Service Worker は動く。
公開先と同じ条件になり、初回に一度だけ自動リロードが入って
`crossOriginIsolated` が true になれば成功。

    python serve.py [ポート] [公開ディレクトリ] [--no-coop-coep]
"""

import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    coop_coep = True  # False にすると GitHub Pages と同じ「ヘッダなし」になる

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        # SharedArrayBuffer を使える状態にする（エンジンの必須要件）
        if self.coop_coep:
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        super().end_headers()


if __name__ == "__main__":
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 5180
    root = args[1] if len(args) > 1 else "web-proto"
    NoCacheHandler.coop_coep = "--no-coop-coep" not in flags
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f"http://localhost:{port}/  ({root})"
          + ("" if NoCacheHandler.coop_coep else "  COOP/COEP なし（coi-serviceworker の確認用）"))
    ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
