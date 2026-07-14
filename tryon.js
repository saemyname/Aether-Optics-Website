/* Aether NY — live webcam virtual try-on (MediaPipe FaceLandmarker).
   One shared engine drives two hosts: the full-screen overlay (home) and the
   in-place product stage (detail page). */
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/* Overlay fit tuning. widthK: glasses width ÷ outer-eye-corner distance;
   yOffset: fraction of glasses height nudged down so lenses sit on the eyes. */
const FIT = { widthK: 2.08, yOffset: 0.06 };
const R_EYE = 33, L_EYE = 263, R_TEMPLE = 234, L_TEMPLE = 454;

/* ---------- shared engine (single model + single camera) ---------- */
let landmarker = null, stream = null, raf = null, lastTs = -1;
let vEl = null, cEl = null, cCtx = null, gImg = null;
const imgCache = new Map();

function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const i = new Image(); i.src = src; imgCache.set(src, i); return i;
}
function setImage(src) { gImg = loadImg(src); }

async function ensureModel() {
  if (landmarker) return;
  const fs = await FilesetResolver.forVisionTasks(VISION);
  landmarker = await FaceLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1
  });
}

async function startEngine(video, canvas, imageSrc) {
  vEl = video; cEl = canvas; cCtx = canvas.getContext("2d");
  setImage(imageSrc);
  await ensureModel();
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
    });
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  if (!raf) loop();
}

function loop() {
  const v = vEl;
  if (v && v.readyState >= 2 && v.videoWidth) {
    if (cEl.width !== v.videoWidth) { cEl.width = v.videoWidth; cEl.height = v.videoHeight; }
    cCtx.drawImage(v, 0, 0, cEl.width, cEl.height);
    const ts = performance.now();
    if (ts !== lastTs) {
      lastTs = ts;
      let r = null;
      try { r = landmarker.detectForVideo(v, ts); } catch (e) {}
      if (r && r.faceLandmarks && r.faceLandmarks[0]) drawGlasses(r.faceLandmarks[0]);
    }
  }
  raf = requestAnimationFrame(loop);
}

function drawGlasses(lm) {
  const img = gImg;
  if (!img || !img.complete || !img.naturalWidth) return;
  const W = cEl.width, H = cEl.height;
  const rx = lm[R_EYE].x * W, ry = lm[R_EYE].y * H;
  const lx = lm[L_EYE].x * W, ly = lm[L_EYE].y * H;
  const tW = Math.hypot((lm[L_TEMPLE].x - lm[R_TEMPLE].x) * W, (lm[L_TEMPLE].y - lm[R_TEMPLE].y) * H);
  const eyeW = Math.hypot(lx - rx, ly - ry);
  const gw = Math.max(tW * 1.06, eyeW * FIT.widthK);
  const gh = gw * (img.naturalHeight / img.naturalWidth);
  const cx = (rx + lx) / 2, cy = (ry + ly) / 2;
  const angle = Math.atan2(ly - ry, lx - rx);
  cCtx.save();
  cCtx.translate(cx, cy);
  cCtx.rotate(angle);
  cCtx.drawImage(img, -gw / 2, -gh / 2 + gh * FIT.yOffset, gw, gh);
  cCtx.restore();
}

function stopEngine() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (vEl) vEl.srcObject = null;
  vEl = cEl = cCtx = null; lastTs = -1;
}

function capture(canvas, name) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "aether-tryon-" + (name || "look") + ".png";
  a.click();
}

/* ---------- Host A: full-screen overlay (home / anywhere) ---------- */
const el = {};
function frameList() {
  return (window.CATALOG || []).map(it => ({ id: it.id, name: it.name, price: it.price, image: it.colorways[0].image }));
}
let ovFrames = [], ovCurrent = 0;

function buildOverlay() {
  if (el.root) return;
  const root = document.createElement("div");
  root.className = "to-overlay";
  root.innerHTML = `
    <div class="to-top">
      <span class="brand">Aether <b>NY</b></span>
      <div class="to-title">Virtual Try-On<small>Live camera</small></div>
      <button class="to-close" aria-label="Close try-on">✕</button>
    </div>
    <div class="to-stage"><div class="to-view">
      <video autoplay playsinline muted style="display:none"></video>
      <canvas class="to-canvas"></canvas>
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
  el.video = root.querySelector("video");
  el.canvas = root.querySelector("canvas");
  el.status = root.querySelector(".to-status");
  el.sTitle = root.querySelector(".s-title");
  el.sMsg = root.querySelector(".s-msg");
  el.sAction = root.querySelector(".s-action");
  el.strip = root.querySelector(".to-strip");
  el.name = root.querySelector(".to-current .n");
  el.price = root.querySelector(".to-current .p");
  el.shop = root.querySelector(".shop");
  root.querySelector(".to-close").addEventListener("click", closeOverlay);
  root.querySelector(".cap").addEventListener("click", () => capture(el.canvas, ovFrames[ovCurrent].id));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && el.root.classList.contains("open")) closeOverlay(); });
}
function ovStatus(t, m, a) { el.status.classList.remove("hide"); el.sTitle.textContent = t; el.sMsg.textContent = m; el.sAction.innerHTML = a || ""; }
function ovSetCurrent(i) {
  ovCurrent = i; const f = ovFrames[i];
  el.name.textContent = f.name; el.price.textContent = "$" + f.price;
  el.shop.href = "product.html?id=" + encodeURIComponent(f.id);
  setImage(f.image);
  el.strip.querySelectorAll(".to-thumb").forEach((b, k) => b.classList.toggle("on", k === i));
}
async function overlayRun() {
  ovStatus("Loading face tracking…", "One moment — readying the fitting mirror.", `<div class="to-spinner"></div>`);
  try { await ensureModel(); } catch (e) {
    ovStatus("Couldn’t load try-on", "The face-tracking engine failed to load. Check your connection and try again.", `<button class="btn btn-light retry">Try again</button>`);
    el.sAction.querySelector(".retry")?.addEventListener("click", overlayRun); return;
  }
  ovStatus("Starting camera…", "Allow camera access to try the frames on.", `<div class="to-spinner"></div>`);
  try { await startEngine(el.video, el.canvas, ovFrames[ovCurrent].image); }
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
  engine: { start: startEngine, setImage, stop: stopEngine, capture, ensureModel }
};
