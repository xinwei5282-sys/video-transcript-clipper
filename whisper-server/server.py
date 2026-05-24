#!/usr/bin/env python3
"""本地 Whisper 转写服务 - 零依赖,Python 标准库实现

接口:
  GET  /health      健康检查
  POST /transcribe  上传音频(原始二进制 body),返回 {text: "..."}
                    可选 query: ?lang=zh (默认 zh)
"""

import http.server
import json
import os
import socketserver
import subprocess
import tempfile
from urllib.parse import urlparse, parse_qs

def pick_model():
    """优先用 large-v3(更准),fallback 到 turbo(更快)"""
    candidates = [
        "~/whisper-models/ggml-large-v3.bin",
        "~/whisper-models/ggml-large-v3-q5_0.bin",
        "~/whisper-models/ggml-large-v3-turbo.bin",
    ]
    for c in candidates:
        path = os.path.expanduser(c)
        if os.path.exists(path):
            return path
    return os.path.expanduser(candidates[-1])

MODEL_PATH = pick_model()
HOST = "127.0.0.1"
PORT = 8765


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename, X-Language")
        self.send_header("Access-Control-Max-Age", "3600")

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {
                "ok": True,
                "model": MODEL_PATH,
                "model_exists": os.path.exists(MODEL_PATH),
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path != "/transcribe":
            self._json(404, {"error": "not found"})
            return

        try:
            qs = parse_qs(urlparse(self.path).query)
            lang = qs.get("lang", ["zh"])[0]
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self._json(400, {"error": "empty body"})
                return

            data = self.rfile.read(length)

            with tempfile.TemporaryDirectory() as tmpdir:
                src = os.path.join(tmpdir, "input.bin")
                with open(src, "wb") as f:
                    f.write(data)

                # 转码为 whisper 要求的格式: 16kHz mono PCM WAV
                wav = os.path.join(tmpdir, "input.wav")
                conv = subprocess.run(
                    ["ffmpeg", "-y", "-i", src,
                     "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
                    capture_output=True, text=True
                )
                if conv.returncode != 0:
                    err_tail = conv.stderr[-1000:]
                    print(f"[ffmpeg failed] size={length}, returncode={conv.returncode}", flush=True)
                    print(f"[ffmpeg stderr]\n{err_tail}", flush=True)
                    self._json(500, {
                        "error": f"ffmpeg failed (returncode={conv.returncode}): {err_tail}",
                    })
                    return

                # 调 whisper-cli 转写
                # -tp 0           temperature 0,deterministic
                # -tpi 0          关掉 fallback temperature 递增(避免"幻觉文字")
                # -bs 5 -bo 5     beam search + best-of(默认值,显式声明)
                # --prompt        给个上下文提示,提高中文识别质量
                out_prefix = os.path.join(tmpdir, "out")
                cmd = [
                    "whisper-cli", "-m", MODEL_PATH, "-l", lang,
                    "-tp", "0", "-tpi", "0",
                    "-bs", "5", "-bo", "5",
                    # 防漏识别(不跳任何段):
                    "-nth", "1.0",      # no_speech_thold 拉到 1.0
                    "-lpt", "-10.0",    # logprob_thold 极松
                    "-et", "10.0",      # entropy_thold 极松
                    # 段间保留 context(用来推断标点),但限制传染范围
                    "-mc", "64",        # max_context 64 token,既有上下文又不太长
                    "-nt", "-otxt", "-of", out_prefix, wav,
                ]
                if lang == "zh":
                    cmd += ["--prompt", "以下是普通话口播视频的内容，请完整准确转写每一句话，不要遗漏。"]
                ws = subprocess.run(cmd, capture_output=True, text=True)
                txt_file = out_prefix + ".txt"
                if not os.path.exists(txt_file):
                    self._json(500, {
                        "error": "whisper failed",
                        "stderr": ws.stderr[-1000:],
                    })
                    return

                with open(txt_file, "r", encoding="utf-8") as f:
                    text = f.read().strip()

                self._json(200, {"text": text, "lang": lang, "bytes": length})

        except Exception as e:
            self._json(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}", flush=True)


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if not os.path.exists(MODEL_PATH):
        print(f"⚠️  模型文件不存在: {MODEL_PATH}")
        print("先下载: curl -L -o ~/whisper-models/ggml-large-v3-turbo.bin https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin")
    else:
        size_mb = os.path.getsize(MODEL_PATH) / 1024 / 1024
        print(f"✓ 模型: {MODEL_PATH} ({size_mb:.0f} MB)")

    print(f"✓ 监听: http://{HOST}:{PORT}")
    print(f"  - GET  /health      健康检查")
    print(f"  - POST /transcribe  音频转写")
    print(f"按 Ctrl+C 退出")

    with ThreadingServer((HOST, PORT), Handler) as srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n退出")
