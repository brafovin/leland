// Feuerwehr - Das Spiel
// Ein HTML5 Canvas-basiertes Feuerwehrspiel

(() => {
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    const WIDTH = canvas.width;
    const HEIGHT = canvas.height;

    // UI-Elemente
    const scoreEl = document.getElementById('score');
    const livesEl = document.getElementById('lives');
    const levelEl = document.getElementById('level');
    const waterFillEl = document.getElementById('water-fill');
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMessage = document.getElementById('overlay-message');
    const startBtn = document.getElementById('start-btn');

    // Spielzustand
    const STATE = { MENU: 'menu', PLAYING: 'playing', LEVEL_DONE: 'level_done', GAME_OVER: 'game_over' };
    let state = STATE.MENU;

    // Spielwerte
    let score = 0;
    let lives = 3;
    let level = 1;
    let levelTimer = 0;
    let spawnTimer = 0;

    // Eingaben
    const keys = {};
    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
        if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
            e.preventDefault();
        }
    });
    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    // Hilfsfunktionen
    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }
    function randInt(min, max) {
        return Math.floor(rand(min, max + 1));
    }
    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }
    function rectsOverlap(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }
    function dist(ax, ay, bx, by) {
        const dx = ax - bx;
        const dy = ay - by;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Spieler: Feuerwehrmann
    const player = {
        x: WIDTH / 2,
        y: HEIGHT / 2,
        w: 28,
        h: 36,
        speed: 3,
        dir: 'down',
        water: 100,
        maxWater: 100,
        waterUsePerShot: 2,
        cooldown: 0,
        animFrame: 0,
        moving: false,
    };

    // Entitäten
    let buildings = [];
    let fires = [];
    let hydrants = [];
    let waterDrops = [];
    let particles = [];
    let floatingTexts = [];

    // ---- Level aufbauen ----
    function setupLevel(lvl) {
        buildings = [];
        fires = [];
        hydrants = [];
        waterDrops = [];
        particles = [];
        floatingTexts = [];

        // Gebäude platzieren
        const buildingCount = Math.min(3 + lvl, 7);
        const attempts = 40;
        for (let i = 0; i < buildingCount; i++) {
            for (let a = 0; a < attempts; a++) {
                const w = randInt(70, 110);
                const h = randInt(70, 110);
                const x = randInt(40, WIDTH - w - 40);
                const y = randInt(60, HEIGHT - h - 60);
                const b = { x, y, w, h, health: 100, maxHealth: 100, burned: false };
                let ok = true;
                for (const other of buildings) {
                    if (rectsOverlap(
                        { x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 },
                        other
                    )) { ok = false; break; }
                }
                // nicht auf Spieler
                if (rectsOverlap(b, { x: player.x - 40, y: player.y - 40, w: 80, h: 80 })) ok = false;
                if (ok) { buildings.push(b); break; }
            }
        }

        // Hydranten an Rändern
        const hydrantCount = 3;
        for (let i = 0; i < hydrantCount; i++) {
            for (let a = 0; a < attempts; a++) {
                const x = randInt(20, WIDTH - 40);
                const y = randInt(20, HEIGHT - 40);
                const h = { x, y, w: 18, h: 24 };
                let ok = true;
                for (const b of buildings) {
                    if (rectsOverlap(
                        { x: h.x - 10, y: h.y - 10, w: h.w + 20, h: h.h + 20 },
                        b
                    )) { ok = false; break; }
                }
                for (const other of hydrants) {
                    if (dist(h.x, h.y, other.x, other.y) < 120) { ok = false; break; }
                }
                if (ok) { hydrants.push(h); break; }
            }
        }

        // Spieler zurücksetzen
        player.x = WIDTH / 2;
        player.y = HEIGHT - 60;
        player.water = player.maxWater;

        // Initiale Brände
        const initialFires = Math.min(1 + Math.floor(lvl / 2), 3);
        for (let i = 0; i < initialFires; i++) spawnFire();

        spawnTimer = Math.max(180 - lvl * 10, 80);
        levelTimer = 0;
    }

    function spawnFire() {
        if (buildings.length === 0) return;
        const b = buildings[randInt(0, buildings.length - 1)];
        if (b.burned) return;
        // Prüfe, ob schon Feuer an diesem Gebäude ist
        for (const f of fires) if (f.building === b) return;
        const fire = {
            building: b,
            x: b.x + b.w / 2,
            y: b.y + b.h / 2,
            size: 18,
            maxSize: 32,
            intensity: 100,
            grow: 0.05 + level * 0.015,
            damage: 0.06 + level * 0.008,
            anim: 0,
        };
        fires.push(fire);
    }

    // ---- Update-Logik ----
    function update(dt) {
        if (state !== STATE.PLAYING) return;

        levelTimer++;

        // Spielerbewegung
        let dx = 0, dy = 0;
        if (keys['arrowleft'] || keys['a']) dx -= 1;
        if (keys['arrowright'] || keys['d']) dx += 1;
        if (keys['arrowup'] || keys['w']) dy -= 1;
        if (keys['arrowdown'] || keys['s']) dy += 1;

        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len; dy /= len;
            player.moving = true;
            player.animFrame += 0.2;
            if (Math.abs(dx) > Math.abs(dy)) {
                player.dir = dx > 0 ? 'right' : 'left';
            } else {
                player.dir = dy > 0 ? 'down' : 'up';
            }
        } else {
            player.moving = false;
            player.animFrame = 0;
        }

        const newX = clamp(player.x + dx * player.speed, player.w / 2, WIDTH - player.w / 2);
        const newY = clamp(player.y + dy * player.speed, player.h / 2, HEIGHT - player.h / 2);

        // Kollision mit Gebäuden
        const playerRect = { x: newX - player.w / 2, y: newY - player.h / 2, w: player.w, h: player.h };
        let blocked = false;
        for (const b of buildings) {
            if (!b.burned && rectsOverlap(playerRect, b)) { blocked = true; break; }
        }
        if (!blocked) {
            player.x = newX;
            player.y = newY;
        } else {
            // Versuche einzelne Achsen
            const rx = { x: newX - player.w / 2, y: player.y - player.h / 2, w: player.w, h: player.h };
            let ok = true;
            for (const b of buildings) if (!b.burned && rectsOverlap(rx, b)) { ok = false; break; }
            if (ok) player.x = newX;
            const ry = { x: player.x - player.w / 2, y: newY - player.h / 2, w: player.w, h: player.h };
            ok = true;
            for (const b of buildings) if (!b.burned && rectsOverlap(ry, b)) { ok = false; break; }
            if (ok) player.y = newY;
        }

        // Hydrant-Kollision
        for (const h of hydrants) {
            const hr = { x: h.x, y: h.y, w: h.w, h: h.h };
            if (rectsOverlap(playerRect, hr)) {
                if (player.water < player.maxWater) {
                    player.water = Math.min(player.maxWater, player.water + 2);
                    if (levelTimer % 6 === 0) {
                        particles.push({
                            x: h.x + h.w / 2, y: h.y,
                            vx: rand(-1, 1), vy: rand(-2, -0.5),
                            life: 30, color: '#4fc3f7', size: 3,
                        });
                    }
                }
            }
        }

        // Wasser spritzen
        if (player.cooldown > 0) player.cooldown--;
        if (keys[' '] && player.water >= player.waterUsePerShot && player.cooldown === 0) {
            player.water -= player.waterUsePerShot;
            player.cooldown = 4;
            let vx = 0, vy = 0;
            const speed = 6;
            if (player.dir === 'up') vy = -speed;
            else if (player.dir === 'down') vy = speed;
            else if (player.dir === 'left') vx = -speed;
            else vx = speed;
            // Start vor dem Spieler
            let sx = player.x, sy = player.y;
            if (player.dir === 'up') sy -= player.h / 2;
            else if (player.dir === 'down') sy += player.h / 2;
            else if (player.dir === 'left') sx -= player.w / 2;
            else sx += player.w / 2;
            waterDrops.push({
                x: sx, y: sy,
                vx: vx + rand(-0.5, 0.5),
                vy: vy + rand(-0.5, 0.5),
                life: 50, size: 4,
            });
            waterDrops.push({
                x: sx, y: sy,
                vx: vx * 0.8 + rand(-1, 1),
                vy: vy * 0.8 + rand(-1, 1),
                life: 40, size: 3,
            });
        }

        // Wassertropfen bewegen
        for (let i = waterDrops.length - 1; i >= 0; i--) {
            const d = waterDrops[i];
            d.x += d.vx;
            d.y += d.vy;
            d.life--;
            // Kollision mit Feuer
            let hit = false;
            for (const f of fires) {
                if (dist(d.x, d.y, f.x, f.y) < f.size + d.size) {
                    f.intensity -= 8;
                    // Sprüh-Partikel
                    for (let p = 0; p < 3; p++) {
                        particles.push({
                            x: d.x, y: d.y,
                            vx: rand(-2, 2), vy: rand(-3, -0.5),
                            life: 20, color: '#eeeeee', size: 2,
                        });
                    }
                    hit = true;
                    break;
                }
            }
            if (hit || d.life <= 0 || d.x < 0 || d.x > WIDTH || d.y < 0 || d.y > HEIGHT) {
                waterDrops.splice(i, 1);
            }
        }

        // Brände aktualisieren
        for (let i = fires.length - 1; i >= 0; i--) {
            const f = fires[i];
            f.anim += 0.1;
            // Feuer wächst
            if (f.size < f.maxSize) f.size += f.grow;
            // Gebäude nimmt Schaden
            f.building.health -= f.damage;
            if (f.building.health <= 0) {
                f.building.health = 0;
                f.building.burned = true;
                fires.splice(i, 1);
                lives--;
                livesEl.textContent = lives;
                floatingTexts.push({
                    x: f.building.x + f.building.w / 2,
                    y: f.building.y,
                    text: '-1 Leben',
                    color: '#ff5555',
                    life: 60,
                });
                // Explosion
                for (let p = 0; p < 20; p++) {
                    particles.push({
                        x: f.x, y: f.y,
                        vx: rand(-4, 4), vy: rand(-4, 4),
                        life: 40, color: p < 10 ? '#ff6600' : '#333333', size: 4,
                    });
                }
                if (lives <= 0) {
                    gameOver();
                    return;
                }
                continue;
            }
            // Wenn gelöscht
            if (f.intensity <= 0) {
                score += 10 * level;
                scoreEl.textContent = score;
                floatingTexts.push({
                    x: f.x, y: f.y - 10,
                    text: `+${10 * level}`,
                    color: '#ffd166',
                    life: 60,
                });
                // Dampf-Partikel
                for (let p = 0; p < 15; p++) {
                    particles.push({
                        x: f.x, y: f.y,
                        vx: rand(-1.5, 1.5), vy: rand(-2.5, -0.5),
                        life: 50, color: '#dddddd', size: 4,
                    });
                }
                fires.splice(i, 1);
            }
        }

        // Neue Brände spawnen
        spawnTimer--;
        if (spawnTimer <= 0) {
            const activeBuildings = buildings.filter(b => !b.burned);
            if (activeBuildings.length > fires.length) {
                spawnFire();
            }
            spawnTimer = Math.max(220 - level * 15, 90);
        }

        // Partikel aktualisieren
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.1;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
        }

        // Schwebetexte
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const t = floatingTexts[i];
            t.y -= 0.6;
            t.life--;
            if (t.life <= 0) floatingTexts.splice(i, 1);
        }

        // UI aktualisieren
        waterFillEl.style.width = `${(player.water / player.maxWater) * 100}%`;

        // Prüfe Level-Abschluss
        const activeBuildings = buildings.filter(b => !b.burned);
        if (activeBuildings.length === 0) {
            gameOver();
            return;
        }
        // Level geschafft, wenn lange gespielt & viele Brände gelöscht
        if (levelTimer > 60 * 45 && fires.length === 0) {
            levelDone();
        }
    }

    function levelDone() {
        state = STATE.LEVEL_DONE;
        score += 50 * level;
        scoreEl.textContent = score;
        overlayTitle.textContent = `Level ${level} geschafft!`;
        overlayMessage.textContent = `Bonus: +${50 * level} Punkte. Bereit für das nächste Level?`;
        startBtn.textContent = 'Nächstes Level';
        overlay.classList.remove('hidden');
    }

    function gameOver() {
        state = STATE.GAME_OVER;
        overlayTitle.textContent = 'Spiel vorbei';
        overlayMessage.textContent = `Endstand: ${score} Punkte in Level ${level}. Versuche es noch einmal!`;
        startBtn.textContent = 'Neustart';
        overlay.classList.remove('hidden');
    }

    // ---- Rendering ----
    function draw() {
        // Gras-Hintergrund
        ctx.fillStyle = '#3d6b1e';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        // Gras-Textur
        ctx.fillStyle = '#4a7a25';
        for (let i = 0; i < 200; i++) {
            const x = (i * 73 + 37) % WIDTH;
            const y = (i * 131 + 97) % HEIGHT;
            ctx.fillRect(x, y, 2, 2);
        }
        // Gehwege um Gebäude
        ctx.fillStyle = '#777';
        for (const b of buildings) {
            ctx.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
        }

        // Gebäude zeichnen
        for (const b of buildings) drawBuilding(b);

        // Hydranten zeichnen
        for (const h of hydrants) drawHydrant(h);

        // Feuer zeichnen
        for (const f of fires) drawFire(f);

        // Wassertropfen
        ctx.fillStyle = '#4fc3f7';
        for (const d of waterDrops) {
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fill();
        }

        // Spieler
        drawPlayer();

        // Partikel
        for (const p of particles) {
            ctx.globalAlpha = Math.max(0, p.life / 50);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;

        // Schwebetexte
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        for (const t of floatingTexts) {
            ctx.globalAlpha = Math.max(0, t.life / 60);
            ctx.fillStyle = '#000';
            ctx.fillText(t.text, t.x + 1, t.y + 1);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, t.x, t.y);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'start';
    }

    function drawBuilding(b) {
        if (b.burned) {
            // Ruine
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(b.x, b.y, b.w, b.h);
            ctx.strokeStyle = '#444';
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x, b.y, b.w, b.h);
            // Rauchende Trümmer
            ctx.fillStyle = '#333';
            for (let i = 0; i < 6; i++) {
                const x = b.x + (i * 17 + 5) % b.w;
                const y = b.y + (i * 23 + 7) % b.h;
                ctx.fillRect(x, y, 8, 8);
            }
            return;
        }
        // Körper
        const healthRatio = b.health / b.maxHealth;
        const r = Math.floor(160 + (1 - healthRatio) * 40);
        const g = Math.floor(100 * healthRatio);
        const bl = Math.floor(50 * healthRatio);
        ctx.fillStyle = `rgb(${r}, ${g + 70}, ${bl + 40})`;
        ctx.fillRect(b.x, b.y, b.w, b.h);

        // Dach
        ctx.fillStyle = '#8b3a1f';
        ctx.beginPath();
        ctx.moveTo(b.x - 5, b.y + 15);
        ctx.lineTo(b.x + b.w / 2, b.y - 10);
        ctx.lineTo(b.x + b.w + 5, b.y + 15);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#5a2410';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fenster
        ctx.fillStyle = healthRatio > 0.3 ? '#a8d8ea' : '#444';
        const winSize = 14;
        const cols = Math.floor(b.w / 25);
        const rows = Math.floor((b.h - 20) / 25);
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const wx = b.x + 8 + i * 25;
                const wy = b.y + 25 + j * 25;
                ctx.fillRect(wx, wy, winSize, winSize);
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 1;
                ctx.strokeRect(wx, wy, winSize, winSize);
            }
        }
        // Tür
        ctx.fillStyle = '#5a2410';
        ctx.fillRect(b.x + b.w / 2 - 8, b.y + b.h - 20, 16, 20);
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(b.x + b.w / 2 + 4, b.y + b.h - 12, 2, 2);

        // Umrandung
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.h);

        // Lebensleiste
        const barW = b.w;
        const barH = 5;
        ctx.fillStyle = '#000';
        ctx.fillRect(b.x, b.y - 8, barW, barH);
        ctx.fillStyle = healthRatio > 0.5 ? '#4caf50' : healthRatio > 0.25 ? '#ffc107' : '#f44336';
        ctx.fillRect(b.x, b.y - 8, barW * healthRatio, barH);
    }

    function drawHydrant(h) {
        // Sockel
        ctx.fillStyle = '#b71c1c';
        ctx.fillRect(h.x + 2, h.y + 4, h.w - 4, h.h - 6);
        // Oberer Knopf
        ctx.fillStyle = '#1565c0';
        ctx.fillRect(h.x, h.y, h.w, 6);
        // Seitenausgänge
        ctx.fillStyle = '#0d47a1';
        ctx.fillRect(h.x - 2, h.y + 10, 4, 6);
        ctx.fillRect(h.x + h.w - 2, h.y + 10, 4, 6);
        // Highlight
        ctx.fillStyle = '#ffeb3b';
        ctx.fillRect(h.x + h.w / 2 - 1, h.y + 2, 2, 2);
        // Umrandung
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(h.x, h.y, h.w, h.h);
    }

    function drawFire(f) {
        ctx.save();
        ctx.translate(f.x, f.y);
        const flicker = Math.sin(f.anim) * 2;
        const size = f.size + flicker;
        const intensityRatio = f.intensity / 100;

        // Äußere Flamme
        ctx.fillStyle = '#ff3300';
        ctx.beginPath();
        ctx.ellipse(0, 0, size, size * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Mittlere Flamme
        ctx.fillStyle = '#ff9900';
        ctx.beginPath();
        ctx.ellipse(0, 2, size * 0.7, size * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();

        // Innere Flamme
        ctx.fillStyle = '#ffdd00';
        ctx.beginPath();
        ctx.ellipse(0, 4, size * 0.4, size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Intensitätsbalken
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(f.x - 20, f.y - f.size - 12, 40, 4);
        ctx.fillStyle = '#ff3300';
        ctx.fillRect(f.x - 20, f.y - f.size - 12, 40 * intensityRatio, 4);
    }

    function drawPlayer() {
        const px = player.x;
        const py = player.y;
        const bob = player.moving ? Math.sin(player.animFrame) * 1.5 : 0;

        // Schatten
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(px, py + 18, 14, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Körper (rote Feuerwehrmann-Uniform)
        ctx.fillStyle = '#c62828';
        ctx.fillRect(px - 10, py - 5 + bob, 20, 18);

        // Gelbe Streifen
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(px - 10, py + bob, 20, 2);
        ctx.fillRect(px - 10, py + 8 + bob, 20, 2);

        // Beine
        ctx.fillStyle = '#1a1a1a';
        const legOffset = player.moving ? Math.sin(player.animFrame) * 2 : 0;
        ctx.fillRect(px - 8, py + 13 + bob, 6, 8 + legOffset);
        ctx.fillRect(px + 2, py + 13 + bob, 6, 8 - legOffset);

        // Kopf
        ctx.fillStyle = '#ffcc99';
        ctx.beginPath();
        ctx.arc(px, py - 12 + bob, 8, 0, Math.PI * 2);
        ctx.fill();

        // Helm (rot mit gelbem Rand)
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.arc(px, py - 14 + bob, 9, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(px - 10, py - 9 + bob, 20, 2);

        // Helm-Abzeichen
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(px, py - 15 + bob, 2, 0, Math.PI * 2);
        ctx.fill();

        // Augen
        ctx.fillStyle = '#000';
        if (player.dir === 'up') {
            ctx.fillRect(px - 4, py - 14 + bob, 2, 2);
            ctx.fillRect(px + 2, py - 14 + bob, 2, 2);
        } else if (player.dir === 'down') {
            ctx.fillRect(px - 4, py - 10 + bob, 2, 2);
            ctx.fillRect(px + 2, py - 10 + bob, 2, 2);
        } else if (player.dir === 'left') {
            ctx.fillRect(px - 5, py - 12 + bob, 2, 2);
            ctx.fillRect(px - 1, py - 12 + bob, 2, 2);
        } else {
            ctx.fillRect(px + 1, py - 12 + bob, 2, 2);
            ctx.fillRect(px + 4, py - 12 + bob, 2, 2);
        }

        // Schlauch je nach Richtung
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (player.dir === 'up') {
            ctx.moveTo(px, py - 5 + bob);
            ctx.lineTo(px, py - 22 + bob);
        } else if (player.dir === 'down') {
            ctx.moveTo(px, py + 5 + bob);
            ctx.lineTo(px, py + 22 + bob);
        } else if (player.dir === 'left') {
            ctx.moveTo(px - 5, py + 3 + bob);
            ctx.lineTo(px - 18, py + 3 + bob);
        } else {
            ctx.moveTo(px + 5, py + 3 + bob);
            ctx.lineTo(px + 18, py + 3 + bob);
        }
        ctx.stroke();
    }

    // ---- Hauptschleife ----
    let lastTime = 0;
    function loop(time) {
        const dt = (time - lastTime) / 16.67;
        lastTime = time;
        update(dt);
        draw();
        requestAnimationFrame(loop);
    }

    // ---- Spielstart ----
    function startGame() {
        if (state === STATE.GAME_OVER || state === STATE.MENU) {
            score = 0;
            lives = 3;
            level = 1;
        } else if (state === STATE.LEVEL_DONE) {
            level++;
        }
        scoreEl.textContent = score;
        livesEl.textContent = lives;
        levelEl.textContent = level;
        setupLevel(level);
        state = STATE.PLAYING;
        overlay.classList.add('hidden');
    }

    startBtn.addEventListener('click', startGame);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && state !== STATE.PLAYING) {
            startGame();
        }
    });

    requestAnimationFrame(loop);
})();
