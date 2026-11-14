# Ядро блокнотов Tulpar: один процесс Python на блокнот, общий словарь
# переменных между ячейками. Обмен — JSON с заголовком Content-Length
# (как у языковых серверов), поэтому Jupyter ставить не нужно.
import ast, base64, builtins, io, json, os, sys, traceback, warnings

os.environ.setdefault("MPLBACKEND", "Agg")
warnings.filterwarnings("ignore", message=".*non-interactive.*")

_in = sys.stdin.buffer
_out = sys.stdout.buffer
ns = {"__name__": "__main__", "__builtins__": builtins}
current = {"id": None}
count = 0


def read():
    headers = {}
    while True:
        line = _in.readline()
        if not line:
            sys.exit(0)
        line = line.decode("utf-8").strip()
        if not line:
            break
        k, _, v = line.partition(":")
        headers[k.strip().lower()] = v.strip()
    n = int(headers.get("content-length", "0"))
    return json.loads(_in.read(n).decode("utf-8"))


def send(obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    _out.write(b"Content-Length: %d\r\n\r\n" % len(data))
    _out.write(data)
    _out.flush()


class Stream(io.TextIOBase):
    def __init__(self, name):
        self.name = name

    def writable(self):
        return True

    def write(self, s):
        if s:
            send({"type": "stream", "id": current["id"], "name": self.name, "text": s})
        return len(s)

    def flush(self):
        pass


def _input(prompt=""):
    send({"type": "input_request", "id": current["id"], "prompt": str(prompt)})
    while True:
        msg = read()
        if msg.get("type") == "input_reply":
            return msg.get("value", "")


builtins.input = _input
sys.stdout = Stream("stdout")
sys.stderr = Stream("stderr")


def display(value):
    if value is None:
        return
    for mime, method in (("image/png", "_repr_png_"), ("text/html", "_repr_html_"), ("text/markdown", "_repr_markdown_")):
        fn = getattr(value, method, None)
        if callable(fn):
            try:
                data = fn()
            except Exception:
                data = None
            if data:
                if isinstance(data, bytes):
                    data = base64.b64encode(data).decode("ascii")
                send({"type": "display", "id": current["id"], "mime": mime, "data": data, "text": repr(value)[:2000]})
                return
    send({"type": "display", "id": current["id"], "mime": "text/plain", "data": repr(value)})


ns["display"] = display


def flush_figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if not plt:
        return
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", bbox_inches="tight", dpi=110)
        send({"type": "display", "id": current["id"], "mime": "image/png", "data": base64.b64encode(buf.getvalue()).decode("ascii")})
    plt.close("all")


def run(code):
    global count
    count += 1
    try:
        tree = ast.parse(code, "<ячейка>", "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            last = ast.Expression(tree.body.pop().value)
        exec(compile(tree, "<ячейка>", "exec"), ns)
        if last is not None:
            value = eval(compile(last, "<ячейка>", "eval"), ns)
            if value is not None:
                ns["_"] = value
                display(value)
        flush_figures()
        return True
    except SystemExit:
        return True
    except BaseException as e:  # noqa: BLE001 — показываем любую ошибку ячейки
        flush_figures()
        tb = traceback.format_exception(type(e), e, e.__traceback__)
        # Свои кадры ядра пользователю не нужны
        tb = [line for line in tb if "kernel.py" not in line and "<string>" not in line]
        send({"type": "error", "id": current["id"], "ename": type(e).__name__, "evalue": str(e), "traceback": "".join(tb)})
        return False


send({"type": "ready", "python": sys.version.split()[0]})
while True:
    msg = read()
    if msg.get("type") == "execute":
        current["id"] = msg.get("id")
        ok = run(msg.get("code", ""))
        send({"type": "done", "id": current["id"], "count": count, "ok": ok})
        current["id"] = None
