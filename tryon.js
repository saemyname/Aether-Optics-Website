/* Aether NY — live 3D virtual try-on.
   MediaPipe FaceLandmarker gives a 6DoF head-pose matrix; three.js renders the
   real glasses GLB onto the face over the webcam feed. One shared engine drives
   both hosts: the full-screen overlay (home) and the in-place product stage. */
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/* Fit tuning. Glasses are anchored directly to the eye landmarks: positioned
   at the nose bridge, scaled to the outer-eye-corner span, oriented by the
   head-pose matrix. widthK: frame width ÷ outer-eye-corner distance. ox/oy/oz:
   small head-local nudges (cm) — oz seats the frame onto the face. templeFade
   {Start,End} are model-space Z (metres): the arm dissolves from Start
   (opaque, front) to End (transparent, ear), fading into the head like iOS. */
const TUNE = {
  fovY: 63, near: 1, far: 2000, exposure: 1.3, envIntensity: 1.6,
  widthK: 1.5, ox: 0, oy: 0, oz: 0.6,
  templeSplayBase: 0.55, templeSplayK: 1, templeSign: 1, templeSplayMax: 1.1,
  templeFadeStart: -0.045, templeFadeEnd: -0.12
};
const BRIDGE = 168, R_EYE = 33, L_EYE = 263, R_TEMPLE = 234, L_TEMPLE = 454;

/* ---------- shared engine ---------- */
let landmarker = null, stream = null, raf = null, lastTs = -1;
let three = null, mountEl = null, currentModelUrl = null;
let currentWidth = 0.134, currentDepth = 0.135, currentRef = 0.134, currentHinges = [];
const modelCache = new Map();
const refWidth = new Map(); // frame stem -> reference width, so size variants scale proportionally
const stemOf = url => url.replace(/_(narrow|medium|wide)\.glb$/i, "");
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _pos = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _off = new THREE.Vector3();
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();

async function ensureModel() {
  if (landmarker) return;
  const fs = await FilesetResolver.forVisionTasks(VISION);
  landmarker = await FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1,
    outputFacialTransformationMatrixes: true
  });
}

function ensureThree() {
  if (three) return three;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TUNE.exposure;
  renderer.autoClear = false;
  const canvas = renderer.domElement;
  canvas.className = "tryon-canvas";

  const video = document.createElement("video");
  video.autoplay = true; video.muted = true; video.playsInline = true;
  video.setAttribute("playsinline", ""); video.setAttribute("muted", "");
  video.className = "tryon-video";

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  bgScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    // toneMapped:false keeps the webcam feed true-colour — only the glasses
    // get ACES tone mapping, so the video isn't tinted warm/filmic.
    new THREE.MeshBasicMaterial({ map: videoTex, depthTest: false, depthWrite: false, toneMapped: false })
  ));

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(TUNE.fovY, 1, TUNE.near, TUNE.far);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.4, 1, 1.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7); fill.position.set(-0.6, 0.2, 0.6); scene.add(fill);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = TUNE.envIntensity;

  cam.updateMatrixWorld();
  const glassesRoot = new THREE.Group(); glassesRoot.visible = false; scene.add(glassesRoot);

  three = { renderer, canvas, video, videoTex, bgScene, bgCam, scene, cam, glassesRoot, loader: new GLTFLoader() };
  return three;
}

/* Bake a depth-based alpha gradient into the temple arms so their ear ends
   dissolve instead of clipping through the head. */
function applyTempleFade(root) {
  root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const z0 = TUNE.templeFadeEnd, z1 = TUNE.templeFadeStart;
  root.traverse(o => {
    if (!o.isMesh || !/temple/i.test(o.name)) return;
    const pos = o.geometry.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      let a = (v.z - z0) / (z1 - z0); a = Math.min(1, Math.max(0, a));
      a = a * a * (3 - 2 * a);
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = a;
    }
    o.geometry.setAttribute("color", new THREE.BufferAttribute(col, 4));
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      m.vertexColors = true; m.transparent = true; m.depthWrite = false; m.needsUpdate = true;
    });
  });
}

async function loadModel(url) {
  if (modelCache.has(url)) return modelCache.get(url);
  const gltf = await three.loader.loadAsync(url);
  const root = gltf.scene;
  applyTempleFade(root);
  root.updateWorldMatrix(true, true);
  const hinges = [];
  root.traverse(o => {
    if (/temple_hinge/i.test(o.name)) {
      const wx = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).x;
      hinges.push({ node: o, baseY: o.rotation.y, side: Math.sign(wx) || 1 });
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const width = box.max.x - box.min.x;
  const stem = stemOf(url);
  if (!refWidth.has(stem)) refWidth.set(stem, width); // first-loaded variant anchors the frame's scale
  const entry = { root, width, depth: box.max.z - box.min.z, hinges, stem };
  modelCache.set(url, entry);
  return entry;
}

async function setModel(url) {
  currentModelUrl = url;
  const t = ensureThree();
  const entry = await loadModel(url);
  if (currentModelUrl !== url) return; // superseded while loading
  const g = t.glassesRoot;
  while (g.children.length) g.remove(g.children[0]);
  g.add(entry.root);
  currentWidth = entry.width; currentDepth = entry.depth; currentHinges = entry.hinges;
  currentRef = refWidth.get(entry.stem) || entry.width; // shared across a frame's sizes
}

/* Anchor the frame to the eyes: nose-bridge position, outer-eye-corner scale,
   head-pose rotation. All world units are the head-pose matrix's (centimetres). */
function placeGlasses(lm, mtxData) {
  const t = three, cam = t.cam;
  _m.fromArray(mtxData); _m.decompose(_p, _q, _s);
  const depth = _p.z; // face distance in view space (negative, in front of camera)
  const toWorld = (nx, ny, out) => {
    out.set(nx * 2 - 1, -(ny * 2 - 1), 0.5).unproject(cam);
    return out.multiplyScalar(depth / out.z); // ride the ray out to the face depth
  };
  toWorld(lm[BRIDGE].x, lm[BRIDGE].y, _pos);
  toWorld(lm[R_EYE].x, lm[R_EYE].y, _e1);
  toWorld(lm[L_EYE].x, lm[L_EYE].y, _e2);
  // scale on the frame's shared reference width so different sizes render at
  // their true relative size (medium wider than narrow), not all normalised.
  const scale = (_e1.distanceTo(_e2) * TUNE.widthK) / currentRef;
  const g = t.glassesRoot;
  g.quaternion.copy(_q);
  g.scale.setScalar(scale);
  _off.set(TUNE.ox, TUNE.oy, TUNE.oz).applyQuaternion(_q);
  g.position.copy(_pos).add(_off);

  // Splay the temple arms outward to the head width so they hug the sides of
  // the face instead of clipping through it (real hinges opening wider).
  if (currentHinges.length) {
    toWorld(lm[R_TEMPLE].x, lm[R_TEMPLE].y, _t1);
    toWorld(lm[L_TEMPLE].x, lm[L_TEMPLE].y, _t2);
    const faceW = _t1.distanceTo(_t2), frameW = currentWidth * scale, templeLen = currentDepth * scale;
    let splay = TUNE.templeSplayBase; // always open past rest so the arms clear the face
    if (faceW > frameW && templeLen > 0) splay += Math.asin(Math.min(1, (faceW - frameW) / 2 / templeLen));
    splay = Math.min(splay, TUNE.templeSplayMax) * TUNE.templeSplayK;
    for (const h of currentHinges) h.node.rotation.y = h.baseY - h.side * splay * TUNE.templeSign;
  }
}

function sizeToVideo() {
  const t = three, vw = t.video.videoWidth, vh = t.video.videoHeight;
  if (!vw || !vh) return;
  t.renderer.setSize(vw, vh, false);
  t.cam.aspect = vw / vh; t.cam.updateProjectionMatrix();
}

function mount(container) {
  const t = ensureThree();
  if (mountEl === container) return;
  container.insertBefore(t.canvas, container.firstChild);
  container.insertBefore(t.video, container.firstChild);
  mountEl = container;
}

function loop() {
  raf = requestAnimationFrame(loop);
  const t = three, v = t.video;
  if (v.readyState >= 2 && v.videoWidth) {
    if (t.renderer.domElement.width !== v.videoWidth) sizeToVideo();
    const ts = performance.now();
    if (ts !== lastTs) {
      lastTs = ts;
      let r = null;
      try { r = landmarker.detectForVideo(v, ts); } catch (e) {}
      const lm = r && r.faceLandmarks && r.faceLandmarks[0];
      const mtx = r && r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
      if (lm && mtx) { placeGlasses(lm, mtx.data); t.glassesRoot.visible = true; }
      else { t.glassesRoot.visible = false; }
    }
    t.videoTex.needsUpdate = true;
  }
  t.renderer.clear();
  t.renderer.render(t.bgScene, t.bgCam);
  t.renderer.clearDepth();
  t.renderer.render(t.scene, t.cam);
}

async function startEngine(container, modelUrl) {
  const t = ensureThree();
  mount(container);
  await ensureModel();
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
    });
  }
  t.video.srcObject = stream;
  await t.video.play().catch(() => {});
  sizeToVideo();
  await setModel(modelUrl);
  if (!raf) loop();
}

function stopEngine() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; }
  if (three) {
    if (three.video.parentNode) three.video.parentNode.removeChild(three.video);
    if (three.canvas.parentNode) three.canvas.parentNode.removeChild(three.canvas);
    three.video.srcObject = null;
    three.glassesRoot.visible = false;
  }
  mountEl = null; lastTs = -1;
}

function capture(name) {
  if (!three) return;
  const a = document.createElement("a");
  a.href = three.renderer.domElement.toDataURL("image/png");
  a.download = "aether-tryon-" + (name || "look") + ".png";
  a.click();
}

/* Live-tuning helper (console): AetherTryOn.engine.retune({widthK:1.6, oy:0.3})
   widthK/ox/oy/oz apply next frame; fov and templeFade take effect here. */
function retune(patch) {
  Object.assign(TUNE, patch);
  if (three) { three.cam.fov = TUNE.fovY; three.cam.updateProjectionMatrix(); }
  if (("templeFadeStart" in patch || "templeFadeEnd" in patch) && currentModelUrl) {
    modelCache.delete(currentModelUrl);
    return setModel(currentModelUrl);
  }
}

/* ---------- Host A: full-screen overlay (home / anywhere) ---------- */
const el = {};
function frameList() {
  return (window.CATALOG || []).map(it => ({
    id: it.id, name: it.name, price: it.price,
    model: it.colorways[0].model, image: it.colorways[0].image
  }));
}
let ovFrames = [], ovCurrent = 0;

function buildOverlay() {
  if (el.root) return;
  const root = document.createElement("div");
  root.className = "to-overlay";
  root.innerHTML = `
    <div class="to-top">
      <span class="brand">Aether <b>NY</b></span>
      <div class="to-title">Virtual Try-On<small>Live camera · 3D</small></div>
      <button class="to-close" aria-label="Close try-on">✕</button>
    </div>
    <div class="to-stage"><div class="to-view">
      <div class="to-hint">Center your face · turn slowly to see the fit</div>
      <div class="to-status"><div>
        <span class="eyebrow">Virtual try-on</span>
        <h3 class="s-title">Ready when you are</h3>
        <p class="s-msg">We’ll use your camera to place the frames on your face. Nothing is recorded or uploaded.</p>
        <div class="s-action"></div>
      </div></div>
    </div></div>
    <div class="to-dock">
      <div class="to-current"><span class="n"></span><span class="p"></span></div>
      <div class="to-strip"></div>
      <div class="to-actions">
        <button class="btn btn-light cap">Capture look</button>
        <a class="btn btn-ghost shop" style="color:var(--paper);border-color:rgba(246,243,237,.3)" href="shop.html">View in shop</a>
      </div>
    </div>`;
  document.body.appendChild(root);
  el.root = root;
  el.view = root.querySelector(".to-view");
  el.status = root.querySelector(".to-status");
  el.sTitle = root.querySelector(".s-title");
  el.sMsg = root.querySelector(".s-msg");
  el.sAction = root.querySelector(".s-action");
  el.strip = root.querySelector(".to-strip");
  el.name = root.querySelector(".to-current .n");
  el.price = root.querySelector(".to-current .p");
  el.shop = root.querySelector(".shop");
  root.querySelector(".to-close").addEventListener("click", closeOverlay);
  root.querySelector(".cap").addEventListener("click", () => capture(ovFrames[ovCurrent].id));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && el.root.classList.contains("open")) closeOverlay(); });
}
function ovStatus(t, m, a) { el.status.classList.remove("hide"); el.sTitle.textContent = t; el.sMsg.textContent = m; el.sAction.innerHTML = a || ""; }
function ovSetCurrent(i) {
  ovCurrent = i; const f = ovFrames[i];
  el.name.textContent = f.name; el.price.textContent = "$" + f.price;
  el.shop.href = "product.html?id=" + encodeURIComponent(f.id);
  el.strip.querySelectorAll(".to-thumb").forEach((b, k) => b.classList.toggle("on", k === i));
  if (raf) setModel(f.model);
}
async function overlayRun() {
  ovStatus("Loading face tracking…", "One moment — readying the fitting mirror.", `<div class="to-spinner"></div>`);
  try { await ensureModel(); } catch (e) {
    ovStatus("Couldn’t load try-on", "The face-tracking engine failed to load. Check your connection and try again.", `<button class="btn btn-light retry">Try again</button>`);
    el.sAction.querySelector(".retry")?.addEventListener("click", overlayRun); return;
  }
  ovStatus("Starting camera…", "Allow camera access to try the frames on.", `<div class="to-spinner"></div>`);
  try { await startEngine(el.view, ovFrames[ovCurrent].model); }
  catch (e) {
    ovStatus("Camera blocked", "Allow camera access in your browser, then reopen try-on. Your camera stays on your device.", `<button class="btn btn-light retry">Try again</button>`);
    el.sAction.querySelector(".retry")?.addEventListener("click", overlayRun); return;
  }
  el.status.classList.add("hide");
}
function openOverlay(itemId) {
  buildOverlay();
  ovFrames = frameList(); if (!ovFrames.length) return;
  const idx = ovFrames.findIndex(f => f.id === itemId);
  ovCurrent = idx >= 0 ? idx : 0;
  el.strip.innerHTML = ovFrames.map((f, i) => `<button class="to-thumb ${i === ovCurrent ? "on" : ""}" data-i="${i}" aria-label="${f.name}"><img src="${f.image}" alt=""></button>`).join("");
  el.strip.querySelectorAll(".to-thumb").forEach(b => b.addEventListener("click", () => ovSetCurrent(+b.dataset.i)));
  ovSetCurrent(ovCurrent);
  el.root.classList.add("open");
  document.body.style.overflow = "hidden";
  overlayRun();
}
function closeOverlay() { stopEngine(); el.root.classList.remove("open"); document.body.style.overflow = ""; }

/* wire global [data-tryon] triggers (used on home) */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tryon]");
  if (!t) return;
  e.preventDefault();
  openOverlay(t.getAttribute("data-tryon") || null);
});

/* Public API: full-screen for home, engine for the product in-place stage. */
window.AetherTryOn = {
  open: openOverlay,
  engine: { start: startEngine, setModel, stop: stopEngine, capture, ensureModel, retune },
  debug: { three: () => three, hinges: () => currentHinges, TUNE }
};
