/* Aether Optics — shared interactions */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const money = n => '$' + n;
  const stars = r => `<span class="stars"><i style="width:${(r / 5 * 100).toFixed(1)}%"></i></span>`;

  /* ---- Product card markup ---- */
  function card(item) {
    const cw = item.colorways[0];
    const tag = item.type === 'sunglasses' ? 'Sunglasses' : 'Eyeglasses';
    const swatches = item.colorways.slice(0, 4)
      .map(c => `<span class="swatch" style="background:${c.swatch}" title="${c.name}"></span>`).join('');
    const rating = item.rating ? `<div class="card-rating">${stars(item.rating)} ${item.rating} <span>(${item.reviewCount})</span></div>` : '';
    return `<a class="card" href="product.html?id=${encodeURIComponent(item.id)}">
      <div class="card-img"><span class="card-tag">${tag}</span><img src="${cw.image}" alt="${item.name} in ${cw.name}" loading="lazy"></div>
      <div class="card-body">
        <div class="card-row"><span class="name">${item.name}</span><span class="price">${money(item.price)}</span></div>
        <div class="swatches">${swatches}</div>
        ${rating}
      </div>
    </a>`;
  }

  /* ---- Home: collection preview (first 6) ---- */
  const grid = $('#collectionGrid');
  if (grid && window.CATALOG) {
    grid.innerHTML = CATALOG.slice(0, 3).map(card).join('');
  }

  /* Try-on viewport now renders a live 3D frame (hero.js) — no PNG cycling. */

  /* ---- Scroll reveals ---- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => io.observe(el));

  /* ---- Mobile nav (minimal) ---- */
  const toggle = $('.nav-toggle');
  if (toggle) toggle.addEventListener('click', () => {
    const links = $('.nav-links');
    const open = links.style.display === 'flex';
    links.style.cssText = open ? '' : 'display:flex;position:absolute;top:100%;left:0;right:0;flex-direction:column;gap:1rem;background:var(--paper);padding:1.5rem var(--pad-x);border-bottom:1px solid var(--hairline)';
  });

  window.AETHER = { card, money, stars };
})();
