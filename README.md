# RealSense-Viewer-MK1

**Version 2.0.0** · reines Desktop-Programm für Windows (kein Browser, kein Webserver)

Zeigt das 3D-Bild (Punktwolke) einer per USB angeschlossenen **Intel RealSense D415** live in einem eigenen Programmfenster an – im Design der Dashboards (dunkel, Amber/Teal, Lattice-Stil). Dazu kommen das Tiefenbild mit Farbskala und das auf die Tiefe ausgerichtete Farbbild.

## Funktionen

- **3D-Punktwolke** in OpenGL: linke Maustaste drehen, mittlere Maustaste verschieben, Mausrad zoomen
- Ansichten: **3D · Tiefe · Farbe · Geteilt** (Tasten 1–4)
- Punktfarbe: echtes **RGB** der Kamera, **Tiefen-Farbskala** (mit Legende), Amber oder Teal
- Distanzbereich (min./max.), Punktgröße, Punktabstand (1–4 Pixel), Bodenraster, Kamerasymbol mit Sichtkegel
- Blickwinkel: Kamera, Schräg, Oben, Seite
- Kamera: Auflösung (bis 1280×720), Bildrate, IR-Projektor an/aus, Laserleistung, Preset (z. B. High Accuracy / High Density)
- Filter des RealSense-SDK: räumliche und zeitliche Glättung, Löcher füllen
- Geräteinfo: Modell, Seriennummer, Firmware, USB-Typ (Warnung bei USB 2), Temperatur, FPS
- Tiefenbild: Mauszeiger zeigt die Entfernung des Pixels in Metern
- **Punktwolke als PLY speichern** (MeshLab, CloudCompare, Blender …), Bild als PNG, Einfrieren
- **Demo-Szene**, wenn keine Kamera angeschlossen ist (Betriebsart einstellbar)
- Dunkle Windows-Titelleiste, Fenstergröße wird gemerkt
- Alle Einstellungen in der menschenlesbaren **config.ini** neben der exe

### Tastenkürzel

| Taste | Funktion |
|---|---|
| Leertaste | Einfrieren / Fortsetzen |
| Strg+S | Punktwolke als PLY speichern |
| Strg+P | Bild als PNG speichern |
| 1 / 2 / 3 / 4 | Ansicht 3D / Tiefe / Farbe / Geteilt |
| F11 | Vollbild |

## Benutzung (Windows 10/11)

1. Zip entpacken, `RealSense-Viewer-MK1.exe` starten (der erste Start dauert einige Sekunden, weil die exe sich entpackt).
2. Die D415 an einen **USB-3-Port** anschließen. An USB 2 funktionieren nur kleine Auflösungen.

Ein separater Treiber ist nicht nötig – die RealSense-Bibliothek steckt in der exe. Wird die Kamera nicht erkannt: Kabel/Port wechseln, andere Programme schließen, die die Kamera benutzen (z. B. Intel RealSense Viewer), dann **„Kamera neu verbinden“** klicken.

Probleme werden in `realsense-viewer.log` neben der exe protokolliert.

## config.ini

Wird beim ersten Start neben der exe angelegt.

| Abschnitt | Schlüssel | Bedeutung |
|---|---|---|
| `[kamera]` | `aufloesung`, `fps` | z. B. `848x480`, `30` |
| `[kamera]` | `seriennummer` | leer = erste Kamera, sonst bestimmte Kamera |
| `[kamera]` | `demo_modus` | `auto` (Demo ohne Kamera), `nein`, `ja` |
| `[kamera]` | `laser`, `laserleistung`, `preset` | Projektor-Einstellungen |
| `[verarbeitung]` | `punktabstand` | 1 = jeder Pixel, 2 = jeder zweite … |
| `[verarbeitung]` | `min_distanz_m`, `max_distanz_m` | angezeigter Tiefenbereich |
| `[ansicht]` | `farbmodus`, `punktgroesse`, `ansicht` | Darstellung |
| `[fenster]` | `breite`, `hoehe`, `maximiert` | Fenster |

## Bauen per GitHub Actions

1. Inhalt dieser Zip in ein GitHub-Repository hochladen (inkl. Ordner `.github`).
2. Bei jedem Push auf `main`/`master` baut der Workflow **Build Windows EXE** die exe mit PyInstaller, startet sie mit `--selbsttest` und stellt sie als Artefakt bereit (Reiter *Actions* → Lauf → *Artifacts*).
3. Für ein Release einen Tag setzen, z. B. `git tag v2.0.0 && git push --tags` – dann erscheint die fertige Zip unter *Releases*.

Die Versionsnummer steht in `app.py` (`APP_VERSION`) und wird automatisch in exe-Eigenschaften, Zip-Namen und Fenster übernommen.

## Lokal starten (ohne exe)

```bash
pip install -r requirements.txt
python app.py
```

`python app.py --selbsttest` prüft, ob alle Bestandteile vorhanden sind.

## Ordnerstruktur

```
RealSense-Viewer-MK1/
├── app.py                      Programmfenster (PySide6/Qt + pyqtgraph-OpenGL)
├── kamera.py                   Kamera-Thread, Demo-Szene, config.ini
├── requirements.txt
├── assets/                     icon.ico, icon.png, logo.svg, pfeil.png
├── build/make_version_info.py  Versionsressource für die exe
└── .github/workflows/build-exe.yml
```

## Hinweise

- PLY-Export: Einheit Meter, Z zeigt nach oben, die Kamera sitzt im Ursprung und blickt in +Y-Richtung.
- Bei 1280×720 mit Punktabstand 1 sind es bis zu 920.000 Punkte – auf schwächeren Grafikkarten Punktabstand 2 wählen.
