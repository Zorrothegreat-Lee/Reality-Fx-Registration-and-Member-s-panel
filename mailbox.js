/* Mailbox (mailbox.html) */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  let selectedId = null;
  const KIND_BADGE = {
    invoice: 'gold', registration: 'gold', verify: 'info', welcome: 'ok', credit: 'ok', refund: 'warn', reapply: 'info',
    cashout: 'gold', 'finance-report': 'info', 'staff-fund': 'ok', 'staff-invite': 'info',
  };
  const KIND_LABEL = {
    invoice: 'Invoice', registration: 'Registration link', verify: 'Verification', welcome: 'Welcome',
    credit: 'RFX credit', refund: 'Refund', reapply: 'Re-application',
    cashout: 'Cash-out', 'finance-report': 'Finance audit', 'staff-fund': 'Staff funding', 'staff-invite': 'Staff invite',
  };

  /* Download any email as a standalone .html file — the invoice, the
     registration link, the end-of-day audit log — so it can be saved,
     filed or printed from the file itself. */
  function downloadEmail(m) {
    const when = String(m.sentAt || '').slice(0, 10);
    const slug = String(m.subject || m.kind || 'email').replace(/[^\w-]+/g, '-').slice(0, 60);
    const doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>' + ui.esc(m.subject) + '</title>' +
      '<style>body{font-family:Segoe UI,Arial,sans-serif;background:#f3f1ea;margin:0;padding:32px;} .wrap{max-width:760px;margin:0 auto;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden;padding:28px 34px;} .meta{font-size:12.5px;color:#777;border-bottom:1px solid #e5e2d8;padding-bottom:14px;margin-bottom:22px;}</style></head>' +
      '<body><div class="wrap"><div class="meta"><b>Reality FX — ' + ui.esc(m.subject) + '</b><br>To: ' + ui.esc(m.to) + ' · ' + db.fmtDate(m.sentAt) + ' · Filed from the RFX Mailbox</div>' +
      m.html +
      '</div></body></html>';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    a.download = 'RFX-' + slug + '-' + when + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function renderList() {
    const all = db.emails();
    const box = document.getElementById('mail-list');
    if (!all.length) {
      box.innerHTML = '<div class="empty-state"><div class="e-ic">' + (RFX.icons && RFX.icons.inbox) + '</div><div class="e-t">Inbox empty</div>' +
        '<p class="small">Create an enrollment in the Staff Console to generate the invoice + registration emails.</p></div>';
      return;
    }
    box.innerHTML = all.map(m =>
      '<div class="mail-item ' + (m.read ? '' : 'unread') + (m.id === selectedId ? ' active' : '') + '" data-id="' + m.id + '">' +
      '<div class="m-subj">' + ui.esc(m.subject) + '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-top:5px;">' +
      '<span class="pill ' + (KIND_BADGE[m.kind] || '') + '" style="font-size:9px;">' + (KIND_LABEL[m.kind] || m.kind) + '</span>' +
      '<span class="small faint">to ' + ui.esc(m.to) + '</span>' +
      '<span class="small faint" style="margin-left:auto;">' + ui.fmtRelative(m.sentAt) + '</span>' +
      '<button class="btn btn-dark btn-sm" data-mail-dl="' + m.id + '" title="Download this email as a file" style="padding:3px 8px;font-size:11px;">' + (RFX.icons.download || '') + '</button></div>' +
      '</div>'
    ).join('');
    box.querySelectorAll('.mail-item').forEach(el => el.addEventListener('click', e => {
      if (e.target && e.target.closest && e.target.closest('[data-mail-dl]')) return;
      select(el.dataset.id);
    }));
    box.querySelectorAll('[data-mail-dl]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const m = db.emails().find(x => x.id === b.dataset.mailDl);
      if (m) downloadEmail(m);
    }));
  }

  function select(id) {
    selectedId = id;
    db.markEmailRead(id);
    const m = db.emails().find(e => e.id === id);
    const body = document.getElementById('mail-body');
    if (!m) { body.innerHTML = ''; return; }
    body.innerHTML =
      '<div class="eyebrow ' + (KIND_BADGE[m.kind] || '') + '" style="margin-bottom:4px;">' + KIND_LABEL[m.kind] + '</div>' +
      '<h3 class="serif" style="font-size:21px;line-height:1.3;">' + ui.esc(m.subject) + '</h3>' +
      '<div class="m-meta" style="display:flex;align-items:center;gap:12px;">' +
      '<span>To: <b style="color:var(--muted);">' + ui.esc(m.to) + '</b> · ' + db.fmtDate(m.sentAt) + '</span>' +
      '<button class="btn btn-dark btn-sm" id="btn-mail-dl" style="margin-left:auto;"><span data-icon="download"></span> Download file</button></div>' +
      '<div class="mail-paper">' + m.html + '</div>';
    const dl = document.getElementById('btn-mail-dl');
    if (dl) dl.addEventListener('click', () => downloadEmail(m));
    renderList();
    updateCount();
  }

  function updateCount() {
    const el = document.getElementById('mail-count');
    if (el) el.textContent = db.unreadCount();
  }

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all simulated emails?')) return;
    db.clearEmails();
    selectedId = null;
    document.getElementById('mail-body').innerHTML = '<div class="empty-state"><div class="e-ic">' + (RFX.icons && RFX.icons.inbox) + '</div><div class="e-t">Inbox cleared</div></div>';
    renderList(); updateCount();
  });

  // auto-open newest email on first load if any
  const all = db.emails();
  if (all.length) select(all[0].id);
  renderList(); updateCount();
  setInterval(() => { renderList(); updateCount(); }, 3000);
})();
