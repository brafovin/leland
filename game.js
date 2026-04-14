// Fire Department - 3D Firefighter Game (American Style)
// Built with Three.js r128 (global `THREE`)

// ============================================================
// GLOBAL STATE
// ============================================================
const state = {
    score: 0,
    water: 100,
    maxWater: 100,
    lives: 3,
    level: 1,
    fires: [],
    compartments: [],
    player: {
        pos: new THREE.Vector3(10, 1.7, 12),
        yaw: -Math.PI * 0.85,
        pitch: -0.05,
    },
    spraying: false,
    nearbyCompartment: null,
    nearbyHydrant: null,
    running: false,
    levelTransitioning: false,
};

const keys = {};
let mouseLocked = false;
let messageTimer = 0;

// ============================================================
// RENDERER
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
document.getElementById('canvas-container').appendChild(renderer.domElement);
const canvas = renderer.domElement;

// ============================================================
// SCENE + CAMERA
// ============================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x9ec5e8, 60, 240);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);

function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ============================================================
// LIGHTING
// ============================================================
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a2a1a, 0.4));

const sun = new THREE.DirectionalLight(0xfff3d6, 1.0);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 250;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun);

// ============================================================
// SHARED MATERIALS
// ============================================================
const MAT = {
    red: new THREE.MeshStandardMaterial({ color: 0xc41230, metalness: 0.5, roughness: 0.35 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.4, roughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.95, roughness: 0.1 }),
    black: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x668899, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.55 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd200, metalness: 0.3, roughness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x363636, roughness: 0.95 }),
    brick: new THREE.MeshStandardMaterial({ color: 0x9a3a2c, roughness: 0.9 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
};

// ============================================================
// GROUND + ROAD MARKINGS
// ============================================================
{
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), MAT.asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd200 });
    for (let i = -10; i <= 10; i++) {
        for (const x of [-22, 22]) {
            const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3), dashMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(x, 0.02, i * 6);
            scene.add(line);
        }
    }
}

// ============================================================
// TRUCK CONTAINER
// ============================================================
const TRUCK_POS = new THREE.Vector3(0, 0, 5);
const truckGroup = new THREE.Group();
truckGroup.position.copy(TRUCK_POS);
scene.add(truckGroup);

// ============================================================
// FIRE STATION (American style brick firehouse)
// ============================================================
function buildFireStation() {
    const g = new THREE.Group();
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, metalness: 0.4, roughness: 0.5 });

    // Main brick building
    const main = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 18), MAT.brick);
    main.position.set(0, 6, -28);
    main.castShadow = true;
    main.receiveShadow = true;
    g.add(main);

    // White trim around top
    const trim = new THREE.Mesh(new THREE.BoxGeometry(30.5, 1, 18.5), trimMat);
    trim.position.set(0, 11.5, -28);
    g.add(trim);

    // Two big bay doors
    for (let i = -1; i <= 1; i += 2) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 0.3), doorMat);
        door.position.set(i * 7, 4.5, -19);
        g.add(door);

        // Window strip on door
        const winMat = new THREE.MeshStandardMaterial({
            color: 0x6699aa, emissive: 0x113344, emissiveIntensity: 0.4,
            transparent: true, opacity: 0.75
        });
        const win = new THREE.Mesh(new THREE.BoxGeometry(7, 1.2, 0.05), winMat);
        win.position.set(i * 7, 7.5, -18.85);
        g.add(win);

        // Horizontal panel lines on roll-up door
        for (let j = 0; j < 5; j++) {
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(7.9, 0.06, 0.06),
                new THREE.MeshStandardMaterial({ color: 0xaaaaaa })
            );
            stripe.position.set(i * 7, 1.5 + j * 1.2, -18.85);
            g.add(stripe);
        }
    }

    // "FIRE STATION 7" sign plate (white)
    const sign = new THREE.Mesh(
        new THREE.BoxGeometry(16, 1.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 })
    );
    sign.position.set(0, 10.3, -18.9);
    g.add(sign);

    // Flagpole with US flag stripes
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 14, 8),
        new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7 })
    );
    pole.position.set(14, 7, -18);
    g.add(pole);

    const flag = new THREE.Group();
    const stripes = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 1.8),
        new THREE.MeshStandardMaterial({ color: 0xbb0a1e, side: THREE.DoubleSide })
    );
    flag.add(stripes);
    // Blue canton
    const canton = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x0a3161, side: THREE.DoubleSide })
    );
    canton.position.set(-0.9, 0.45, 0.01);
    flag.add(canton);
    flag.position.set(15.5, 12, -18);
    g.add(flag);

    return g;
}
scene.add(buildFireStation());

// ============================================================
// FIRE TRUCK - American style Pierce/E-One pumper
// ============================================================
function buildFireTruck() {
    // Chassis frame (below cab+body)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 11), MAT.black);
    chassis.position.y = 0.85;
    chassis.castShadow = true;
    truckGroup.add(chassis);

    // Front chrome bumper
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.5, 0.5), MAT.chrome);
    bumper.position.set(0, 0.7, -5.4);
    truckGroup.add(bumper);

    // === CAB ===
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 3.2), MAT.red);
    cab.position.set(0, 2.3, -3.4);
    cab.castShadow = true;
    truckGroup.add(cab);

    // White cab roof
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.18, 3.25), MAT.white);
    roof.position.set(0, 3.6, -3.4);
    truckGroup.add(roof);

    // Windshield
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 0.1), MAT.glass);
    windshield.position.set(0, 2.85, -4.96);
    truckGroup.add(windshield);

    // Side windows
    for (const sx of [-1.31, 1.31]) {
        const sw = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 1.4), MAT.glass);
        sw.position.set(sx, 2.85, -3.4);
        truckGroup.add(sw);
    }

    // Door panels (white with yellow stripe, Maltese cross)
    for (const sx of [-1.306, 1.306]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 1.2), MAT.white);
        door.position.set(sx, 1.7, -3.0);
        truckGroup.add(door);

        // Yellow stripe
        const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.12, 1.25),
            new THREE.MeshStandardMaterial({ color: 0xffd200 })
        );
        stripe.position.set(sx + 0.02 * Math.sign(sx), 1.3, -3.0);
        truckGroup.add(stripe);

        // Maltese cross (simplified)
        const cross = new THREE.Mesh(
            new THREE.BoxGeometry(0.04, 0.5, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffd200 })
        );
        cross.position.set(sx + 0.03 * Math.sign(sx), 1.8, -3.0);
        truckGroup.add(cross);
    }

    // Headlights
    for (const sx of [-0.9, 0.9]) {
        const hl = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 12, 12),
            new THREE.MeshStandardMaterial({
                color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.9
            })
        );
        hl.position.set(sx, 1.5, -5.02);
        truckGroup.add(hl);
    }

    // === LIGHT BAR (roof of cab) ===
    const lbBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.6), MAT.black);
    lbBase.position.set(0, 3.78, -3.4);
    truckGroup.add(lbBase);

    for (let i = -2; i <= 2; i++) {
        const isRed = i % 2 === 0;
        const led = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.18, 0.45),
            new THREE.MeshStandardMaterial({
                color: isRed ? 0xff0000 : 0x0033ff,
                emissive: isRed ? 0xff0000 : 0x0033ff,
                emissiveIntensity: 0.8,
            })
        );
        led.position.set(i * 0.42, 3.85, -3.4);
        led.userData.isLight = true;
        led.userData.color = isRed ? 'red' : 'blue';
        truckGroup.add(led);
    }

    // === BODY (back module with compartments) ===
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 6.5), MAT.red);
    body.position.set(0, 2.0, 1.4);
    body.castShadow = true;
    truckGroup.add(body);

    // Yellow scotchlite stripe along the body
    const bodyStripe = new THREE.Mesh(
        new THREE.BoxGeometry(2.62, 0.18, 6.52),
        new THREE.MeshStandardMaterial({ color: 0xffd200, emissive: 0x332200 })
    );
    bodyStripe.position.set(0, 1.3, 1.4);
    truckGroup.add(bodyStripe);

    // Top deck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.15, 6.55), MAT.black);
    deck.position.set(0, 3.4, 1.4);
    truckGroup.add(deck);

    // Hose bed (coiled hose on top)
    const hoseMat = new THREE.MeshStandardMaterial({ color: 0xfff5e6, roughness: 0.7 });
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
            const h = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 1.0), hoseMat);
            h.position.set(-0.8 + c * 0.8, 3.55 + r * 0.05, -0.6 + r * 0.55);
            truckGroup.add(h);
        }
    }

    // Aerial ladder section on top
    const ladderRailMat = new THREE.MeshStandardMaterial({
        color: 0xc0c0c0, metalness: 0.85, roughness: 0.25
    });
    const ladder = new THREE.Group();
    for (const sx of [-0.4, 0.4]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 5), ladderRailMat);
        rail.position.set(sx, 0, 0);
        ladder.add(rail);
    }
    for (let z = -2.3; z <= 2.3; z += 0.4) {
        const rung = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.05), ladderRailMat);
        rung.position.set(0, 0, z);
        ladder.add(rung);
    }
    ladder.position.set(0, 3.9, 2.8);
    truckGroup.add(ladder);

    // === WHEELS ===
    const wheelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.4, 20);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 });

    const wheelPositions = [
        [-1.2, 0.65, -3.8], [1.2, 0.65, -3.8],
        [-1.2, 0.65,  0.2], [1.2, 0.65,  0.2],
        [-1.2, 0.65,  2.6], [1.2, 0.65,  2.6],
    ];
    for (const [x, y, z] of wheelPositions) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, y, z);
        w.castShadow = true;
        truckGroup.add(w);

        const rim = new THREE.Mesh(
            new THREE.CylinderGeometry(0.35, 0.35, 0.42, 12),
            rimMat
        );
        rim.rotation.z = Math.PI / 2;
        rim.position.set(x, y, z);
        truckGroup.add(rim);
    }
}
buildFireTruck();

// ============================================================
// EQUIPMENT (items stored inside compartments)
// ============================================================
function createEquipment(type) {
    const g = new THREE.Group();
    switch (type) {
        case 'axe': {
            const handle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), MAT.wood);
            g.add(handle);
            const head = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.14, 0.05),
                new THREE.MeshStandardMaterial({ color: 0xc41230, metalness: 0.6 }));
            head.position.set(0.09, 0.32, 0);
            g.add(head);
            g.rotation.z = Math.PI / 2.3;
            break;
        }
        case 'extinguisher': {
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.13, 0.13, 0.55, 16),
                new THREE.MeshStandardMaterial({ color: 0xcc0000 }));
            g.add(body);
            const top = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.13, 0.1, 16), MAT.black);
            top.position.y = 0.32;
            g.add(top);
            const handle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.06), MAT.chrome);
            handle.position.y = 0.4;
            g.add(handle);
            break;
        }
        case 'helmet': {
            const dome = new THREE.Mesh(
                new THREE.SphereGeometry(0.18, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshStandardMaterial({ color: 0xffd200, metalness: 0.3, roughness: 0.4 }));
            g.add(dome);
            const brim = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16),
                new THREE.MeshStandardMaterial({ color: 0xffd200 }));
            brim.position.y = -0.01;
            g.add(brim);
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.03, 0.18),
                new THREE.MeshStandardMaterial({ color: 0xffd200 }));
            back.position.set(0, -0.01, 0.16);
            g.add(back);
            break;
        }
        case 'hose': {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.2, 0.045, 8, 24),
                new THREE.MeshStandardMaterial({ color: 0xfff5e6, roughness: 0.7 }));
            ring.rotation.x = Math.PI / 2;
            g.add(ring);
            const nozzle = new THREE.Mesh(
                new THREE.CylinderGeometry(0.05, 0.06, 0.18, 12), MAT.chrome);
            nozzle.position.set(0.2, 0, 0);
            nozzle.rotation.z = Math.PI / 2;
            g.add(nozzle);
            break;
        }
        case 'tank': {
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.1, 0.55, 16),
                new THREE.MeshStandardMaterial({ color: 0xffd200, metalness: 0.5 }));
            g.add(body);
            const valve = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 8, 8), MAT.chrome);
            valve.position.y = 0.32;
            g.add(valve);
            break;
        }
        case 'saw': {
            const motor = new THREE.Mesh(
                new THREE.BoxGeometry(0.26, 0.18, 0.18),
                new THREE.MeshStandardMaterial({ color: 0xff8800 }));
            g.add(motor);
            const blade = new THREE.Mesh(
                new THREE.BoxGeometry(0.5, 0.04, 0.02), MAT.chrome);
            blade.position.x = 0.36;
            g.add(blade);
            break;
        }
        case 'flashlight': {
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.25, 12),
                new THREE.MeshStandardMaterial({ color: 0xffd200 }));
            body.rotation.z = Math.PI / 2;
            g.add(body);
            const head = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.04, 0.05, 12), MAT.chrome);
            head.rotation.z = Math.PI / 2;
            head.position.x = 0.13;
            g.add(head);
            break;
        }
        case 'rope': {
            const coil = new THREE.Mesh(
                new THREE.TorusGeometry(0.16, 0.035, 8, 20),
                new THREE.MeshStandardMaterial({ color: 0xeeeecc }));
            coil.rotation.x = Math.PI / 2;
            g.add(coil);
            break;
        }
        case 'crowbar': {
            const bar = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8),
                new THREE.MeshStandardMaterial({ color: 0xff8800, metalness: 0.6 }));
            g.add(bar);
            const hook = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.06, 0.04),
                new THREE.MeshStandardMaterial({ color: 0xff8800, metalness: 0.6 }));
            hook.position.y = 0.3;
            g.add(hook);
            break;
        }
    }
    return g;
}

// ============================================================
// COMPARTMENTS (Gerätefächer - openable equipment lockers)
// ============================================================
// Door swings UP from a top hinge (pivot at top-front edge).
// Local frame of the compartment group: +Z is outward.
function createCompartment(name, side, zOffset, contents) {
    const group = new THREE.Group();
    const w = 1.8, h = 1.8, d = 0.06;

    // Inner cavity (dark)
    const interior = new THREE.Mesh(
        new THREE.BoxGeometry(w - 0.05, h - 0.05, 0.7),
        MAT.interior);
    interior.position.set(0, 0, -0.36);
    group.add(interior);

    // Thin frame around the opening
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 });
    for (const [fw, fh, fx, fy] of [
        [w, 0.06, 0, h / 2],
        [w, 0.06, 0, -h / 2],
        [0.06, h, w / 2, 0],
        [0.06, h, -w / 2, 0],
    ]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.08), frameMat);
        f.position.set(fx, fy, 0);
        group.add(f);
    }

    // Door (hinged at top)
    const pivot = new THREE.Group();
    pivot.position.set(0, h / 2, d / 2);
    group.add(pivot);

    const doorMat = new THREE.MeshStandardMaterial({
        color: 0xc41230, metalness: 0.65, roughness: 0.25
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), doorMat);
    door.position.set(0, -h / 2, 0);
    pivot.add(door);

    // Roll-up style horizontal ridges on door surface
    for (let i = 0; i < 8; i++) {
        const ridge = new THREE.Mesh(
            new THREE.BoxGeometry(w - 0.05, 0.025, 0.02), MAT.chrome);
        ridge.position.set(0, -h + (i + 0.5) * h / 8, d / 2 + 0.015);
        pivot.add(ridge);
    }

    // Chrome handle near bottom of door
    const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.07, 0.06), MAT.chrome);
    handle.position.set(0, -h + 0.15, d / 2 + 0.04);
    pivot.add(handle);

    // Label plate (name tag)
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256; labelCanvas.height = 64;
    const lctx = labelCanvas.getContext('2d');
    lctx.fillStyle = '#ffd200';
    lctx.fillRect(0, 0, 256, 64);
    lctx.fillStyle = '#000';
    lctx.font = 'bold 36px sans-serif';
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';
    lctx.fillText(name, 128, 32);
    const labelTex = new THREE.CanvasTexture(labelCanvas);
    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.9, 0.22),
        new THREE.MeshBasicMaterial({ map: labelTex })
    );
    label.position.set(0, h / 2 - 0.18, d / 2 + 0.05);
    pivot.add(label);

    // Equipment items inside (visible when door is open)
    for (const item of contents) {
        const mesh = createEquipment(item.type);
        mesh.position.set(item.x || 0, item.y || 0, item.z || -0.3);
        if (item.rot) mesh.rotation.set(item.rot[0] || 0, item.rot[1] || 0, item.rot[2] || 0);
        group.add(mesh);
    }

    // Place on truck body. Right side: face +X. Left side: face -X.
    group.position.set(side * 1.305, 2.0, zOffset);
    group.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
    truckGroup.add(group);

    return {
        name, group, pivot,
        isOpen: false,
        targetAngle: 0,
        currentAngle: 0,
        worldPos: new THREE.Vector3(),
    };
}

// Instantiate compartments (3 per side, along truck body Z axis)
state.compartments.push(
    createCompartment('Atemschutz', 1, -0.6, [
        { type: 'helmet', x: -0.55, y: 0.5, z: -0.2 },
        { type: 'helmet', x:  0.00, y: 0.5, z: -0.2 },
        { type: 'helmet', x:  0.55, y: 0.5, z: -0.2 },
        { type: 'tank',   x: -0.45, y: -0.35, z: -0.3 },
        { type: 'tank',   x:  0.00, y: -0.35, z: -0.3 },
        { type: 'tank',   x:  0.45, y: -0.35, z: -0.3 },
    ]),
    createCompartment('Werkzeug', 1, 1.45, [
        { type: 'axe',        x: -0.5, y: 0.1, z: -0.2 },
        { type: 'axe',        x:  0.0, y: 0.1, z: -0.2 },
        { type: 'crowbar',    x:  0.5, y: 0.1, z: -0.2 },
        { type: 'saw',        x:  0.0, y: -0.55, z: -0.3 },
        { type: 'flashlight', x: -0.55, y: 0.6, z: -0.2 },
        { type: 'flashlight', x:  0.55, y: 0.6, z: -0.2 },
    ]),
    createCompartment('Schlauch', 1, 3.5, [
        { type: 'hose',         x: -0.45, y:  0.35, z: -0.25 },
        { type: 'hose',         x:  0.45, y:  0.35, z: -0.25 },
        { type: 'hose',         x:  0.00, y: -0.20, z: -0.25 },
        { type: 'extinguisher', x: -0.5,  y: -0.55, z: -0.3 },
        { type: 'extinguisher', x:  0.5,  y: -0.55, z: -0.3 },
    ]),
    createCompartment('Pumpe', -1, -0.6, [
        { type: 'hose',         x:  0.00, y:  0.1, z: -0.25 },
        { type: 'extinguisher', x: -0.45, y: -0.45, z: -0.3 },
        { type: 'extinguisher', x:  0.45, y: -0.45, z: -0.3 },
        { type: 'flashlight',   x: -0.55, y:  0.6, z: -0.2 },
    ]),
    createCompartment('Rettung', -1, 1.45, [
        { type: 'rope',   x: -0.45, y:  0.3, z: -0.25 },
        { type: 'rope',   x:  0.45, y:  0.3, z: -0.25 },
        { type: 'helmet', x:  0.00, y: -0.45, z: -0.2 },
        { type: 'rope',   x:  0.00, y:  0.3, z: -0.25 },
    ]),
    createCompartment('Werkzeug 2', -1, 3.5, [
        { type: 'axe',     x: -0.45, y:  0.1, z: -0.2 },
        { type: 'crowbar', x:  0.45, y:  0.1, z: -0.2 },
        { type: 'saw',     x:  0.00, y: -0.5, z: -0.3 },
        { type: 'flashlight', x: 0.00, y: 0.6, z: -0.2 },
    ])
);

// ============================================================
// HYDRANTS (American pillar style, yellow)
// ============================================================
const hydrants = [];
function createHydrant(x, z) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.2, 12), MAT.yellow);
    base.position.y = 0.1;
    g.add(base);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.7, 12), MAT.yellow);
    body.position.y = 0.55;
    g.add(body);

    // Two side outlet caps
    for (const sx of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.15, 12), MAT.yellow);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(sx * 0.22, 0.5, 0);
        g.add(cap);
    }

    // Top steamer connection
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.15, 12), MAT.yellow);
    top.position.y = 0.97;
    g.add(top);

    // Pentagon operating nut
    const nut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.07, 0.06, 5), MAT.black);
    nut.position.y = 1.07;
    g.add(nut);

    g.position.set(x, 0, z);
    g.castShadow = true;
    scene.add(g);
    hydrants.push({ group: g, position: new THREE.Vector3(x, 0, z) });
}
createHydrant( 15, 12);
createHydrant(-15, 12);
createHydrant( 15, -12);
createHydrant(-15, -12);

// ============================================================
// BUILDINGS (simple boxes with windows)
// ============================================================
function createBuilding(x, z, w, h, d, color) {
    const g = new THREE.Group();
    const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    main.position.y = h / 2;
    main.castShadow = true;
    main.receiveShadow = true;
    g.add(main);

    // Flat roof trim
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.3, d + 0.4),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    roof.position.y = h + 0.15;
    g.add(roof);

    // Windows on all four sides
    const winMat = new THREE.MeshStandardMaterial({
        color: 0x88aacc, emissive: 0x223344, emissiveIntensity: 0.3
    });
    const floors = Math.max(1, Math.floor(h / 3));
    const colsX = Math.max(1, Math.floor(w / 2) - 1);
    const colsZ = Math.max(1, Math.floor(d / 2) - 1);

    for (let f = 0; f < floors; f++) {
        const yy = f * 3 + 1.6;
        for (let c = -colsX; c <= colsX; c++) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.05), winMat);
            win.position.set(c * 1.6, yy, d / 2 + 0.025);
            g.add(win);
            const win2 = win.clone();
            win2.position.z = -d / 2 - 0.025;
            g.add(win2);
        }
        for (let c = -colsZ; c <= colsZ; c++) {
            const win = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, 0.8), winMat);
            win.position.set(w / 2 + 0.025, yy, c * 1.6);
            g.add(win);
            const win2 = win.clone();
            win2.position.x = -w / 2 - 0.025;
            g.add(win2);
        }
    }

    g.position.set(x, 0, z);
    scene.add(g);
    return g;
}
createBuilding( 38,  25, 8, 10, 8, 0x9b6a4e);
createBuilding(-38,  25, 8, 14, 8, 0x6e8a8e);
createBuilding( 38, -25, 8,  8, 8, 0x8a6e6e);
createBuilding(-38, -25, 8, 12, 8, 0x6e6e8a);

// ============================================================
// FIRES
// ============================================================
function createFire(x, z) {
    const g = new THREE.Group();
    const flames = [];
    for (let i = 0; i < 6; i++) {
        const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.4 + Math.random() * 0.25, 1.2 + Math.random() * 0.7, 8),
            new THREE.MeshBasicMaterial({
                color: i < 2 ? 0xff2200 : (i < 4 ? 0xff7700 : 0xffcc00),
                transparent: true,
                opacity: 0.85
            })
        );
        flame.position.set(
            (Math.random() - 0.5) * 0.8,
            0.6 + Math.random() * 0.5,
            (Math.random() - 0.5) * 0.8
        );
        flame.userData.baseY = flame.position.y;
        flame.userData.phase = Math.random() * Math.PI * 2;
        flames.push(flame);
        g.add(flame);
    }

    // Ember point light
    const light = new THREE.PointLight(0xff5511, 1.6, 10);
    light.position.y = 1.4;
    g.add(light);

    g.position.set(x, 0, z);
    scene.add(g);

    return {
        group: g,
        flames,
        light,
        health: 100,
        position: new THREE.Vector3(x, 0, z),
        extinguished: false,
    };
}

function spawnFires() {
    const spots = [
        [38, 25], [-38, 25], [38, -25], [-38, -25],
        [25, 28], [-25, 28],
    ];
    for (const [x, z] of spots) {
        state.fires.push(createFire(
            x + (Math.random() - 0.5) * 4,
            z + (Math.random() - 0.5) * 4
        ));
    }
    // Extra fires based on level
    for (let i = 0; i < state.level - 1; i++) {
        state.fires.push(createFire(
            (Math.random() - 0.5) * 80,
            (Math.random() - 0.5) * 80
        ));
    }
}
spawnFires();

// ============================================================
// WATER PARTICLES
// ============================================================
const waterParticles = [];
const waterGeo = new THREE.SphereGeometry(0.07, 6, 6);
const waterMat = new THREE.MeshBasicMaterial({
    color: 0x55aaff, transparent: true, opacity: 0.75
});

function spawnWaterParticles(origin, dir) {
    for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(waterGeo, waterMat.clone());
        p.position.copy(origin);
        const spread = new THREE.Vector3(
            (Math.random() - 0.5) * 0.25,
            (Math.random() - 0.5) * 0.25,
            (Math.random() - 0.5) * 0.25
        );
        p.userData.vel = dir.clone().multiplyScalar(16).add(spread.multiplyScalar(5));
        p.userData.life = 1.0;
        scene.add(p);
        waterParticles.push(p);
    }
}

function updateWaterParticles(dt) {
    for (let i = waterParticles.length - 1; i >= 0; i--) {
        const p = waterParticles[i];
        p.userData.vel.y -= 9.8 * dt;
        p.position.addScaledVector(p.userData.vel, dt);
        p.userData.life -= dt * 0.8;
        p.material.opacity = Math.max(0, p.userData.life * 0.75);

        // Collide with any active fire
        for (const fire of state.fires) {
            if (fire.extinguished) continue;
            if (p.position.distanceTo(fire.position) < 1.4 && p.position.y < 2.5) {
                fire.health -= 12;
                p.userData.life = 0;
                if (fire.health <= 0) {
                    fire.extinguished = true;
                    state.score += 100 * state.level;
                    updateHUD();
                    for (const f of fire.flames) f.visible = false;
                    fire.light.intensity = 0;
                }
                break;
            }
        }

        if (p.userData.life <= 0 || p.position.y < 0) {
            scene.remove(p);
            waterParticles.splice(i, 1);
        }
    }
}

// ============================================================
// INPUT
// ============================================================
document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyE') tryInteract();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

canvas.addEventListener('click', () => {
    if (state.running && !mouseLocked) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    mouseLocked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', e => {
    if (!mouseLocked) return;
    state.player.yaw -= e.movementX * 0.0025;
    state.player.pitch -= e.movementY * 0.0025;
    state.player.pitch = Math.max(-Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, state.player.pitch));
});

document.addEventListener('mousedown', e => {
    if (mouseLocked && e.button === 0) state.spraying = true;
});
document.addEventListener('mouseup', e => {
    if (e.button === 0) state.spraying = false;
});

// ============================================================
// INTERACT (E key)
// ============================================================
function tryInteract() {
    if (!state.running) return;
    if (state.nearbyCompartment) {
        const c = state.nearbyCompartment;
        c.isOpen = !c.isOpen;
        c.targetAngle = c.isOpen ? -Math.PI / 2.2 : 0;
        showMessage(c.isOpen ? `${c.name} geöffnet` : `${c.name} geschlossen`, 1.5);
        return;
    }
    if (state.nearbyHydrant) {
        state.water = state.maxWater;
        updateHUD();
        showMessage('Wasser aufgefüllt!', 1.5);
    }
}

// ============================================================
// GAME LOOP
// ============================================================
const clock = new THREE.Clock();

function update(dt) {
    // --- Player movement ---
    const forward = new THREE.Vector3(
        -Math.sin(state.player.yaw), 0, -Math.cos(state.player.yaw));
    const right = new THREE.Vector3(
        Math.cos(state.player.yaw), 0, -Math.sin(state.player.yaw));

    const move = new THREE.Vector3();
    if (state.running) {
        if (keys['KeyW'] || keys['ArrowUp'])    move.add(forward);
        if (keys['KeyS'] || keys['ArrowDown'])  move.sub(forward);
        if (keys['KeyD'] || keys['ArrowRight']) move.add(right);
        if (keys['KeyA'] || keys['ArrowLeft'])  move.sub(right);
    }
    if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(5.5 * dt);
        state.player.pos.add(move);
    }

    // Clamp to world bounds
    state.player.pos.x = Math.max(-80, Math.min(80, state.player.pos.x));
    state.player.pos.z = Math.max(-80, Math.min(80, state.player.pos.z));
    state.player.pos.y = 1.7;

    // Simple truck body collision (keep player outside the truck box)
    {
        const local = state.player.pos.clone().sub(TRUCK_POS);
        const bxW = 1.75, bxH = 6, bxD = 6.5;
        if (Math.abs(local.x) < bxW && Math.abs(local.z - 1.0) < bxD) {
            // push out along the larger penetration axis
            const dx = bxW - Math.abs(local.x);
            const dz = bxD - Math.abs(local.z - 1.0);
            if (dx < dz) {
                state.player.pos.x = TRUCK_POS.x + Math.sign(local.x || 1) * bxW;
            } else {
                state.player.pos.z = TRUCK_POS.z + 1.0 + Math.sign((local.z - 1.0) || 1) * bxD;
            }
        }
    }

    // --- Camera follows player ---
    camera.position.copy(state.player.pos);
    const lookDir = new THREE.Vector3(
        -Math.sin(state.player.yaw) * Math.cos(state.player.pitch),
        Math.sin(state.player.pitch),
        -Math.cos(state.player.yaw) * Math.cos(state.player.pitch)
    );
    camera.lookAt(state.player.pos.clone().add(lookDir));

    // --- Compartment animation + proximity ---
    state.nearbyCompartment = null;
    let nearestDist = 3.5;
    for (const c of state.compartments) {
        c.currentAngle += (c.targetAngle - c.currentAngle) * Math.min(1, dt * 6);
        c.pivot.rotation.x = c.currentAngle;

        c.group.getWorldPosition(c.worldPos);
        const d = state.player.pos.distanceTo(c.worldPos);
        if (d < nearestDist) {
            nearestDist = d;
            state.nearbyCompartment = c;
        }
    }

    // --- Hydrant proximity ---
    state.nearbyHydrant = null;
    for (const h of hydrants) {
        if (state.player.pos.distanceTo(h.position) < 2.5) {
            state.nearbyHydrant = h;
            break;
        }
    }

    // --- Interaction prompt ---
    const prompt = document.getElementById('interact-prompt');
    if (state.nearbyCompartment) {
        prompt.textContent = `[E] ${state.nearbyCompartment.name} ${
            state.nearbyCompartment.isOpen ? 'schließen' : 'öffnen'}`;
        prompt.classList.remove('hidden');
    } else if (state.nearbyHydrant) {
        prompt.textContent = '[E] Wasser auffüllen';
        prompt.classList.remove('hidden');
    } else {
        prompt.classList.add('hidden');
    }

    // --- Spraying water ---
    if (state.spraying && state.water > 0 && state.running) {
        state.water = Math.max(0, state.water - dt * 25);
        const origin = camera.position.clone().add(lookDir.clone().multiplyScalar(0.8));
        origin.y -= 0.25;
        spawnWaterParticles(origin, lookDir);
        updateHUD();
    }

    updateWaterParticles(dt);

    // --- Flame animation ---
    const t = clock.getElapsedTime();
    for (const fire of state.fires) {
        if (fire.extinguished) continue;
        for (const f of fire.flames) {
            f.position.y = f.userData.baseY + Math.sin(t * 8 + f.userData.phase) * 0.12;
            f.scale.y = 0.9 + Math.sin(t * 10 + f.userData.phase) * 0.18;
            f.rotation.y = t * 2 + f.userData.phase;
        }
        fire.light.intensity = 1.4 + Math.sin(t * 12 + fire.position.x) * 0.5;
    }

    // --- Light bar strobe ---
    const strobePhase = Math.floor(t * 6) % 2;
    truckGroup.traverse(obj => {
        if (obj.userData && obj.userData.isLight) {
            const isRed = obj.userData.color === 'red';
            obj.material.emissiveIntensity = (isRed === (strobePhase === 0)) ? 1.8 : 0.15;
        }
    });

    // --- Message timer ---
    if (messageTimer > 0) {
        messageTimer -= dt;
        if (messageTimer <= 0) document.getElementById('message').classList.add('hidden');
    }

    // --- Level transition ---
    if (!state.levelTransitioning && state.running &&
        state.fires.length > 0 && state.fires.every(f => f.extinguished)) {
        state.levelTransitioning = true;
        state.level++;
        updateHUD();
        showMessage(`Level ${state.level}! Neuer Einsatz...`, 2.5);
        setTimeout(() => {
            for (const fire of state.fires) scene.remove(fire.group);
            state.fires.length = 0;
            spawnFires();
            state.water = state.maxWater;
            updateHUD();
            state.levelTransitioning = false;
        }, 2500);
    }
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    update(dt);
    renderer.render(scene, camera);
}

animate();


// ============================================================
// HUD
// ============================================================
function updateHUD() {
    document.getElementById('score').textContent = state.score;
    document.getElementById('lives').textContent = state.lives;
    document.getElementById('level').textContent = state.level;
    document.getElementById('water-fill').style.width = (state.water / state.maxWater * 100) + '%';
}

function showMessage(text, duration) {
    const el = document.getElementById('message');
    el.textContent = text;
    el.classList.remove('hidden');
    messageTimer = duration || 2;
}

// ============================================================
// START BUTTON
// ============================================================
document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('overlay').classList.add('hidden');
    state.running = true;
    canvas.requestPointerLock();
});

updateHUD();
