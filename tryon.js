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

/* Fit tuning. The head-pose matrix and glasses live in the canonical face
   frame; models are in metres, the matrix in centimetres, hence scale ≈ 100.
   offset places the frame on the nose bridge (cm). templeFade{Start,End} are
   model-space Z (metres): the arm dissolves from Start (opaque, front) to End
   (transparent, ear) so the temples fade into the head like the iOS app. */
const TUNE = {
  fovY: 63, near: 1, far: 2000,
  scale: 100, ox: 0, oy: 1.2, oz: 5.2,
  templeFadeStart: -0.045, templeFadeEnd: -0.12
};

/* ---------- shared engine ---------- */
let landmarker = null, stream = null, raf = null, lastTs = -1;
let three = null, mountEl = null, currentModelUrl = null;
const modelCache = new Map();

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
  renderer.toneMappingExposure = 1.05;
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
    new THREE.MeshBasicMaterial({ map: videoTex, depthTest: false, depthWrite: false })
  ));

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(TUNE.fovY, 1, TUNE.near, TUNE.far);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(0.4, 1, 1.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-0.6, 0.2, 0.6); scene.add(fill);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const faceGroup = new THREE.Group(); faceGroup.matrixAutoUpdate = false; scene.add(faceGroup);
  const glassesRoot = new THREE.Group(); glassesRoot.visible = false; faceGroup.add(glassesRoot);

  three = { renderer, canvas, video, videoTex, bgScene, bgCam, scene, cam, faceGroup, glassesRoot, loader: new GLTFLoader() };
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
  modelCache.set(url, root);
  return root;
}

async function setModel(url) {
  currentModelUrl = url;
  const t = ensureThree();
  const root = await loadModel(url);
  if (currentModelUrl !== url) return; // superseded while loading
  const g = t.glassesRoot;
  while (g.children.length) g.remove(g.children[0]);
  g.add(root);
  g.scale.setScalar(TUNE.scale);
  g.position.set(TUNE.ox, TUNE.oy, TUNE.oz);
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
      const mtx = r && r.facialTransformationMatrixes && r.facialTransformationMatrixes[0];
      if (mtx) { t.faceGroup.matrix.fromArray(mtx.data); t.glassesRoot.visible = true; }
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

/* Live-tuning helper (console): AetherTryOn.engine.retune({oy:1.5, scale:105}) */
function retune(patch) {
  Object.assign(TUNE, patch);
  if (three) { three.cam.fov = TUNE.fovY; three.cam.updateProjectionMatrix(); }
  if (currentModelUrl) { modelCache.delete(currentModelUrl); return setModel(currentModelUrl); }
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
  engine: { start: startEngine, setModel, stop: stopEngine, capture, ensureModel, retune }
};
