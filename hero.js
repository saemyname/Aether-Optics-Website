/* Aether NY — hero 3D frame. The signature Cicely renders live in the lens
   circle: it drifts with a slow turn to show its form, and you can grab and
   spin it a full turn. Same lighting as the try-on so the acetate reads rich. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODEL = "assets/GLB/cicely-opt-sbf-lavender-tortoise-with-riesling_wide.glb";
const mount = document.getElementById("hero3d");
if (mount) init();

function init() {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(0.5, 0.9, 1.1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.55); rim.position.set(-0.7, 0.3, -0.6); scene.add(rim);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const pivot = new THREE.Group();
  pivot.rotation.x = -0.08; // a touch of the top edge, for depth
  scene.add(pivot);

  new GLTFLoader().load(MODEL, gltf => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    model.position.sub(box.getCenter(new THREE.Vector3())); // centre on origin
    pivot.add(model);
    const size = box.getSize(new THREE.Vector3());
    const dist = (Math.max(size.x, size.y) / 2) / Math.tan((cam.fov * Math.PI / 180) / 2) * 1.45;
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    resize();
    mount.classList.add("ready");
  });

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
}
