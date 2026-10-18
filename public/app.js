// Collect page: live student search.
(function () {
  const q = document.getElementById('q');
  if (!q) return;
  const items = Array.from(document.querySelectorAll('#results li'));
  const none = document.getElementById('noresults');
  q.addEventListener('input', () => {
    const terms = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    items.forEach((li) => {
      const hay = li.dataset.search;
      const match = terms.every((t) => hay.includes(t));
      li.hidden = !match;
      if (match) shown++;
    });
    if (none) none.hidden = shown > 0 || !items.length;
  });
  q.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = items.find((li) => !li.hidden);
    if (first) { e.preventDefault(); first.querySelector('a').click(); }
  });
})();

// Collect form: quick amount buttons + prevent double submit.
(function () {
  const form = document.getElementById('collect-form');
  if (!form) return;
  const amount = document.getElementById('amount');
  form.querySelectorAll('[data-amount]').forEach((b) => {
    b.addEventListener('click', () => { amount.value = b.dataset.amount; amount.focus(); });
  });
  form.addEventListener('submit', () => {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
  });
})();

// Attendance: live present/absent count.
(function () {
  const form = document.getElementById('att-form');
  if (!form) return;
  const boxes = form.querySelectorAll('input[name="present"]');
  const p = document.getElementById('att-p');
  const a = document.getElementById('att-a');
  if (!p) return;
  const update = () => {
    const n = Array.from(boxes).filter((b) => b.checked).length;
    p.textContent = n;
    a.textContent = boxes.length - n;
  };
  boxes.forEach((b) => b.addEventListener('change', update));
  update();
})();
