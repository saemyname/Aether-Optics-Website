/* Aether NY — reusable 3D frame viewer. Drives the hero lens circle (a single
   frame) and the try-on section viewport (cycles through frames like a slide
   show). Each frame drifts with a slow turn and can be grabbed and spun.
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
  panel(0, 1.5, 2.6, 5, 1.7, 7);      // wide top strip → bright band across the lenses
  panel(-2.4, 1.0, 1.8, 2.6, 2.6, 3.4); // key softbox
  panel(2.4, 0.4, 1.6, 1.6, 4, 2.4);  // side strip
  panel(0, -2.2, 1.4, 4, 1.8, 1.4);   // lower fill
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 2.3;

  const pivot = new THREE.Group();
  pivot.rotation.x = -0.08; // a touch of the top edge, for depth
  scene.add(pivot);

  function swapModel(root) {
    while (pivot.children.length) pivot.remove(pivot.children[0]);
    pivot.add(root);
    const size = root.userData.size;
    const dist = (Math.max(size.x, size.y) / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.45;
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
    resize();
  }

  // drag to spin; gentle auto-drift when idle
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let angle = 0, dragging = false, lastX = 0, idleUntil = 0;
  mount.addEventListener("pointerdown", e => {
    dragging = true; lastX = e.clientX; mount.setPointerCapture(e.pointerId);
    mount.classList.add("grab", "touched");
  });
  mount.addEventListener("pointermove", e => {
    if (!dragging) return;
    angle += (e.clientX - lastX) * 0.01; lastX = e.clientX;
  });
  const end = () => { if (!dragging) return; dragging = false; idleUntil = performance.now() + 2600; mount.classList.remove("grab"); };
  mount.addEventListener("pointerup", end);
  mount.addEventListener("pointercancel", end);

  function resize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount);

  (function loop() {
    requestAnimationFrame(loop);
    const t = performance.now();
    if (!dragging && t > idleUntil && !reduce) {
      const target = Math.sin(t * 0.00042) * 0.55; // slow ±32° sweep
      angle += (target - angle) * 0.02;
    }
    pivot.rotation.y = angle;
    renderer.render(scene, cam);
  })();

  // ── content: a single frame, or a cycling slideshow ──
  if (opts.frames && opts.frames.length) {
    const dotsEl = opts.dots;
    let i = 0, timer;
    if (dotsEl) {
      dotsEl.innerHTML = opts.frames.map((_, k) => `<button aria-label="Frame ${k + 1}"></button>`).join("");
    }
    const dotBtns = dotsEl ? [...dotsEl.querySelectorAll("button")] : [];
    function show(n) {
      i = n;
      dotBtns.forEach((d, k) => d.classList.toggle("on", k === i));
      mount.style.opacity = 0;
      loadModel(opts.frames[i]).then(root => {
        if (i !== n) return; // superseded
        swapModel(root); mount.classList.add("ready"); mount.style.opacity = 1;
      });
    }
    const next = () => show((i + 1) % opts.frames.length);
    const restart = () => { clearInterval(timer); timer = setInterval(next, 3800); };
    dotBtns.forEach((d, k) => d.addEventListener("click", () => { show(k); restart(); }));
    show(0); restart();
  } else {
    loadModel(opts.model).then(root => { swapModel(root); mount.classList.add("ready"); });
  }
}

const hero = document.getElementById("hero3d");
if (hero) mountViewer(hero, { model: "assets/GLB/cicely-opt-sbf-lavender-tortoise-with-riesling_wide.glb" });

const tryon = document.getElementById("tryon3d");
if (tryon) {
  const frames = (window.CATALOG || []).slice(0, 6).map(it => it.colorways[0].model);
  mountViewer(tryon, { frames, dots: document.getElementById("vpDots") });
}
