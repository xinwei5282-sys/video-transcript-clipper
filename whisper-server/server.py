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
import threading
import time
import uuid
from urllib.parse import urlparse, parse_qs

def _find_first_existing(candidates):
    for c in candidates:
        path = os.path.expanduser(c)
        if os.path.exists(path):
            return path
    return None

# 准确度优先(短视频),M2 上 1 分钟音频约 1 分钟
MODEL_PATH_ACCURATE = _find_first_existing([
    "~/whisper-models/ggml-large-v3.bin",
    "~/whisper-models/ggml-large-v3-q5_0.bin",
    "~/whisper-models/ggml-large-v3-turbo.bin",
])

# 速度优先(长视频),M2 上 1 分钟音频约 10-20 秒
MODEL_PATH_FAST = _find_first_existing([
    "~/whisper-models/ggml-large-v3-turbo.bin",
    "~/whisper-models/ggml-large-v3-q5_0.bin",
    "~/whisper-models/ggml-large-v3.bin",
])

MODEL_PATH = MODEL_PATH_ACCURATE  # 默认,health endpoint 显示用

def pick_model_for_duration(duration_sec):
    """长视频自动切到 fast 模型,短视频用 accurate"""
    if duration_sec > LONG_THRESHOLD_SEC and MODEL_PATH_FAST != MODEL_PATH_ACCURATE:
        return MODEL_PATH_FAST
    return MODEL_PATH_ACCURATE
HOST = "127.0.0.1"
PORT = 8765

# 长视频切分参数
LONG_THRESHOLD_SEC = 300   # 超过 5 分钟才切
SEGMENT_SEC = 300          # 每段 5 分钟
OVERLAP_SEC = 5            # 段间 5 秒重叠(避免边界丢字,接受少量重复)

# 飞书 clip 任务队列(内存,简单够用)
CLIP_TASKS = {}            # task_id -> {url, status, markdown, error, created_at, updated_at}
CLIP_LOCK = threading.Lock()
CLIP_TASK_TTL_SEC = 3600   # 任务保留 1 小时后清理


def get_audio_duration(wav_path):
    """ffprobe 获取音频时长(秒)"""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", wav_path],
        capture_output=True, text=True
    )
    try:
        return float(r.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def split_wav(wav_path, tmpdir):
    """长音频切多段,短音频返回原路径。返回 chunk 路径列表"""
    duration = get_audio_duration(wav_path)
    if duration <= LONG_THRESHOLD_SEC:
        return [wav_path], duration

    chunks = []
    start = 0.0
    idx = 0
    while start < duration:
        chunk = os.path.join(tmpdir, f"chunk_{idx:03d}.wav")
        chunk_dur = min(SEGMENT_SEC, duration - start)
        # 注意:-ss 必须在 -i 前面才能用关键帧 seek(快很多)
        r = subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{start:.2f}", "-t", f"{chunk_dur:.2f}",
             "-i", wav_path, "-c", "copy", chunk],
            capture_output=True, text=True
        )
        if r.returncode != 0:
            raise RuntimeError(f"ffmpeg split chunk {idx} failed: {r.stderr[-300:]}")
        chunks.append(chunk)
        if start + SEGMENT_SEC >= duration:
            break
        start += (SEGMENT_SEC - OVERLAP_SEC)
        idx += 1
    return chunks, duration


def dedupe_text(text):
    """干掉 whisper 幻觉循环:连续相同的行/句子超过 2 次时只保留 1 次"""
    if not text:
        return text
    # 1) 按行去重(行间是 \n)
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        # 同一行连续出现 >=2 次,只留 1 个
        if cleaned_lines and cleaned_lines[-1].strip() == line.strip():
            continue
        cleaned_lines.append(line)
    # 2) 按句号/逗号切短句,连续相同的短句去重
    out_lines = []
    for line in cleaned_lines:
        if not line.strip():
            out_lines.append(line)
            continue
        # 中文标点切分
        import re
        parts = re.split(r"([,。!?;])", line)
        # 重组并去重相邻的重复短句
        new_parts = []
        last_sentence = ""
        i = 0
        while i < len(parts):
            seg = parts[i]
            punct = parts[i + 1] if i + 1 < len(parts) else ""
            sentence = (seg + punct).strip()
            if sentence and sentence == last_sentence:
                i += 2
                continue
            if sentence:
                new_parts.append(seg + punct)
                last_sentence = sentence
            i += 2
        out_lines.append("".join(new_parts))
    return "\n".join(out_lines).strip()


def transcribe_one(wav_path, tmpdir, lang, tag="", model_path=None):
    """转写单个 wav 文件,返回纯文字"""
    out_prefix = os.path.join(tmpdir, f"out_{tag or 'main'}")
    cmd = [
        "whisper-cli", "-m", model_path or MODEL_PATH, "-l", lang,
        "-tp", "0", "-tpi", "0",
        "-bs", "5", "-bo", "5",
        "-nth", "1.0",
        "-lpt", "-10.0",
        "-et", "10.0",
        "-mc", "64",
        "-nt", "-otxt", "-of", out_prefix, wav_path,
    ]
    if lang == "zh":
        cmd += ["--prompt", "以下是普通话口播视频的内容，请完整准确转写每一句话，不要遗漏。"]
    ws = subprocess.run(cmd, capture_output=True, text=True)
    txt_file = out_prefix + ".txt"
    if not os.path.exists(txt_file):
        raise RuntimeError(f"whisper failed: {ws.stderr[-500:]}")
    with open(txt_file, "r", encoding="utf-8") as f:
        return f.read().strip()


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
            return

        # 扩展 polling:取最早一个 pending 任务
        if path == "/clip/poll":
            with CLIP_LOCK:
                self._cleanup_old_tasks()
                pending = [
                    (tid, task) for tid, task in CLIP_TASKS.items()
                    if task["status"] == "pending"
                ]
                pending.sort(key=lambda x: x[1]["created_at"])
                if not pending:
                    self._json(200, {"task": None})
                    return
                tid, task = pending[0]
                task["status"] = "claimed"
                task["updated_at"] = time.time()
                self._json(200, {"task": {"task_id": tid, "url": task["url"]}})
            return

        # Claude Code 查询任务状态: /clip/result/<task_id>
        if path.startswith("/clip/result/"):
            tid = path[len("/clip/result/"):]
            with CLIP_LOCK:
                task = CLIP_TASKS.get(tid)
                if not task:
                    self._json(404, {"error": "task not found"})
                    return
                self._json(200, {
                    "task_id": tid,
                    "url": task["url"],
                    "status": task["status"],
                    "markdown": task.get("markdown"),
                    "error": task.get("error"),
                    "created_at": task["created_at"],
                    "updated_at": task["updated_at"],
                })
            return

        self._json(404, {"error": "not found"})

    def _cleanup_old_tasks(self):
        """清理 1 小时前的任务"""
        cutoff = time.time() - CLIP_TASK_TTL_SEC
        to_remove = [tid for tid, t in CLIP_TASKS.items() if t["created_at"] < cutoff]
        for tid in to_remove:
            del CLIP_TASKS[tid]

    def do_POST(self):
        path = urlparse(self.path).path

        # Claude Code 投递任务: {url}
        if path == "/clip/enqueue":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                url = body.get("url", "").strip()
                if not url:
                    self._json(400, {"error": "missing url"})
                    return
                task_id = uuid.uuid4().hex[:12]
                now = time.time()
                with CLIP_LOCK:
                    CLIP_TASKS[task_id] = {
                        "url": url,
                        "status": "pending",
                        "markdown": None,
                        "error": None,
                        "created_at": now,
                        "updated_at": now,
                    }
                print(f"[clip enqueue] task_id={task_id} url={url[:80]}", flush=True)
                self._json(200, {"task_id": task_id, "status": "pending"})
            except Exception as e:
                self._json(500, {"error": str(e)})
            return

        # 扩展提交结果: {task_id, status: "done"|"error", markdown?, error?}
        if path == "/clip/result":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                tid = body.get("task_id")
                status = body.get("status", "done")
                with CLIP_LOCK:
                    task = CLIP_TASKS.get(tid)
                    if not task:
                        self._json(404, {"error": "task not found"})
                        return
                    task["status"] = status
                    task["markdown"] = body.get("markdown")
                    task["error"] = body.get("error")
                    task["updated_at"] = time.time()
                print(f"[clip result] task_id={tid} status={status}", flush=True)
                self._json(200, {"ok": True})
            except Exception as e:
                self._json(500, {"error": str(e)})
            return

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

                # 切分长音频(短的直接整段跑)
                try:
                    chunks, duration = split_wav(wav, tmpdir)
                except RuntimeError as e:
                    self._json(500, {"error": str(e)})
                    return

                segmented = len(chunks) > 1
                model_for_run = pick_model_for_duration(duration)
                model_name = os.path.basename(model_for_run)
                if segmented:
                    print(f"[long video] duration={duration:.1f}s, 切成 {len(chunks)} 段(每段 {SEGMENT_SEC}s,重叠 {OVERLAP_SEC}s),用 {model_name}", flush=True)

                # 逐段转写(顺序,避免 GPU 争用)
                texts = []
                try:
                    for i, chunk in enumerate(chunks):
                        if segmented:
                            print(f"  转写段 {i+1}/{len(chunks)}", flush=True)
                        texts.append(transcribe_one(chunk, tmpdir, lang, tag=f"{i:03d}", model_path=model_for_run))
                except RuntimeError as e:
                    self._json(500, {"error": str(e)})
                    return

                # 拼接(段间用空行分隔,便于阅读;重叠部分会有少量重复)+ 后处理去重
                text = "\n\n".join(t for t in texts if t).strip()
                text = dedupe_text(text)

                self._json(200, {
                    "text": text,
                    "lang": lang,
                    "bytes": length,
                    "duration_sec": round(duration, 1),
                    "segments": len(chunks),
                })

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
