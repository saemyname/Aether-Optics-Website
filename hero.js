/* Aether NY — reusable 3D frame viewer. The hero lens circle shows one frame;
   the try-on viewport runs a scanline wipe: as the cognac line sweeps up, the
   next frame is revealed below it (two models split by a moving clip plane).
   Studio "lightbox" lighting bakes crisp reflections onto the acetate & metal. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map();
function loadModel(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  return loader.loadAsync(url).then(gltf => {
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    root.position.sub(box.getCenter(new THREE.Vector3())); // centre on origin
    root.userData.size = box.getSize(new THREE.Vector3());
    cache.set(url, root);
    return root;
  });
}

function mountViewer(mount, opts) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const FOV_T = Math.tan((cam.fov * Math.PI / 180) / 2);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(0.5, 0.9, 1.1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-0.7, 0.3, -0.6); scene.add(rim);

  // A small studio "lightbox": bright softbox panels on a dark surround → crisp,
  // sparkly reflections, with a soft catch-light band across the lenses.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x13131a);
  const panel = (x, y, z, w, h, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.material.color.setScalar(i); m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
  };
  panel(0, 1.5, 2.6, 5, 1.7, 7);
  panel(-2.4, 1.0, 1.8, 2.6, 2.6, 3.4);
  panel(2.4, 0.4, 1.6, 1.6, 4, 2.4);
  panel(0, -2.2, 1.4, 4, 1.8, 1.4);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 2.3;

  const pivot = new THREE.Group();
  pivot.rotation.x = -0.08; // a touch of the top edge, for depth
  scene.add(pivot);

  // drag to spin; gentle auto-drift when idle
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let angle = 0, dragging = false, lastX = 0, idleUntil = 0;
  mount.addEventListener("pointerdown", e => { dragging = true; lastX = e.clientX; mount.setPointerCapture(e.pointerId); mount.classList.add("grab", "touched"); });
  mount.addEventListener("pointermove", e => { if (!dragging) return; angle += (e.clientX - lastX) * 0.01; lastX = e.clientX; });
  const end = () => { if (!dragging) return; dragging = false; idleUntil = performance.now() + 2600; mount.classList.remove("grab"); };
  mount.addEventListener("pointerup", end);
  mount.addEventListener("pointercancel", end);

  let dist = 1;
  function resize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount);
  function fitCam(root) {
    const s = root.userData.size;
    dist = (Math.max(s.x, s.y) / 2) / FOV_T * 1.45;
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
    resize();
  }

  let onFrame = null; // cycling viewer overrides the render step

  // ── try-on viewport: scanline wipe between cycling frames ──
  if (opts.frames && opts.frames.length) {
    const scanline = mount.parentElement.querySelector(".scanline");
    const dotsEl = opts.dots;
    if (dotsEl) dotsEl.innerHTML = opts.frames.map((_, k) => `<button aria-label="Frame ${k + 1}"></button>`).join("");
    const dotBtns = dotsEl ? [...dotsEl.querySelectorAll("button")] : [];
    const setDots = i => dotBtns.forEach((d, k) => d.classList.toggle("on", k === i));

    const planeAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);  // keep y > line
    const planeBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0); // keep y < line
    const DWELL = 2600, SWEEP = 1400;
    let curIdx = 0, targetIdx = 1, modelA = null, modelB = null, phase = "load", phaseStart = 0;

    loadModel(opts.frames[0]).then(r => {
      modelA = r; pivot.add(r); fitCam(r);
      setDots(0); mount.classList.add("ready"); mount.style.opacity = 1;
      phase = "dwell"; phaseStart = performance.now();
      loadModel(opts.frames[targetIdx]).then(m => modelB = m);
    });

    function beginSweep() {
      if (!modelB) { phaseStart = performance.now(); return; } // next frame not ready yet
      pivot.add(modelB);
      phase = "sweep"; phaseStart = performance.now();
    }
    function endSweep() {
      pivot.remove(modelA);
      modelA = modelB; modelB = null;
      curIdx = targetIdx; setDots(curIdx);
      targetIdx = (curIdx + 1) % opts.frames.length;
      scanline.style.opacity = 0;
      phase = "dwell"; phaseStart = performance.now();
      loadModel(opts.frames[targetIdx]).then(m => modelB = m);
    }
    dotBtns.forEach((d, k) => d.addEventListener("click", () => {
      if (phase !== "dwell" || k === curIdx) return;
      targetIdx = k;
      loadModel(opts.frames[k]).then(m => { modelB = m; beginSweep(); });
    }));

    onFrame = t => {
      const visHalf = dist * FOV_T; // world half-height visible at the frame plane
      if (phase === "sweep") {
        const p = Math.min(1, (t - phaseStart) / SWEEP);
        const yLine = -visHalf + p * 2 * visHalf; // sweeps bottom → top
        planeAbove.constant = -yLine;
        planeBelow.constant = yLine;
        scanline.style.top = (1 - (yLine + visHalf) / (2 * visHalf)) * 100 + "%";
        scanline.style.opacity = (p < 0.12 ? p / 0.12 : p > 0.88 ? (1 - p) / 0.12 : 1) * 0.85;
        modelA.visible = true; modelB.visible = false;
        renderer.clippingPlanes = [planeAbove]; renderer.autoClear = true; renderer.render(scene, cam);
        modelA.visible = false; modelB.visible = true;
        renderer.clippingPlanes = [planeBelow]; renderer.autoClear = false; renderer.render(scene, cam);
        renderer.autoClear = true; renderer.clippingPlanes = [];
        if (p >= 1) endSweep();
      } else {
        if (modelA) modelA.visible = true;
        if (modelB) modelB.visible = false;
        renderer.clippingPlanes = [];
        renderer.render(scene, cam);
        if (phase === "dwell" && t - phaseStart > DWELL) beginSweep();
      }
    };
  } else {
    loadModel(opts.model).then(r => { pivot.add(r); fitCam(r); mount.classList.add("ready"); });
  }

  (function loop() {
    requestAnimationFrame(loop);
    const t = performance.now();
    if (!dragging && t > idleUntil && !reduce) {
      const target = Math.sin(t * 0.00042) * 0.55; // slow ±32° sweep
      angle += (target - angle) * 0.02;
    }
    pivot.rotation.y = angle;
    if (onFrame) onFrame(t); else renderer.render(scene, cam);
  })();
}

const hero = document.getElementById("hero3d");
if (hero) mountViewer(hero, { model: "assets/GLB/cicely-opt-sbf-lavender-tortoise-with-riesling_wide.glb" });

const tryon = document.getElementById("tryon3d");
if (tryon) {
  const frames = (window.CATALOG || []).slice(0, 6).map(it => it.colorways[0].model);
  mountViewer(tryon, { frames, dots: document.getElementById("vpDots") });
}
