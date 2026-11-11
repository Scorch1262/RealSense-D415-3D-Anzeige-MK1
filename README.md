# RealSense-Viewer-MK1

**Version 1.0.0**

Zeigt das 3D-Bild (Punktwolke) einer per USB angeschlossenen **Intel RealSense D415** live im Browser an – im Design der Dashboards (dunkel, Amber/Teal, Lattice-Stil). Zusätzlich gibt es das Tiefenbild mit Farbskala und das auf die Tiefe ausgerichtete Farbbild.

## Funktionen

- **3D-Punktwolke** mit Maus drehen, verschieben, zoomen (three.js, offline eingebettet)
- Ansichten: **3D · Tiefe · Farbe · Geteilt** (3D + Tiefe + Farbe gleichzeitig)
- Punktfarbe: echtes **RGB** der Kamera, **Tiefen-Farbskala**, Amber oder Teal
- Distanzbereich (min./max.), Punktgröße, Punktabstand (1–4 Pixel), Bodenraster, Kamerasymbol mit Sichtkegel
- Blickwinkel-Voreinstellungen: Kamera, Schräg, Oben, Seite
- Kamera: Auflösung (bis 1280×720), Bildrate, IR-Projektor an/aus, Laserleistung, Preset (z. B. High Accuracy / High Density)
- Filter des RealSense-SDK: räumliche und zeitliche Glättung, Löcher füllen
- Geräteinfo: Modell, Seriennummer, Firmware, USB-Typ (Warnung bei USB 2), Temperatur, FPS
- Tiefenbild: Mauszeiger zeigt die Entfernung des Pixels in Metern
- **Punktwolke als PLY speichern** (z. B. für MeshLab, CloudCompare, Blender), Bild als PNG, Einfrieren
- **Demo-Szene**, wenn keine Kamera angeschlossen ist (Betriebsart einstellbar)
- Webseite auch im LAN erreichbar (Handy/Tablet), Port auf der Webseite dauerhaft änderbar
- Alle Einstellungen in der menschenlesbaren **config.ini** neben der exe

## Benutzung (Windows)

1. Zip entpacken, `RealSense-Viewer-MK1.exe` starten.
2. Der Browser öffnet sich automatisch mit `http://localhost:8095`.
3. Die D415 an einen **USB-3-Port** anschließen (blauer Port / USB-C-Kabel mit USB-3-Unterstützung). An USB 2 funktionieren nur kleine Auflösungen.

Ein separater Treiber ist für die D415 unter Windows 10/11 nicht nötig – die Bibliothek des RealSense-SDK steckt bereits in der exe. Wird die Kamera nicht erkannt: Kabel/Port wechseln, Intel RealSense Viewer schließen (die Kamera kann nur von einem Programm gleichzeitig genutzt werden), dann auf **„Kamera neu verbinden“** klicken.

Aus dem Netzwerk: `http://<IP-des-Rechners>:8095` (ggf. in der Windows-Firewall freigeben).

## config.ini

Wird beim ersten Start neben der exe angelegt. Wichtige Einträge:

| Abschnitt | Schlüssel | Bedeutung |
|---|---|---|
| `[server]` | `port` | Port der Webseite (Standard 8095), Änderung nach Neustart aktiv |
| `[server]` | `browser_oeffnen` | `ja`/`nein` – Browser beim Start öffnen |
| `[kamera]` | `aufloesung`, `fps` | z. B. `848x480`, `30` |
| `[kamera]` | `seriennummer` | leer = erste Kamera, sonst bestimmte Kamera |
| `[kamera]` | `demo_modus` | `auto` (Demo ohne Kamera), `nein`, `ja` |
| `[verarbeitung]` | `punktabstand` | 1 = jeder Pixel, 2 = jeder zweite … |
| `[verarbeitung]` | `min_distanz_m`, `max_distanz_m` | angezeigter Tiefenbereich |

## Bauen per GitHub Actions

1. Inhalt dieser Zip in ein GitHub-Repository hochladen (inkl. Ordner `.github`).
2. Bei jedem Push auf `main`/`master` baut der Workflow **Build Windows EXE** die exe, testet sie (`--selbsttest`) und stellt sie als Artefakt bereit (Reiter *Actions* → Lauf → *Artifacts*).
3. Für ein Release einen Tag setzen, z. B. `git tag v1.0.0 && git push --tags` – dann erscheint die fertige Zip unter *Releases*.

Die Versionsnummer steht in `app.py` (`APP_VERSION`) und wird automatisch in exe, Zip-Namen und Webseite übernommen.

## Lokal starten (ohne exe)

```bash
pip install -r requirements.txt
python app.py
```

Parameter: `--kein-browser` (Browser nicht öffnen), `--selbsttest` (Prüfung der Bestandteile).

## Ordnerstruktur

```
RealSense-Viewer-MK1/
├── app.py                      Server, Kamera-Thread, Demo-Szene
├── requirements.txt
├── static/
│   ├── index.html              Oberfläche
│   ├── style.css               Dashboard-Design
│   ├── app.js                  3D-Darstellung, Bedienung
│   ├── logo.svg
│   └── vendor/                 three.js r170 + OrbitControls (MIT-Lizenz)
├── assets/icon.ico, icon.png   Programmsymbol
├── build/make_version_info.py  Versionsressource für die exe
└── .github/workflows/build-exe.yml
```

## Hinweise

- PLY-Export: Einheit Meter, Y zeigt nach oben, die Kamera blickt in −Z-Richtung.
- Die Punktwolke wird im Browser aus Tiefenbild + Kamera-Intrinsics berechnet; über WLAN ggf. Punktabstand 2–3 wählen.
- three.js © three.js authors, MIT-Lizenz (`static/vendor/three-LICENSE.txt`).
