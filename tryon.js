/* Aether NY — live webcam virtual try-on (MediaPipe FaceLandmarker) */
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/* Per-frame overlay tuning. widthK: glasses width ÷ outer-eye-corner distance.
   yOffset: fraction of glasses height to nudge down so lenses sit on the eyes. */
const FIT = { widthK: 2.08, yOffset: 0.06 };
// MediaPipe canonical landmarks: outer eye corners + nose bridge.
const R_EYE = 33, L_EYE = 263, BRIDGE = 168, R_TEMPLE = 234, L_TEMPLE = 454;

let landmarker = null, stream = null, raf = null;
let frames = [], current = 0;
const imgCache = new Map();

const el = {}; // overlay refs

function build() {
  if (el.root) return;
  const root = document.createElement("div");
  root.className = "to-overlay";
  root.innerHTML = `
    <div class="to-top">
      <span class="brand">Aether <b>NY</b></span>
      <div class="to-title" id="toTitle">Virtual Try-On<small>Live camera</small></div>
      <button class="to-close" id="toClose" aria-label="Close try-on">✕</button>
    </div>
    <div class="to-stage">
      <div class="to-view">
        <video id="toVideo" autoplay playsinline muted style="display:none"></video>
        <canvas class="to-canvas" id="toCanvas"></canvas>
        <div class="to-hint" id="toHint">Center your face · turn slowly to see the fit</div>
        <div class="to-status" id="toStatus">
          <div>
            <span class="eyebrow">Virtual try-on</span>
            <h3 id="toStatusTitle">Ready when you are</h3>
            <p id="toStatusMsg">We’ll use your camera to place the frames on your face. Nothing is recorded or uploaded.</p>
            <div id="toStatusAction"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="to-dock">
      <div class="to-current"><span class="n" id="toName"></span><span class="p" id="toPrice"></span></div>
      <div class="to-strip" id="toStrip"></div>
      <div class="to-actions">
        <button class="btn btn-light" id="toCapture">Capture look</button>
        <a class="btn btn-ghost" style="color:var(--paper);border-color:rgba(246,243,237,.3)" id="toShop" href="shop.html">View in shop</a>
      </div>
    </div>`;
  document.body.appendChild(root);
  el.root = root;
  el.video = root.querySelector("#toVideo");
  el.canvas = root.querySelector("#toCanvas");
  el.ctx = el.canvas.getContext("2d");
  el.status = root.querySelector("#toStatus");
  el.statusTitle = root.querySelector("#toStatusTitle");
  el.statusMsg = root.querySelector("#toStatusMsg");
  el.statusAction = root.querySelector("#toStatusAction");
  el.strip = root.querySelector("#toStrip");
  el.name = root.querySelector("#toName");
  el.price = root.querySelector("#toPrice");
  el.title = root.querySelector("#toTitle");
  el.shop = root.querySelector("#toShop");
  root.querySelector("#toClose").addEventListener("click", close);
  root.querySelector("#toCapture").addEventListener("click", capture);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && el.root.classList.contains("open")) close(); });
}

function frameList() {
  return (window.CATALOG || []).map(it => ({
    id: it.id, name: it.name, price: it.price, image: it.colorways[0].image
  }));
}

function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const img = new Image(); img.src = src; imgCache.set(src, img); return img;
}

function renderStrip() {
  el.strip.innerHTML = frames.map((f, i) =>
    `<button class="to-thumb ${i === current ? "on" : ""}" data-i="${i}" aria-label="${f.name}"><img src="${f.image}" alt=""></button>`).join("");
  el.strip.querySelectorAll(".to-thumb").forEach(b =>
    b.addEventListener("click", () => setCurrent(+b.dataset.i)));
  setCurrent(current, true);
}

function setCurrent(i, silent) {
  current = i;
  const f = frames[current];
  el.name.textContent = f.name; el.price.textContent = "$" + f.price;
  el.shop.href = "product.html?id=" + encodeURIComponent(f.id);
  loadImg(f.image);
  if (!silent) el.strip.querySelectorAll(".to-thumb").forEach((b, k) => b.classList.toggle("on", k === current));
  el.strip.querySelectorAll(".to-thumb").forEach((b, k) => b.classList.toggle("on", k === current));
}

function setStatus(title, msg, actionHTML) {
  el.status.classList.remove("hide");
  el.statusTitle.textContent = title;
  el.statusMsg.textContent = msg;
  el.statusAction.innerHTML = actionHTML || "";
}
function hideStatus() { el.status.classList.add("hide"); }

async function ensureModel() {
  if (landmarker) return landmarker;
  const fileset = await FilesetResolver.forVisionTasks(VISION);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO", numFaces: 1
  });
  return landmarker;
}

async function startCamera() {
  setStatus("Starting camera…", "Allow camera access to try the frames on.", `<div class="to-spinner"></div>`);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 960, height: 1280 }, audio: false });
  } catch (err) {
    setStatus("Camera blocked", "Allow camera access in your browser, then reopen try-on. Your camera stays on your device.",
      `<button class="btn btn-light" id="toRetry">Try again</button>`);
    el.statusAction.querySelector("#toRetry")?.addEventListener("click", run);
    return false;
  }
  el.video.srcObject = stream;
  await el.video.play().catch(() => {});
  return true;
}

async function run() {
  setStatus("Loading face tracking…", "One moment — readying the fitting mirror.", `<div class="to-spinner"></div>`);
  let ok;
  try { await ensureModel(); } catch (e) {
    setStatus("Couldn’t load try-on", "The face-tracking engine failed to load. Check your connection and try again.",
      `<button class="btn btn-light" id="toRetry">Try again</button>`);
    el.statusAction.querySelector("#toRetry")?.addEventListener("click", run);
    return;
  }
  ok = await startCamera();
  if (!ok) return;
  hideStatus();
  loop();
}

let lastTs = -1;
function loop() {
  const v = el.video;
  if (v.readyState >= 2 && v.videoWidth) {
    if (el.canvas.width !== v.videoWidth) { el.canvas.width = v.videoWidth; el.canvas.height = v.videoHeight; }
    el.ctx.drawImage(v, 0, 0, el.canvas.width, el.canvas.height);
    const ts = performance.now();
    if (ts !== lastTs) {
      lastTs = ts;
      let res = null;
      try { res = landmarker.detectForVideo(v, ts); } catch (e) {}
      if (res && res.faceLandmarks && res.faceLandmarks[0]) drawGlasses(res.faceLandmarks[0]);
    }
  }
  raf = requestAnimationFrame(loop);
}

function drawGlasses(lm) {
  const img = loadImg(frames[current].image);
  if (!img.complete || !img.naturalWidth) return;
  const W = el.canvas.width, H = el.canvas.height;
  const rx = lm[R_EYE].x * W, ry = lm[R_EYE].y * H;
  const lx = lm[L_EYE].x * W, ly = lm[L_EYE].y * H;
  // width from temples (falls back to eye distance × K if temples missing)
  const tW = Math.hypot((lm[L_TEMPLE].x - lm[R_TEMPLE].x) * W, (lm[L_TEMPLE].y - lm[R_TEMPLE].y) * H);
  const eyeW = Math.hypot(lx - rx, ly - ry);
  const gw = Math.max(tW * 1.06, eyeW * FIT.widthK);
  const gh = gw * (img.naturalHeight / img.naturalWidth);
  const cx = (rx + lx) / 2, cy = (ry + ly) / 2;
  const angle = Math.atan2(ly - ry, lx - rx);
  const ctx = el.ctx;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.drawImage(img, -gw / 2, -gh / 2 + gh * FIT.yOffset, gw, gh);
  ctx.restore();
}

function capture() {
  const url = el.canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url; a.download = "aether-tryon-" + frames[current].id + ".png"; a.click();
}

function stopCamera() {
  if (raf) cancelAnimationFrame(raf), raf = null;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (el.video) el.video.srcObject = null;
}

function open(itemId) {
  build();
  frames = frameList();
  if (!frames.length) return;
  const idx = frames.findIndex(f => f.id === itemId);
  current = idx >= 0 ? idx : 0;
  renderStrip();
  el.root.classList.add("open");
  document.body.style.overflow = "hidden";
  run();
}

function close() {
  stopCamera();
  el.root.classList.remove("open");
  document.body.style.overflow = "";
}

// wire any [data-tryon] triggers on the page
function bind() {
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tryon]");
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute("data-tryon") || null);
  });
}
bind();
window.AetherTryOn = { open };
