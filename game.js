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
    let decorations = [];
    let roads = [];
    let groundPattern = [];

    // ---- Level aufbauen ----
    function setupLevel(lvl) {
        buildings = [];
        fires = [];
        hydrants = [];
        waterDrops = [];
        particles = [];
        floatingTexts = [];
        decorations = [];
        roads = [];
        groundPattern = [];

        // Straßen: ein horizontales und ein vertikales Band
        const roadH = { x: 0, y: randInt(220, 380), w: WIDTH, h: 50, horizontal: true };
        const roadV = { x: randInt(280, 520), y: 0, w: 50, h: HEIGHT, horizontal: false };
        roads.push(roadH, roadV);

        // Gras-Muster (einmalig vorgeneriert)
        for (let i = 0; i < 400; i++) {
            groundPattern.push({
                x: rand(0, WIDTH),
                y: rand(0, HEIGHT),
                shade: randInt(0, 2),
                type: Math.random() < 0.8 ? 'grass' : 'flower',
            });
        }

        // Gebäude platzieren
        const buildingCount = Math.min(3 + lvl, 7);
        const attempts = 60;
        for (let i = 0; i < buildingCount; i++) {
            for (let a = 0; a < attempts; a++) {
                const w = randInt(80, 120);
                const h = randInt(80, 120);
                const x = randInt(40, WIDTH - w - 40);
                const y = randInt(60, HEIGHT - h - 60);
                const b = {
                    x, y, w, h,
                    health: 100, maxHealth: 100, burned: false,
                    type: randInt(0, 2), // 0=Haus, 1=Wohnblock, 2=Laden
                    seed: randInt(0, 9999),
                };
                let ok = true;
                for (const other of buildings) {
                    if (rectsOverlap(
                        { x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 },
                        other
                    )) { ok = false; break; }
                }
                // Nicht auf Straßen
                for (const r of roads) {
                    if (rectsOverlap(b, { x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 })) {
                        ok = false; break;
                    }
                }
                // nicht auf Spieler
                if (rectsOverlap(b, { x: player.x - 40, y: player.y - 40, w: 80, h: 80 })) ok = false;
                if (ok) { buildings.push(b); break; }
            }
        }

        // Hydranten am Straßenrand
        const hydrantCount = 3;
        for (let i = 0; i < hydrantCount; i++) {
            for (let a = 0; a < attempts; a++) {
                const x = randInt(20, WIDTH - 40);
                const y = randInt(20, HEIGHT - 40);
                const h = { x, y, w: 14, h: 20 };
                let ok = true;
                for (const b of buildings) {
                    if (rectsOverlap(
                        { x: h.x - 10, y: h.y - 10, w: h.w + 20, h: h.h + 20 },
                        b
                    )) { ok = false; break; }
                }
                for (const r of roads) {
                    if (rectsOverlap(
                        { x: h.x, y: h.y, w: h.w, h: h.h },
                        r
                    )) { ok = false; break; }
                }
                for (const other of hydrants) {
                    if (dist(h.x, h.y, other.x, other.y) < 120) { ok = false; break; }
                }
                if (ok) { hydrants.push(h); break; }
            }
        }

        // Dekorationen (Bäume, Büsche, Steine)
        const decoCount = 20;
        for (let i = 0; i < decoCount; i++) {
            for (let a = 0; a < attempts; a++) {
                const x = randInt(15, WIDTH - 30);
                const y = randInt(15, HEIGHT - 30);
                const r = Math.random();
                const type = r < 0.5 ? 'tree' : r < 0.8 ? 'bush' : 'rock';
                const size = type === 'tree' ? rand(14, 20) : type === 'bush' ? rand(8, 14) : rand(5, 9);
                const d = { x, y, type, size, seed: randInt(0, 9999) };
                let ok = true;
                for (const b of buildings) {
                    if (rectsOverlap({ x: d.x - size, y: d.y - size, w: size * 2, h: size * 2 }, b)) { ok = false; break; }
                }
                for (const rd of roads) {
                    if (rectsOverlap({ x: d.x - size, y: d.y - size, w: size * 2, h: size * 2 }, rd)) { ok = false; break; }
                }
                for (const hy of hydrants) {
                    if (dist(d.x, d.y, hy.x + hy.w / 2, hy.y + hy.h / 2) < 28) { ok = false; break; }
                }
                for (const o of decorations) {
                    if (dist(d.x, d.y, o.x, o.y) < Math.max(20, size + o.size)) { ok = false; break; }
                }
                if (dist(d.x, d.y, player.x, player.y) < 40) ok = false;
                if (ok) { decorations.push(d); break; }
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
            const speed = 7;
            if (player.dir === 'up') vy = -speed;
            else if (player.dir === 'down') vy = speed;
            else if (player.dir === 'left') vx = -speed;
            else vx = speed;
            // Start an der Düsen-Spitze
            let sx = player.x, sy = player.y + 4;
            if (player.dir === 'up') { sx = player.x; sy = player.y - 22; }
            else if (player.dir === 'down') { sx = player.x + 5; sy = player.y + 22; }
            else if (player.dir === 'left') { sx = player.x - 20; sy = player.y + 4; }
            else { sx = player.x + 20; sy = player.y + 4; }
            // Mehrere Tropfen mit Streuung für Spray-Effekt
            for (let i = 0; i < 3; i++) {
                const spread = 0.8;
                waterDrops.push({
                    x: sx + rand(-1, 1),
                    y: sy + rand(-1, 1),
                    vx: vx + rand(-spread, spread),
                    vy: vy + rand(-spread, spread),
                    life: 45 + randInt(0, 10),
                    size: rand(2.5, 4),
                });
            }
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
            // Kontinuierlicher Rauch
            if (levelTimer % 3 === 0) {
                particles.push({
                    x: f.x + rand(-f.size / 3, f.size / 3),
                    y: f.y - f.size * 0.6,
                    vx: rand(-0.3, 0.3),
                    vy: rand(-1.6, -0.8),
                    life: 80,
                    maxLife: 80,
                    type: 'smoke',
                    size: rand(5, 10),
                });
            }
            // Gelegentliche Glut
            if (levelTimer % 8 === 0) {
                particles.push({
                    x: f.x + rand(-f.size / 2, f.size / 2),
                    y: f.y,
                    vx: rand(-0.8, 0.8),
                    vy: rand(-2.5, -1),
                    life: 40,
                    maxLife: 40,
                    type: 'ember',
                    size: rand(1.5, 3),
                });
            }
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
        // Gras-Hintergrund (mehrere Schattierungen)
        const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
        grad.addColorStop(0, '#3e6b1e');
        grad.addColorStop(1, '#345817');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);

        // Gras-Textur (vorgeneriert)
        const shades = ['#4a7a25', '#2d5016', '#578b2d'];
        for (const p of groundPattern) {
            if (p.type === 'grass') {
                ctx.fillStyle = shades[p.shade];
                ctx.fillRect(p.x, p.y, 2, 3);
            } else {
                // Blume
                ctx.fillStyle = ['#ffeb3b', '#ffffff', '#e91e63'][p.shade];
                ctx.fillRect(p.x, p.y, 2, 2);
                ctx.fillRect(p.x - 1, p.y + 1, 1, 1);
                ctx.fillRect(p.x + 2, p.y + 1, 1, 1);
            }
        }

        // Straßen zeichnen
        for (const r of roads) drawRoad(r);

        // Gehwege um Gebäude
        for (const b of buildings) {
            ctx.fillStyle = '#9e9e9e';
            ctx.fillRect(b.x - 6, b.y - 6, b.w + 12, b.h + 12);
            // Fugen
            ctx.strokeStyle = '#757575';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 1; i < 4; i++) {
                const fx = b.x - 6 + (b.w + 12) * (i / 4);
                ctx.moveTo(fx, b.y - 6);
                ctx.lineTo(fx, b.y + b.h + 6);
            }
            ctx.stroke();
        }

        // Dekorationen (Schatten zuerst)
        for (const d of decorations) drawDecorationShadow(d);

        // Gebäude-Schatten
        for (const b of buildings) {
            if (!b.burned) {
                ctx.fillStyle = 'rgba(0,0,0,0.35)';
                ctx.beginPath();
                ctx.ellipse(b.x + b.w / 2 + 8, b.y + b.h + 4, b.w / 2 + 4, 8, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Gebäude zeichnen
        for (const b of buildings) drawBuilding(b);

        // Dekorationen zeichnen
        for (const d of decorations) drawDecoration(d);

        // Hydranten zeichnen
        for (const h of hydrants) drawHydrant(h);

        // Feuer-Glut (Boden-Glow unter Feuer)
        for (const f of fires) drawFireGlow(f);

        // Feuer zeichnen
        for (const f of fires) drawFire(f);

        // Wasserstrahl
        for (const d of waterDrops) {
            const a = clamp(d.life / 50, 0, 1);
            ctx.globalAlpha = a;
            const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.size * 2);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.4, '#81d4fa');
            g.addColorStop(1, 'rgba(79,195,247,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size * 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Spieler
        drawPlayer();

        // Partikel (Rauch, Glut, Sonstige)
        for (const p of particles) {
            if (p.type === 'smoke') {
                const life = p.life / p.maxLife;
                ctx.globalAlpha = life * 0.55;
                const r = p.size * (2 - life);
                const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                g.addColorStop(0, '#555555');
                g.addColorStop(1, 'rgba(60,60,60,0)');
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'ember') {
                const life = p.life / p.maxLife;
                ctx.globalAlpha = life;
                ctx.fillStyle = life > 0.5 ? '#ffeb3b' : '#ff5722';
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.globalAlpha = Math.max(0, p.life / 50);
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            }
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

    function drawRoad(r) {
        // Asphalt-Untergrund
        const g = r.horizontal
            ? ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
            : ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
        g.addColorStop(0, '#2e2e2e');
        g.addColorStop(0.5, '#3a3a3a');
        g.addColorStop(1, '#2e2e2e');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);

        // Randsteine
        ctx.fillStyle = '#d0d0d0';
        if (r.horizontal) {
            ctx.fillRect(r.x, r.y - 2, r.w, 2);
            ctx.fillRect(r.x, r.y + r.h, r.w, 2);
        } else {
            ctx.fillRect(r.x - 2, r.y, 2, r.h);
            ctx.fillRect(r.x + r.w, r.y, 2, r.h);
        }

        // Mittelstreifen (gestrichelt)
        ctx.fillStyle = '#ffd95a';
        if (r.horizontal) {
            const cy = r.y + r.h / 2 - 1;
            for (let x = r.x + 10; x < r.x + r.w; x += 30) {
                ctx.fillRect(x, cy, 16, 2);
            }
        } else {
            const cx = r.x + r.w / 2 - 1;
            for (let y = r.y + 10; y < r.y + r.h; y += 30) {
                ctx.fillRect(cx, y, 2, 16);
            }
        }
    }

    function drawDecorationShadow(d) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        const r = d.type === 'tree' ? d.size * 0.9 : d.size * 0.8;
        ctx.ellipse(d.x + 2, d.y + d.size * 0.4, r, r * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    function drawDecoration(d) {
        if (d.type === 'tree') {
            // Stamm
            ctx.fillStyle = '#5a3a1e';
            ctx.fillRect(d.x - 2, d.y, 4, d.size * 0.4);
            ctx.strokeStyle = '#3a2510';
            ctx.lineWidth = 1;
            ctx.strokeRect(d.x - 2, d.y, 4, d.size * 0.4);
            // Krone (mehrere Kreise)
            ctx.fillStyle = '#2e7d32';
            ctx.beginPath();
            ctx.arc(d.x, d.y - d.size * 0.3, d.size * 0.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#388e3c';
            ctx.beginPath();
            ctx.arc(d.x - d.size * 0.3, d.y - d.size * 0.5, d.size * 0.55, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(d.x + d.size * 0.35, d.y - d.size * 0.4, d.size * 0.5, 0, Math.PI * 2);
            ctx.fill();
            // Highlight
            ctx.fillStyle = '#66bb6a';
            ctx.beginPath();
            ctx.arc(d.x - d.size * 0.2, d.y - d.size * 0.6, d.size * 0.2, 0, Math.PI * 2);
            ctx.fill();
        } else if (d.type === 'bush') {
            ctx.fillStyle = '#2e7d32';
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#43a047';
            ctx.beginPath();
            ctx.arc(d.x - d.size * 0.3, d.y - d.size * 0.2, d.size * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(d.x + d.size * 0.3, d.y - d.size * 0.1, d.size * 0.55, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Stein
            ctx.fillStyle = '#6e6e6e';
            ctx.beginPath();
            ctx.ellipse(d.x, d.y, d.size, d.size * 0.7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#9e9e9e';
            ctx.beginPath();
            ctx.ellipse(d.x - d.size * 0.3, d.y - d.size * 0.3, d.size * 0.35, d.size * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawBuilding(b) {
        if (b.burned) {
            // Ruine mit Fundament
            ctx.fillStyle = '#4a3a2a';
            ctx.fillRect(b.x, b.y + b.h * 0.2, b.w, b.h * 0.8);
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(b.x + 4, b.y + b.h * 0.3, b.w - 8, b.h * 0.6);
            // Trümmer
            ctx.fillStyle = '#2a2a2a';
            for (let i = 0; i < 10; i++) {
                const x = b.x + ((b.seed + i * 17) % b.w);
                const y = b.y + b.h * 0.3 + ((b.seed + i * 29) % (b.h * 0.5));
                const s = 4 + ((b.seed + i * 7) % 6);
                ctx.fillRect(x, y, s, s);
            }
            // Gebrochene Wände
            ctx.strokeStyle = '#3a3a3a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(b.x, b.y + b.h * 0.3);
            ctx.lineTo(b.x + b.w * 0.15, b.y + b.h * 0.15);
            ctx.lineTo(b.x + b.w * 0.3, b.y + b.h * 0.35);
            ctx.lineTo(b.x + b.w * 0.5, b.y + b.h * 0.2);
            ctx.lineTo(b.x + b.w * 0.7, b.y + b.h * 0.4);
            ctx.lineTo(b.x + b.w * 0.85, b.y + b.h * 0.2);
            ctx.lineTo(b.x + b.w, b.y + b.h * 0.3);
            ctx.stroke();
            // Dauerhafter Rauch
            if (Math.random() < 0.3) {
                particles.push({
                    x: b.x + rand(b.w * 0.2, b.w * 0.8),
                    y: b.y + b.h * 0.3,
                    vx: rand(-0.2, 0.2),
                    vy: rand(-1, -0.4),
                    life: 60, maxLife: 60, type: 'smoke', size: rand(4, 7),
                });
            }
            return;
        }

        const healthRatio = b.health / b.maxHealth;
        const type = b.type;

        if (type === 0) {
            drawHouse(b, healthRatio);
        } else if (type === 1) {
            drawApartment(b, healthRatio);
        } else {
            drawShop(b, healthRatio);
        }

        // Lebensleiste (nur wenn beschädigt)
        if (healthRatio < 1) {
            const barW = b.w;
            const barH = 5;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(b.x, b.y - 10, barW, barH);
            ctx.fillStyle = healthRatio > 0.5 ? '#4caf50' : healthRatio > 0.25 ? '#ffc107' : '#f44336';
            ctx.fillRect(b.x + 1, b.y - 9, (barW - 2) * healthRatio, barH - 2);
        }
    }

    // Dunkelt Farbe ab (für Brandschäden)
    function darken(hex, ratio) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgb(${Math.floor(r * ratio)}, ${Math.floor(g * ratio)}, ${Math.floor(b * ratio)})`;
    }

    function drawWindows(b, rows, cols, lit, baseY) {
        const startY = b.y + baseY;
        const areaH = b.h - baseY - 12;
        const wSize = Math.min(14, (b.w - 16) / cols - 4);
        const spacingX = (b.w - 16) / cols;
        const spacingY = areaH / rows;
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < rows; j++) {
                const wx = b.x + 8 + i * spacingX + (spacingX - wSize) / 2;
                const wy = startY + j * spacingY + (spacingY - wSize) / 2;
                // Rahmen
                ctx.fillStyle = '#f5f5f5';
                ctx.fillRect(wx - 1, wy - 1, wSize + 2, wSize + 2);
                // Glas mit Farbverlauf
                const g = ctx.createLinearGradient(wx, wy, wx + wSize, wy + wSize);
                if (lit) {
                    g.addColorStop(0, '#b3e5fc');
                    g.addColorStop(0.5, '#81d4fa');
                    g.addColorStop(1, '#4fc3f7');
                } else {
                    g.addColorStop(0, '#37474f');
                    g.addColorStop(1, '#1c2429');
                }
                ctx.fillStyle = g;
                ctx.fillRect(wx, wy, wSize, wSize);
                // Fensterkreuz
                ctx.strokeStyle = '#f5f5f5';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(wx + wSize / 2, wy);
                ctx.lineTo(wx + wSize / 2, wy + wSize);
                ctx.moveTo(wx, wy + wSize / 2);
                ctx.lineTo(wx + wSize, wy + wSize / 2);
                ctx.stroke();
            }
        }
    }

    function drawHouse(b, healthRatio) {
        // Wandfarbe abhängig vom Gebäude
        const colors = ['#e0c9a6', '#d4b896', '#c9a77d', '#e8dcc4'];
        const wallColor = colors[b.seed % colors.length];
        const damaged = healthRatio < 0.7;

        // Körper mit Gradient
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
        g.addColorStop(0, darken(wallColor, 0.85));
        g.addColorStop(0.5, wallColor);
        g.addColorStop(1, darken(wallColor, 0.8));
        ctx.fillStyle = damaged ? darken(wallColor, 0.5 + healthRatio * 0.5) : g;
        ctx.fillRect(b.x, b.y + 12, b.w, b.h - 12);

        // Fachwerk-Linien
        ctx.strokeStyle = darken(wallColor, 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y + 12);
        ctx.lineTo(b.x + b.w, b.y + 12);
        ctx.moveTo(b.x, b.y + b.h - 2);
        ctx.lineTo(b.x + b.w, b.y + b.h - 2);
        ctx.stroke();

        // Giebeldach
        const roofColor = '#8b3a1f';
        ctx.fillStyle = roofColor;
        ctx.beginPath();
        ctx.moveTo(b.x - 8, b.y + 18);
        ctx.lineTo(b.x + b.w / 2, b.y - 8);
        ctx.lineTo(b.x + b.w + 8, b.y + 18);
        ctx.closePath();
        ctx.fill();
        // Dachziegel-Textur
        ctx.strokeStyle = darken(roofColor, 0.6);
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            const y = b.y - 4 + i * 6;
            ctx.beginPath();
            ctx.moveTo(b.x - 8 + (18 - (18 - (y - (b.y - 8)) * 0.5)), y);
            ctx.lineTo(b.x + b.w + 8 - (18 - (18 - (y - (b.y - 8)) * 0.5)), y);
            ctx.stroke();
        }
        ctx.strokeStyle = '#4a2010';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - 8, b.y + 18);
        ctx.lineTo(b.x + b.w / 2, b.y - 8);
        ctx.lineTo(b.x + b.w + 8, b.y + 18);
        ctx.stroke();

        // Schornstein
        ctx.fillStyle = '#8d6e63';
        ctx.fillRect(b.x + b.w * 0.7, b.y - 4, 8, 12);
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(b.x + b.w * 0.7 - 1, b.y - 6, 10, 3);

        // Fenster
        const rows = Math.max(1, Math.floor((b.h - 40) / 28));
        const cols = Math.max(1, Math.floor(b.w / 30));
        drawWindows(b, rows, cols, healthRatio > 0.4, 22);

        // Tür
        const doorW = 14;
        const doorH = 22;
        const doorX = b.x + b.w / 2 - doorW / 2;
        const doorY = b.y + b.h - doorH - 2;
        ctx.fillStyle = '#5a2410';
        ctx.fillRect(doorX, doorY, doorW, doorH);
        ctx.strokeStyle = '#3a1508';
        ctx.lineWidth = 1;
        ctx.strokeRect(doorX, doorY, doorW, doorH);
        // Türgriff
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(doorX + doorW - 3, doorY + doorH / 2, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // Umrandung
        ctx.strokeStyle = darken(wallColor, 0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x, b.y + 12, b.w, b.h - 12);
    }

    function drawApartment(b, healthRatio) {
        const colors = ['#b0bec5', '#90a4ae', '#cfd8dc', '#78909c'];
        const wallColor = colors[b.seed % colors.length];

        // Körper
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
        g.addColorStop(0, darken(wallColor, 0.8));
        g.addColorStop(0.5, wallColor);
        g.addColorStop(1, darken(wallColor, 0.75));
        ctx.fillStyle = healthRatio < 0.6 ? darken(wallColor, 0.4 + healthRatio * 0.6) : g;
        ctx.fillRect(b.x, b.y + 6, b.w, b.h - 6);

        // Flachdach
        ctx.fillStyle = '#424242';
        ctx.fillRect(b.x - 3, b.y, b.w + 6, 8);
        ctx.fillStyle = '#616161';
        ctx.fillRect(b.x - 3, b.y, b.w + 6, 3);

        // Antenne
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(b.x + b.w * 0.2, b.y);
        ctx.lineTo(b.x + b.w * 0.2, b.y - 10);
        ctx.moveTo(b.x + b.w * 0.2 - 4, b.y - 7);
        ctx.lineTo(b.x + b.w * 0.2 + 4, b.y - 7);
        ctx.stroke();

        // Viele kleine Fenster (Wohnungen)
        const rows = Math.max(2, Math.floor((b.h - 20) / 22));
        const cols = Math.max(2, Math.floor(b.w / 22));
        drawWindows(b, rows, cols, healthRatio > 0.4, 14);

        // Eingang mit Stufen
        const doorW = 18;
        const doorH = 20;
        const doorX = b.x + b.w / 2 - doorW / 2;
        const doorY = b.y + b.h - doorH - 2;
        ctx.fillStyle = '#37474f';
        ctx.fillRect(doorX - 2, doorY + doorH - 4, doorW + 4, 4);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(doorX, doorY, doorW, doorH - 2);
        // Glastür-Effekt
        ctx.fillStyle = '#4fc3f7';
        ctx.fillRect(doorX + 1, doorY + 2, doorW - 2, doorH - 6);
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(doorX + doorW / 2, doorY + 2);
        ctx.lineTo(doorX + doorW / 2, doorY + doorH - 4);
        ctx.stroke();

        // Umrandung
        ctx.strokeStyle = darken(wallColor, 0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x, b.y + 6, b.w, b.h - 6);
    }

    function drawShop(b, healthRatio) {
        const colors = ['#ffcdd2', '#f8bbd0', '#fff59d', '#c8e6c9'];
        const wallColor = colors[b.seed % colors.length];

        // Körper
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y);
        g.addColorStop(0, darken(wallColor, 0.85));
        g.addColorStop(0.5, wallColor);
        g.addColorStop(1, darken(wallColor, 0.8));
        ctx.fillStyle = healthRatio < 0.6 ? darken(wallColor, 0.4 + healthRatio * 0.6) : g;
        ctx.fillRect(b.x, b.y + 14, b.w, b.h - 14);

        // Flachdach mit Markise
        ctx.fillStyle = '#455a64';
        ctx.fillRect(b.x - 3, b.y + 10, b.w + 6, 6);
        // Gestreifte Markise
        const stripes = ['#c62828', '#f5f5f5'];
        const stripW = 10;
        const mY = b.y + 16;
        for (let i = 0; i < b.w / stripW; i++) {
            ctx.fillStyle = stripes[i % 2];
            ctx.fillRect(b.x + i * stripW, mY, stripW, 6);
        }
        // Markisen-Kante
        ctx.fillStyle = '#8d6e63';
        ctx.beginPath();
        for (let i = 0; i < b.w / 8; i++) {
            ctx.moveTo(b.x + i * 8, mY + 6);
            ctx.lineTo(b.x + i * 8 + 4, mY + 10);
            ctx.lineTo(b.x + i * 8 + 8, mY + 6);
        }
        ctx.fill();

        // Namensschild
        ctx.fillStyle = '#37474f';
        ctx.fillRect(b.x + 4, b.y + 2, b.w - 8, 10);
        ctx.fillStyle = '#ffd166';
        ctx.font = 'bold 8px Arial';
        ctx.textAlign = 'center';
        const names = ['MARKT', 'CAFÉ', 'BÄCKER', 'LADEN', 'SHOP'];
        ctx.fillText(names[b.seed % names.length], b.x + b.w / 2, b.y + 10);
        ctx.textAlign = 'start';

        // Großes Schaufenster unten
        const swX = b.x + 8;
        const swY = b.y + 30;
        const swW = b.w - 16;
        const swH = b.h - 52;
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(swX - 2, swY - 2, swW + 4, swH + 4);
        const wg = ctx.createLinearGradient(swX, swY, swX + swW, swY + swH);
        wg.addColorStop(0, '#b3e5fc');
        wg.addColorStop(0.5, '#81d4fa');
        wg.addColorStop(1, '#4fc3f7');
        ctx.fillStyle = healthRatio > 0.4 ? wg : '#37474f';
        ctx.fillRect(swX, swY, swW, swH);
        // Reflektionen
        if (healthRatio > 0.4) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.beginPath();
            ctx.moveTo(swX + 4, swY + 4);
            ctx.lineTo(swX + 12, swY + 4);
            ctx.lineTo(swX + 20, swY + swH - 4);
            ctx.lineTo(swX + 12, swY + swH - 4);
            ctx.closePath();
            ctx.fill();
        }

        // Tür
        const doorW = 14;
        const doorH = 20;
        const doorX = b.x + b.w / 2 - doorW / 2;
        const doorY = b.y + b.h - doorH - 2;
        ctx.fillStyle = '#4a2810';
        ctx.fillRect(doorX, doorY, doorW, doorH);
        ctx.fillStyle = '#81d4fa';
        ctx.fillRect(doorX + 2, doorY + 2, doorW - 4, doorH - 8);
        ctx.strokeStyle = '#2a1408';
        ctx.strokeRect(doorX, doorY, doorW, doorH);

        // Umrandung
        ctx.strokeStyle = darken(wallColor, 0.4);
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x, b.y + 14, b.w, b.h - 14);
    }

    function drawHydrant(h) {
        const cx = h.x + h.w / 2;
        // Schatten
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(cx + 2, h.y + h.h + 1, h.w * 0.7, 3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Bodenplatte
        ctx.fillStyle = '#424242';
        ctx.fillRect(h.x - 2, h.y + h.h - 3, h.w + 4, 3);

        // Hauptkörper (Zylinder mit Gradient)
        const g = ctx.createLinearGradient(h.x, 0, h.x + h.w, 0);
        g.addColorStop(0, '#8b0000');
        g.addColorStop(0.4, '#d32f2f');
        g.addColorStop(0.6, '#f44336');
        g.addColorStop(1, '#7f0000');
        ctx.fillStyle = g;
        ctx.fillRect(h.x + 1, h.y + 5, h.w - 2, h.h - 8);

        // Ringe am Körper
        ctx.fillStyle = '#4a0000';
        ctx.fillRect(h.x + 1, h.y + 8, h.w - 2, 1);
        ctx.fillRect(h.x + 1, h.y + h.h - 6, h.w - 2, 1);

        // Seiten-Ausgänge (Nozzles)
        ctx.fillStyle = '#b71c1c';
        ctx.fillRect(h.x - 3, h.y + 10, 3, 5);
        ctx.fillRect(h.x + h.w, h.y + 10, 3, 5);
        // Kappen auf Nozzles
        ctx.fillStyle = '#757575';
        ctx.fillRect(h.x - 4, h.y + 10, 1, 5);
        ctx.fillRect(h.x + h.w + 3, h.y + 10, 1, 5);

        // Kuppel (Bonnet)
        ctx.fillStyle = '#d32f2f';
        ctx.beginPath();
        ctx.arc(cx, h.y + 5, h.w / 2, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#f44336';
        ctx.beginPath();
        ctx.arc(cx - 1, h.y + 5, h.w / 2 - 2, Math.PI, 0);
        ctx.fill();

        // Betriebsmutter (Pentagon oben)
        ctx.fillStyle = '#424242';
        ctx.beginPath();
        ctx.arc(cx, h.y + 3, 2, 0, Math.PI * 2);
        ctx.fill();

        // Highlight (3D-Effekt)
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(h.x + 2, h.y + 6, 1, h.h - 10);

        // Umrandung
        ctx.strokeStyle = '#3a0000';
        ctx.lineWidth = 1;
        ctx.strokeRect(h.x + 1, h.y + 5, h.w - 2, h.h - 8);
    }

    function drawFireGlow(f) {
        const glowR = f.size * 2.5;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowR);
        g.addColorStop(0, 'rgba(255,150,0,0.35)');
        g.addColorStop(0.5, 'rgba(255,80,0,0.18)');
        g.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, glowR, 0, Math.PI * 2);
        ctx.fill();
    }

    function flameShape(cx, cy, w, h, phase, color) {
        const f1 = Math.sin(phase) * 0.15;
        const f2 = Math.cos(phase * 1.3) * 0.15;
        const f3 = Math.sin(phase * 0.7) * 0.1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx, cy + h);
        ctx.bezierCurveTo(
            cx - w * (1 + f1), cy + h * 0.6,
            cx - w * (0.8 + f2), cy - h * 0.2,
            cx + w * f3, cy - h
        );
        ctx.bezierCurveTo(
            cx + w * (0.8 + f1), cy - h * 0.2,
            cx + w * (1 + f2), cy + h * 0.6,
            cx, cy + h
        );
        ctx.closePath();
        ctx.fill();
    }

    function drawFire(f) {
        const intensityRatio = f.intensity / 100;
        const flicker = Math.sin(f.anim) * 2 + Math.sin(f.anim * 2.3) * 1.2;
        const size = f.size + flicker;

        ctx.save();
        // Äußere Flamme (dunkelrot)
        flameShape(f.x, f.y + size * 0.4, size * 1.1, size * 1.6, f.anim, '#b71c1c');
        // Rote Flamme
        flameShape(f.x, f.y + size * 0.3, size * 0.9, size * 1.4, f.anim * 1.2, '#f44336');
        // Orange Flamme
        flameShape(f.x, f.y + size * 0.2, size * 0.7, size * 1.1, f.anim * 1.5, '#ff9800');
        // Gelbe Flamme (Kern)
        flameShape(f.x, f.y + size * 0.1, size * 0.45, size * 0.8, f.anim * 1.8, '#ffeb3b');
        // Weißer Kern
        flameShape(f.x, f.y, size * 0.2, size * 0.5, f.anim * 2.2, '#ffffff');
        ctx.restore();

        // Glüher unter der Flamme
        ctx.fillStyle = 'rgba(255,100,0,0.6)';
        ctx.beginPath();
        ctx.ellipse(f.x, f.y + size * 0.9, size * 0.8, size * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();

        // Intensitätsbalken
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(f.x - 20, f.y - f.size - 18, 40, 5);
        const barG = ctx.createLinearGradient(f.x - 20, 0, f.x + 20, 0);
        barG.addColorStop(0, '#ff3300');
        barG.addColorStop(1, '#ffeb3b');
        ctx.fillStyle = barG;
        ctx.fillRect(f.x - 19, f.y - f.size - 17, 38 * intensityRatio, 3);
    }

    function drawPlayer() {
        const px = player.x;
        const py = player.y;
        const bob = player.moving ? Math.sin(player.animFrame) * 1.2 : 0;
        const legSwing = player.moving ? Math.sin(player.animFrame) * 2.5 : 0;

        // Schatten
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.ellipse(px, py + 20, 13, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // Stiefel
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(px - 9, py + 18 + bob, 7, 4);
        ctx.fillRect(px + 2, py + 18 + bob, 7, 4);
        // Stiefel-Glanz
        ctx.fillStyle = '#424242';
        ctx.fillRect(px - 8, py + 19 + bob, 5, 1);
        ctx.fillRect(px + 3, py + 19 + bob, 5, 1);

        // Hosen (dunkelblau)
        ctx.fillStyle = '#212121';
        ctx.fillRect(px - 9, py + 10 + bob, 7, 8 + legSwing);
        ctx.fillRect(px + 2, py + 10 + bob, 7, 8 - legSwing);
        // Reflektierende Streifen an den Hosen
        ctx.fillStyle = '#ffeb3b';
        ctx.fillRect(px - 9, py + 15 + bob, 7, 1);
        ctx.fillRect(px + 2, py + 15 + bob, 7, 1);

        // Jacke (rot mit Gradient)
        const jg = ctx.createLinearGradient(px - 11, 0, px + 11, 0);
        jg.addColorStop(0, '#8b0000');
        jg.addColorStop(0.5, '#d32f2f');
        jg.addColorStop(1, '#8b0000');
        ctx.fillStyle = jg;
        ctx.fillRect(px - 11, py - 4 + bob, 22, 15);

        // Reflektierende gelbe Streifen
        ctx.fillStyle = '#ffeb3b';
        ctx.fillRect(px - 11, py + 1 + bob, 22, 1.5);
        ctx.fillRect(px - 11, py + 6 + bob, 22, 1.5);
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(px - 11, py + 2 + bob, 22, 0.5);
        ctx.fillRect(px - 11, py + 7 + bob, 22, 0.5);

        // Kragen
        ctx.fillStyle = '#5d0000';
        ctx.fillRect(px - 5, py - 4 + bob, 10, 3);

        // Arme
        ctx.fillStyle = '#c62828';
        ctx.fillRect(px - 13, py - 2 + bob, 3, 11);
        ctx.fillRect(px + 10, py - 2 + bob, 3, 11);
        // Gelbe Streifen an Armen
        ctx.fillStyle = '#ffeb3b';
        ctx.fillRect(px - 13, py + 4 + bob, 3, 1);
        ctx.fillRect(px + 10, py + 4 + bob, 3, 1);

        // Hände
        ctx.fillStyle = '#ffdbac';
        ctx.fillRect(px - 13, py + 9 + bob, 3, 3);
        ctx.fillRect(px + 10, py + 9 + bob, 3, 3);

        // Kopf
        ctx.fillStyle = '#ffdbac';
        ctx.beginPath();
        ctx.arc(px, py - 10 + bob, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#d4a574';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Helm - Unterteil (Rand)
        ctx.fillStyle = '#424242';
        ctx.beginPath();
        ctx.ellipse(px, py - 10 + bob, 9, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Helm - Kuppel
        const hg = ctx.createRadialGradient(px - 2, py - 16 + bob, 1, px, py - 14 + bob, 8);
        hg.addColorStop(0, '#ff5252');
        hg.addColorStop(0.6, '#d32f2f');
        hg.addColorStop(1, '#8b0000');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(px, py - 13 + bob, 8, Math.PI, 0);
        ctx.fill();

        // Helm-Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.ellipse(px - 3, py - 16 + bob, 2.5, 1.5, -0.3, 0, Math.PI * 2);
        ctx.fill();

        // Helm-Abzeichen (vorne)
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.moveTo(px - 3, py - 11 + bob);
        ctx.lineTo(px, py - 14 + bob);
        ctx.lineTo(px + 3, py - 11 + bob);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b8860b';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Helmrand (Krempe)
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py - 13 + bob, 8, Math.PI, 0);
        ctx.stroke();

        // Visier (transparent)
        ctx.fillStyle = 'rgba(100,200,255,0.4)';
        ctx.fillRect(px - 6, py - 11 + bob, 12, 3);

        // Augen
        ctx.fillStyle = '#000';
        if (player.dir === 'up') {
            ctx.fillRect(px - 3, py - 11 + bob, 1.5, 1);
            ctx.fillRect(px + 1.5, py - 11 + bob, 1.5, 1);
        } else if (player.dir === 'down') {
            ctx.fillRect(px - 3, py - 9 + bob, 1.5, 1.5);
            ctx.fillRect(px + 1.5, py - 9 + bob, 1.5, 1.5);
        } else if (player.dir === 'left') {
            ctx.fillRect(px - 4, py - 10 + bob, 1.5, 1.5);
            ctx.fillRect(px - 1, py - 10 + bob, 1.5, 1.5);
        } else {
            ctx.fillRect(px + 1, py - 10 + bob, 1.5, 1.5);
            ctx.fillRect(px + 4, py - 10 + bob, 1.5, 1.5);
        }

        // Schlauch/Düse
        ctx.strokeStyle = '#616161';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        if (player.dir === 'up') {
            ctx.moveTo(px + 5, py + 4 + bob);
            ctx.lineTo(px, py - 4 + bob);
            ctx.lineTo(px, py - 22 + bob);
        } else if (player.dir === 'down') {
            ctx.moveTo(px + 5, py + 4 + bob);
            ctx.lineTo(px + 5, py + 12 + bob);
            ctx.lineTo(px + 5, py + 22 + bob);
        } else if (player.dir === 'left') {
            ctx.moveTo(px + 5, py + 4 + bob);
            ctx.lineTo(px - 5, py + 4 + bob);
            ctx.lineTo(px - 20, py + 4 + bob);
        } else {
            ctx.moveTo(px - 5, py + 4 + bob);
            ctx.lineTo(px + 5, py + 4 + bob);
            ctx.lineTo(px + 20, py + 4 + bob);
        }
        ctx.stroke();
        // Schlauch-Highlight
        ctx.strokeStyle = '#9e9e9e';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.lineCap = 'butt';

        // Düsen-Spitze
        ctx.fillStyle = '#ffd166';
        let nx = px, ny = py + 4 + bob;
        if (player.dir === 'up') { nx = px; ny = py - 22 + bob; }
        else if (player.dir === 'down') { nx = px + 5; ny = py + 22 + bob; }
        else if (player.dir === 'left') { nx = px - 20; ny = py + 4 + bob; }
        else { nx = px + 20; ny = py + 4 + bob; }
        ctx.beginPath();
        ctx.arc(nx, ny, 2, 0, Math.PI * 2);
        ctx.fill();
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
