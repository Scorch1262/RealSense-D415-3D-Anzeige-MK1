# Änderungen

## 2.0.1
- Fehler „Couldn't resolve requests“ behoben: Das Programm fragt jetzt die tatsächlich von der Kamera
  angebotenen Formate ab und wählt das passendste (z. B. an USB 2 automatisch 640×480 @ 30 statt 1280×720)
- Abweichung von der Wunschauflösung wird in der Statuszeile angezeigt
- Farbstrom auch im BGR-Format nutzbar, sonst automatisch nur Tiefe
- Diagnose im Log: Gerät, USB-Typ, alle verfügbaren Tiefen-/Farbformate, gewähltes Format
- Klare Meldung, wenn die Kamera erkannt wird, aber keine Formate liefert (Windows-Kamera-Datenschutz, belegte Kamera)
- Gleiche Fehlermeldung wird nicht mehr alle paar Sekunden ins Log geschrieben

## 2.0.0
- Komplett auf reines Desktop-Programm umgestellt (PySide6/Qt + OpenGL), kein Browser und kein Webserver mehr
- 3D-Ansicht mit pyqtgraph-OpenGL, Tiefen- und Farbbild als native Ansichten
- Gleiches Dashboard-Design (dunkel, Amber/Teal, HUD-Ecken), dunkle Windows-Titelleiste
- Tastenkürzel (Leertaste, Strg+S, Strg+P, 1–4, F11), Fenstergröße wird gespeichert
- Speichern von PLY/PNG über Windows-Dateidialog
- Protokolldatei `realsense-viewer.log` neben der exe
- Build: Fenster-exe ohne Konsole, Selbsttest im Workflow

## 1.0.0
- Erste Version (Browser-Oberfläche)
