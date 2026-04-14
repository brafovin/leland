# Fire Department - 3D Firefighter

Ein 3D-Feuerwehrspiel im amerikanischen Stil, direkt im Browser. Gebaut mit
[Three.js](https://threejs.org/) (via CDN, kein Build-Schritt), purem
JavaScript, HTML und CSS.

## Spielen

Three.js wird via CDN geladen, du brauchst also eine Internet-Verbindung und
einen kleinen lokalen Webserver (wegen CORS/`file://`-Beschränkungen):

```
python3 -m http.server 8000
```

Dann `http://localhost:8000` im Browser öffnen und auf **EINSATZ STARTEN**
klicken. Der Mauszeiger wird gefangen, und du bist im Einsatz.

## Ziel

Du bist der Feuerwehrmann. Vor dem Feuerwehrhaus steht deine Engine - ein
amerikanischer Pierce/E-One-Stil Pumper mit roter Lackierung, weißem Dach,
blinkender Lightbar und sechs **öffenbaren Gerätefächern** an beiden Seiten.
Lösche alle Brände in der Stadt, bevor das Wasser ausgeht.

## Steuerung

| Taste              | Aktion                              |
|--------------------|-------------------------------------|
| WASD / Pfeiltasten | Laufen                              |
| Maus               | Umsehen (Pointer-Lock)              |
| Linksklick         | Wasser spritzen                     |
| E                  | Gerätefach öffnen/schließen         |
| E (an Hydrant)     | Wasser auffüllen                    |
| ESC                | Mauszeiger freigeben                |

## Gerätefächer

Die sechs Fächer am Truck lassen sich wie amerikanische Roll-Up-Compartments
nach oben öffnen. Jedes Fach hat eine gelbe Beschriftung und enthält passendes
Equipment:

- **Atemschutz** - Helme, Atemluftflaschen
- **Werkzeug** - Äxte, Brecheisen, Rettungssäge, Taschenlampen
- **Schlauch** - Schlauchrollen, Feuerlöscher
- **Pumpe** - Schlauch, Feuerlöscher
- **Rettung** - Seile, Helm
- **Werkzeug 2** - Axt, Brecheisen, Säge

Geh einfach zu einem Fach, schau darauf, und drücke **E**.

## Spielmechanik

- **Wasser:** Dein Tank hat 100 Einheiten. Linksklick verbraucht Wasser.
- **Hydranten:** Vier gelbe US-Hydranten rings um den Truck. Hingehen und **E**
  drücken füllt den Tank sofort auf.
- **Brände:** Verteilt um die Stadt. Ziele mit dem Fadenkreuz auf die Flammen
  und sprüh Wasser. Jede Flamme hat 100 HP.
- **Level:** Sobald alle Brände gelöscht sind, startet das nächste Level mit
  zusätzlichen Bränden.
- **Punkte:** +100 × Level pro gelöschtem Feuer.

## Dateien

- `index.html` - Einstiegspunkt mit HUD, Overlay und Three.js CDN-Tag
- `style.css` - Styling für HUD, Crosshair, Overlay
- `game.js` - 3D-Szene, Truck, Gerätefächer, Gameplay, Game-Loop

## Technik

- Three.js r128 via jsdelivr CDN
- Keine Build-Tools, kein npm, reine Vanilla-JS
- Schatten (`PCFSoftShadowMap`), Fog, Hemisphere + Directional Lights
- Pointer-Lock für Maussteuerung
- Simple Wasser-Partikel mit Schwerkraft und Kollision gegen Brände
- Animation der Fächer über einen Pivot am oberen Türrand (schwenkt nach oben)
