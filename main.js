/* Aether NY — shared interactions */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const money = n => '$' + n;

  /* ---- Product card markup ---- */
  function card(item) {
    const cw = item.colorways[0];
    const tag = item.type === 'sunglasses' ? 'Sunglasses' : 'Eyeglasses';
    const swatches = item.colorways.slice(0, 4)
      .map(c => `<span class="swatch" style="background:${c.swatch}" title="${c.name}"></span>`).join('');
    return `<a class="card" href="product.html?id=${encodeURIComponent(item.id)}">
      <div class="card-img"><span class="card-tag">${tag}</span><img src="${cw.image}" alt="${item.name} in ${cw.name}" loading="lazy"></div>
      <div class="card-body">
        <div class="card-row"><span class="name">${item.name}</span><span class="price">${money(item.price)}</span></div>
        <div class="swatches">${swatches}</div>
      </div>
    </a>`;
  }

  /* ---- Home: collection preview (first 6) ---- */
  const grid = $('#collectionGrid');
  if (grid && window.CATALOG) {
    grid.innerHTML = CATALOG.slice(0, 6).map(card).join('');
  }

  /* ---- Home: try-on viewport cycling ---- */
  const vp = $('#viewport');
  if (vp && window.CATALOG) {
    const picks = CATALOG.slice(0, 6);
    const img = $('#vpFrame'), dots = $('#vpDots');
    let i = 0, timer;
    dots.innerHTML = picks.map((_, k) => `<button aria-label="Frame ${k + 1}"></button>`).join('');
    const dotEls = $$('button', dots);
    function show(n) {
      i = n;
      img.style.opacity = 0;
      setTimeout(() => { img.src = picks[i].colorways[0].image; img.alt = picks[i].name + ' previewed on face'; img.style.opacity = 1; }, 220);
      dotEls.forEach((d, k) => d.classList.toggle('on', k === i));
    }
    function next() { show((i + 1) % picks.length); }
    dotEls.forEach((d, k) => d.addEventListener('click', () => { show(k); restart(); }));
    function restart() { clearInterval(timer); timer = setInterval(next, 2600); }
    show(0); restart();
  }

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

  window.AETHER = { card, money };
})();
