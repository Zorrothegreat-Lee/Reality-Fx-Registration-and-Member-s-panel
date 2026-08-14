/* Reception (index.html) */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  // The journey strip — from the brief, verbatim (SVG icons)
  const JOURNEY = [
    { ic: 'cart', t: 'Course purchase' },
    { ic: 'card', t: 'Payment approved' },
    { ic: 'clipboard', t: 'Enrollment created' },
    { ic: 'receipt', t: 'Invoice generated' },
    { ic: 'mail', t: 'Invoice email' },
    { ic: 'link', t: 'Registration link' },
    { ic: 'edit', t: 'Registration' },
    { ic: 'checkCircle', t: 'Approval' },
    { ic: 'userCheck', t: 'Student ID + code' },
    { ic: 'link', t: 'Handoff to RFX OS' },
    { ic: 'flag', t: 'Ready to log in' },
  ];

  function renderJourney() {
    const I = RFX.icons || {};
    const wrap = document.getElementById('journey');
    wrap.innerHTML = JOURNEY.map((j, i) =>
      '<div class="tl-step ' + (i === 0 ? 'done' : '') + '"><div class="tl-node">' + (I[j.ic] || '') + '</div><div class="tl-lab">' + j.t + '</div></div>'
    ).join('');
  }

  function renderOpenLinks() {
    const card = document.getElementById('open-links');
    const open = db.enrollments().filter(e => e.registration && !e.registration.submittedAt && e.state === 'PENDING');
    if (!open.length) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    const rows = open.map(e => {
      const link = location.href.split('/').slice(0, -1).join('/') + '/register.html?token=' + e.registration.token;
      return '<div style="display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">' +
        '<span style="flex:1;min-width:200px;"><b style="color:var(--text);">' + ui.esc(e.payment.customerName) + '</b><br><span class="small">' + ui.esc(e.payment.email) + '</span></span>' +
        '<span class="small" style="color:var(--faint);">expires ' + db.fmtDateShort(e.registration.tokenExpiresAt) + '</span>' +
        '<a class="btn btn-ghost btn-sm" href="' + link + '" target="_blank">Open registration →</a>' +
        '</div>';
    }).join('');
    card.innerHTML = '<div class="eyebrow muted" style="margin-bottom:10px;">Active registration links (demo)</div>' + rows;
  }

  function renderDutyPill() {
    const pill = document.getElementById('on-duty-pill');
    if (!pill) return;
    const n = db.onDutyCount();
    pill.innerHTML = n > 0
      ? '<span class="dot ok pulse"></span> Reception · 24/7 · ' + n + ' team member' + (n === 1 ? '' : 's') + ' on duty now'
      : '<span class="dot warn"></span> Reception · 24/7 · checking coverage…';
  }

  /* ---------------- smart door --------------
     The dashboard already knows what you need next, before you click
     anything. One door carries the gold glow + a tag; the hint below
     says why. Priorities: a live registration link -> Members; no
     enrollments yet -> Staff Console; an approved student awaiting the
     handoff -> Staff Console; everyone active -> Members (the gateway). */
  function smartDoor() {
    const enrs = db.enrollments();
    const open = enrs.filter(e => e.registration && !e.registration.submittedAt && e.state === 'PENDING');
    if (open.length) return { key: 'member', hint: 'A registration link is live — complete your registration before it expires.' };
    if (!enrs.length) return { key: 'admin', hint: 'No paid enrollments yet — receive the first one here.' };
    const pendingHandoff = enrs.filter(e => e.state === 'APPROVED' && !e.handoff.confirmedAt);
    if (pendingHandoff.length) return { key: 'admin', hint: pendingHandoff.length + ' approved student' + (pendingHandoff.length === 1 ? '' : 's') + ' awaiting the RFX OS handoff — confirm the bridge.' };
    const active = enrs.filter(e => e.state === 'ACTIVE');
    if (active.length) return { key: 'member', hint: active.length + ' active student' + (active.length === 1 ? '' : 's') + ' — your identity, credit and gateway into RFX OS.' };
    return { key: 'member', hint: 'Your student identity, RFX credit and your gateway into RFX OS.' };
  }
  function renderSmartDoor() {
    const doors = Array.prototype.slice.call(document.querySelectorAll('.door'));
    if (!doors.length) return;
    const target = smartDoor();
    const tag = document.getElementById('smart-hint');
    doors.forEach(d => {
      const isSmart = d.dataset.smart === target.key;
      d.classList.toggle('card-gold', isSmart);
      const t = d.querySelector('.door-tag');
      if (t) {
        t.innerHTML = (RFX.icons && RFX.icons.sparkles ? RFX.icons.sparkles : '') + ' For you';
        t.hidden = !isSmart;
      }
    });
    if (tag) tag.textContent = target.hint;
  }

  renderJourney();
  renderOpenLinks();
  renderSmartDoor();
  renderDutyPill();
  setInterval(renderOpenLinks, 3000);
  setInterval(renderSmartDoor, 4000);
  setInterval(renderDutyPill, 8000);
})();
