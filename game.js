// Fire Department - 3D Firefighter Game (American Style)
// Built with Three.js r128 (global `THREE`)

// ============================================================
// GLOBAL STATE
// ============================================================
const state = {
    score: 0,
    water: 100,
    maxWater: 100,
    air: 100,        // SCBA breathing tank (depletes in smoke)
    maxAir: 100,
    lives: 3,
    level: 1,
    fires: [],
    compartments: [],
    player: {
        pos: new THREE.Vector3(10, 1.7, 12),
        yaw: -Math.PI * 0.85,
        pitch: -0.05,
    },
    // Driving mode
    drivingTruck: false,
    truckPos: new THREE.Vector3(0, 0, 5),
    truckYaw: 0,
    truckSpeed: 0,
    // Interior building the player is currently inside (if any)
    currentInterior: null,
    spraying: false,
    nozzleMode: 'stream',   // 'stream' (long range, high damage) or 'fog' (cone, low damage)
    hoseConnected: true,
    smokeIntensity: 0,      // 0..1, increases near fires, darkens vision
    nearbyCompartment: null,
    nearbyHydrant: null,
    running: false,
    levelTransitioning: false,
};

// Simulator constants
const SIM = {
    HOSE_MAX_LENGTH: 32,             // meters from truck pump outlet
    AIR_DEPLETE_PER_SEC: 4,          // when standing in smoke
    AIR_REFILL_RATE: 40,             // when at hydrant/truck
    FIRE_GROW_PER_SEC: 3,            // fire health points added per second (if not being hit)
    FIRE_MAX_HEALTH: 260,            // cap so it's still beatable
    STREAM_DAMAGE: 14,               // per particle hit
    FOG_DAMAGE: 6,                   // per particle hit (but fog shoots many)
    SMOKE_RADIUS: 10,                // fires pump smoke in this radius
    TRUCK_OUTLET: new THREE.Vector3(1.31, 1.25, 4.0), // local pos of rear pump outlet
};

const keys = {};
let mouseLocked = false;
let messageTimer = 0;

// Filled later in the BUILDINGS section once a hollow building exists
let interiorHouse = null;
function applyInteriorCollision(_house, _pos) { /* filled below */ }

// ============================================================
// RENDERER
// ============================================================
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.physicallyCorrectLights = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('canvas-container').appendChild(renderer.domElement);
const canvas = renderer.domElement;

// ============================================================
// SCENE + CAMERA
// ============================================================
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfd9f0, 80, 300);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);

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
// SKY (Three.js Sky shader - procedural atmospheric scattering)
// ============================================================
const sky = new THREE.Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const skyU = sky.material.uniforms;
skyU['turbidity'].value = 6;
skyU['rayleigh'].value = 1.5;
skyU['mieCoefficient'].value = 0.005;
skyU['mieDirectionalG'].value = 0.82;

// Sun position (shared between Sky shader and DirectionalLight)
const sunPos = new THREE.Vector3();
{
    const elevation = 42; // degrees above horizon
    const azimuth = 135;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    sunPos.setFromSphericalCoords(1, phi, theta);
    skyU['sunPosition'].value.copy(sunPos);
}

// ============================================================
// LIGHTING (physically correct units - lux/cd)
// ============================================================
scene.add(new THREE.AmbientLight(0xffffff, 0.12));

const sun = new THREE.DirectionalLight(0xfff4d6, 3.2);
sun.position.copy(sunPos).multiplyScalar(150);
sun.castShadow = true;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// ============================================================
// ENVIRONMENT MAP (PMREM from Sky shader)
// Bakes the sky into an IBL cube so all PBR materials get realistic
// indirect lighting + reflections. Must be done before any other
// geometry is added so only the sky ends up in the environment.
// ============================================================
{
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromScene(scene, 0.04).texture;
    pmrem.dispose();
}

// ============================================================
// SHARED MATERIALS (physical, clearcoat paint for realism)
// ============================================================
const MAT = {
    // Candy-apple red fire truck paint with clearcoat (simulates 2K lacquer)
    red: new THREE.MeshPhysicalMaterial({
        color: 0xb00e26,
        metalness: 0.2,
        roughness: 0.32,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        reflectivity: 0.6,
    }),
    // Off-white cab roof / door paint, same clearcoat
    white: new THREE.MeshPhysicalMaterial({
        color: 0xeeeeee,
        metalness: 0.15,
        roughness: 0.35,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
    }),
    // Chrome bumper, handles, rims - heavily reflective
    chrome: new THREE.MeshPhysicalMaterial({
        color: 0xf0f0f0,
        metalness: 1.0,
        roughness: 0.06,
        clearcoat: 0.5,
        clearcoatRoughness: 0.05,
    }),
    // Smoked glass for windshield/side windows
    glass: new THREE.MeshPhysicalMaterial({
        color: 0x182028,
        metalness: 0.2,
        roughness: 0.04,
        transmission: 0.4,
        transparent: true,
        opacity: 0.55,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        ior: 1.45,
    }),
    // Painted black chassis / trim
    black: new THREE.MeshPhysicalMaterial({
        color: 0x0c0c0c,
        metalness: 0.4,
        roughness: 0.55,
        clearcoat: 0.4,
        clearcoatRoughness: 0.3,
    }),
    // Hydrant / scotchlite stripe yellow
    yellow: new THREE.MeshPhysicalMaterial({
        color: 0xf4c20d,
        metalness: 0.3,
        roughness: 0.45,
        clearcoat: 0.6,
        clearcoatRoughness: 0.2,
    }),
    // Hickory axe handle
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4226, roughness: 0.9 }),
    // Asphalt (texture applied later in GROUND section)
    asphalt: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95, metalness: 0 }),
    // Brick (texture applied later in FIRE STATION section)
    brick: new THREE.MeshStandardMaterial({ color: 0x8a3423, roughness: 0.92, metalness: 0 }),
    // Dark compartment interior
    interior: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    // Rubber tire
    rubber: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.88, metalness: 0 }),
};

// ============================================================
// CANVAS TEXTURES (procedural, no external assets)
// ============================================================
function makeAsphaltTexture() {
    const size = 512;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    // Base
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, size, size);
    // Noise grain
    for (let i = 0; i < 12000; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = Math.random() * 1.8;
        const g = 25 + Math.random() * 90;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(x, y, r, r);
    }
    // Larger aggregate stones
    for (let i = 0; i < 300; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 1 + Math.random() * 2.5;
        const g = 55 + Math.random() * 50;
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    // Oil stain blotches
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 6 + Math.random() * 14;
        const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, 'rgba(0,0,0,0.5)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeBrickTexture() {
    const w = 512, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // Mortar background
    ctx.fillStyle = '#3a2a22';
    ctx.fillRect(0, 0, w, h);
    // Bricks
    const bw = 64, bh = 26, mortar = 3;
    for (let row = 0; row < h / bh; row++) {
        const offset = (row % 2) * (bw / 2);
        for (let col = -1; col < w / bw + 1; col++) {
            const x = col * bw + offset;
            const y = row * bh;
            const shade = 0.72 + Math.random() * 0.42;
            const r = Math.floor(138 * shade);
            const g = Math.floor(50 * shade);
            const b = Math.floor(38 * shade);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
            // Subtle speckles for aged look
            for (let k = 0; k < 6; k++) {
                ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`;
                ctx.fillRect(
                    x + mortar / 2 + Math.random() * (bw - mortar),
                    y + mortar / 2 + Math.random() * (bh - mortar),
                    2, 2);
            }
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeConcreteTexture() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9e9a90';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4000; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        const shade = 130 + Math.random() * 70;
        ctx.fillStyle = `rgba(${shade},${shade - 5},${shade - 10},${Math.random() * 0.8})`;
        ctx.fillRect(x, y, 1.5, 1.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeStuccoTexture(baseColor) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const [br, bg, bb] = baseColor;
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    ctx.fillRect(0, 0, size, size);
    // Grainy noise
    for (let i = 0; i < 8000; i++) {
        const x = Math.random() * size, y = Math.random() * size;
        const d = Math.random() * 40 - 20;
        ctx.fillStyle = `rgba(${br + d},${bg + d},${bb + d},0.7)`;
        ctx.fillRect(x, y, 2, 2);
    }
    // Cracks and stains
    for (let i = 0; i < 6; i++) {
        const x0 = Math.random() * size, y0 = Math.random() * size;
        ctx.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.15})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let k = 0; k < 5; k++) {
            ctx.lineTo(x0 + (Math.random() - 0.5) * 80, y0 + (Math.random() - 0.5) * 80);
        }
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeSidingTexture(baseColor) {
    // Horizontal wood/vinyl siding planks
    const w = 256, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const [br, bg, bb] = baseColor;
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    ctx.fillRect(0, 0, w, h);
    const plankH = 24;
    for (let row = 0; row < h / plankH; row++) {
        const y = row * plankH;
        // Plank face with subtle horizontal banding
        const grd = ctx.createLinearGradient(0, y, 0, y + plankH);
        grd.addColorStop(0, `rgba(255,255,255,0.12)`);
        grd.addColorStop(0.5, `rgba(0,0,0,0)`);
        grd.addColorStop(1, `rgba(0,0,0,0.18)`);
        ctx.fillStyle = grd;
        ctx.fillRect(0, y, w, plankH);
        // Shadow under each plank
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, y + plankH - 2, w, 2);
    }
    // Wood grain streaks
    for (let i = 0; i < 60; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.08})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 10 + Math.random() * 30, y);
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeRoofTexture() {
    // Asphalt shingle pattern
    const w = 256, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2e2e30';
    ctx.fillRect(0, 0, w, h);
    const rowH = 18, tileW = 32;
    for (let row = 0; row < h / rowH; row++) {
        const offset = (row % 2) * (tileW / 2);
        for (let col = -1; col < w / tileW + 1; col++) {
            const x = col * tileW + offset;
            const y = row * rowH;
            const shade = 40 + Math.random() * 35;
            ctx.fillStyle = `rgb(${shade},${shade},${shade + 2})`;
            ctx.fillRect(x + 1, y + 1, tileW - 2, rowH - 2);
        }
    }
    // Noise grain
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const g = 30 + Math.random() * 80;
        ctx.fillStyle = `rgba(${g},${g},${g},0.5)`;
        ctx.fillRect(x, y, 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeStorefrontTexture() {
    // Commercial tiled storefront with a band of windows
    const w = 512, h = 256;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // Bottom stone
    ctx.fillStyle = '#7a7468';
    ctx.fillRect(0, 0, w, h);
    // Window band
    ctx.fillStyle = '#0a1828';
    ctx.fillRect(8, 40, w - 16, 120);
    // Window dividers
    ctx.strokeStyle = '#4a4030';
    ctx.lineWidth = 4;
    for (let x = 8; x <= w - 8; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 40); ctx.lineTo(x, 160);
        ctx.stroke();
    }
    // Reflection highlights in windows
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let x = 14; x <= w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 50); ctx.lineTo(x + 8, 150);
        ctx.stroke();
    }
    // Upper and lower trim
    ctx.fillStyle = '#443d33';
    ctx.fillRect(0, 35, w, 6);
    ctx.fillRect(0, 160, w, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

const TEX = {
    asphalt: makeAsphaltTexture(),
    brick: makeBrickTexture(),
    concrete: makeConcreteTexture(),
    roof: makeRoofTexture(),
    storefront: makeStorefrontTexture(),
    // House/apartment fronts
    stuccoBeige: makeStuccoTexture([220, 200, 160]),
    stuccoPeach: makeStuccoTexture([235, 195, 150]),
    stuccoGreen: makeStuccoTexture([180, 200, 160]),
    sidingWhite: makeSidingTexture([230, 230, 225]),
    sidingBlue: makeSidingTexture([140, 170, 200]),
    sidingYellow: makeSidingTexture([235, 215, 140]),
};
TEX.asphalt.repeat.set(50, 50);
TEX.brick.repeat.set(4, 2);
TEX.concrete.repeat.set(8, 4);

// Apply textures to shared materials
MAT.asphalt.map = TEX.asphalt;
MAT.asphalt.needsUpdate = true;
MAT.brick.map = TEX.brick;
MAT.brick.needsUpdate = true;

// ============================================================
// GROUND + ROAD MARKINGS
// ============================================================
{
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), MAT.asphalt);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Concrete apron in front of the fire station bays (lighter strip)
    const apron = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 14),
        new THREE.MeshStandardMaterial({
            map: TEX.concrete, color: 0xaaa59a, roughness: 0.9, metalness: 0
        })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, 0.01, -10);
    apron.receiveShadow = true;
    scene.add(apron);

    // Yellow lane dashes down the road
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf4c20d });
    for (let i = -10; i <= 10; i++) {
        for (const x of [-22, 22]) {
            const line = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 3), dashMat);
            line.rotation.x = -Math.PI / 2;
            line.position.set(x, 0.02, i * 6);
            scene.add(line);
        }
    }

    // Solid white curbs between apron and road
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.7 });
    for (const x of [-17, 17]) {
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 14), curbMat);
        curb.position.set(x, 0.1, -10);
        scene.add(curb);
    }
}

// ============================================================
// TRUCK CONTAINER (moveable - position driven by state.truckPos)
// ============================================================
const truckGroup = new THREE.Group();
truckGroup.position.copy(state.truckPos);
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
// TRUCK DETAILS (mirrors, grille, pump panel, plate, reflectors)
// ============================================================
function addTruckDetails() {
    // Chrome grille on the front of the cab
    {
        const grille = new THREE.Group();
        const grilleBg = new THREE.Mesh(
            new THREE.BoxGeometry(2.0, 0.8, 0.06), MAT.black);
        grille.add(grilleBg);
        for (let i = -4; i <= 4; i++) {
            const slot = new THREE.Mesh(
                new THREE.BoxGeometry(0.12, 0.7, 0.1), MAT.chrome);
            slot.position.set(i * 0.22, 0, 0.04);
            grille.add(slot);
        }
        // Thick chrome surround
        const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 0.12), MAT.chrome);
        top.position.y = 0.44; grille.add(top);
        const bot = top.clone(); bot.position.y = -0.44; grille.add(bot);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.96, 0.12), MAT.chrome);
        left.position.x = -1.05; grille.add(left);
        const right = left.clone(); right.position.x = 1.05; grille.add(right);

        grille.position.set(0, 1.55, -4.97);
        truckGroup.add(grille);
    }

    // Side mirrors on west-coast style arms
    for (const sx of [-1.4, 1.4]) {
        const arm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), MAT.chrome);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(sx + Math.sign(sx) * 0.35, 3.1, -4.5);
        truckGroup.add(arm);

        const head = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.45, 0.25), MAT.black);
        head.position.set(sx + Math.sign(sx) * 0.75, 3.1, -4.5);
        truckGroup.add(head);

        const mirror = new THREE.Mesh(
            new THREE.PlaneGeometry(0.38, 0.2),
            new THREE.MeshPhysicalMaterial({
                color: 0xbbccdd, metalness: 1, roughness: 0.02,
                clearcoat: 1, clearcoatRoughness: 0.02,
            })
        );
        mirror.position.set(sx + Math.sign(sx) * (0.75 - 0.13), 3.1, -4.5);
        mirror.rotation.y = Math.sign(sx) * Math.PI / 2;
        truckGroup.add(mirror);
    }

    // Pump panel on driver side - gauges and valves between wheels
    {
        const panel = new THREE.Group();
        const bg = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.08), MAT.chrome);
        panel.add(bg);

        // Gauges (circles with colored centers)
        for (let i = 0; i < 5; i++) {
            const g = new THREE.Mesh(
                new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16),
                new THREE.MeshPhysicalMaterial({
                    color: 0xffffff, metalness: 0, roughness: 0.2,
                    clearcoat: 1, clearcoatRoughness: 0.02,
                })
            );
            g.rotation.x = Math.PI / 2;
            g.position.set(-0.7 + i * 0.35, 0.3, 0.05);
            panel.add(g);

            // Needle
            const n = new THREE.Mesh(
                new THREE.BoxGeometry(0.007, 0.08, 0.01),
                new THREE.MeshBasicMaterial({ color: 0xcc0000 }));
            n.position.set(-0.7 + i * 0.35, 0.3, 0.09);
            n.rotation.z = -0.6 + Math.random() * 1.2;
            panel.add(n);
        }

        // Valve handles (colored knobs)
        const valveCols = [0xff0000, 0x0077cc, 0xf4c20d, 0x00aa44];
        for (let i = 0; i < 4; i++) {
            const v = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12),
                new THREE.MeshStandardMaterial({ color: valveCols[i], roughness: 0.4 })
            );
            v.rotation.x = Math.PI / 2;
            v.position.set(-0.6 + i * 0.4, -0.25, 0.06);
            panel.add(v);

            const stem = new THREE.Mesh(
                new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), MAT.chrome);
            stem.position.set(-0.6 + i * 0.4, -0.25, 0.08);
            panel.add(stem);
        }

        panel.position.set(-1.33, 1.25, -1.5);
        panel.rotation.y = Math.PI / 2;
        truckGroup.add(panel);
    }

    // License plate at the rear
    {
        const plateCanvas = document.createElement('canvas');
        plateCanvas.width = 256; plateCanvas.height = 128;
        const px = plateCanvas.getContext('2d');
        px.fillStyle = '#ffffff';
        px.fillRect(0, 0, 256, 128);
        px.fillStyle = '#c41230';
        px.fillRect(4, 4, 248, 30);
        px.fillStyle = '#ffffff';
        px.font = 'bold 22px sans-serif';
        px.textAlign = 'center';
        px.fillText('FIRE DEPT', 128, 26);
        px.fillStyle = '#000';
        px.font = 'bold 62px "Arial Black", sans-serif';
        px.fillText('ENG-7', 128, 100);
        const tex = new THREE.CanvasTexture(plateCanvas);
        tex.encoding = THREE.sRGBEncoding;
        const plate = new THREE.Mesh(
            new THREE.PlaneGeometry(0.9, 0.45),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })
        );
        plate.position.set(0, 1.5, 4.76);
        plate.rotation.y = Math.PI;
        truckGroup.add(plate);

        // Rear red tail lights
        for (const sx of [-1.0, 1.0]) {
            const tl = new THREE.Mesh(
                new THREE.BoxGeometry(0.35, 0.2, 0.08),
                new THREE.MeshStandardMaterial({
                    color: 0xcc0000, emissive: 0xcc0000, emissiveIntensity: 0.9
                })
            );
            tl.position.set(sx, 1.5, 4.76);
            truckGroup.add(tl);
        }
    }

    // Scotchlite chevron pattern on rear (alert stripes)
    {
        const chevron = new THREE.Group();
        const chevW = 0.3, chevH = 2.2;
        for (let i = -3; i <= 3; i++) {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(chevW, chevH, 0.04),
                new THREE.MeshStandardMaterial({
                    color: i % 2 === 0 ? 0xff3300 : 0xf4c20d,
                    emissive: i % 2 === 0 ? 0x220800 : 0x221a00,
                    emissiveIntensity: 0.2,
                    roughness: 0.4,
                })
            );
            bar.position.set(i * 0.32, 1.5, 4.74);
            bar.rotation.z = Math.PI / 6;
            chevron.add(bar);
        }
        truckGroup.add(chevron);
    }

    // Orange cab roof marker lights (5 small amber domes, classic US rig)
    for (let i = -2; i <= 2; i++) {
        const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 6),
            new THREE.MeshStandardMaterial({
                color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 1.2
            })
        );
        marker.position.set(i * 0.4, 3.72, -5.0);
        truckGroup.add(marker);
    }
}
addTruckDetails();

// ============================================================
// DEPLOYABLE HOSE (visible line from truck pump outlet to player)
// ============================================================
const HOSE_SEGMENTS = 28;
const hoseLine = (() => {
    const positions = new Float32Array((HOSE_SEGMENTS + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xe8d8b8, linewidth: 2 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    return line;
})();

// World-space outlet is the local SIM.TRUCK_OUTLET transformed by the truck
const _outletWorld = new THREE.Vector3();
function getHoseOutlet() {
    _outletWorld.copy(SIM.TRUCK_OUTLET);
    truckGroup.localToWorld(_outletWorld);
    return _outletWorld;
}

// Update the hose line as a catenary (sagging) curve from outlet to player hand
function updateHose() {
    const outlet = getHoseOutlet();
    const hand = state.player.pos.clone();
    hand.y -= 0.3;
    // bring hand slightly forward of the player so the hose appears to be held
    const forward = new THREE.Vector3(
        -Math.sin(state.player.yaw), 0, -Math.cos(state.player.yaw));
    hand.addScaledVector(forward, 0.4);

    const dist = outlet.distanceTo(hand);
    state.hoseConnected = dist <= SIM.HOSE_MAX_LENGTH;

    // Drop amount based on distance - longer hose sags more
    const sag = Math.min(2.0, dist * 0.08);

    const pos = hoseLine.geometry.attributes.position.array;
    for (let i = 0; i <= HOSE_SEGMENTS; i++) {
        const t = i / HOSE_SEGMENTS;
        // Lerp between outlet and hand
        const x = outlet.x + (hand.x - outlet.x) * t;
        const z = outlet.z + (hand.z - outlet.z) * t;
        let y = outlet.y + (hand.y - outlet.y) * t;
        // Catenary-ish sag (sin curve is a decent approximation for this length)
        y -= Math.sin(t * Math.PI) * sag;
        const idx = i * 3;
        pos[idx]     = x;
        pos[idx + 1] = y;
        pos[idx + 2] = z;
    }
    hoseLine.geometry.attributes.position.needsUpdate = true;
    hoseLine.geometry.computeBoundingSphere();
}

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
// BUILDINGS (detailed)
// ============================================================
// Shared window material (lit interior)
const WIN_MAT = new THREE.MeshStandardMaterial({
    color: 0x8aaabc, emissive: 0x233348, emissiveIntensity: 0.35,
    roughness: 0.25, metalness: 0.1
});
const WIN_FRAME_MAT = new THREE.MeshStandardMaterial({
    color: 0xeeeeee, roughness: 0.5
});

function makeWindow(w, h, depth) {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, h * 0.9, depth * 0.3),
        WIN_MAT);
    g.add(glass);
    // Cross mullions
    const v = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, h * 0.9, depth * 0.4),
        WIN_FRAME_MAT);
    g.add(v);
    const hBar = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, 0.06, depth * 0.4),
        WIN_FRAME_MAT);
    g.add(hBar);
    // Outer frame
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, depth * 0.2),
        WIN_FRAME_MAT);
    frame.position.z = depth * 0.5;
    g.add(frame);
    const inset = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.9, h * 0.9, depth),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    inset.position.z = -depth * 0.2;
    g.add(inset);
    return g;
}

// --- Suburban house with gabled roof, porch, door, chimney ---
function buildHouse(x, z, rotY, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const w = 10, d = 8, h = 4.5;
    const wallTex = opts.wallTex || TEX.sidingWhite;
    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex, roughness: 0.8
    });
    // Texture repeat on a per-material basis
    const wt = wallTex.clone();
    wt.needsUpdate = true;
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    wt.repeat.set(3, 2);
    wallMat.map = wt;

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Gable roof - prism from ShapeGeometry extruded
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-w / 2 - 0.3, 0);
    roofShape.lineTo(w / 2 + 0.3, 0);
    roofShape.lineTo(w / 2 + 0.3, 0.3);
    roofShape.lineTo(0, 2.8);
    roofShape.lineTo(-w / 2 - 0.3, 0.3);
    roofShape.lineTo(-w / 2 - 0.3, 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
        depth: d + 0.6, bevelEnabled: false
    });
    roofGeo.translate(0, 0, -(d + 0.6) / 2);
    const rt = TEX.roof.clone();
    rt.needsUpdate = true;
    rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
    rt.repeat.set(3, 2);
    const roofMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.85 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = h;
    roof.castShadow = true;
    g.add(roof);

    // Gable end fills (the triangles)
    const gableGeo = new THREE.Shape();
    gableGeo.moveTo(-w / 2 - 0.3, 0);
    gableGeo.lineTo(w / 2 + 0.3, 0);
    gableGeo.lineTo(w / 2 + 0.3, 0.3);
    gableGeo.lineTo(0, 2.8);
    gableGeo.lineTo(-w / 2 - 0.3, 0.3);
    gableGeo.lineTo(-w / 2 - 0.3, 0);
    const gableFill = new THREE.Mesh(
        new THREE.ShapeGeometry(gableGeo), wallMat);
    gableFill.position.set(0, h, d / 2 + 0.3);
    g.add(gableFill);
    const gableFill2 = gableFill.clone();
    gableFill2.position.z = -d / 2 - 0.3;
    gableFill2.rotation.y = Math.PI;
    g.add(gableFill2);

    // Chimney
    const chim = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 2, 0.9),
        new THREE.MeshStandardMaterial({ map: TEX.brick, roughness: 0.9 })
    );
    chim.position.set(-w / 4, h + 1.5, -d / 4);
    chim.castShadow = true;
    g.add(chim);

    // Front porch
    const porchDeck = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 0.3, 2),
        new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.8 })
    );
    porchDeck.position.set(0, 0.3, d / 2 + 1);
    g.add(porchDeck);
    // Porch roof
    const porchRoof = new THREE.Mesh(
        new THREE.BoxGeometry(5.7, 0.15, 2.2),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    porchRoof.position.set(0, 3.0, d / 2 + 1);
    g.add(porchRoof);
    // Porch columns
    for (const sx of [-2.4, 2.4]) {
        const col = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.12, 2.7, 8),
            new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 })
        );
        col.position.set(sx, 1.65, d / 2 + 1.9);
        g.add(col);
    }
    // Porch steps
    for (let i = 0; i < 3; i++) {
        const step = new THREE.Mesh(
            new THREE.BoxGeometry(4.5 - i * 0.3, 0.12, 0.3),
            new THREE.MeshStandardMaterial({ color: 0x886644 })
        );
        step.position.set(0, 0.06 + i * 0.12, d / 2 + 2 + i * 0.3);
        g.add(step);
    }

    // Front door
    const door = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 2.1, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x6a2a14, roughness: 0.6 })
    );
    door.position.set(0, 1.25, d / 2 + 0.06);
    g.add(door);
    // Door knob
    const knob = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0xaa8822, metalness: 0.9, roughness: 0.2 })
    );
    knob.position.set(0.42, 1.15, d / 2 + 0.12);
    g.add(knob);

    // Windows on front (besides door)
    for (const sx of [-3.5, 3.5]) {
        const win = makeWindow(1.4, 1.4, 0.2);
        win.position.set(sx, 1.8, d / 2 + 0.02);
        g.add(win);
        const win2 = makeWindow(1.4, 1.4, 0.2);
        win2.position.set(sx, 3.5, d / 2 + 0.02);
        g.add(win2);
    }
    // Upper center window (above door)
    const winMid = makeWindow(1.2, 1.4, 0.2);
    winMid.position.set(0, 3.5, d / 2 + 0.02);
    g.add(winMid);

    // Back windows
    for (const sx of [-3, 0, 3]) {
        const win = makeWindow(1.2, 1.4, 0.2);
        win.position.set(sx, 1.8, -d / 2 - 0.02);
        win.rotation.y = Math.PI;
        g.add(win);
        const win2 = makeWindow(1.2, 1.4, 0.2);
        win2.position.set(sx, 3.5, -d / 2 - 0.02);
        win2.rotation.y = Math.PI;
        g.add(win2);
    }
    // Side windows
    for (const sz of [-2, 2]) {
        for (const sy of [1.8, 3.5]) {
            const win = makeWindow(1.2, 1.4, 0.2);
            win.position.set(w / 2 + 0.02, sy, sz);
            win.rotation.y = Math.PI / 2;
            g.add(win);
            const win2 = makeWindow(1.2, 1.4, 0.2);
            win2.position.set(-w / 2 - 0.02, sy, sz);
            win2.rotation.y = -Math.PI / 2;
            g.add(win2);
        }
    }

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// --- Hollow house: walkable interior with doorway + furniture ---
// Returns a descriptor used for collision and mission spawning.
function buildHollowHouse(x, z, rotY, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const w = 12, d = 9, h = 4.2;
    const wallThick = 0.2;
    const doorW = 1.8;
    const wallTex = opts.wallTex || TEX.sidingBlue;

    const wallMatExt = new THREE.MeshStandardMaterial({
        map: wallTex, roughness: 0.8
    });
    const interiorMat = new THREE.MeshStandardMaterial({
        color: 0xd8cfbe, roughness: 0.9
    });

    // Floor (wooden)
    const floorTex = TEX.sidingYellow.clone();
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(4, 3);
    floorTex.needsUpdate = true;
    const floor = new THREE.Mesh(
        new THREE.BoxGeometry(w - wallThick * 2, 0.1, d - wallThick * 2),
        new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.7 })
    );
    floor.position.y = 0.05;
    floor.receiveShadow = true;
    g.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(
        new THREE.BoxGeometry(w - wallThick * 2, 0.1, d - wallThick * 2),
        new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.95 })
    );
    ceiling.position.y = h - 0.05;
    g.add(ceiling);

    // Back wall
    const backWall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, wallThick), wallMatExt);
    backWall.position.set(0, h / 2, -d / 2);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    g.add(backWall);

    // Front wall split around a doorway
    const frontLeftW = (w - doorW) / 2;
    const frontLeft = new THREE.Mesh(
        new THREE.BoxGeometry(frontLeftW, h, wallThick), wallMatExt);
    frontLeft.position.set(-(doorW / 2 + frontLeftW / 2), h / 2, d / 2);
    frontLeft.castShadow = true;
    g.add(frontLeft);
    const frontRight = frontLeft.clone();
    frontRight.position.x = (doorW / 2 + frontLeftW / 2);
    g.add(frontRight);
    // Header above the door
    const header = new THREE.Mesh(
        new THREE.BoxGeometry(doorW + 0.1, h - 2.2, wallThick), wallMatExt);
    header.position.set(0, h - (h - 2.2) / 2, d / 2);
    g.add(header);

    // Side walls
    const sideWall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThick, h, d - wallThick * 2), wallMatExt);
    sideWall.position.set(-w / 2 + wallThick / 2, h / 2, 0);
    sideWall.castShadow = true;
    sideWall.receiveShadow = true;
    g.add(sideWall);
    const sideWall2 = sideWall.clone();
    sideWall2.position.x = w / 2 - wallThick / 2;
    g.add(sideWall2);

    // Gabled roof on top
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-w / 2 - 0.3, 0);
    roofShape.lineTo(w / 2 + 0.3, 0);
    roofShape.lineTo(w / 2 + 0.3, 0.3);
    roofShape.lineTo(0, 2.5);
    roofShape.lineTo(-w / 2 - 0.3, 0.3);
    roofShape.lineTo(-w / 2 - 0.3, 0);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
        depth: d + 0.6, bevelEnabled: false
    });
    roofGeo.translate(0, 0, -(d + 0.6) / 2);
    const rt = TEX.roof.clone();
    rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
    rt.repeat.set(3, 2);
    rt.needsUpdate = true;
    const roof = new THREE.Mesh(roofGeo,
        new THREE.MeshStandardMaterial({ map: rt, roughness: 0.85 }));
    roof.position.y = h;
    roof.castShadow = true;
    g.add(roof);

    // Gable fills
    const gable = new THREE.Shape();
    gable.moveTo(-w / 2 - 0.3, 0);
    gable.lineTo(w / 2 + 0.3, 0);
    gable.lineTo(w / 2 + 0.3, 0.3);
    gable.lineTo(0, 2.5);
    gable.lineTo(-w / 2 - 0.3, 0.3);
    gable.lineTo(-w / 2 - 0.3, 0);
    const gf = new THREE.Mesh(
        new THREE.ShapeGeometry(gable), wallMatExt);
    gf.position.set(0, h, d / 2 + 0.3);
    g.add(gf);
    const gf2 = gf.clone();
    gf2.position.z = -d / 2 - 0.3;
    gf2.rotation.y = Math.PI;
    g.add(gf2);

    // Porch in front of the doorway
    const porchDeck = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.3, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.8 })
    );
    porchDeck.position.set(0, 0.3, d / 2 + 0.9);
    g.add(porchDeck);

    // === INTERIOR FURNITURE ===
    // Couch (3-seater)
    const couchMat = new THREE.MeshStandardMaterial({ color: 0x6a4a3a, roughness: 0.85 });
    const couchBase = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 1.0), couchMat);
    couchBase.position.set(-3, 0.35, -3);
    g.add(couchBase);
    const couchBack = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 0.3), couchMat);
    couchBack.position.set(-3, 0.85, -3.45);
    g.add(couchBack);
    for (const sx of [-1.4, 1.4]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 1.0), couchMat);
        arm.position.set(-3 + sx, 0.65, -3);
        g.add(arm);
    }

    // Coffee table
    const table = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.08, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.4, metalness: 0.1 })
    );
    table.position.set(-3, 0.55, -1.8);
    g.add(table);
    for (const [sx, sz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) {
        const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.5, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x2a1a10 })
        );
        leg.position.set(-3 + sx, 0.25, -1.8 + sz);
        g.add(leg);
    }

    // TV stand + TV
    const tvStand = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x3a2a1a })
    );
    tvStand.position.set(-3, 0.3, 3.2);
    g.add(tvStand);
    const tv = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.9, 0.08),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0a, emissive: 0x112244, emissiveIntensity: 0.4
        })
    );
    tv.position.set(-3, 1.1, 3.2);
    g.add(tv);

    // Kitchen counter on the right side
    const counter = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 0.9, 0.8),
        new THREE.MeshStandardMaterial({ color: 0xd0c8b8, roughness: 0.6 })
    );
    counter.position.set(3, 0.45, -2);
    g.add(counter);
    const counterTop = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 0.06, 0.85),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.3, metalness: 0.3 })
    );
    counterTop.position.set(3, 0.93, -2);
    g.add(counterTop);
    // Stove top (the fire source)
    const stove = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.03, 0.8),
        new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.5, roughness: 0.3 })
    );
    stove.position.set(4, 0.97, -2);
    g.add(stove);
    // Stove burners
    for (const [bx, bz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
        const burner = new THREE.Mesh(
            new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12),
            new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
        );
        burner.position.set(4 + bx, 0.99, -2 + bz);
        g.add(burner);
    }
    // Kitchen cabinets on wall
    const cabinet = new THREE.Mesh(
        new THREE.BoxGeometry(4.5, 0.7, 0.4),
        new THREE.MeshStandardMaterial({ color: 0xc4a878, roughness: 0.5 })
    );
    cabinet.position.set(3, 2.8, -3.2);
    g.add(cabinet);

    // Dining table with 2 chairs
    const dTable = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.06, 1.0),
        new THREE.MeshStandardMaterial({ color: 0x9a7a4a })
    );
    dTable.position.set(3, 0.9, 1.5);
    g.add(dTable);
    for (const [sx, sz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.4], [0.6, 0.4]]) {
        const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.9, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x6a4a2a })
        );
        leg.position.set(3 + sx, 0.45, 1.5 + sz);
        g.add(leg);
    }
    for (const cz of [0.9, 2.1]) {
        const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.55, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x8a6a4a })
        );
        chair.position.set(3, 0.27, cz);
        g.add(chair);
        const cback = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.5, 0.06),
            new THREE.MeshStandardMaterial({ color: 0x8a6a4a })
        );
        cback.position.set(3, 0.8, cz + (cz < 1.5 ? -0.25 : 0.25));
        g.add(cback);
    }

    // Interior warm light
    const interiorLight = new THREE.PointLight(0xffcc88, 0.8, 14, 2);
    interiorLight.position.set(0, h - 0.4, 0);
    g.add(interiorLight);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);

    // Return descriptor used by collision + missions
    return {
        group: g,
        x, z, rotY: rotY || 0,
        w, d, h,
        wallThick,
        doorW,
        // Door gap is on the LOCAL +Z front wall
        // Interior fire spawn spots (in world coordinates after rotation)
        interiorSpots: [
            [4.0, -2.0],       // kitchen stove
            [-3.0, -3.2],      // couch
            [-3.0, 3.0],       // tv area
            [3.0, 1.5],        // dining table
        ].map(([lx, lz]) => {
            // rotate local -> world around (x, z)
            const cs = Math.cos(rotY || 0);
            const sn = Math.sin(rotY || 0);
            return [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
        }),
    };
}

// Replace the real interior collision stub defined near the top
applyInteriorCollision = function (house, pos) {
    // Transform world pos into house-local space
    const dx = pos.x - house.x;
    const dz = pos.z - house.z;
    const cs = Math.cos(-house.rotY);
    const sn = Math.sin(-house.rotY);
    let lx = dx * cs - dz * sn;
    let lz = dx * sn + dz * cs;

    const halfW = house.w / 2;
    const halfD = house.d / 2;
    const wt = house.wallThick;
    const doorHalf = house.doorW / 2;
    const playerR = 0.35;

    // Helper: is a given (lx, lz) inside the building footprint?
    const wasInside =
        Math.abs(lx) < halfW - wt &&
        Math.abs(lz) < halfD - wt;

    if (wasInside) {
        // Clamp to interior box, BUT allow passing through the door gap
        const atDoor = Math.abs(lx) < doorHalf && lz > halfD - wt - 0.5;
        if (!atDoor) {
            lx = Math.max(-halfW + wt + playerR, Math.min(halfW - wt - playerR, lx));
            lz = Math.max(-halfD + wt + playerR, Math.min(halfD - wt - playerR, lz));
        }
    } else {
        // Outside: block penetration into the building except through the door
        if (Math.abs(lx) < halfW + playerR && Math.abs(lz) < halfD + playerR) {
            // Near the front wall (+Z side)?
            const frontDist = Math.abs(lz - halfD);
            const otherWallDist = Math.min(
                Math.abs(lz + halfD),
                Math.abs(lx - halfW),
                Math.abs(lx + halfW)
            );
            if (frontDist < otherWallDist && Math.abs(lx) < doorHalf) {
                // Allow entry via door gap - no clamp
            } else {
                // Push out along shortest axis
                const pushFront = halfD + playerR - lz;
                const pushBack  = lz + halfD + playerR;
                const pushRight = halfW + playerR - lx;
                const pushLeft  = lx + halfW + playerR;
                const mn = Math.min(pushFront, pushBack, pushRight, pushLeft);
                if (mn === pushFront) lz = halfD + playerR;
                else if (mn === pushBack) lz = -halfD - playerR;
                else if (mn === pushRight) lx = halfW + playerR;
                else lx = -halfW - playerR;
            }
        }
    }

    // Transform local back to world
    const cs2 = Math.cos(house.rotY);
    const sn2 = Math.sin(house.rotY);
    pos.x = house.x + lx * cs2 - lz * sn2;
    pos.z = house.z + lx * sn2 + lz * cs2;
};

// --- Apartment/office block with balconies ---
function buildApartment(x, z, rotY) {
    const g = new THREE.Group();
    const w = 14, d = 10, floors = 4, fh = 3.2;
    const h = floors * fh;
    const wallTex = TEX.stuccoBeige.clone();
    wallTex.needsUpdate = true;
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(4, floors);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Flat roof with parapet
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4),
        new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9 })
    );
    roof.position.y = h + 0.25;
    g.add(roof);
    // HVAC unit on roof
    const hvac = new THREE.Mesh(
        new THREE.BoxGeometry(2, 1.2, 1.5),
        new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.5, roughness: 0.4 })
    );
    hvac.position.set(-3, h + 1.1, 1);
    g.add(hvac);

    // Windows + balconies per floor
    for (let f = 0; f < floors; f++) {
        const yy = f * fh + fh / 2 + 0.1;
        // Front: 4 windows with balconies between them
        for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            const sx = k * 2.8;
            const win = makeWindow(1.6, 1.8, 0.22);
            win.position.set(sx, yy, d / 2 + 0.02);
            g.add(win);

            if (f > 0) {
                // Balcony
                const balcony = new THREE.Mesh(
                    new THREE.BoxGeometry(1.9, 0.12, 0.9),
                    new THREE.MeshStandardMaterial({ color: 0xccc4b8, roughness: 0.8 })
                );
                balcony.position.set(sx, yy - 0.9, d / 2 + 0.5);
                g.add(balcony);
                // Railing
                for (let i = 0; i < 7; i++) {
                    const bar = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6),
                        MAT.chrome
                    );
                    bar.position.set(sx - 0.9 + i * 0.3, yy - 0.4, d / 2 + 0.94);
                    g.add(bar);
                }
                const top = new THREE.Mesh(
                    new THREE.BoxGeometry(1.9, 0.05, 0.05), MAT.chrome);
                top.position.set(sx, yy + 0.05, d / 2 + 0.94);
                g.add(top);
            }
        }
        // Back
        for (let k = -2; k <= 2; k++) {
            if (k === 0) continue;
            const win = makeWindow(1.6, 1.8, 0.22);
            win.position.set(k * 2.8, yy, -d / 2 - 0.02);
            win.rotation.y = Math.PI;
            g.add(win);
        }
        // Sides
        for (let k = -1; k <= 1; k += 2) {
            const win = makeWindow(1.6, 1.8, 0.22);
            win.position.set(w / 2 + 0.02, yy, k * 2.5);
            win.rotation.y = Math.PI / 2;
            g.add(win);
            const win2 = makeWindow(1.6, 1.8, 0.22);
            win2.position.set(-w / 2 - 0.02, yy, k * 2.5);
            win2.rotation.y = -Math.PI / 2;
            g.add(win2);
        }
    }

    // Ground-floor entrance with awning
    const entrance = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 2.6, 0.15),
        new THREE.MeshStandardMaterial({ color: 0x1a2838, roughness: 0.3, metalness: 0.4 })
    );
    entrance.position.set(0, 1.3, d / 2 + 0.05);
    g.add(entrance);
    const awning = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.2, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x992222 })
    );
    awning.position.set(0, 2.8, d / 2 + 0.6);
    g.add(awning);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// --- Commercial storefront (diner / shop) ---
function buildCommercial(x, z, rotY, sign) {
    const g = new THREE.Group();
    const w = 12, d = 8, h = 5.5;
    const wallTex = TEX.storefront.clone();
    wallTex.needsUpdate = true;
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(1, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8 });

    // Front panel with storefront texture
    const front = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h), wallMat);
    front.position.set(0, h / 2, d / 2 + 0.01);
    g.add(front);

    // Body (generic stucco for rest)
    const bodyMat = new THREE.MeshStandardMaterial({
        map: TEX.stuccoPeach, roughness: 0.9
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Flat roof
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.6, 0.3, d + 0.6),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a })
    );
    roof.position.y = h + 0.15;
    g.add(roof);

    // Big awning stripe over entrance
    const awning = new THREE.Mesh(
        new THREE.BoxGeometry(w - 1, 0.25, 1.4),
        new THREE.MeshStandardMaterial({ color: 0xbb1822 })
    );
    awning.position.set(0, 3.1, d / 2 + 0.7);
    g.add(awning);
    // Awning stripes
    for (let i = 0; i < 6; i++) {
        const s = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.27, 1.42),
            new THREE.MeshStandardMaterial({ color: 0xeeeeee })
        );
        s.position.set(-(w - 2) / 2 + i * (w - 1.5) / 5.5, 3.1, d / 2 + 0.7);
        g.add(s);
    }

    // Lit sign above awning (canvas text)
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 512; signCanvas.height = 96;
    const sx = signCanvas.getContext('2d');
    sx.fillStyle = '#221a10';
    sx.fillRect(0, 0, 512, 96);
    sx.fillStyle = '#ffd200';
    sx.font = 'bold 64px "Arial Black", sans-serif';
    sx.textAlign = 'center';
    sx.textBaseline = 'middle';
    sx.fillText(sign || 'DINER', 256, 52);
    const signTex = new THREE.CanvasTexture(signCanvas);
    signTex.encoding = THREE.sRGBEncoding;
    const signMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 1.5, 1.3),
        new THREE.MeshStandardMaterial({
            map: signTex, emissive: 0x998811, emissiveIntensity: 0.3
        })
    );
    signMesh.position.set(0, 4.5, d / 2 + 0.04);
    g.add(signMesh);

    // Entrance door (double glass)
    const eDoor = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 2.2, 0.1),
        new THREE.MeshPhysicalMaterial({
            color: 0x1a2838, metalness: 0.6, roughness: 0.15,
            transparent: true, opacity: 0.7
        })
    );
    eDoor.position.set(0, 1.1, d / 2 + 0.06);
    g.add(eDoor);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// --- Gas station with canopy and pumps ---
function buildGasStation(x, z, rotY) {
    const g = new THREE.Group();
    // Shop
    const shopMat = new THREE.MeshStandardMaterial({
        map: TEX.stuccoBeige, roughness: 0.9
    });
    const shop = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), shopMat);
    shop.position.set(-5, 2, 0);
    shop.castShadow = true;
    shop.receiveShadow = true;
    g.add(shop);
    // Shop roof
    const shopRoof = new THREE.Mesh(
        new THREE.BoxGeometry(7.3, 0.3, 6.3),
        new THREE.MeshStandardMaterial({ color: 0x222222 })
    );
    shopRoof.position.set(-5, 4.15, 0);
    g.add(shopRoof);
    // Shop window
    const win = makeWindow(3, 2, 0.2);
    win.position.set(-5, 2.2, 3.02);
    g.add(win);
    const win2 = makeWindow(1.6, 2, 0.2);
    win2.position.set(-2.8, 2.2, 3.02);
    g.add(win2);

    // Canopy (over pumps)
    const canopyPost = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7 });
    for (const sx of [2, 8]) {
        for (const sz of [-2.5, 2.5]) {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.2, 0.2, 5, 8),
                canopyPost
            );
            post.position.set(sx, 2.5, sz);
            g.add(post);
        }
    }
    const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.5, 7),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee })
    );
    canopy.position.set(5, 5.25, 0);
    g.add(canopy);
    const canopyStripe = new THREE.Mesh(
        new THREE.BoxGeometry(8.1, 0.5, 0.5),
        new THREE.MeshStandardMaterial({
            color: 0xcc0000, emissive: 0x440000, emissiveIntensity: 0.3
        })
    );
    canopyStripe.position.set(5, 5.25, 3.6);
    g.add(canopyStripe);
    const canopyStripe2 = canopyStripe.clone();
    canopyStripe2.position.z = -3.6;
    g.add(canopyStripe2);

    // Pumps (2)
    for (const [px, pz] of [[4, 0], [6.5, 0]]) {
        const pump = new THREE.Group();
        const pumpBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.8, 0.6),
            new THREE.MeshStandardMaterial({ color: 0xbb1822 })
        );
        pumpBody.position.y = 0.9;
        pump.add(pumpBody);
        const pumpTop = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.4, 0.5),
            new THREE.MeshStandardMaterial({
                color: 0xeeeeee, emissive: 0x222222
            })
        );
        pumpTop.position.y = 2.0;
        pump.add(pumpTop);
        const base = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.15, 0.9),
            new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.3 })
        );
        pump.add(base);
        pump.position.set(px, 0, pz);
        g.add(pump);
    }

    // Concrete apron under pumps
    const apron = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 7),
        new THREE.MeshStandardMaterial({
            map: TEX.concrete, color: 0xb0a898, roughness: 0.9
        })
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(5, 0.02, 0);
    apron.receiveShadow = true;
    g.add(apron);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// Place 6 buildings + gas station around the map
// The blue suburban house is hollow and walkable; doorway opens toward
// the street (front = local +Z, so rotY places that side toward the truck).
interiorHouse = buildHollowHouse( 40,  25,  Math.PI, { wallTex: TEX.sidingBlue });

const BUILDINGS = [
    buildHouse     ( 42,  12, -Math.PI / 2, { wallTex: TEX.sidingYellow }),
    buildHouse     (-42,  28,  Math.PI / 2, { wallTex: TEX.sidingWhite  }),
    buildApartment (-42, -10,  Math.PI / 2),
    buildCommercial( 42, -22, -Math.PI / 2, "JOE'S DINER"),
    buildGasStation(-10, -38,  0),
];

// ============================================================
// EXTRA VEHICLES (decorative, parked near the station)
// ============================================================
function addWheels(group, positions, radius) {
    radius = radius || 0.6;
    const wheelGeo = new THREE.CylinderGeometry(radius, radius, 0.38, 18);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.8, roughness: 0.2 });
    for (const [x, y, z] of positions) {
        const w = new THREE.Mesh(wheelGeo, tireMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(x, y, z);
        w.castShadow = true;
        group.add(w);
        const rim = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.4, 10),
            rimMat);
        rim.rotation.z = Math.PI / 2;
        rim.position.set(x, y, z);
        group.add(rim);
    }
}

// --- Aerial ladder truck (longer than the pumper, with extending ladder) ---
function buildLadderTruck(x, z, rotY) {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.4, 13), MAT.black);
    chassis.position.y = 0.85;
    chassis.castShadow = true;
    g.add(chassis);

    // Front bumper
    const bumper = new THREE.Mesh(
        new THREE.BoxGeometry(2.7, 0.5, 0.5), MAT.chrome);
    bumper.position.set(0, 0.7, -6.4);
    g.add(bumper);

    // Cab
    const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 2.4, 3.2), MAT.red);
    cab.position.set(0, 2.3, -4.4);
    cab.castShadow = true;
    g.add(cab);
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(2.65, 0.18, 3.25), MAT.white);
    roof.position.set(0, 3.6, -4.4);
    g.add(roof);
    // Windshield
    const ws = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.1, 0.1), MAT.glass);
    ws.position.set(0, 2.85, -5.96);
    g.add(ws);
    // Side windows
    for (const sx of [-1.31, 1.31]) {
        const sw = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 1.0, 1.4), MAT.glass);
        sw.position.set(sx, 2.85, -4.4);
        g.add(sw);
    }
    // Grille
    const grille = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.8, 0.06), MAT.black);
    grille.position.set(0, 1.55, -5.97);
    g.add(grille);
    // Lightbar
    const lb = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.15, 0.6), MAT.black);
    lb.position.set(0, 3.78, -4.4);
    g.add(lb);
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
        led.position.set(i * 0.42, 3.85, -4.4);
        g.add(led);
    }

    // Body (longer rear platform with stabilizer outriggers)
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 2.2, 8), MAT.red);
    body.position.set(0, 1.9, 0.5);
    body.castShadow = true;
    g.add(body);
    // Yellow scotchlite stripe
    const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(2.62, 0.18, 8.02),
        new THREE.MeshStandardMaterial({ color: 0xffd200, emissive: 0x332200 })
    );
    stripe.position.set(0, 1.25, 0.5);
    g.add(stripe);

    // Outriggers extended
    for (const sx of [-1.8, 1.8]) {
        const out = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.2, 0.3),
            new THREE.MeshStandardMaterial({ color: 0xffd200 })
        );
        out.position.set(sx, 0.1, 0.5);
        g.add(out);
        // Plate on the ground
        const plate = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.08, 0.8), MAT.chrome);
        plate.position.set(sx * 1.2, 0.04, 0.5);
        g.add(plate);
    }

    // Turntable + extended aerial ladder (angled up toward a building)
    const turntable = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.0, 0.4, 16), MAT.black);
    turntable.position.set(0, 3.3, 0);
    g.add(turntable);

    const ladderGroup = new THREE.Group();
    ladderGroup.position.set(0, 3.6, 0);
    // tilt up about 35 degrees, rotated toward nearest fire-ish direction
    ladderGroup.rotation.x = -0.6;
    ladderGroup.rotation.y = 0.4;
    const ladderMat = new THREE.MeshStandardMaterial({
        color: 0xcccccc, metalness: 0.8, roughness: 0.3
    });
    const railLen = 14;
    for (const sx of [-0.45, 0.45]) {
        const rail = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.08, railLen), ladderMat);
        rail.position.set(sx, 0, railLen / 2);
        ladderGroup.add(rail);
    }
    for (let zz = 0.3; zz < railLen - 0.2; zz += 0.45) {
        const rung = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 0.05, 0.05), ladderMat);
        rung.position.set(0, 0, zz);
        ladderGroup.add(rung);
    }
    // Basket at tip
    const basket = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.9, 1.0),
        new THREE.MeshStandardMaterial({ color: 0xffd200, roughness: 0.5 })
    );
    basket.position.set(0, 0.4, railLen - 0.2);
    ladderGroup.add(basket);
    // Basket railing
    const railTop = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.04, 1.0), MAT.chrome);
    railTop.position.set(0, 0.9, railLen - 0.2);
    ladderGroup.add(railTop);

    g.add(ladderGroup);

    // Wheels (4 rear axles for a tiller-ish look + 1 front)
    addWheels(g, [
        [-1.2, 0.65, -4.8], [1.2, 0.65, -4.8],
        [-1.2, 0.65, -0.8], [1.2, 0.65, -0.8],
        [-1.2, 0.65,  1.4], [1.2, 0.65,  1.4],
        [-1.2, 0.65,  3.6], [1.2, 0.65,  3.6],
    ]);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// --- Box-style ambulance (white with red/orange stripes) ---
function buildAmbulance(x, z, rotY) {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.35, 6.5), MAT.black);
    chassis.position.y = 0.75;
    g.add(chassis);

    // Cab
    const cab = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 1.8, 2.2),
        new THREE.MeshPhysicalMaterial({
            color: 0xffffff, metalness: 0.2, roughness: 0.3,
            clearcoat: 1, clearcoatRoughness: 0.1
        })
    );
    cab.position.set(0, 1.85, -2);
    cab.castShadow = true;
    g.add(cab);
    // Windshield
    const ws = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.9, 0.1), MAT.glass);
    ws.position.set(0, 2.2, -3.05);
    g.add(ws);
    // Side windows
    for (const sx of [-1.16, 1.16]) {
        const sw = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.7, 1.2), MAT.glass);
        sw.position.set(sx, 2.15, -2);
        g.add(sw);
    }
    // Box module
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 2.5, 4),
        new THREE.MeshPhysicalMaterial({
            color: 0xffffff, metalness: 0.1, roughness: 0.35,
            clearcoat: 0.8
        })
    );
    box.position.set(0, 2.15, 1.5);
    box.castShadow = true;
    g.add(box);
    // Red cross on side
    const crossCanvas = document.createElement('canvas');
    crossCanvas.width = crossCanvas.height = 128;
    const cx = crossCanvas.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, 128, 128);
    cx.fillStyle = '#cc0000';
    cx.fillRect(40, 20, 48, 88);
    cx.fillRect(20, 40, 88, 48);
    const crossTex = new THREE.CanvasTexture(crossCanvas);
    crossTex.encoding = THREE.sRGBEncoding;
    for (const sx of [-1.26, 1.26]) {
        const cross = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 1.2),
            new THREE.MeshStandardMaterial({ map: crossTex })
        );
        cross.position.set(sx, 2.4, 1.0);
        cross.rotation.y = Math.sign(sx) * Math.PI / 2;
        g.add(cross);
    }
    // Orange + red side stripes
    for (const sx of [-1.26, 1.26]) {
        const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(6.3, 0.4),
            new THREE.MeshStandardMaterial({ color: 0xff6600 })
        );
        stripe.position.set(sx, 1.3, 0);
        stripe.rotation.y = Math.sign(sx) * Math.PI / 2;
        g.add(stripe);
    }
    // "AMBULANCE" text on hood (mirrored would be overkill)
    const ambCanvas = document.createElement('canvas');
    ambCanvas.width = 512; ambCanvas.height = 96;
    const acx = ambCanvas.getContext('2d');
    acx.fillStyle = '#ffffff';
    acx.fillRect(0, 0, 512, 96);
    acx.fillStyle = '#cc0000';
    acx.font = 'bold 72px "Arial Black", sans-serif';
    acx.textAlign = 'center';
    acx.textBaseline = 'middle';
    acx.fillText('AMBULANCE', 256, 50);
    const ambTex = new THREE.CanvasTexture(ambCanvas);
    ambTex.encoding = THREE.sRGBEncoding;
    const amb = new THREE.Mesh(
        new THREE.PlaneGeometry(2.5, 0.6),
        new THREE.MeshStandardMaterial({ map: ambTex })
    );
    amb.position.set(0, 1.9, 3.51);
    g.add(amb);
    // Small lightbar
    const lb = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.14, 0.5),
        new THREE.MeshStandardMaterial({
            color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 0.7
        })
    );
    lb.position.set(0, 2.83, -2);
    g.add(lb);

    addWheels(g, [
        [-1.15, 0.55, -1.8], [1.15, 0.55, -1.8],
        [-1.15, 0.55,  2.4], [1.15, 0.55,  2.4],
    ], 0.5);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// --- Chief SUV (red Tahoe/Suburban style) ---
function buildChiefSUV(x, z, rotY) {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 0.3, 5.2), MAT.black);
    chassis.position.y = 0.7;
    g.add(chassis);
    // Body
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(2.1, 1.5, 5),
        new THREE.MeshPhysicalMaterial({
            color: 0xb00e26, metalness: 0.4, roughness: 0.3,
            clearcoat: 1.0, clearcoatRoughness: 0.06
        })
    );
    body.position.y = 1.55;
    body.castShadow = true;
    g.add(body);
    // Upper greenhouse
    const top = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 0.9, 3.8),
        new THREE.MeshPhysicalMaterial({
            color: 0xb00e26, metalness: 0.4, roughness: 0.3,
            clearcoat: 1.0, clearcoatRoughness: 0.06
        })
    );
    top.position.set(0, 2.7, -0.1);
    g.add(top);
    // Windshield
    const ws = new THREE.Mesh(
        new THREE.BoxGeometry(1.95, 0.85, 0.08), MAT.glass);
    ws.position.set(0, 2.7, -1.95);
    ws.rotation.x = -0.1;
    g.add(ws);
    // Side windows
    for (const sx of [-1.01, 1.01]) {
        const sw = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.7, 3.5), MAT.glass);
        sw.position.set(sx, 2.7, -0.1);
        g.add(sw);
    }
    // Rear window
    const rw = new THREE.Mesh(
        new THREE.BoxGeometry(1.95, 0.8, 0.08), MAT.glass);
    rw.position.set(0, 2.7, 1.75);
    g.add(rw);
    // Bumper
    const bump = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.3, 0.3), MAT.chrome);
    bump.position.set(0, 0.8, -2.58);
    g.add(bump);
    // Grille
    const grille = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.45, 0.05), MAT.black);
    grille.position.set(0, 1.3, -2.55);
    g.add(grille);
    for (let i = -2; i <= 2; i++) {
        const slot = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.4, 0.08), MAT.chrome);
        slot.position.set(i * 0.3, 1.3, -2.53);
        g.add(slot);
    }
    // Headlights
    for (const sx of [-0.8, 0.8]) {
        const hl = new THREE.Mesh(
            new THREE.SphereGeometry(0.13, 10, 10),
            new THREE.MeshStandardMaterial({
                color: 0xffffcc, emissive: 0xffffaa, emissiveIntensity: 0.9
            })
        );
        hl.position.set(sx, 1.35, -2.55);
        g.add(hl);
    }
    // Lightbar
    const lb = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.14, 0.45), MAT.black);
    lb.position.set(0, 3.2, -0.1);
    g.add(lb);
    for (let i = -1; i <= 1; i++) {
        const led = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.16, 0.4),
            new THREE.MeshStandardMaterial({
                color: i === 0 ? 0xff0000 : 0x0033ff,
                emissive: i === 0 ? 0xff0000 : 0x0033ff,
                emissiveIntensity: 0.9,
            })
        );
        led.position.set(i * 0.5, 3.27, -0.1);
        g.add(led);
    }
    // "CHIEF 7" on side (canvas texture on small plane)
    const chCanvas = document.createElement('canvas');
    chCanvas.width = 256; chCanvas.height = 64;
    const chx = chCanvas.getContext('2d');
    chx.fillStyle = '#ffffff';
    chx.fillRect(0, 0, 256, 64);
    chx.fillStyle = '#000000';
    chx.font = 'bold 34px "Arial Black", sans-serif';
    chx.textAlign = 'center';
    chx.fillText('CHIEF 7', 128, 44);
    const chTex = new THREE.CanvasTexture(chCanvas);
    chTex.encoding = THREE.sRGBEncoding;
    for (const sx of [-1.06, 1.06]) {
        const label = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 0.4),
            new THREE.MeshStandardMaterial({ map: chTex })
        );
        label.position.set(sx, 1.7, 0.2);
        label.rotation.y = Math.sign(sx) * Math.PI / 2;
        g.add(label);
    }

    addWheels(g, [
        [-1.1, 0.55, -1.6], [1.1, 0.55, -1.6],
        [-1.1, 0.55,  1.6], [1.1, 0.55,  1.6],
    ], 0.5);

    g.position.set(x, 0, z);
    g.rotation.y = rotY || 0;
    scene.add(g);
    return g;
}

// Place extra vehicles in front of the station (to the left of the pumper)
buildLadderTruck(-9,  5, 0);
buildAmbulance (-16, 5, 0);
buildChiefSUV  ( 10, 5, 0);

// ============================================================
// FIRES
// Radial gradient sprite + additive blending gives a volumetric glow
// that looks much more like real flames than flat cones.
// ============================================================
function makeFlameSprite() {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0.0, 'rgba(255,255,200,1)');
    grd.addColorStop(0.15, 'rgba(255,200,60,1)');
    grd.addColorStop(0.4, 'rgba(255,90,10,0.85)');
    grd.addColorStop(0.75, 'rgba(180,20,0,0.35)');
    grd.addColorStop(1.0, 'rgba(120,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function makeSmokeSprite() {
    const size = 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0.0, 'rgba(80,80,80,0.9)');
    grd.addColorStop(0.5, 'rgba(50,50,50,0.4)');
    grd.addColorStop(1.0, 'rgba(30,30,30,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
}

const FLAME_TEX = makeFlameSprite();
const SMOKE_TEX = makeSmokeSprite();

function createFire(x, z) {
    const g = new THREE.Group();
    const flames = [];

    // Multiple billboard flame sprites clustered and scaled differently
    for (let i = 0; i < 14; i++) {
        const mat = new THREE.SpriteMaterial({
            map: FLAME_TEX,
            color: 0xffffff,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.95,
        });
        const sprite = new THREE.Sprite(mat);
        const r = Math.random() * 0.8;
        const ang = Math.random() * Math.PI * 2;
        sprite.position.set(
            Math.cos(ang) * r,
            0.4 + Math.random() * 1.6,
            Math.sin(ang) * r
        );
        const s = 1.2 + Math.random() * 1.6;
        sprite.scale.set(s, s * 1.4, s);
        sprite.userData.baseY = sprite.position.y;
        sprite.userData.baseScale = s;
        sprite.userData.phase = Math.random() * Math.PI * 2;
        sprite.userData.speed = 0.8 + Math.random() * 0.6;
        flames.push(sprite);
        g.add(sprite);
    }

    // Drifting smoke sprites (non-additive, dark)
    const smokeSprites = [];
    for (let i = 0; i < 8; i++) {
        const mat = new THREE.SpriteMaterial({
            map: SMOKE_TEX,
            color: 0x222222,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(
            (Math.random() - 0.5) * 1.5,
            2 + Math.random() * 2,
            (Math.random() - 0.5) * 1.5
        );
        const s = 1.5 + Math.random() * 1.8;
        sprite.scale.set(s, s, s);
        sprite.userData.baseY = sprite.position.y;
        sprite.userData.phase = Math.random() * Math.PI * 2;
        sprite.userData.speed = 0.4 + Math.random() * 0.4;
        smokeSprites.push(sprite);
        g.add(sprite);
    }

    // Ember glow point light (physically correct -> much higher intensity)
    const light = new THREE.PointLight(0xff5511, 25, 18, 2);
    light.position.y = 1.4;
    g.add(light);

    // Charred base on the ground under the fire
    const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(1.4, 24),
        new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 1.0,
            transparent: true,
            opacity: 0.9,
        })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.03;
    g.add(scorch);

    g.position.set(x, 0, z);
    scene.add(g);

    return {
        group: g,
        flames,
        smoke: smokeSprites,
        light,
        scorch,
        health: 100,
        maxHealth: 100,
        growScale: 1.0,           // grows with time, shrinks as fire is damaged
        lastHitTime: 0,
        position: new THREE.Vector3(x, 0, z),
        extinguished: false,
    };
}

// ============================================================
// MISSIONS (Einsatz-Templates)
// ============================================================
const MISSIONS = [
    {
        id: 'house_interior',
        name: 'Zimmerbrand - Blaue Villa',
        objective: 'Fahr zur Blauen Villa und betrete das Haus durch die Haustür - Brand in Küche und Wohnzimmer',
        bonus: 800,
        // Spawn inside the hollow house (coordinates come from the house descriptor below)
        spotsFromInterior: true,
    },
    {
        id: 'diner_grease',
        name: 'Fettbrand im Diner',
        objective: "Kontrolliere den Küchenbrand bei Joe's Diner",
        bonus: 750,
        spots: [[42, -22], [40, -24], [44, -20]],
    },
    {
        id: 'apartment',
        name: 'Apartmentbrand - 3. OG',
        objective: '4 Glutnester, dichter Rauch - Atemschutz beachten',
        bonus: 1000,
        spots: [[-40, -8], [-44, -10], [-42, -13], [-38, -9]],
    },
    {
        id: 'house_yellow',
        name: 'Dachstuhlbrand',
        objective: 'Brand am gelben Haus - zwei Glutnester',
        bonus: 600,
        spots: [[42, 12], [44, 14]],
    },
    {
        id: 'house_white',
        name: 'Kellerbrand',
        objective: 'Vollbrand beim weissen Haus - Rauchentwicklung',
        bonus: 700,
        spots: [[-42, 28], [-40, 26], [-44, 30]],
    },
    {
        id: 'gas_station',
        name: 'Grossalarm - Tankstelle',
        objective: 'KRITISCH: Brand an den Zapfsaeulen - sofort loeschen!',
        bonus: 1500,
        spots: [[-6, -38], [-8, -36], [-12, -40], [-10, -42], [-4, -36]],
    },
    {
        id: 'multi',
        name: 'Grossalarm - Mehrere Einsatzstellen',
        objective: 'Stadtweiter Einsatz - alle Brandherde abarbeiten',
        bonus: 2000,
        spots: [[42, 28], [-42, 28], [42, -22], [-40, -10], [-8, -38]],
    },
];

state.missionIndex = 0;
state.currentMission = null;

function startMission(index) {
    // Clear existing fires
    for (const fire of state.fires) scene.remove(fire.group);
    state.fires.length = 0;

    const mission = MISSIONS[index % MISSIONS.length];
    state.currentMission = mission;
    state.missionIndex = index;

    // Resolve spots: either a static list or pulled from an interior descriptor
    let spots = mission.spots;
    if (mission.spotsFromInterior && interiorHouse) {
        spots = interiorHouse.interiorSpots;
    }

    if (spots) {
        for (const [x, z] of spots) {
            state.fires.push(createFire(
                x + (Math.random() - 0.5) * 1.5,
                z + (Math.random() - 0.5) * 1.5
            ));
        }
    }

    // Show briefing message
    showMessage(`Einsatz: ${mission.name}`, 3);
    updateHUD();
    updateMissionHUD();
}

function updateMissionHUD() {
    const m = state.currentMission;
    if (!m) return;
    document.getElementById('mission-name').textContent = m.name;
    document.getElementById('mission-objective').textContent = m.objective;
    const total = state.fires.length;
    const left = state.fires.filter(f => !f.extinguished).length;
    const done = total - left;
    document.getElementById('mission-progress').textContent =
        `Brandherde ${done} / ${total}`;
}

startMission(0);

// ============================================================
// WATER PARTICLES
// ============================================================
const waterParticles = [];
const waterGeo = new THREE.SphereGeometry(0.07, 6, 6);
const waterMat = new THREE.MeshBasicMaterial({
    color: 0x55aaff, transparent: true, opacity: 0.75
});

function spawnWaterParticles(origin, dir) {
    if (state.nozzleMode === 'stream') {
        // Tight, fast, long-range stream with heavy damage per particle
        for (let i = 0; i < 3; i++) {
            const p = new THREE.Mesh(waterGeo, waterMat.clone());
            p.position.copy(origin);
            const spread = new THREE.Vector3(
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1
            );
            p.userData.vel = dir.clone().multiplyScalar(26).add(spread.multiplyScalar(3));
            p.userData.life = 1.2;
            p.userData.damage = SIM.STREAM_DAMAGE;
            scene.add(p);
            waterParticles.push(p);
        }
    } else {
        // Wide fog cone with lots of small droplets, low damage per droplet
        for (let i = 0; i < 10; i++) {
            const p = new THREE.Mesh(waterGeo, waterMat.clone());
            p.position.copy(origin);
            // Random direction within a cone
            const coneAngle = 0.35;
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * coneAngle;
            const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
            const up = new THREE.Vector3().crossVectors(dir, right).normalize();
            const coneDir = dir.clone()
                .addScaledVector(right, Math.sin(r) * Math.cos(theta))
                .addScaledVector(up,    Math.sin(r) * Math.sin(theta))
                .normalize();
            p.userData.vel = coneDir.multiplyScalar(14 + Math.random() * 4);
            p.userData.life = 0.7;
            p.userData.damage = SIM.FOG_DAMAGE;
            scene.add(p);
            waterParticles.push(p);
        }
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
            const hitRadius = 1.2 + fire.growScale * 0.4;
            if (p.position.distanceTo(fire.position) < hitRadius && p.position.y < 3.0) {
                fire.health -= (p.userData.damage || 12);
                fire.lastHitTime = performance.now() / 1000;
                p.userData.life = 0;
                if (fire.health <= 0) {
                    fire.extinguished = true;
                    state.score += 100 * state.level;
                    updateHUD();
                    updateMissionHUD();
                    for (const f of fire.flames) f.visible = false;
                    for (const s of fire.smoke) s.visible = false;
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
    if (e.code === 'KeyF') toggleDrive();
    if (e.code === 'Digit1') {
        state.nozzleMode = 'stream';
        updateHUD();
        showMessage('Vollstrahl', 1);
    }
    if (e.code === 'Digit2') {
        state.nozzleMode = 'fog';
        updateHUD();
        showMessage('Sprühnebel', 1);
    }
});

// ============================================================
// DRIVING MODE
// ============================================================
function toggleDrive() {
    if (!state.running) return;
    if (state.drivingTruck) {
        // Exit at the driver door (-x side of local frame)
        state.drivingTruck = false;
        const exitLocal = new THREE.Vector3(-2.8, 0, -3.4);
        exitLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.truckYaw);
        state.player.pos.copy(state.truckPos).add(exitLocal);
        state.player.pos.y = 1.7;
        state.player.yaw = state.truckYaw + Math.PI / 2;
        state.truckSpeed = 0;
        hoseLine.visible = true;
        showMessage('Ausgestiegen', 1.2);
    } else {
        // Must be near the truck to enter
        const dist = state.player.pos.distanceTo(state.truckPos);
        if (dist < 6) {
            state.drivingTruck = true;
            hoseLine.visible = false;
            showMessage('Einsteigen - W/S gas, A/D lenken', 2);
        } else {
            showMessage('Zu weit vom Truck entfernt', 1.2);
        }
    }
}

function driveUpdate(dt) {
    // Throttle / brake
    let throttle = 0;
    if (keys['KeyW'] || keys['ArrowUp'])   throttle = 1;
    if (keys['KeyS'] || keys['ArrowDown']) throttle = -1;
    state.truckSpeed += throttle * 9 * dt;
    if (throttle === 0) state.truckSpeed *= Math.pow(0.25, dt);
    state.truckSpeed = Math.max(-10, Math.min(20, state.truckSpeed));

    // Steering (scales with speed, reverses when driving backward)
    let steer = 0;
    if (keys['KeyA'] || keys['ArrowLeft'])  steer = 1;
    if (keys['KeyD'] || keys['ArrowRight']) steer = -1;
    const speedFrac = Math.min(1, Math.abs(state.truckSpeed) / 20);
    state.truckYaw += steer * 1.4 * speedFrac * dt * Math.sign(state.truckSpeed || 1);

    // Move truck
    const fwd = new THREE.Vector3(
        -Math.sin(state.truckYaw), 0, -Math.cos(state.truckYaw));
    state.truckPos.addScaledVector(fwd, state.truckSpeed * dt);
    state.truckPos.x = Math.max(-80, Math.min(80, state.truckPos.x));
    state.truckPos.z = Math.max(-80, Math.min(80, state.truckPos.z));

    truckGroup.position.copy(state.truckPos);
    truckGroup.rotation.y = state.truckYaw;

    // Player stays "in" the truck (for hose, air refill, etc.)
    state.player.pos.copy(state.truckPos);
    state.player.pos.y = 2.5;
    state.player.yaw = state.truckYaw;

    // Chase camera - behind and above the truck
    const back = fwd.clone().negate();
    const camPos = state.truckPos.clone()
        .addScaledVector(back, 12)
        .add(new THREE.Vector3(0, 6.5, 0));
    camera.position.copy(camPos);
    const lookPoint = state.truckPos.clone()
        .addScaledVector(fwd, 6)
        .add(new THREE.Vector3(0, 2.5, 0));
    camera.lookAt(lookPoint);
}
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
        state.air = state.maxAir;
        updateHUD();
        showMessage('Wasser & Atemluft aufgefüllt!', 1.5);
    }
}

// ============================================================
// GAME LOOP
// ============================================================
const clock = new THREE.Clock();

function update(dt) {
    let lookDir;

    if (state.drivingTruck) {
        // === DRIVE MODE ===
        driveUpdate(dt);
        // Pseudo look direction for the spray/camera/prompt logic that
        // expects a forward vector; sprays are disabled in drive mode anyway.
        lookDir = new THREE.Vector3(
            -Math.sin(state.truckYaw), 0, -Math.cos(state.truckYaw));
    } else {
        // === WALK MODE ===
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

        // Interior building collision (walls + door gap)
        if (interiorHouse) applyInteriorCollision(interiorHouse, state.player.pos);

        // --- Camera follows player ---
        camera.position.copy(state.player.pos);
        lookDir = new THREE.Vector3(
            -Math.sin(state.player.yaw) * Math.cos(state.player.pitch),
            Math.sin(state.player.pitch),
            -Math.cos(state.player.yaw) * Math.cos(state.player.pitch)
        );
        camera.lookAt(state.player.pos.clone().add(lookDir));
    }

    // --- Compartment animation + proximity ---
    state.nearbyCompartment = null;
    let nearestDist = 3.5;
    for (const c of state.compartments) {
        c.currentAngle += (c.targetAngle - c.currentAngle) * Math.min(1, dt * 6);
        c.pivot.rotation.x = c.currentAngle;

        c.group.getWorldPosition(c.worldPos);
        if (!state.drivingTruck) {
            const d = state.player.pos.distanceTo(c.worldPos);
            if (d < nearestDist) {
                nearestDist = d;
                state.nearbyCompartment = c;
            }
        }
    }

    // --- Hydrant proximity (only walking) ---
    state.nearbyHydrant = null;
    if (!state.drivingTruck) {
        for (const h of hydrants) {
            if (state.player.pos.distanceTo(h.position) < 2.5) {
                state.nearbyHydrant = h;
                break;
            }
        }
    }

    // --- Interaction prompt ---
    const prompt = document.getElementById('interact-prompt');
    if (state.drivingTruck) {
        prompt.textContent = '[F] Aussteigen';
        prompt.classList.remove('hidden');
    } else if (state.nearbyCompartment) {
        prompt.textContent = `[E] ${state.nearbyCompartment.name} ${
            state.nearbyCompartment.isOpen ? 'schließen' : 'öffnen'}`;
        prompt.classList.remove('hidden');
    } else if (state.nearbyHydrant) {
        prompt.textContent = '[E] Wasser auffüllen';
        prompt.classList.remove('hidden');
    } else if (state.player.pos.distanceTo(state.truckPos) < 6) {
        prompt.textContent = '[F] Einsteigen';
        prompt.classList.remove('hidden');
    } else {
        prompt.classList.add('hidden');
    }

    // --- Hose line update (visible sagging tube from truck to player) ---
    updateHose();
    const hoseEl = document.getElementById('hose-status');
    if (state.hoseConnected) {
        hoseEl.textContent = 'CONNECTED';
        hoseEl.classList.remove('disconnected');
    } else {
        hoseEl.textContent = 'OUT OF RANGE';
        hoseEl.classList.add('disconnected');
    }

    // --- Spraying water (only if walking and hose connected) ---
    if (state.spraying && state.water > 0 && state.running &&
        state.hoseConnected && !state.drivingTruck) {
        const useRate = state.nozzleMode === 'stream' ? 18 : 32;
        state.water = Math.max(0, state.water - dt * useRate);
        const origin = camera.position.clone().add(lookDir.clone().multiplyScalar(0.8));
        origin.y -= 0.25;
        spawnWaterParticles(origin, lookDir);
        updateHUD();
    }

    updateWaterParticles(dt);

    // --- Smoke intensity (distance to nearest unextinguished fire) ---
    let nearestFireDist = Infinity;
    let activeFires = 0;
    for (const fire of state.fires) {
        if (fire.extinguished) continue;
        activeFires++;
        const d = state.player.pos.distanceTo(fire.position);
        if (d < nearestFireDist) nearestFireDist = d;
    }
    // Smoke is thick within SMOKE_RADIUS and fades to 0 at 2x radius
    let targetSmoke = 0;
    if (nearestFireDist < SIM.SMOKE_RADIUS * 2) {
        targetSmoke = Math.max(0,
            1 - (nearestFireDist - SIM.SMOKE_RADIUS * 0.3) /
                (SIM.SMOKE_RADIUS * 1.4));
        targetSmoke = Math.min(1, targetSmoke);
    }
    state.smokeIntensity += (targetSmoke - state.smokeIntensity) * Math.min(1, dt * 3);

    // Adjust fog + tone exposure to sell the smoke
    scene.fog.color.setRGB(
        0.75 - state.smokeIntensity * 0.6,
        0.85 - state.smokeIntensity * 0.7,
        0.94 - state.smokeIntensity * 0.8
    );
    scene.fog.near = 80 - state.smokeIntensity * 70;
    scene.fog.far  = 300 - state.smokeIntensity * 270;
    renderer.toneMappingExposure = 1.05 - state.smokeIntensity * 0.4;

    // --- SCBA air depletion in smoke / refill at hydrant or truck ---
    if (state.running) {
        const outlet = getHoseOutlet();
        const atTruck = state.player.pos.distanceTo(outlet) < 3.5;
        if (state.nearbyHydrant || atTruck) {
            state.air = Math.min(state.maxAir, state.air + dt * SIM.AIR_REFILL_RATE);
        } else if (state.smokeIntensity > 0.2) {
            state.air = Math.max(0,
                state.air - dt * SIM.AIR_DEPLETE_PER_SEC * state.smokeIntensity);
        }
        if (state.air <= 0 && state.smokeIntensity > 0.4) {
            // Suffocation hit - lose a life, respawn at truck
            state.lives = Math.max(0, state.lives - 1);
            state.air = state.maxAir * 0.5;
            state.player.pos.set(10, 1.7, 12);
            showMessage('Keine Luft mehr! Du wurdest evakuiert.', 3);
            updateHUD();
        }
        updateHUD();
    }

    // Low-air warning flash
    const warningEl = document.getElementById('warning-overlay');
    if (state.air < 25 && state.smokeIntensity > 0.3) {
        warningEl.classList.remove('hidden');
    } else {
        warningEl.classList.add('hidden');
    }

    // --- Fire growth: if a fire isn't hit recently, it grows ---
    const now = performance.now() / 1000;
    for (const fire of state.fires) {
        if (fire.extinguished) continue;
        const sinceHit = now - (fire.lastHitTime || 0);
        if (sinceHit > 1.5 && fire.health < SIM.FIRE_MAX_HEALTH) {
            fire.health = Math.min(
                SIM.FIRE_MAX_HEALTH,
                fire.health + SIM.FIRE_GROW_PER_SEC * dt);
        }
        // growScale reflects how big the fire is (0.5 small ... 1.8 raging)
        const targetScale = 0.5 + (fire.health / SIM.FIRE_MAX_HEALTH) * 1.3;
        fire.growScale += (targetScale - fire.growScale) * Math.min(1, dt * 2);
        fire.group.scale.setScalar(fire.growScale);
    }

    // --- Flame animation (billboard sprites) ---
    const t = clock.getElapsedTime();
    for (const fire of state.fires) {
        if (fire.extinguished) continue;
        for (const f of fire.flames) {
            const wobble = Math.sin(t * 10 * f.userData.speed + f.userData.phase);
            f.position.y = f.userData.baseY + wobble * 0.18;
            const pulse = 1 + wobble * 0.12;
            f.scale.set(
                f.userData.baseScale * pulse,
                f.userData.baseScale * 1.4 * pulse,
                f.userData.baseScale * pulse
            );
            f.material.opacity = 0.75 + (Math.sin(t * 14 + f.userData.phase) + 1) * 0.12;
        }
        // Smoke drifts upward and fades at top, wraps back
        for (const s of fire.smoke) {
            s.position.y += s.userData.speed * dt;
            s.position.x += Math.sin(t * 0.5 + s.userData.phase) * dt * 0.3;
            if (s.position.y > s.userData.baseY + 6) {
                s.position.y = s.userData.baseY;
            }
            const lifeFrac = (s.position.y - s.userData.baseY) / 6;
            s.material.opacity = 0.55 * (1 - lifeFrac);
            const ss = 1.5 + lifeFrac * 2;
            s.scale.set(ss, ss, ss);
        }
        fire.light.intensity = 22 + Math.sin(t * 12 + fire.position.x) * 8;
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

    // --- Mission complete / advance ---
    if (!state.levelTransitioning && state.running &&
        state.fires.length > 0 && state.fires.every(f => f.extinguished)) {
        state.levelTransitioning = true;
        const bonus = state.currentMission ? state.currentMission.bonus : 500;
        state.score += bonus;
        state.level++;
        updateHUD();
        showMessage(`EINSATZ ABGESCHLOSSEN  +${bonus} Punkte`, 3);
        setTimeout(() => {
            startMission(state.missionIndex + 1);
            state.water = state.maxWater;
            state.air = state.maxAir;
            state.levelTransitioning = false;
        }, 3000);
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
    document.getElementById('level').textContent = state.level;
    const activeFires = state.fires.filter(f => !f.extinguished).length;
    document.getElementById('fires-left').textContent = activeFires;
    document.getElementById('water-fill').style.width = (state.water / state.maxWater * 100) + '%';
    document.getElementById('air-fill').style.width = (state.air / state.maxAir * 100) + '%';
    document.getElementById('nozzle-mode').textContent =
        state.nozzleMode === 'stream' ? 'VOLLSTRAHL' : 'SPRÜHNEBEL';
    const pat = document.getElementById('nozzle-pattern');
    if (pat) pat.className = 'nozzle-pattern' + (state.nozzleMode === 'fog' ? ' fog' : '');
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
