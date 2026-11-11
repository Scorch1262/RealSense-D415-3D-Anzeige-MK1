#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RealSense-Viewer-MK1
Zeigt das 3D-Bild (Punktwolke), das Tiefenbild und das Farbbild einer per USB
angeschlossenen Intel RealSense D415 im Browser an – im Design der Dashboards.

Start:  python app.py          (oder die gebaute RealSense-Viewer-MK1.exe)
Danach: http://localhost:8095  (Port in config.ini bzw. auf der Webseite änderbar)
"""

import configparser
import json
import logging
import math
import os
import struct
import sys
import threading
import time
import webbrowser
from pathlib import Path

import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory

try:
    import pyrealsense2 as rs
    RS_IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - nur ohne SDK
    rs = None
    RS_IMPORT_ERROR = str(exc)

APP_NAME = "RealSense-Viewer-MK1"
APP_VERSION = "1.0.0"

# --------------------------------------------------------------------------
# Pfade: Ressourcen (im exe eingebettet) und Konfiguration (neben der exe)
# --------------------------------------------------------------------------
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
    RES_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))
else:
    BASE_DIR = Path(__file__).resolve().parent
    RES_DIR = BASE_DIR

STATIC_DIR = RES_DIR / "static"
CONFIG_PATH = BASE_DIR / "config.ini"

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="replace")
    except Exception:
        pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger(APP_NAME)
logging.getLogger("werkzeug").setLevel(logging.WARNING)

# --------------------------------------------------------------------------
# Konfiguration
# --------------------------------------------------------------------------
DEFAULTS = {
    "server": {
        "port": "8095",
        "host": "0.0.0.0",
        "browser_oeffnen": "ja",
    },
    "kamera": {
        "aufloesung": "848x480",
        "fps": "30",
        "seriennummer": "",
        "demo_modus": "auto",          # auto | ja | nein
        "laser": "ja",
        "laserleistung": "150",
        "preset": "",
    },
    "verarbeitung": {
        "punktabstand": "2",           # 1 = jeder Pixel, 2 = jeder zweite ...
        "spatial_filter": "ja",
        "temporal_filter": "ja",
        "loecher_fuellen": "nein",
        "min_distanz_m": "0.15",
        "max_distanz_m": "3.0",
    },
    "ansicht": {
        "farbmodus": "rgb",            # rgb | tiefe | amber | teal
        "punktgroesse": "2.0",
        "ansicht": "3d",               # 3d | tiefe | farbe | geteilt
        "gitter": "ja",
        "achsen": "ja",
    },
}

AUFLOESUNGEN = ["1280x720", "848x480", "640x480", "640x360", "480x270", "424x240"]
FPS_WERTE = [6, 15, 30]

_cfg_lock = threading.Lock()


def _truthy(v):
    return str(v).strip().lower() in ("1", "ja", "yes", "true", "an", "on")


def load_config():
    cfg = configparser.ConfigParser()
    cfg.read_dict(DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.read(CONFIG_PATH, encoding="utf-8")
        except Exception as exc:
            log.warning("config.ini konnte nicht gelesen werden (%s) – nutze Standardwerte", exc)
    else:
        save_config(cfg)
    return cfg


def save_config(cfg):
    header = (
        f"# {APP_NAME} – Konfiguration\n"
        "# Diese Datei liegt neben der exe und kann mit jedem Texteditor bearbeitet werden.\n"
        "# Werte für ja/nein: ja | nein.  Nach Änderung des Ports Programm neu starten.\n\n"
    )
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
            fh.write(header)
            cfg.write(fh)
    except Exception as exc:
        log.warning("config.ini konnte nicht geschrieben werden: %s", exc)


CFG = load_config()


def cfg_get(section, key):
    with _cfg_lock:
        return CFG.get(section, key, fallback=DEFAULTS[section][key])


def cfg_set(section, key, value):
    with _cfg_lock:
        CFG.set(section, key, str(value))


def settings_dict():
    with _cfg_lock:
        return {s: dict(CFG.items(s)) for s in DEFAULTS}


# --------------------------------------------------------------------------
# Frame-Format (binär, little endian) für /api/frame
#   0  4s   Magic "RS3D"
#   4  I    Sequenznummer
#   8  H    Breite
#  10  H    Höhe
#  12  f    fx
#  16  f    fy
#  20  f    ppx
#  24  f    ppy
#  28  f    Tiefeneinheit (Meter pro Rohwert)
#  32  I    Flags (Bit0 = Farbbild vorhanden, Bit1 = Demo)
#  36  f    Kamera-FPS (gemessen)
#  40  ...  Tiefe uint16[w*h], danach optional RGB uint8[w*h*3]
# --------------------------------------------------------------------------
HEADER_FMT = "<4sIHHfffffIf"
HEADER_SIZE = struct.calcsize(HEADER_FMT)  # 40


def pack_frame(seq, depth, rgb, fx, fy, ppx, ppy, depth_units, demo, fps):
    h, w = depth.shape
    flags = (1 if rgb is not None else 0) | (2 if demo else 0)
    head = struct.pack(HEADER_FMT, b"RS3D", seq & 0xFFFFFFFF, w, h,
                       fx, fy, ppx, ppy, depth_units, flags, fps)
    parts = [head, np.ascontiguousarray(depth, dtype="<u2").tobytes()]
    if rgb is not None:
        parts.append(np.ascontiguousarray(rgb, dtype=np.uint8).tobytes())
    return b"".join(parts)


# --------------------------------------------------------------------------
# Kamera-Thread
# --------------------------------------------------------------------------
class CameraWorker(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="Kamera")
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.frame = None
        self.seq = 0
        self.restart_flag = threading.Event()
        self.stop_flag = threading.Event()
        self.option_queue = []
        self.status = {
            "verbunden": False,
            "demo": False,
            "meldung": "Starte …",
            "geraet": {},
            "fps": 0.0,
            "aufloesung": "",
            "temperatur": None,
            "optionen": {},
            "sdk": (getattr(rs, "__version__", "?") if rs else None),
            "sdk_fehler": RS_IMPORT_ERROR,
        }
        self._fps_t = time.time()
        self._fps_n = 0
        self._fps = 0.0

    # ---------------- öffentliche Hilfen ----------------
    def request_restart(self):
        self.restart_flag.set()

    def queue_option(self, name, value):
        with self.lock:
            self.option_queue.append((name, value))

    def get_frame(self, after_seq, timeout=1.0):
        with self.cond:
            if self.seq <= after_seq:
                self.cond.wait(timeout)
            return self.seq, self.frame

    def get_status(self):
        with self.lock:
            return json.loads(json.dumps(self.status))

    def _set_status(self, **kw):
        with self.lock:
            self.status.update(kw)

    def _publish(self, data):
        with self.cond:
            self.seq += 1
            self.frame = data
            self.cond.notify_all()

    def _tick_fps(self):
        self._fps_n += 1
        now = time.time()
        if now - self._fps_t >= 1.0:
            self._fps = self._fps_n / (now - self._fps_t)
            self._fps_n = 0
            self._fps_t = now
            self._set_status(fps=round(self._fps, 1))

    # ---------------- Hauptschleife ----------------
    def run(self):
        while not self.stop_flag.is_set():
            self.restart_flag.clear()
            mode = cfg_get("kamera", "demo_modus").strip().lower()
            if mode in ("ja", "1", "true", "an"):
                self._run_demo(forever=True)
                continue
            if rs is None:
                self._set_status(meldung="RealSense-SDK (pyrealsense2) nicht verfügbar – Demo-Modus")
                self._run_demo(forever=True)
                continue
            try:
                devs = rs.context().query_devices()
                n = len(devs)
            except Exception as exc:
                n = 0
                log.warning("Geräteabfrage fehlgeschlagen: %s", exc)
            if n == 0:
                msg = "Keine RealSense-Kamera gefunden – USB-Kabel prüfen (USB 3 empfohlen)"
                self._set_status(verbunden=False, meldung=msg, geraet={})
                if mode == "auto":
                    # Demo zeigen, aber regelmäßig nach Kamera suchen
                    self._run_demo(forever=False, dauer=3.0)
                else:
                    self._idle(2.0)
                continue
            try:
                self._run_camera()
            except Exception as exc:
                log.error("Kamerafehler: %s", exc)
                self._set_status(verbunden=False, meldung=f"Kamerafehler: {exc}")
                self._idle(2.0)

    def _idle(self, sec):
        end = time.time() + sec
        while time.time() < end and not self.restart_flag.is_set() and not self.stop_flag.is_set():
            time.sleep(0.1)

    # ---------------- echte Kamera ----------------
    def _run_camera(self):
        res = cfg_get("kamera", "aufloesung")
        try:
            w, h = [int(x) for x in res.lower().split("x")]
        except Exception:
            w, h = 848, 480
        fps = int(float(cfg_get("kamera", "fps") or 30))
        serial = cfg_get("kamera", "seriennummer").strip()

        pipeline = rs.pipeline()
        config = rs.config()
        if serial:
            config.enable_device(serial)
        config.enable_stream(rs.stream.depth, w, h, rs.format.z16, fps)
        config.enable_stream(rs.stream.color, w, h, rs.format.rgb8, fps)

        self._set_status(meldung=f"Verbinde mit Kamera ({w}x{h} @ {fps} fps) …")
        try:
            profile = pipeline.start(config)
            has_color = True
        except Exception as exc:
            log.warning("Start mit Farbe fehlgeschlagen (%s) – versuche nur Tiefe", exc)
            config = rs.config()
            if serial:
                config.enable_device(serial)
            config.enable_stream(rs.stream.depth, w, h, rs.format.z16, fps)
            try:
                profile = pipeline.start(config)
            except Exception:
                # letzte Rückfallebene: Standardprofil des Geräts
                config = rs.config()
                if serial:
                    config.enable_device(serial)
                config.enable_stream(rs.stream.depth, rs.format.z16)
                profile = pipeline.start(config)
            has_color = False

        dev = profile.get_device()
        depth_sensor = dev.first_depth_sensor()
        depth_units = depth_sensor.get_depth_scale()

        def info(key):
            try:
                return dev.get_info(key) if dev.supports(key) else ""
            except Exception:
                return ""

        geraet = {
            "name": info(rs.camera_info.name),
            "seriennummer": info(rs.camera_info.serial_number),
            "firmware": info(rs.camera_info.firmware_version),
            "usb": info(rs.camera_info.usb_type_descriptor),
            "produkt_linie": info(rs.camera_info.product_line),
        }
        log.info("Kamera verbunden: %s  SN %s  FW %s  USB %s", geraet["name"],
                 geraet["seriennummer"], geraet["firmware"], geraet["usb"])

        # Sensor-Optionen aus der Konfiguration anwenden
        self._apply_initial_options(depth_sensor)

        dprof = profile.get_stream(rs.stream.depth).as_video_stream_profile()
        intr = dprof.get_intrinsics()
        aw, ah = intr.width, intr.height

        align = rs.align(rs.stream.depth) if has_color else None
        spatial = rs.spatial_filter()
        temporal = rs.temporal_filter()
        holes = rs.hole_filling_filter()

        usb_hint = ""
        if geraet["usb"].startswith("2"):
            usb_hint = " – Achtung: nur USB 2 erkannt, Auflösung/FPS eingeschränkt"
        self._set_status(
            verbunden=True, demo=False, geraet=geraet,
            aufloesung=f"{aw}x{ah} @ {fps} fps" + ("" if has_color else " (ohne Farbe)"),
            meldung="Kamera läuft" + usb_hint,
            optionen=self._read_options(depth_sensor),
        )

        last_temp = 0.0
        try:
            while not self.restart_flag.is_set() and not self.stop_flag.is_set():
                self._process_option_queue(depth_sensor)
                try:
                    frames = pipeline.wait_for_frames(3000)
                except Exception as exc:
                    raise RuntimeError(f"Keine Bilder mehr von der Kamera ({exc})")

                if align is not None:
                    frames = align.process(frames)
                depth = frames.get_depth_frame()
                if not depth:
                    continue
                color = frames.get_color_frame() if has_color else None

                if _truthy(cfg_get("verarbeitung", "spatial_filter")):
                    depth = spatial.process(depth)
                if _truthy(cfg_get("verarbeitung", "temporal_filter")):
                    depth = temporal.process(depth)
                if _truthy(cfg_get("verarbeitung", "loecher_fuellen")):
                    depth = holes.process(depth)

                d = np.asanyarray(depth.get_data())
                rgb = np.asanyarray(color.get_data()) if color else None

                step = max(1, int(float(cfg_get("verarbeitung", "punktabstand") or 1)))
                if step > 1:
                    d = d[::step, ::step]
                    if rgb is not None:
                        rgb = rgb[::step, ::step]
                fx, fy = intr.fx / step, intr.fy / step
                ppx, ppy = (intr.ppx + 0.5) / step - 0.5, (intr.ppy + 0.5) / step - 0.5

                self._tick_fps()
                self._publish(pack_frame(self.seq + 1, d, rgb, fx, fy, ppx, ppy,
                                         depth_units, False, self._fps))

                now = time.time()
                if now - last_temp > 2.0:
                    last_temp = now
                    self._set_status(temperatur=self._read_temp(depth_sensor))
        finally:
            try:
                pipeline.stop()
            except Exception:
                pass
            self._set_status(verbunden=False)

    def _apply_initial_options(self, sensor):
        try:
            preset = cfg_get("kamera", "preset").strip()
            if preset and sensor.supports(rs.option.visual_preset):
                self._set_preset(sensor, preset)
        except Exception as exc:
            log.warning("Preset konnte nicht gesetzt werden: %s", exc)
        try:
            if sensor.supports(rs.option.emitter_enabled):
                sensor.set_option(rs.option.emitter_enabled,
                                  1.0 if _truthy(cfg_get("kamera", "laser")) else 0.0)
        except Exception as exc:
            log.warning("Laser an/aus fehlgeschlagen: %s", exc)
        try:
            if sensor.supports(rs.option.laser_power):
                r = sensor.get_option_range(rs.option.laser_power)
                val = float(cfg_get("kamera", "laserleistung") or r.default)
                val = min(max(val, r.min), r.max)
                sensor.set_option(rs.option.laser_power, val)
        except Exception as exc:
            log.warning("Laserleistung fehlgeschlagen: %s", exc)

    def _set_preset(self, sensor, name):
        r = sensor.get_option_range(rs.option.visual_preset)
        for i in range(int(r.min), int(r.max) + 1):
            try:
                if sensor.get_option_value_description(rs.option.visual_preset, i) == name:
                    sensor.set_option(rs.option.visual_preset, i)
                    return True
            except Exception:
                continue
        return False

    def _read_options(self, sensor):
        out = {}
        try:
            if sensor.supports(rs.option.emitter_enabled):
                out["laser"] = sensor.get_option(rs.option.emitter_enabled) > 0.5
            if sensor.supports(rs.option.laser_power):
                r = sensor.get_option_range(rs.option.laser_power)
                out["laserleistung"] = sensor.get_option(rs.option.laser_power)
                out["laserleistung_min"] = r.min
                out["laserleistung_max"] = r.max
                out["laserleistung_step"] = r.step
            if sensor.supports(rs.option.visual_preset):
                r = sensor.get_option_range(rs.option.visual_preset)
                names = []
                for i in range(int(r.min), int(r.max) + 1):
                    try:
                        names.append(sensor.get_option_value_description(rs.option.visual_preset, i))
                    except Exception:
                        pass
                out["presets"] = [n for n in names if n]
                cur = int(sensor.get_option(rs.option.visual_preset))
                out["preset"] = sensor.get_option_value_description(rs.option.visual_preset, cur)
        except Exception as exc:
            log.debug("Optionen lesen: %s", exc)
        return out

    def _read_temp(self, sensor):
        for opt in ("asic_temperature", "projector_temperature"):
            try:
                o = getattr(rs.option, opt)
                if sensor.supports(o):
                    return round(sensor.get_option(o), 1)
            except Exception:
                continue
        return None

    def _process_option_queue(self, sensor):
        with self.lock:
            queue, self.option_queue = self.option_queue, []
        if not queue:
            return
        for name, value in queue:
            try:
                if name == "laser" and sensor.supports(rs.option.emitter_enabled):
                    sensor.set_option(rs.option.emitter_enabled, 1.0 if value else 0.0)
                elif name == "laserleistung" and sensor.supports(rs.option.laser_power):
                    sensor.set_option(rs.option.laser_power, float(value))
                elif name == "preset" and sensor.supports(rs.option.visual_preset):
                    self._set_preset(sensor, str(value))
            except Exception as exc:
                log.warning("Option %s=%s fehlgeschlagen: %s", name, value, exc)
        self._set_status(optionen=self._read_options(sensor))

    # ---------------- Demo-Szene ----------------
    def _run_demo(self, forever=True, dauer=3.0):
        """Synthetische Szene, damit die Oberfläche ohne Kamera testbar ist."""
        w, h = 640, 360
        fx = fy = 450.0
        ppx, ppy = (w - 1) / 2.0, (h - 1) / 2.0
        units = 0.001
        u, v = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        rx = (u - ppx) / fx
        ry = (v - ppy) / fy
        self._set_status(demo=True, verbunden=False,
                         geraet={"name": "Demo-Szene", "seriennummer": "—", "firmware": "—",
                                 "usb": "—", "produkt_linie": "Demo"},
                         aufloesung=f"{w}x{h} @ 15 fps (Demo-Szene)",
                         optionen={})
        if forever:
            self._set_status(meldung="Demo-Modus aktiv")
        start = time.time()
        while not self.restart_flag.is_set() and not self.stop_flag.is_set():
            t = time.time()
            if not forever and t - start > dauer:
                break
            ph = t * 0.6
            # Rückwand
            z = np.full((h, w), 2.6, dtype=np.float32)
            # Boden: y = +0.55 m (Kamera-y zeigt nach unten)
            with np.errstate(divide="ignore", invalid="ignore"):
                zf = np.where(ry > 1e-3, 0.55 / ry, np.inf)
            z = np.minimum(z, zf)
            # Kugel
            cx, cy, cz, r = 0.35 * math.sin(ph), 0.05, 1.5 + 0.25 * math.cos(ph), 0.32
            dn = np.sqrt(rx * rx + ry * ry + 1.0)
            dx, dy, dz = rx / dn, ry / dn, 1.0 / dn
            b = dx * cx + dy * cy + dz * cz
            c = cx * cx + cy * cy + cz * cz - r * r
            disc = b * b - c
            hit = disc > 0
            tt = np.where(hit, b - np.sqrt(np.maximum(disc, 0)), np.inf)
            zs = tt * dz
            z = np.minimum(z, np.where(hit, zs, np.inf))
            # Quader links
            bx0, bx1, by0, bz0 = -0.85, -0.45, 0.10, 1.9
            zb = np.full_like(z, bz0)
            xb, yb = rx * zb, ry * zb
            inside = (xb > bx0) & (xb < bx1) & (yb > by0) & (yb < 0.55)
            z = np.where(inside & (zb < z), zb, z)
            # Rauschen + Löcher wie bei echter Kamera
            noise = np.random.normal(0, 0.002, z.shape).astype(np.float32) * z * z
            z = z + noise
            z[np.random.random(z.shape) < 0.01] = 0
            depth = np.clip(z / units, 0, 65535).astype(np.uint16)
            depth[~np.isfinite(z)] = 0

            # Farbe: Muster je nach Fläche
            X, Y = rx * z, ry * z
            rgb = np.zeros((h, w, 3), dtype=np.uint8)
            checker = ((np.floor(X * 4) + np.floor(z * 4)) % 2).astype(np.float32)
            rgb[..., 0] = (40 + 30 * checker).astype(np.uint8)
            rgb[..., 1] = (44 + 30 * checker).astype(np.uint8)
            rgb[..., 2] = (52 + 30 * checker).astype(np.uint8)
            wall = np.abs(z - 2.6) < 0.05
            rgb[wall] = np.stack([
                (60 + 40 * (np.sin(X * 6) * 0.5 + 0.5)),
                (70 + 30 * (np.cos(Y * 6) * 0.5 + 0.5)),
                (90 + 20 * np.ones_like(X)),
            ], -1)[wall].astype(np.uint8)
            sph = np.abs(z - zs) < 0.01
            shade = np.clip(1.2 - (z - (cz - r)) / r, 0.3, 1.0)
            rgb[sph] = (np.stack([255 * shade, 176 * shade, 0 * shade], -1))[sph].astype(np.uint8)
            box = inside & (np.abs(z - bz0) < 0.02)
            rgb[box] = (0, 200, 190)

            step = max(1, int(float(cfg_get("verarbeitung", "punktabstand") or 1)))
            if step > 1:
                depth, rgb = depth[::step, ::step], rgb[::step, ::step]
            sfx, sfy = fx / step, fy / step
            sppx, sppy = (ppx + 0.5) / step - 0.5, (ppy + 0.5) / step - 0.5
            self._tick_fps()
            self._publish(pack_frame(self.seq + 1, depth, rgb, sfx, sfy, sppx, sppy,
                                     units, True, self._fps))
            sleep = 1 / 15 - (time.time() - t)
            if sleep > 0:
                time.sleep(sleep)
        self._set_status(demo=False)


CAM = CameraWorker()

# --------------------------------------------------------------------------
# Webserver
# --------------------------------------------------------------------------
app = Flask(__name__, static_folder=None)


@app.after_request
def _no_cache(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/")
def index():
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace("{{VERSION}}", APP_VERSION).replace("{{APP_NAME}}", APP_NAME)
    return Response(html, mimetype="text/html")


@app.route("/static/<path:name>")
def static_files(name):
    resp = send_from_directory(STATIC_DIR, name)
    if name.endswith(".js"):
        resp.headers["Content-Type"] = "text/javascript; charset=utf-8"
    return resp


@app.route("/api/frame")
def api_frame():
    try:
        after = int(request.args.get("nach", "0"))
    except ValueError:
        after = 0
    seq, data = CAM.get_frame(after, timeout=1.5)
    if data is None or seq <= after:
        return Response(status=204)
    return Response(data, mimetype="application/octet-stream")


@app.route("/api/status")
def api_status():
    st = CAM.get_status()
    st["version"] = APP_VERSION
    st["app"] = APP_NAME
    st["einstellungen"] = settings_dict()
    st["aufloesungen"] = AUFLOESUNGEN
    st["fps_werte"] = FPS_WERTE
    st["port_aktiv"] = ACTIVE_PORT
    st["config_pfad"] = str(CONFIG_PATH)
    return jsonify(st)


RESTART_KEYS = {("kamera", "aufloesung"), ("kamera", "fps"), ("kamera", "seriennummer"),
                ("kamera", "demo_modus")}
LIVE_OPTION_KEYS = {"laser", "laserleistung", "preset"}


@app.route("/api/einstellungen", methods=["POST"])
def api_settings():
    data = request.get_json(silent=True) or {}
    restart = False
    port_changed = False
    for section, values in data.items():
        if section not in DEFAULTS or not isinstance(values, dict):
            continue
        for key, value in values.items():
            if key not in DEFAULTS[section]:
                continue
            if isinstance(value, bool):
                value = "ja" if value else "nein"
            value = str(value)
            if section == "server" and key == "port":
                try:
                    p = int(value)
                    if not 1 <= p <= 65535:
                        raise ValueError
                except ValueError:
                    return jsonify(ok=False, fehler="Ungültiger Port"), 400
                port_changed = p != ACTIVE_PORT
            old = cfg_get(section, key)
            cfg_set(section, key, value)
            if (section, key) in RESTART_KEYS and old != value:
                restart = True
            if section == "kamera" and key in LIVE_OPTION_KEYS:
                CAM.queue_option(key, _truthy(value) if key == "laser" else value)
    with _cfg_lock:
        save_config(CFG)
    if restart:
        CAM.request_restart()
    return jsonify(ok=True, neustart_kamera=restart, port_neustart=port_changed)


@app.route("/api/kamera/neustart", methods=["POST"])
def api_cam_restart():
    CAM.request_restart()
    return jsonify(ok=True)


@app.route("/api/geraete")
def api_devices():
    out = []
    if rs is not None:
        try:
            for d in rs.context().query_devices():
                out.append({
                    "name": d.get_info(rs.camera_info.name),
                    "seriennummer": d.get_info(rs.camera_info.serial_number),
                })
        except Exception as exc:
            log.debug("Geräteliste: %s", exc)
    return jsonify(out)


ACTIVE_PORT = int(cfg_get("server", "port") or 8095)


def selbsttest():
    """Wird im GitHub-Actions-Build aufgerufen: prüft, ob alles in der exe steckt."""
    ok = True
    print(f"{APP_NAME} v{APP_VERSION} – Selbsttest")
    for name in ("index.html", "style.css", "app.js", "logo.svg",
                 "vendor/three.module.min.js", "vendor/OrbitControls.js"):
        exists = (STATIC_DIR / name).exists()
        ok &= exists
        print(f"  [{'OK' if exists else 'FEHLT'}] static/{name}")
    if rs is None:
        ok = False
        print(f"  [FEHLT] pyrealsense2: {RS_IMPORT_ERROR}")
    else:
        try:
            n = len(rs.context().query_devices())
            print(f"  [OK] pyrealsense2 {getattr(rs, '__version__', '?')} – {n} Gerät(e)")
        except Exception as exc:
            ok = False
            print(f"  [FEHLER] RealSense-Kontext: {exc}")
    print("Ergebnis:", "OK" if ok else "FEHLER")
    return 0 if ok else 1


def main():
    global ACTIVE_PORT
    if "--selbsttest" in sys.argv:
        sys.exit(selbsttest())
    host = cfg_get("server", "host") or "0.0.0.0"
    ACTIVE_PORT = int(cfg_get("server", "port") or 8095)
    print("=" * 62)
    print(f"  {APP_NAME}  v{APP_VERSION}")
    print(f"  Webseite:   http://localhost:{ACTIVE_PORT}")
    print(f"  Konfig:     {CONFIG_PATH}")
    if rs is None:
        print(f"  WARNUNG: pyrealsense2 nicht geladen ({RS_IMPORT_ERROR})")
    print("  Beenden:    Strg+C oder Fenster schließen")
    print("=" * 62)
    CAM.start()
    if _truthy(cfg_get("server", "browser_oeffnen")) and "--kein-browser" not in sys.argv:
        threading.Timer(1.2, lambda: webbrowser.open(f"http://localhost:{ACTIVE_PORT}")).start()
    try:
        app.run(host=host, port=ACTIVE_PORT, threaded=True, use_reloader=False)
    except OSError as exc:
        print(f"\nFEHLER: Port {ACTIVE_PORT} ist belegt oder nicht verfügbar ({exc}).")
        print(f"Bitte in {CONFIG_PATH} unter [server] einen anderen Port eintragen.")
        if getattr(sys, "frozen", False):
            input("Enter zum Beenden …")


if __name__ == "__main__":
    main()
