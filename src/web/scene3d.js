import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const ALT_SCALE = 2;   // exagerează altitudinea (la fel ca în varianta 2D)
const CAR_SCALE = 7;   // mărimea mașinii față de scenă
const FIT_HALF_SCENE = 180; // un traseu mic e mărit până ocupă ~±180 unități (grila are ±280)
const MIN_FIT_HALF_M = 4;   // nu mărim mai mult de atât: ±4 m umple scena (jitter-ul GPS rămâne mic)
const MAX_ZOOM = FIT_HALF_SCENE / MIN_FIT_HALF_M;
const MIN_POINT_GAP_M = 0.3; // puncte mai apropiate de atât nu se mai adaugă

// date: x, y = planul solului, z = altitudine  ->  three: X, Y(sus), Z
const toScene = (p) => new THREE.Vector3(p.x, (p.z || 0) * ALT_SCALE, p.y);

export function bodyColorFor(car) {
  const s = `${car.imageBase || car.imageUrl || ""} ${car.name || ""}`.toLowerCase();
  return s.includes("red") || s.includes("taycan") ? 0xb3122f : 0xc3c9d2;
}

/* ------------------------------------------------------------------ */
/*  Constructor geometrie sculptată (lofting pe secțiuni transversale) */
/* ------------------------------------------------------------------ */
function buildSculptedShell(stations, radialSegs = 28) {
  // Fiecare stație: { z, yBottom, yTop, halfW, crown, shoulder }
  const positions = [];
  const uvs = [];
  const indices = [];

  const rows = stations.length;
  const cols = radialSegs + 1;

  for (let i = 0; i < rows; i++) {
    const st = stations[i];
    const vCoord = i / (rows - 1);

    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2; // 0 = dreapta, PI/2 = sus, PI = stânga, 3PI/2 = jos

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Profil transversal super-eliptic: lat la umeri, rotunjit sus
      const signX = Math.sign(cosT);
      const absX = Math.abs(cosT);
      const x = signX * Math.pow(absX, st.shoulder || 0.72) * st.halfW;

      let y;
      if (sinT >= 0) {
        const hTop = st.yTop - st.yMid;
        y = st.yMid + Math.pow(sinT, st.crown || 0.85) * hTop;
      } else {
        const hBot = st.yMid - st.yBottom;
        y = st.yMid - Math.pow(-sinT, 0.55) * hBot;
      }

      positions.push(x, y, st.z);
      uvs.push(u, vCoord);
    }
  }

  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = (i + 1) * cols + (j + 1);
      const d = i * cols + (j + 1);
      indices.push(a, d, b, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/*  Mașina 3D Porsche (fața = +Z)                                      */
/* ------------------------------------------------------------------ */
function buildCar(bodyColor) {
  const isTaycan = bodyColor === 0xb3122f;
  const g = new THREE.Group();

  const paint = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    metalness: 0.55,
    roughness: 0.20,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x070b12,
    metalness: 0.1,
    roughness: 0.06,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.90
  });

  const darkTrim = new THREE.MeshStandardMaterial({
    color: 0x11151d,
    roughness: 0.55,
    metalness: 0.35
  });

  const tire = new THREE.MeshStandardMaterial({
    color: 0x0f1217,
    roughness: 0.88
  });

  const rim = new THREE.MeshStandardMaterial({
    color: 0xe6ecf5,
    metalness: 0.92,
    roughness: 0.16
  });

  const caliper = new THREE.MeshStandardMaterial({
    color: isTaycan ? 0xfacc15 : 0xef4444,
    metalness: 0.35,
    roughness: 0.28
  });

  // 1. CAROSERIA INFERIOARĂ SCULPTATĂ (cu talie îngustată la uși și aripi evazate)
  const bodyStations = isTaycan
    ? [
        { z: -5.35, yBottom: 0.62, yMid: 1.15, yTop: 1.48, halfW: 0.40, shoulder: 0.85, crown: 0.9 },
        { z: -5.15, yBottom: 0.54, yMid: 1.18, yTop: 1.72, halfW: 1.98, shoulder: 0.65, crown: 0.85 },
        { z: -4.20, yBottom: 0.48, yMid: 1.24, yTop: 1.88, halfW: 2.26, shoulder: 0.62, crown: 0.80 }, // aripi spate late
        { z: -2.80, yBottom: 0.46, yMid: 1.22, yTop: 1.86, halfW: 2.28, shoulder: 0.62, crown: 0.80 },
        { z: -0.50, yBottom: 0.46, yMid: 1.16, yTop: 1.76, halfW: 2.08, shoulder: 0.68, crown: 0.85 }, // talie uși
        { z:  1.80, yBottom: 0.46, yMid: 1.14, yTop: 1.72, halfW: 2.12, shoulder: 0.66, crown: 0.85 },
        { z:  3.30, yBottom: 0.48, yMid: 1.12, yTop: 1.66, halfW: 2.22, shoulder: 0.60, crown: 0.80 }, // aripi față
        { z:  4.65, yBottom: 0.50, yMid: 1.00, yTop: 1.38, halfW: 2.02, shoulder: 0.68, crown: 0.85 }, // bot plonjat
        { z:  5.28, yBottom: 0.54, yMid: 0.86, yTop: 1.08, halfW: 1.55, shoulder: 0.80, crown: 0.95 },
        { z:  5.42, yBottom: 0.64, yMid: 0.82, yTop: 0.94, halfW: 0.45, shoulder: 0.90, crown: 1.00 }
      ]
    : [
        { z: -5.10, yBottom: 0.62, yMid: 1.18, yTop: 1.52, halfW: 0.40, shoulder: 0.85, crown: 0.9 },
        { z: -4.90, yBottom: 0.54, yMid: 1.22, yTop: 1.80, halfW: 1.96, shoulder: 0.65, crown: 0.85 },
        { z: -3.80, yBottom: 0.48, yMid: 1.28, yTop: 1.96, halfW: 2.28, shoulder: 0.60, crown: 0.78 }, // șolduri late 911 Turbo
        { z: -2.40, yBottom: 0.46, yMid: 1.24, yTop: 1.90, halfW: 2.24, shoulder: 0.62, crown: 0.80 },
        { z: -0.20, yBottom: 0.46, yMid: 1.16, yTop: 1.76, halfW: 2.02, shoulder: 0.68, crown: 0.85 }, // talie uși
        { z:  1.90, yBottom: 0.46, yMid: 1.14, yTop: 1.74, halfW: 2.06, shoulder: 0.66, crown: 0.85 },
        { z:  3.25, yBottom: 0.48, yMid: 1.14, yTop: 1.72, halfW: 2.18, shoulder: 0.58, crown: 0.78 }, // aripi faruri 911
        { z:  4.55, yBottom: 0.50, yMid: 1.02, yTop: 1.44, halfW: 1.96, shoulder: 0.66, crown: 0.85 },
        { z:  5.08, yBottom: 0.56, yMid: 0.88, yTop: 1.12, halfW: 1.48, shoulder: 0.80, crown: 0.95 },
        { z:  5.22, yBottom: 0.66, yMid: 0.84, yTop: 0.96, halfW: 0.42, shoulder: 0.90, crown: 1.00 }
      ];

  g.add(new THREE.Mesh(buildSculptedShell(bodyStations, 32), paint));

  // 2. HABITACLUL VITRAT SEPARAT (îngustat spre plafon — nu mai e îngropat în metal!)
  const cabinStations = isTaycan
    ? [
        { z: -4.15, yBottom: 1.76, yMid: 1.84, yTop: 1.92, halfW: 1.38, shoulder: 0.78, crown: 0.85 },
        { z: -2.90, yBottom: 1.76, yMid: 2.08, yTop: 2.46, halfW: 1.56, shoulder: 0.74, crown: 0.80 },
        { z: -1.40, yBottom: 1.70, yMid: 2.18, yTop: 2.68, halfW: 1.54, shoulder: 0.74, crown: 0.78 },
        { z:  0.10, yBottom: 1.66, yMid: 2.16, yTop: 2.66, halfW: 1.50, shoulder: 0.75, crown: 0.78 },
        { z:  1.45, yBottom: 1.64, yMid: 1.96, yTop: 2.26, halfW: 1.54, shoulder: 0.76, crown: 0.82 },
        { z:  2.45, yBottom: 1.62, yMid: 1.70, yTop: 1.78, halfW: 1.46, shoulder: 0.82, crown: 0.90 }
      ]
    : [
        { z: -3.95, yBottom: 1.82, yMid: 1.90, yTop: 1.98, halfW: 1.34, shoulder: 0.78, crown: 0.85 },
        { z: -2.50, yBottom: 1.80, yMid: 2.14, yTop: 2.54, halfW: 1.52, shoulder: 0.74, crown: 0.80 },
        { z: -0.95, yBottom: 1.72, yMid: 2.24, yTop: 2.78, halfW: 1.48, shoulder: 0.74, crown: 0.76 },
        { z:  0.35, yBottom: 1.68, yMid: 2.20, yTop: 2.72, halfW: 1.46, shoulder: 0.75, crown: 0.78 },
        { z:  1.50, yBottom: 1.66, yMid: 1.98, yTop: 2.28, halfW: 1.50, shoulder: 0.76, crown: 0.82 },
        { z:  2.35, yBottom: 1.64, yMid: 1.72, yTop: 1.80, halfW: 1.42, shoulder: 0.82, crown: 0.90 }
      ];

  g.add(new THREE.Mesh(buildSculptedShell(cabinStations, 28), glass));

  // Panou plafon vopsit peste habitaclu (lasă parbrizul, geamurile laterale și luneta din sticlă)
  const roofStations = isTaycan
    ? [
        { z: -2.30, yBottom: 2.48, yMid: 2.54, yTop: 2.60, halfW: 1.24, shoulder: 0.75, crown: 0.82 },
        { z: -1.10, yBottom: 2.60, yMid: 2.66, yTop: 2.72, halfW: 1.28, shoulder: 0.75, crown: 0.80 },
        { z:  0.15, yBottom: 2.58, yMid: 2.64, yTop: 2.70, halfW: 1.24, shoulder: 0.75, crown: 0.82 }
      ]
    : [
        { z: -2.05, yBottom: 2.56, yMid: 2.62, yTop: 2.68, halfW: 1.20, shoulder: 0.75, crown: 0.82 },
        { z: -0.85, yBottom: 2.68, yMid: 2.75, yTop: 2.82, halfW: 1.24, shoulder: 0.75, crown: 0.80 },
        { z:  0.30, yBottom: 2.64, yMid: 2.70, yTop: 2.76, halfW: 1.20, shoulder: 0.75, crown: 0.82 }
      ];
  g.add(new THREE.Mesh(buildSculptedShell(roofStations, 20), paint));

  // 3. ELEMENTE AERODINAMICE (Splitter față, praguri, difuzor spate, oglinzi)
  const zFrontBumper = isTaycan ? 5.15 : 4.95;
  const zRearBumper = isTaycan ? -5.12 : -4.88;

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.14, 0.65), darkTrim);
  splitter.position.set(0, 0.48, zFrontBumper - 0.15);
  g.add(splitter);

  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.34, 0.55), darkTrim);
  diffuser.position.set(0, 0.64, zRearBumper + 0.12);
  g.add(diffuser);

  // 4. ELERON SPATE (Porsche 911 Turbo S)
  if (!isTaycan) {
    const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.10, 0.78), paint);
    wingBlade.position.set(0, 2.15, -4.45);
    wingBlade.rotation.x = -0.07;
    g.add(wingBlade);

    for (const sx of [-1.28, 1.28]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.34, 0.38), darkTrim);
      pylon.position.set(sx, 1.96, -4.38);
      g.add(pylon);
    }

    // 4 evacuări sport rotunde în difuzor
    for (const ex of [-1.25, -0.95, 0.95, 1.25]) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.3, 14).rotateX(Math.PI / 2),
        rim
      );
      pipe.position.set(ex, 0.62, zRearBumper - 0.05);
      g.add(pipe);
    }
  }

  // Oglinzi laterale aerodinamice pe braț
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.14), darkTrim);
    arm.position.set(sx * 1.88, 1.76, 1.48);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.20, 0.36), paint);
    mirror.position.set(sx * 2.12, 1.82, 1.42);
    g.add(arm, mirror);

    // Prag lateral negru
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 4.8), darkTrim);
    skirt.position.set(sx * 2.02, 0.48, -0.1);
    g.add(skirt);
  }

  // 5. ROȚI SPORT CU ARCE DE ROATĂ EVAZATE, JANTE SPIȚATE & ETRIERE
  const wheelGeo = new THREE.CylinderGeometry(0.84, 0.84, 0.74, 32).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.77, 24).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.80, 16).rotateZ(Math.PI / 2);
  const archGeo = new THREE.TorusGeometry(0.92, 0.11, 12, 28, Math.PI).rotateY(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.79, 0.075, 1.08);
  const caliperGeo = new THREE.BoxGeometry(0.56, 0.34, 0.26);

  const zFront = isTaycan ? 3.28 : 3.18;
  const zRear = isTaycan ? -3.28 : -3.18;

  for (const sx of [-1, 1]) {
    for (const zPos of [zFront, zRear]) {
      const xWheel = sx * 1.96;

      // Pasaj aripă
      const arch = new THREE.Mesh(archGeo, paint);
      arch.position.set(sx * 2.08, 0.84, zPos);
      g.add(arch);

      // Pasaj interior negru
      const liner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.90, 0.90, 0.80, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2),
        darkTrim
      );
      liner.position.set(xWheel - sx * 0.04, 0.84, zPos);
      g.add(liner);

      // Anvelopă, jantă, capac central
      const w = new THREE.Mesh(wheelGeo, tire);
      w.position.set(xWheel, 0.84, zPos);
      const r = new THREE.Mesh(rimGeo, rim);
      r.position.copy(w.position);
      const hub = new THREE.Mesh(hubGeo, darkTrim);
      hub.position.copy(w.position);
      g.add(w, r, hub);

      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(spokeGeo, darkTrim);
        sp.position.copy(w.position);
        sp.rotation.x = (k * Math.PI) / 5;
        g.add(sp);
      }

      const cal = new THREE.Mesh(caliperGeo, caliper);
      cal.position.set(xWheel, 1.00, zPos - 0.22);
      g.add(cal);
    }
  }

  // 6. FARURI LED PORSCHE (4-puncte) & BANDĂ LUMINOASĂ SPATE CONTINUĂ
  const head = new THREE.MeshBasicMaterial({ color: 0xf8fbff });
  const drl = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const tail = new THREE.MeshBasicMaterial({ color: 0xff1e2d });

  for (const sx of [-1.42, 1.42]) {
    if (isTaycan) {
      // Faruri orizontale înguste + priză verticală Air Curtain Taycan
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.16, 0.24), head);
      h.position.set(sx, 1.18, 4.92);
      h.rotation.y = sx * -0.18;
      const curtain = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.48, 0.22), drl);
      curtain.position.set(sx * 1.18, 0.96, 5.02);
      g.add(h, curtain);
    } else {
      // Faruri ovale Porsche 911 încastrate în aripi
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), head);
      h.scale.set(1.15, 0.62, 0.85);
      h.position.set(sx, 1.32, 4.68);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.09, 0.22), drl);
      strip.position.set(sx, 0.96, 4.92);
      g.add(h, strip);
    }
  }

  // Bandă stop LED roșie pe toată lățimea spatelui
  const bar = new THREE.Mesh(new THREE.BoxGeometry(3.45, 0.13, 0.20), tail);
  bar.position.set(0, 1.54, isTaycan ? -5.14 : -4.88);
  g.add(bar);

  return g;
}

/* ------------------------------------------------------------------ */
/*  Drumul de pe sol (panglică colorată) + stâlpi verticali           */
/* ------------------------------------------------------------------ */
function buildRibbon(pts) {
  const n = pts.length;
  const geo = new THREE.BufferGeometry();
  if (n < 2) return geo;

  const pos = new Float32Array(n * 6);
  const col = new Float32Array(n * 6);
  const idx = [];
  const asphalt = new THREE.Color(0x3b4452);
  const gravel = new THREE.Color(0x9a7634);

  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.y - a.y;
    const len = Math.hypot(dx, dz) || 1;
    const rough = pts[i].rough > 0.3;
    const w = rough ? 2.0 : 1.2;
    const nx = (-dz / len) * w;
    const nz = (dx / len) * w;

    pos.set([pts[i].x + nx, 0.2, pts[i].y + nz, pts[i].x - nx, 0.2, pts[i].y - nz], i * 6);
    const c = rough ? gravel : asphalt;
    col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);

    if (i < n - 1) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function buildPoles(pts) {
  const v = [];
  for (const p of pts) {
    if (p.n % 6 === 0) v.push(p.x, 0.2, p.y, p.x, (p.z || 0) * ALT_SCALE, p.y);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return geo;
}

/* ------------------------------------------------------------------ */
/*  Scena                                                              */
/* ------------------------------------------------------------------ */
class CarScene {
  constructor(el, o = {}) {
    this.el = el;
    this.maxPoints = o.maxPoints || Infinity;
    this.trailColor = new THREE.Color(o.trailColor || "#38bdf8");
    this.pts = [];
    this._fit = { k: 1, cx: 0, cy: 0 };
    this._counter = 0;
    this._hist = [];
    this._target = new THREE.Vector3();
    this._targetQ = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
    this._placed = false;
    this._rough = 0;
    this._labelKey = "";
    this._dirty = false;
    this._lastBuild = 0;
    this.mode = "free";

    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const w = el.clientWidth || 640;
    const h = el.clientHeight || 270;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, 1, 4000);
    this.home = { pos: new THREE.Vector3(0, 200, 380), target: new THREE.Vector3(0, 15, 0) };
    this.camera.position.copy(this.home.pos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    el.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = o.zoom !== false;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 900;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.target.copy(this.home.target);

    // lumini
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x222a38, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(200, 400, 250);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.8);
    rim.position.set(-200, 150, -300);
    this.scene.add(rim);

    const grid = new THREE.GridHelper(560, 16, 0x2a3446, 0x1c2431);
    grid.material.transparent = true;
    grid.material.opacity = 0.8;
    this.scene.add(grid);

    // traiectoria
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: this.trailColor }));
    this.ribbon = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    );
    this.poles = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: this.trailColor, transparent: true, opacity: 0.25 })
    );
    this.tube.frustumCulled = this.ribbon.frustumCulled = this.poles.frustumCulled = false;
    this.scene.add(this.tube, this.ribbon, this.poles);

    // mașina
    this.car = new THREE.Group();
    this.model = buildCar(o.bodyColor ?? 0xc3c9d2);
    this.model.scale.setScalar(CAR_SCALE);
    this.car.add(this.model);
    this.scene.add(this.car);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.scale.setScalar(CAR_SCALE * 3.2);
    this.scene.add(this.shadow);

    this.pole = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 })
    );
    this.pole.frustumCulled = false;
    this.scene.add(this.pole);

    // eticheta de altitudine + butoanele de cameră
    this.label = document.createElement("div");
    this.label.className = "scene-label";
    el.appendChild(this.label);

    const tools = document.createElement("div");
    tools.className = "scene-tools";
    this._btns = {};
    [["free", "Vedere generală"], ["follow", "Urmărește"], ["chase", "Din spate"]].forEach(([m, txt]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "scene-btn";
      b.textContent = txt;
      b.addEventListener("click", () => this.setMode(m));
      tools.appendChild(b);
      this._btns[m] = b;
    });
    el.appendChild(tools);
    this.setMode("free", false);

    this._ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(W, H, false);
    });
    this._ro.observe(el);

    this._raf = requestAnimationFrame(this._tick);
  }

  /* ---- API ---- */

  setPath(points) {
    this.pts = points.map((p, i) => ({ x: p.x, y: p.y, z: p.z, rough: p.rough || 0, n: i }));
    this._counter = this.pts.length;
    this._updateFit();
    this._rebuild();
  }

  pushPoint(p) {
    const last = this.pts[this.pts.length - 1];
    // prag mic (30 cm), ca și o plimbare de câțiva metri să lase urmă
    if (last && Math.hypot(p.x - last.x, p.y - last.y, (p.z || 0) - (last.z || 0)) < MIN_POINT_GAP_M) return;
    this.pts.push({ x: p.x, y: p.y, z: p.z, rough: p.rough || 0, n: this._counter++ });
    if (this.pts.length > this.maxPoints) this.pts.shift();
    this._updateFit();
    this._dirty = true;
  }

  /** Golește traseul (de ex. la o cursă nouă). */
  clear() {
    this.pts = [];
    this._hist = [];
    this._placed = false;
    this._fit = { k: 1, cx: 0, cy: 0 };
    this._rebuild();
  }

  setCar(p) {
    const v = toScene(this._fitPoint(p));
    this._hist.push(v);
    if (this._hist.length > 8) this._hist.shift();
    this._place(v, v.clone().sub(this._hist[0]), p);
  }

  setCarAt(i, snap = false) {
    const n = this.pts.length;
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const a = toScene(this._fitPoint(this.pts[Math.max(0, i - 3)]));
    const b = toScene(this._fitPoint(this.pts[Math.min(n - 1, i + 3)]));
    this._place(toScene(this._fitPoint(this.pts[i])), b.sub(a), this.pts[i]);
    if (snap) {
      this.car.position.copy(this._target);
      this.car.quaternion.copy(this._targetQ);
    }
  }

  setMode(m, reset = true) {
    this.mode = m;
    Object.entries(this._btns).forEach(([k, b]) => b.classList.toggle("active", k === m));
    if (m === "free" && reset) {
      this.camera.position.copy(this.home.pos);
      this.controls.target.copy(this.home.target);
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.renderer.dispose();
    this.el.replaceChildren();
  }

  /* ---- intern ---- */

  _place(v, dir, p) {
    this._target.copy(v);
    this._rough = p.rough || 0;

    const h = Math.hypot(dir.x, dir.z);
    if (h > 0.01) {
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = THREE.MathUtils.clamp(Math.atan2(dir.y, h), -0.5, 0.5);
      this._targetQ.setFromEuler(new THREE.Euler(-pitch, yaw, 0, "YXZ"));
    }
    if (!this._placed) {
      this.car.position.copy(v);
      this.car.quaternion.copy(this._targetQ);
      this._placed = true;
    }

    const rough = this._rough > 0.5;
    const key = `${(p.z || 0).toFixed(1)}|${rough}`;
    if (key !== this._labelKey) {
      this._labelKey = key;
      this.label.innerHTML = `+${(p.z || 0).toFixed(1)}m${rough ? "<small>drum neasfaltat</small>" : ""}`;
    }
  }

  _rebuild() {
    this._dirty = false;
    this._lastBuild = performance.now();
    const set = (obj, geo) => {
      obj.geometry.dispose();
      obj.geometry = geo;
    };
    const pts = this.pts;
    if (pts.length < 2) {
      set(this.tube, new THREE.BufferGeometry());
      set(this.ribbon, new THREE.BufferGeometry());
      set(this.poles, new THREE.BufferGeometry());
      return;
    }
    const fitted = pts.map((p) => this._fitPoint(p));
    const curve = new THREE.CatmullRomCurve3(fitted.map(toScene), false, "centripetal");
    set(this.tube, new THREE.TubeGeometry(curve, Math.min(pts.length * 3, 1500), 1.1, 6, false));
    set(this.ribbon, buildRibbon(fitted));
    set(this.poles, buildPoles(fitted));
  }

  /**
   * Scara automată: scena e gândită pentru trasee de sute de metri (grila are 560 de unități).
   * Un traseu de câțiva metri ar fi un punct în mijlocul ei, așa că îl mărim (și îl centrăm)
   * până umple scena. Traseele mari rămân la scara 1:1, ca înainte.
   */
  _updateFit() {
    if (!this.pts.length) {
      this._fit = { k: 1, cx: 0, cy: 0 };
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const half = Math.max(maxX - minX, maxY - minY, 2 * MIN_FIT_HALF_M) / 2;
    const k = Math.min(MAX_ZOOM, Math.max(1, FIT_HALF_SCENE / half));
    this._fit = k > 1 ? { k, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 } : { k: 1, cx: 0, cy: 0 };
  }

  /** Punct în metri -> punct scalat pentru scenă (altitudinea rămâne în metri, cu ALT_SCALE). */
  _fitPoint(p) {
    const { k, cx, cy } = this._fit;
    if (k === 1 && cx === 0 && cy === 0) return p;
    return { ...p, x: (p.x - cx) * k, y: (p.y - cy) * k };
  }

  /** Metri reali per unitate de scenă (pentru afișarea scării). */
  get metersPerUnit() {
    return 1 / this._fit.k;
  }

  _tick = (now) => {
    this._raf = requestAnimationFrame(this._tick);
    const time = now / 1000;

    if (this._dirty && now - this._lastBuild > 250) this._rebuild();

    this.car.position.lerp(this._target, 0.35);
    this.car.quaternion.slerp(this._targetQ, 0.18);

    this.model.position.y = this._rough * Math.sin(time * 38) * 0.9;
    this.model.rotation.z = this._rough * Math.sin(time * 31) * 0.014;

    const c = this.car.position;
    this.shadow.position.set(c.x, 0.3, c.z);
    const pa = this.pole.geometry.attributes.position;
    pa.setXYZ(0, c.x, 0.3, c.z);
    pa.setXYZ(1, c.x, c.y, c.z);
    pa.needsUpdate = true;

    if (this.mode === "follow") {
      const before = this.controls.target.clone();
      this.controls.target.lerp(c, 0.12);
      this.camera.position.add(this.controls.target.clone().sub(before));
    } else if (this.mode === "chase") {
      const fwd = this._tmp.set(0, 0, 1).applyQuaternion(this.car.quaternion);
      fwd.y = 0;
      fwd.normalize();
      const want = c.clone().addScaledVector(fwd, -CAR_SCALE * 11);
      want.y += CAR_SCALE * 4.5;
      this.camera.position.lerp(want, 0.08);
      this.controls.target.lerp(c, 0.2);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const v = this._tmp.copy(c);
    v.y += CAR_SCALE * 3.6 + 8;
    v.project(this.camera);
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    this.label.style.display = v.z < 1 ? "block" : "none";
    this.label.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -100%)`;
  };
}

export function createCarScene(container, opts) {
  return new CarScene(container, opts);
}