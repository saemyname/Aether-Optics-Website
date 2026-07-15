/* Aether NY — shopping bag: localStorage state + slide-out drawer, shared
   across every page. A concept store, so checkout is a demo (no payment). */
const KEY = "aether-bag";
export const FREE_SHIP = 200, SHIP_FEE = 15;
const money = n => "$" + n.toFixed(0);
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const lineId = i => `${i.id}|${i.colorway}|${i.size}`;
const count = () => read().reduce((n, i) => n + i.qty, 0);
const subtotal = () => read().reduce((s, i) => s + i.price * i.qty, 0);
const qtyOf = id => (read().find(i => lineId(i) === id) || {}).qty || 0;

let el = {};

function write(items) { localStorage.setItem(KEY, JSON.stringify(items)); render(); }
function setQty(id, q) { write(read().map(i => lineId(i) === id ? { ...i, qty: q } : i).filter(i => i.qty > 0)); }

function build() {
  if (el.root) return;
  const bag = document.createElement("div");
  bag.className = "bag-drawer";
  bag.innerHTML = `
    <div class="bag-scrim" data-close></div>
    <aside class="bag-panel" role="dialog" aria-label="Shopping bag">
      <div class="bag-head"><h3>Your bag <span class="bag-n"></span></h3><button class="bag-x" data-close aria-label="Close bag">✕</button></div>
      <div class="bag-items"></div>
      <div class="bag-empty"><p>Your bag is empty.</p><a class="link-arrow" href="shop.html" data-close>Shop the collection →</a></div>
      <div class="bag-foot">
        <div class="bag-row"><span>Subtotal</span><span class="bag-sub"></span></div>
        <div class="bag-row muted"><span>Shipping</span><span class="bag-ship"></span></div>
        <div class="bag-row total"><span>Total</span><span class="bag-total"></span></div>
        <a class="btn btn-primary bag-checkout" href="checkout.html">Checkout</a>
        <p class="bag-note">Free shipping over ${money(FREE_SHIP)} · Free 30-day returns</p>
      </div>
    </aside>`;
  document.body.appendChild(bag);
  el = {
    root: bag, items: bag.querySelector(".bag-items"), n: bag.querySelector(".bag-n"),
    sub: bag.querySelector(".bag-sub"), ship: bag.querySelector(".bag-ship"), total: bag.querySelector(".bag-total")
  };
  bag.querySelectorAll("[data-close]").forEach(x => x.addEventListener("click", close));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && bag.classList.contains("open")) close(); });
  el.items.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.closest(".bag-item").dataset.id;
    if (b.dataset.act === "inc") setQty(id, qtyOf(id) + 1);
    if (b.dataset.act === "dec") setQty(id, qtyOf(id) - 1);
    if (b.dataset.act === "rm") setQty(id, 0);
  });
}

function render() {
  const items = read(), n = count();
  document.querySelectorAll(".nav-bag-count").forEach(c => { c.textContent = n || ""; c.classList.toggle("has", n > 0); });
  if (!el.root) return;
  el.n.textContent = n ? `(${n})` : "";
  el.root.classList.toggle("has-items", items.length > 0);
  el.items.innerHTML = items.map(i => `
    <div class="bag-item" data-id="${lineId(i)}">
      <div class="bag-thumb"><img src="${i.image}" alt=""></div>
      <div class="bag-info">
        <div class="bag-item-top"><span class="bag-name">${i.name}</span><button data-act="rm" class="bag-rm" aria-label="Remove ${i.name}">✕</button></div>
        <span class="bag-meta">${i.colorway}${i.size ? ` · ${cap(i.size)}` : ""}</span>
        <div class="bag-item-bot">
          <div class="bag-qty"><button data-act="dec" aria-label="Decrease">−</button><span>${i.qty}</span><button data-act="inc" aria-label="Increase">+</button></div>
          <span class="bag-price">${money(i.price * i.qty)}</span>
        </div>
      </div>
    </div>`).join("");
  const sub = subtotal(), ship = items.length && sub < FREE_SHIP ? SHIP_FEE : 0;
  el.sub.textContent = money(sub); el.ship.textContent = ship ? money(ship) : "Free"; el.total.textContent = money(sub + ship);
}

function open() { build(); render(); requestAnimationFrame(() => el.root.classList.add("open")); document.body.style.overflow = "hidden"; }
function close() { if (el.root) { el.root.classList.remove("open"); document.body.style.overflow = ""; } }

function mountNav() {
  document.querySelectorAll(".nav-cta").forEach(cta => {
    if (cta.querySelector(".nav-bag")) return;
    const b = document.createElement("button");
    b.className = "nav-bag"; b.setAttribute("aria-label", "Open bag");
    b.innerHTML = `Bag <span class="nav-bag-count"></span>`;
    b.addEventListener("click", open);
    cta.insertBefore(b, cta.firstChild);
  });
}

export const Bag = {
  add(entry, silent) { // {id, name, price, image, colorway, size}; silent skips the drawer
    const items = read(), id = lineId(entry), ex = items.find(i => lineId(i) === id);
    if (ex) ex.qty++; else items.push({ ...entry, qty: 1 });
    write(items); if (!silent) open();
  },
  open, close, count, subtotal, items: read, FREE_SHIP, SHIP_FEE,
  clear() { localStorage.removeItem(KEY); render(); }
};
window.AetherBag = Bag;
mountNav();
render();
