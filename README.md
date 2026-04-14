# Feuerwehr - Das Spiel

Ein kleines 2D-Feuerwehrspiel im Browser, gebaut mit HTML5 Canvas und purem
JavaScript (keine Dependencies, kein Build-Schritt).

## Spielen

Öffne einfach `index.html` in einem modernen Browser. Keine Installation nötig.

```
# Alternativ mit lokalem Server:
python3 -m http.server 8000
# dann http://localhost:8000 im Browser öffnen
```

## Ziel

Du bist der Feuerwehrmann! Lösche die Brände in den Gebäuden, bevor diese
abbrennen. Jedes abgebrannte Gebäude kostet ein Leben.

## Steuerung

| Taste | Aktion |
|-------|--------|
| Pfeiltasten / WASD | Bewegen |
| Leertaste | Wasser spritzen |
| Enter | Level starten / neu starten |

## Spielmechanik

- **Wasser:** Dein Tank hat begrenzte Kapazität. Laufe zu den blauen Hydranten,
  um wieder aufzufüllen.
- **Feuer:** Wird nicht gelöscht, wächst es und beschädigt das Gebäude.
- **Leben:** Du verlierst ein Leben pro abgebranntem Gebäude.
- **Level:** Höhere Level = mehr Gebäude und schnellere Brände.
- **Punkte:** +10 × Level pro gelöschtem Feuer, +50 × Level Bonus pro
  abgeschlossenem Level.

## Dateien

- `index.html` - Einstiegspunkt mit HUD und Canvas
- `style.css` - Styling für die Benutzeroberfläche
- `game.js` - Spiellogik, Rendering und Hauptschleife
