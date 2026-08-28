/* RFX Staff Portal — invite activation, sign-in, shift clock in/out, roster */
(function () {
  'use strict';

  const db = RFX.db, ui = RFX.ui;

  let me = null; // current staff member

  /* ---------------- url helpers ---------------- */
  function param(name) {
    const p = new URLSearchParams(location.search);
    return p.get(name);
  }

  /* ---------------- views ---------------- */
  function show(view) {
    ['screen-invite', 'screen-login', 'screen-panel'].forEach(v => {
      document.getElementById(v).hidden = v !== view;
    });
  }

  function roleLabel(role) {
    return role === 'admin' ? 'Admin' : role === 'reception' ? 'Reception' : role === 'approver' ? 'Approver' : 'Finance';
  }

  /* ---------------- invite activation ---------------- */
  function initInvite() {
    const token = param('invite');
    if (!token) return false;
    const v = db.validateStaffInvite(token);
    if (!v.ok) {
      // show the invite card WITH the error so the holder knows the link is dead
      document.getElementById('inv-name').textContent = 'Invite not available';
      document.getElementById('inv-code').disabled = true;
      document.getElementById('btn-activate').disabled = true;
      document.getElementById('inv-err').textContent = v.msg;
      document.getElementById('inv-err').hidden = false;
      show('screen-invite');
      return true;
    }
    const s = v.staff;
    document.getElementById('inv-name').textContent = s.name + ' — ' + roleLabel(s.role);
    show('screen-invite');
    return true;
  }

  function doActivate() {
    const token = param('invite');
    const code = document.getElementById('inv-code').value.trim();
    const res = db.activateStaff(token, code);
    if (!res.ok) {
      ui.toastErr(res.msg || 'Could not activate invite.');
      return;
    }
    ui.toastOk('Staff access activated — welcome aboard.');
    me = res.staff;
    showPanel();
  }

  /* ---------------- sign in ---------------- */
  let panelIv = null;
  function doLogin() {
    const email = document.getElementById('s-email').value.trim();
    const code = document.getElementById('s-code').value;
    const lock = document.getElementById('s-lockout');
    lock.hidden = true;
    const res = db.staffLogin(email, code);
    if (!res.ok) {
      if (res.locked) {
        lock.textContent = res.msg;
        lock.hidden = false;
      } else {
        ui.toastErr(res.msg || 'Sign-in failed.');
      }
      return;
    }
    // the birthday sweep — staff consoles double as the daily sweep so a
    // greeting is never missed even if no student logs in that day.
    try { db.checkBirthdays(); } catch (e) { console.error(e); }
    ui.toastOk('Signed in — good to work.');
    me = res.staff;
    // operator marker — the Staff Console reads this so repairs and support
    // replies carry the real person's name, not a generic console label
    try { sessionStorage.setItem('rfx_staff', JSON.stringify({ id: me.id, name: me.name, role: me.role })); } catch (e) { /* no session — generic attribution */ }
    if (res.weekly) ui.toastOk('Your weekly performance report is in the Mailbox.');
    showPanel();
  }

  /* ---------------- panel ---------------- */
  function showPanel() {
    show('screen-panel');
    document.getElementById('st-name').textContent = me.name;
    document.getElementById('st-role').textContent = roleLabel(me.role);
    document.getElementById('st-shift').innerHTML = '<span class="pill gold">' + me.id + ' · ' + roleLabel(me.role) + '</span>';
    // admin-only: hire section + shift scheduling
    document.getElementById('admin-invite').hidden = me.role !== 'admin';
    const sched = document.getElementById('shift-sched');
    if (sched) sched.hidden = me.role !== 'admin';
    renderShift();
    renderRoster();
    renderMyWallet();
    renderOsUptime();
    renderDuties();
    renderMyPerf();
    renderTeamPerf();
    renderCoverage();
    renderTheStandard();
    refreshPill();
    if (panelIv) clearInterval(panelIv);
    panelIv = setInterval(function () { renderRoster(); refreshPill(); renderMyWallet(); renderOsUptime(); renderDuties(); renderMyPerf(); renderTeamPerf(); renderCoverage(); }, 8000);
  }

  /* ---------------- my RFX wallet ---------------- */
  /* Academy uptime board — staff read the shared outage ledger AND probe the
     OS live themselves, so the status line is never stale: the panel's own
     no-cors probe (3.5s abort, same as the member side) tells the truth right
     now, and the ledger below is the recorded history. The GATE line is the
     mirror: System A's own door (FOR-LEE §9.62) — the endpoint the OS Cloud
     Function calls before issuing any session. Both probed live, every paint. */
  function renderOsUptime() {
    const box = document.getElementById('os-uptime');
    if (!box) return;
    const sum = db.osOutageSummary();
    const log = db.osOutageLog().slice().reverse(); // newest first
    // live probe — never trust a stale label: the panel asks the Academy itself
    let live = 'checking';
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3500);
      fetch(db.osIndexUrl(), { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
        .then(() => { clearTimeout(t); renderOsUptimeHead(true); })
        .catch(() => { clearTimeout(t); renderOsUptimeHead(false); });
    } catch (e) { live = 'down'; }
    // gate probe — the door System A holds. Same shape as the OS probe: live,
    // honest, and it lands in #gate-health when the answer arrives.
    const gLab = document.getElementById('gate-health');
    if (gLab) {
      const gt0 = performance.now();
      try {
        fetch('/api/gate?email=' + encodeURIComponent('staff@realityfx.co.za'), { cache: 'no-store' })
          .then(function (r) { return r.json(); })
          .then(function (g) {
            const ms = (performance.now() - gt0).toFixed(1);
            if (!gLab) return;
            gLab.innerHTML = (g && g.locked)
              ? '<span style="color:#f0a89c;">gate locked</span> <span class="small faint">· ' + ms + ' ms — a student is throttled; the OS will refuse them until it lifts</span>'
              : '<span style="color:#7ee2a4;">gate open</span> <span class="small faint">· ' + ms + ' ms — System A holds the door; the Academy only follows</span>';
          })
          .catch(function () { if (gLab) gLab.innerHTML = '<span style="color:#c9b57a;">gate unreachable</span> <span class="small faint">· local record stands in</span>'; });
      } catch (e) { if (gLab) gLab.innerHTML = '<span style="color:#c9b57a;">gate unreachable</span>'; }
    }
    const renderOsUptimeHead = (up) => {
      let head;
      if (up) {
        head = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:12px 14px;border-radius:10px;background:rgba(74,222,128,0.07);border:1px solid rgba(74,222,128,0.35);">' +
          '<span class="dot ok pulse"></span>' +
          '<div><b style="color:#7ee2a4;">The Academy is online.</b> <span class="small faint">' + (sum.last ? 'Last recorded outage was resolved after ' + db.fmtDuration(sum.last.durationSec) + '.' : 'No recorded outages on this device yet.') + '</span></div></div>';
      } else {
        const open = db.osOutageLog().find(o => o.downAt && !o.upAt);
        const mins = open ? Math.max(1, Math.round((Date.now() - new Date(open.downAt).getTime()) / 60000)) : 1;
        head = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:12px 14px;border-radius:10px;background:rgba(224,96,79,0.08);border:1px solid rgba(224,96,79,0.4);">' +
          '<span class="dot warn pulse"></span>' +
          '<div><b style="color:#f0a89c;">The Academy is DOWN right now.</b> <span class="small faint">' + (open ? 'Power has been out for ' + mins + ' minute' + (mins === 1 ? '' : 's') + '. ' : '') + 'It self-recovers the moment the next probe succeeds.</span></div></div>';
      }
      box.innerHTML = head + renderOsUptimeLedger();
    };
    const renderOsUptimeLedger = () => {
    const rows = log.length
      ? log.map(function (o) {
          const down = o.downAt ? new Date(o.downAt) : null;
          const up = o.upAt ? new Date(o.upAt) : null;
          const dStr = down ? String(down.getDate()).padStart(2, '0') + '/' + String(down.getMonth() + 1).padStart(2, '0') + ' ' + String(down.getHours()).padStart(2, '0') + ':' + String(down.getMinutes()).padStart(2, '0') : '—';
          const status = o.upAt
            ? '<span style="color:#7ee2a4;">restored</span> · ' + db.fmtDuration(o.durationSec)
            : '<span style="color:#f0a89c;">down now</span>';
          return '<li style="display:flex;gap:10px;align-items:baseline;"><span class="a-time">' + dStr + '</span><span class="a-txt small">' + status + (up ? ' · ' + String(up.getHours()).padStart(2, '0') + ':' + String(up.getMinutes()).padStart(2, '0') : '') + '</span></li>';
        }).join('')
      : '<li class="small faint">No outages recorded yet — the monitor is watching.</li>';
      return '<div class="eyebrow muted" style="margin:4px 0 6px;">Outage ledger</div>' +
      '<ul class="audit" style="max-height:180px;overflow:auto;">' + rows + '</ul>' +
      '<div class="small faint" style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">' +
      (sum.count ? '<b>' + sum.count + '</b> outage' + (sum.count === 1 ? '' : 's') + ' on record · ' : '') +
      (sum.totalSec ? 'total downtime <b class="mono gold">' + db.fmtDuration(sum.totalSec) + '</b> · ' : '') +
      'status probed live every refresh · Lee\'s host must be always-on — see FOR-LEE §9.42.</div>';
    };
    // initial paint while the live probe is in flight
    const bootHead = live === 'down' ? null : '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;"><span class="dot pulse"></span><span class="small faint">Checking the Academy…</span></div>';
    box.innerHTML = (bootHead || '') + renderOsUptimeLedger();
  }

  /* TODAY'S DUTIES — the robotic manager's board. Duties come from LIVE system
     state (registration queue, identity flags, support threads, merch queue,
     plus the daily audit/sync/security/outage routines). Manual duties get a
     Complete button that runs the real work first; auto duties close
     themselves when their queue clears; overdue duties are recorded once. */
  const DUTY_ICONS = { audit: 'shieldCheck', sync: 'link', outage: 'zap', security: 'shield', reviews: 'checkCircle', identity: 'search', sessions: 'lock', support: 'headset', merch: 'cart', finance: 'card' };
  function renderDuties() {
    const list = document.getElementById('duties-list');
    const count = document.getElementById('duty-count');
    if (!list || !me) return;
    const duties = db.dutiesFor(me);
    const open = duties.filter(d => !d.doneAt).length;
    const done = duties.filter(d => d.doneAt).length;
    if (count) count.textContent = open ? open + ' open · ' + done + ' done' : 'all done';
    // the manager's note follows the standing — it never nags a gold bar
    const note = document.getElementById('manager-note');
    if (note) {
      const st = db.staffPerfStatus(me);
      if (st.tier === 'excellent') note.textContent = 'All clear, ' + me.name.split(' ')[0] + ' — the bar stays gold by staying thorough.';
      else if (st.tier === 'stable') note.textContent = 'Solid work keeps the bar gold. Overdue duties are the only way it slips.';
      else if (st.tier === 'caution') note.textContent = 'The bar is watching — clear your duties on time and the standing rebuilds fast.';
      else note.textContent = 'The bar is low. Complete every duty on time — the manager records exactly what the work deserves.';
    }
    const I = window.RFX.icons || {};
    const ic = k => I[DUTY_ICONS[k]] || I.clipboard || '';
    const rows = duties.map(function (d) {
      const overdue = !d.doneAt && d.overdue;
      let right;
      if (d.doneAt) right = '<span class="pill ok" style="font-size:9px;">done ' + db.fmtDateShort(d.doneAt) + '</span>';
      else if (d.manual) right = '<button class="btn btn-gold btn-sm" onclick="RFX.staffDutyComplete(\'' + d.id + '\')">' + (I.check || '') + ' Complete</button>';
      else { const n = db.dutyQueueCount(d.kind); right = '<span class="pill ' + (n > 0 ? 'warn' : 'ok') + '" style="font-size:9px;">' + (n > 0 ? n + ' in queue' : 'auto-closes') + '</span>'; }
      const statusPill = d.doneAt ? '' : (overdue ? '<span class="pill danger" style="font-size:9px;">overdue</span>' : '');
      return '<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--border);">' +
        '<span class="ic" style="color:var(--gold-bright);flex:none;">' + ic(d.kind) + '</span>' +
        '<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><b style="font-size:13px;color:var(--text);">' + ui.esc(d.title) + '</b>' + statusPill + '</div>' +
        '<div class="small faint">' + ui.esc(d.desc) + '</div></div>' + right + '</div>';
    }).join('');
    list.innerHTML = rows || '<p class="small faint">No duties for your role today — the manager assigns work as it appears.</p>';
  }
  /* The manager never accepts an empty checkbox: each manual duty runs its
     real work first (audit, sync, security review…), then closes and credits. */
  window.RFX.staffDutyComplete = function (id) {
    if (!me) return;
    const d = (db.dutiesFor(me) || []).find(x => x.id === id);
    if (!d) return ui.toastErr('Duty not found.');
    if (d.doneAt) return ui.toastWarn('Already done.');
    let msg = '';
    switch (d.kind) {
      case 'audit': { const a = db.fullAudit(); msg = a.passed + '/' + a.total + ' system checks green — the audit is on record.'; break; }
      case 'sync': { db.reconcileSweep(); msg = 'Bridge synced and reconciled — the rail is clean.'; break; }
      case 'security': {
        const evs = db.securityEvents();
        const today = evs.filter(e => (e.at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
        msg = 'Security feed reviewed — ' + today + ' event' + (today === 1 ? '' : 's') + ' recorded today.'; break;
      }
      case 'outage': { const b = document.getElementById('os-uptime-card'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' }); msg = 'Uptime board reviewed — the Academy status is right below.'; break; }
      case 'sessions': { const active = db.enrollments().filter(e => e.session && e.session.token).length; msg = 'Session audit done — ' + active + ' active session' + (active === 1 ? '' : 's') + ', one per student enforced automatically.'; break; }
      case 'finance': { const q = (db.payouts ? db.payouts().filter(p => p.status === 'queued').length : 0); msg = 'Payout & refund queue reviewed — ' + q + ' item' + (q === 1 ? '' : 's') + ' in the next consolidated batch.'; break; }
      default: msg = 'Marked complete.';
    }
    const r = db.completeDuty(me, id);
    if (r.ok) { ui.toastOk('Duty complete — ' + (msg || d.title) + ' (+1 on your bar).'); renderDuties(); renderMyPerf(); }
    else ui.toastWarn(r.msg);
  };

  /* MY PERFORMANCE — the staff trust bar. Same gold ring as the students,
     same honesty: completed work and quality decisions raise it; overdue
     duties lower it. The ledger never lies to the person who earns it. */
  function renderMyPerf() {
    const box = document.getElementById('perf-content');
    if (!box || !me) return;
    const I = window.RFX.icons || {};
    const st = db.staffPerfStatus(me);
    const events = st.events.slice(0, 6);
    const rows = events.length
      ? '<ul class="audit">' + events.map(function (e) {
          const sign = e.delta > 0 ? '<b style="color:#7ee2a4;">+' + e.delta + '</b>' : e.delta < 0 ? '<b style="color:#f0a89c;">' + e.delta + '</b>' : '<b style="color:var(--gold);">·</b>';
          return '<li><span class="a-time">' + db.fmtDateShort(e.at) + '</span><span class="a-txt">' + sign + ' — ' + ui.esc(e.note || '') + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="small faint">No activity yet — your first completed duty is recorded here. Keep the bar gold.</p>';
    const tierColor = st.tier === 'excellent' ? '#7ee2a4' : (st.tier === 'danger' || st.tier === 'standdown') ? '#f0a89c' : st.tier === 'caution' ? 'var(--warn)' : 'var(--text)';
    const pay = db.perfPayFactor(me);
    const atRisk = st.score <= 20 ?
      '<div style="margin:6px 0 10px;padding:10px 12px;border-radius:10px;border:1px solid rgba(224,96,79,0.5);background:var(--danger-dim);color:#f0a89c;font-size:12px;"><b>Final warning.</b> A standing at 20 or below opens a termination review — complete every duty on time and the bar rebuilds.</div>' : '';
    const weeklyBtn = '<button class="btn btn-ghost btn-sm" style="margin-top:10px;" onclick="RFX.staffSendReport()">' + (I.mail || '') + ' Send my weekly report</button>';
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;">' +
      ui.trustRingHTML(st.score, { cap: 'staff' }) +
      '<div><div class="num gold" style="font-size:26px;">' + st.score + '%</div>' +
      '<div class="small" style="color:' + tierColor + ';font-weight:600;">' + st.label + '</div>' +
      '<div class="small faint">' + pay.label + ' · the manager watches the work</div></div></div>' +
      atRisk + rows + weeklyBtn;
  }

  /* TEAM PERFORMANCE — the whole team's standings plus the recent feed.
     Everyone sees the board (the standard is shared); only admins get the
     override + stand-down controls, each move recorded with a reason. */
  function renderTeamPerf() {
    const box = document.getElementById('team-perf');
    if (!box || !me) return;
    const I = window.RFX.icons || {};
    const board = db.staffPerfBoard();
    const feed = db.teamPerfFeed(8);
    const rows = board.map(function (m) {
      const color = m.tier === 'excellent' ? '#7ee2a4' : (m.tier === 'danger' || m.tier === 'standdown') ? '#f0a89c' : m.tier === 'caution' ? 'var(--warn)' : 'var(--text)';
      const badge = m.terminated ? '<span class="pill danger" style="font-size:8px;">stood down</span>' : (m.atRisk ? '<span class="pill danger" style="font-size:8px;">final warning</span>' : '');
      return '<li style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);">' +
        '<span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--gold-bright);width:52px;flex:none;">' + m.id + '</span>' +
        '<div style="flex:1;min-width:0;"><b style="font-size:13px;color:var(--text);">' + ui.esc(m.name) + '</b>' +
        ' <span class="small faint">' + (m.role === 'admin' ? 'Admin' : m.role === 'reception' ? 'Reception' : m.role === 'approver' ? 'Approver' : 'Finance') + '</span>' + badge + '</div>' +
        '<span style="color:' + color + ';font-weight:700;font-family:ui-monospace,monospace;font-size:13px;">' + m.score + '</span>' +
        (me.role === 'admin' && !m.terminated ? '<span style="display:inline-flex;gap:4px;">' +
          '<button class="btn btn-dark btn-sm" style="padding:2px 7px;font-size:10px;" title="Adjust performance (+/- 20) with a reason" onclick="RFX.staffOverride(\'' + m.id + '\')">' + (I.edit || '') + '</button>' +
          '<button class="btn btn-danger btn-sm" style="padding:2px 7px;font-size:10px;" title="Stand down — termination review" onclick="RFX.staffTerminate(\'' + m.id + '\')">' + (I.x || '') + '</button>' +
          '</span>' : '') +
        '</li>';
    }).join('');
    const feedRows = feed.length ? feed.map(function (e) {
      const sign = e.delta > 0 ? '<b style="color:#7ee2a4;">+' + e.delta + '</b>' : e.delta < 0 ? '<b style="color:#f0a89c;">' + e.delta + '</b>' : '<b style="color:var(--gold);">·</b>';
      return '<li><span class="a-time">' + db.fmtDateShort(e.at) + '</span><span class="a-txt">' + ui.esc(e.name) + ' ' + sign + ' — ' + ui.esc(e.note || '') + '</span></li>';
    }).join('') : '<li class="small faint">Nothing recorded yet — the logbook fills with real work.</li>';
    box.innerHTML =
      '<ul class="audit" style="margin-bottom:14px;">' + rows + '</ul>' +
      '<div class="eyebrow muted" style="margin:4px 0 6px;">The manager\'s logbook · newest first</div>' +
      '<ul class="audit" style="max-height:220px;overflow:auto;">' + feedRows + '</ul>' +
      (me.role === 'admin' ?
        '<div class="small faint" style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">Admin controls: the pencil adjusts a bar (±20, reason mandatory); the × stands a member down. Every move is recorded permanently.</div>' :
        '<div class="small faint" style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">The whole team works under the same bar — standings are shared, records are honest.</div>');
  }
  window.RFX.staffOverride = function (id) {
    if (!me || me.role !== 'admin') return ui.toastErr('Only an admin can adjust a bar.');
    const m = db.staffById(id);
    if (!m) return ui.toastErr('Staff member not found.');
    const delta = prompt('Adjust ' + m.name + '\'s performance bar (-20 to +20):', '0');
    if (delta == null) return;
    const reason = prompt('Reason (mandatory — recorded permanently):', '');
    if (reason == null) return;
    const r = db.adminPerfOverride(id, delta, reason, me.name);
    if (!r.ok) return ui.toastErr(r.msg);
    ui.toastOk(m.name + '\'s bar is now ' + r.score + ' — override recorded.');
    renderTeamPerf(); renderMyPerf();
  };
  window.RFX.staffTerminate = function (id) {
    if (!me || me.role !== 'admin') return ui.toastErr('Only an admin can stand a member down.');
    const m = db.staffById(id);
    if (!m) return ui.toastErr('Staff member not found.');
    if (m.id === me.id) return ui.toastErr('You cannot stand yourself down — contact the owner.');
    if (!confirm('Stand ' + m.name + ' down? Their access ends now and the decision is emailed + recorded.')) return;
    const reason = prompt('Reason (mandatory — the record a review would read):', '');
    if (reason == null) return;
    const r = db.adminTerminateStaff(id, reason, me.name);
    if (!r.ok) return ui.toastErr(r.msg);
    ui.toastOk(m.name + ' stood down — access revoked, reason on record.');
    renderTeamPerf();
  };

  /* THE STANDARD — the awareness card. Staff know, before anything is ever
     enforced, exactly how the manager works and what it costs. */
  function renderTheStandard() {
    const box = document.getElementById('the-standard');
    if (!box) return;
    box.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;">' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">Pay follows the bar</div><div class="small faint">Excellent and solid are paid in full · needs attention holds 10% · thin ice holds 20% · stood down pays nothing until admin review.</div></div>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">Lateness is measured</div><div class="small faint">A scheduled shift start makes it a fact, not an opinion — more than 15 minutes late is recorded once, on your bar.</div></div>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">Misses escalate</div><div class="small faint">Overdue duties cost -2, then more with every repeat in 30 days (capped -6). The queue closes itself the moment the work is done.</div></div>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">The line is 20</div><div class="small faint">A standing at 20 or below opens a termination review; at 0 the account is stood down. Every number was always in your hands.</div></div>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">Passwords are untouchable</div><div class="small faint">Student passwords exist only as secure hashes — staff and support can never see or reset them. Recovery is self-service: direct the student to <b>Forgot password?</b> on the sign-in screen. Never ask a student for their password.</div></div>' +
      '<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;"><div class="small gold" style="font-weight:700;margin-bottom:4px;">Audits are your proof</div><div class="small faint">One click runs the full 20-check audit and the 5 self-tests that attack the system like an intruder. You never need to be a developer — run it, read the log, and the health of the machine is in your hands.</div></div>' +
      '</div>';
  }
  window.RFX.staffSendReport = function () {
    if (!me) return;
    const r = db.staffWeeklyReport(me.id);
    if (!r.ok) return ui.toastErr(r.msg);
    ui.toastOk('Your weekly performance report is in the Mailbox.');
    renderMyPerf();
  };
  window.RFX.staffSetShiftTime = function () {
    if (!me || me.role !== 'admin') return ui.toastErr('Only an admin schedules shift starts.');
    const id = document.getElementById('ss-staff').value;
    const time = document.getElementById('ss-time').value;
    const m = db.staffById(id);
    if (!m) return ui.toastErr('Pick a staff member.');
    const r = db.setStaffShiftTime(id, time);
    if (!r.ok) return ui.toastErr(r.msg);
    ui.toastOk(m.name + ' — expected start ' + (r.staff.shiftStart || 'not scheduled') + '.');
    renderTeamPerf();
  };

  function renderMyWallet() {
    const box = document.getElementById('my-wallet');
    if (!box || !me) return;
    const w = db.staffWalletFor(me.id);
    const rows = (w.ledger || []).slice().reverse().slice(0, 6);
    box.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
      '<span class="num gold" style="font-size:26px;">' + db.money(w.balance, w.currency) + '</span>' +
      '<span class="mono small" style="color:var(--gold-bright);">' + w.walletNo + '</span>' +
      '<span class="small faint">your RFX money</span></div>' +
      (rows.length
        ? '<div class="eyebrow muted" style="margin:4px 0 6px;">Recent</div><ul class="audit">' + rows.map(e =>
          '<li><span class="a-time">' + db.fmtDate(e.at) + '</span><span class="a-txt"><b style="color:#7ee2a4;">+' + db.money(e.amount, w.currency) + '</b> — ' + ui.esc(e.note || '') + ' <span class="small faint">(' + ui.esc(e.reference || '') + ')</span></span></li>'
        ).join('') + '</ul>'
        : '<p class="small faint">No funds yet. Finance adds money to this wallet when it is earned or approved.</p>');
  }

  function renderShift() {
    const shift = db.currentShift(me.id);
    const st = document.getElementById('shift-status');
    const outBtn = document.getElementById('btn-clock-out');
    if (shift) {
      st.innerHTML = '<span class="dot ok pulse"></span> On duty now · <b>' + (shift.type === 'night' ? 'night shift' : 'day shift') + '</b> since ' + new Date(shift.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      outBtn.hidden = false;
    } else {
      const last = me.shifts.length ? me.shifts[me.shifts.length - 1] : null;
      st.textContent = last ? ('Last shift ended ' + ui.fmtRelative(last.out) + '. Clock in to start a new shift.') : 'Not on a shift yet. Clock in to start.';
      outBtn.hidden = true;
    }
    renderMyShifts();
  }

  function renderMyShifts() {
    const list = document.getElementById('my-shifts');
    const shifts = (me.shifts || []).slice().reverse().slice(0, 8);
    if (!shifts.length) {
      list.innerHTML = '<li><span class="a-time">—</span><span class="a-txt faint">No shifts recorded yet.</span></li>';
      return;
    }
    const ic = RFX.icons && RFX.icons.clock ? RFX.icons.clock : '';
    list.innerHTML = shifts.map(sh => {
      const hrs = sh.out ? ((new Date(sh.out) - new Date(sh.in)) / 3600000).toFixed(1) : '…';
      return '<li><span class="a-time">' + new Date(sh.in).toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' · ' + (sh.type === 'night' ? 'night' : 'day') + '</span>' +
        '<span class="a-txt"><b>' + (sh.type === 'night' ? 'Night' : 'Day') + '</b> · ' + new Date(sh.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        (sh.out ? ' → ' + new Date(sh.out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + hrs + 'h' : ' · in progress') + '</span>' +
        '<span style="margin-left:auto;">' + ic + '</span></li>';
    }).join('');
  }

  function doClock(type) {
    const res = db.clockIn(me.id, type);
    if (!res.ok) { ui.toastErr(res.msg); return; }
    me = db.staffById(me.id);
    if (res.lateMins) {
      ui.toastWarn('Clocked in ' + res.lateMins + ' min late — the manager recorded -' + res.penalty + ' on your bar.');
    } else {
      ui.toastOk('Clocked in — ' + (type === 'night' ? 'night' : 'day') + ' shift started.');
    }
    renderShift(); renderRoster(); refreshPill(); renderMyPerf(); renderTeamPerf();
  }

  function doClockOut() {
    const res = db.clockOut(me.id);
    if (!res.ok) { ui.toastErr(res.msg); return; }
    ui.toastOk('Clocked out — shift ended. Thank you.');
    me = db.staffById(me.id);
    renderShift(); renderRoster(); refreshPill();
  }

  /* SHIFT COVERAGE — the week at a glance. Every hour of the last 7 days
     counts how many staff were actually on duty (real shift records only),
     so coverage gaps — nights nobody covers, quiet weekends — are visible
     at a glance. The 24/7 promise is a measured fact. */
  function renderCoverage() {
    const box = document.getElementById('coverage-heatmap');
    const sub = document.getElementById('coverage-sub');
    const seedBtn = document.getElementById('btn-seed-coverage');
    if (!box) return;
    const h = db.coverageHeatmap(7);
    const st = h.stats;
    if (seedBtn) seedBtn.hidden = !me || me.role !== 'admin';
    const colorFor = n => n === 0 ? 'var(--cov-0)' : n === 1 ? 'var(--cov-1)' : n === 2 ? 'var(--cov-2)' : 'var(--cov-3)';
    const hourHead = [0, 3, 6, 9, 12, 15, 18, 21].map(x => '<div class="cov-h">' + x + ':00</div>').join('');
    const head = '<div class="cov-row"><div class="cov-day"></div>' + hourHead + '</div>';
    const rows = h.days.map(function (d) {
      const cells = d.rows.map(function (r) {
        const who = r.names.length ? r.names.join(', ') : 'No one on duty';
        const when = d.label + ' · ' + String(r.hour).padStart(2, '0') + ':00';
        return '<div class="cov-cell" style="background:' + colorFor(r.count) + ';" title="' + when + ' — ' + r.count + ' on duty (' + who + ')"></div>';
      }).join('');
      const t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const isToday = new Date(d.date).getTime() === t0.getTime();
      return '<div class="cov-row"><div class="cov-day">' + d.label + (isToday ? ' · now' : '') + '</div>' + cells + '</div>';
    }).join('');
    const demoNote = st.demoShifts ? '<span class="pill soon" style="font-size:8px;" title="Sample shifts from the demo seed — real clock-ins replace them as the team works.">sample roster</span>' : '';
    const legend = '<div class="cov-legend"><span class="cov-leg"><i style="background:var(--cov-1);"></i>1 on duty</span><span class="cov-leg"><i style="background:var(--cov-2);"></i>2</span><span class="cov-leg"><i style="background:var(--cov-3);"></i>3+</span></div>';
    box.innerHTML =
      head + rows +
      '<div class="small faint" style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;">' +
      '<b style="color:var(--text);">' + st.coveragePct + '%</b> of ' + (st.windowDays * 24) + ' hours covered · <b style="color:var(--text);">' + st.totalStaffHours + '</b> staff-hours · peak <b style="color:var(--text);">' + st.peak + '</b> staff at once · <b style="color:var(--warn);">' + st.gaps + '</b> uncovered hour' + (st.gaps === 1 ? '' : 's') + '</span>' + legend + demoNote + '</div>';
    if (sub) sub.innerHTML = st.demoShifts
      ? 'every hour of the last 7 days, from the shift records (showing the seeded sample roster)'
      : 'every hour of the last 7 days — how many staff were on duty, straight from the shift records';
  }
  window.RFX.staffSeedCoverage = function () {
    if (!me || me.role !== 'admin') return ui.toastErr('Only an admin can seed demo coverage.');
    const r = db.seedCoverage();
    if (!r.ok) return ui.toastErr(r.msg || 'Could not seed coverage.');
    ui.toastOk('Sample roster built — ' + r.created + ' team member' + (r.created === 1 ? '' : 's') + ' added, 14-day coverage seeded. Real shifts replace it as the team works.');
    renderCoverage(); renderRoster(); renderTeamPerf();
  };

  /* ---------------- roster ---------------- */
  function rosterRow(s) {
    const shift = db.currentShift(s.id);
    const since = shift ? 'since ' + new Date(shift.in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return '<li><span class="a-time">' + (s.id) + '</span>' +
      '<span class="a-txt"><b>' + ui.esc(s.name) + '</b> · ' + (s.role === 'admin' ? 'Admin' : s.role === 'reception' ? 'Reception' : s.role === 'approver' ? 'Approver' : 'Finance') +
      (shift ? ' <span class="dot ok pulse" style="vertical-align:middle;"></span>' : '') + '</span>' +
      '<span style="margin-left:auto;white-space:nowrap;">' + (shift ? '<span class="pill ok">On duty ' + since + '</span>' : '<span class="pill soon">Off</span>') + '</span></li>';
  }

  function renderRoster() {
    const onDuty = document.getElementById('roster');
    const all = document.getElementById('team-list');
    const duty = db.onDutyStaff();
    onDuty.innerHTML = duty.length ? duty.map(rosterRow).join('') : '<li><span class="a-txt faint">No one on duty right now — coverage gap.</span></li>';
    all.innerHTML = db.staff().map(rosterRow).join('');
  }

  /* ---------------- reception pill ---------------- */
  function refreshPill() {
    const pill = document.getElementById('on-duty-pill');
    if (!pill) return;
    const n = db.onDutyCount();
    const hasTeam = !!(db.staff && db.staff().length);
    pill.innerHTML = n > 0
      ? '<span class="dot ok pulse"></span> Reception · 24/7 · ' + n + ' on duty'
      : '<span class="dot warn"></span> Reception · 24/7 · ' + (hasTeam ? 'no one on duty right now — coverage gap' : 'checking coverage…');
  }

  /* ---------------- hire (admin) ---------------- */
  function doHire() {
    const name = document.getElementById('h-name').value.trim();
    const email = document.getElementById('h-email').value.trim();
    const role = document.getElementById('h-role').value;
    const out = document.getElementById('hire-result');
    const res = db.createStaff({ name, email, role, by: me ? me.name : 'Reality FX Admin' });
    if (!res.ok) { out.innerHTML = '<span class="small" style="color:#f0a89c;">' + ui.esc(res.msg) + '</span>'; return; }
    document.getElementById('h-name').value = '';
    document.getElementById('h-email').value = '';
    out.innerHTML = '<span class="small" style="color:#7ee2a4;">' + (RFX.icons && RFX.icons.checkCircle ? '<span style="vertical-align:middle;">' + RFX.icons.checkCircle + '</span> ' : '') + ui.esc(res.staff.name) + ' invited — the invite email is in the <a href="mailbox.html" style="color:var(--gold-bright);">Mailbox</a>. One-time link, 7-day expiry.</span>';
    renderRoster();
  }

  /* ---------------- multi-tab safety ---------------- */
  // If another tab adopts a newer store revision, refresh our staff reference so
  // clock-in/out and roster actions always land on the live record.
  window.addEventListener('rfx:sync', function () {
    if (!me) return;
    const live = db.staffById(me.id);
    if (live && live !== me) {
      me = live;
      if (document.getElementById('screen-panel') && !document.getElementById('screen-panel').hidden) {
        renderShift(); renderRoster(); renderMyWallet(); refreshPill();
      }
    }
  });

  /* ---------------- sign out ---------------- */
  function doLogout() {
    if (panelIv) { clearInterval(panelIv); panelIv = null; }
    me = null;
    show('screen-login');
    ui.toastOk('Signed out.');
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    if (initInvite()) {
      document.getElementById('btn-activate').addEventListener('click', doActivate);
    } else {
      show('screen-login');
      document.getElementById('btn-staff-login').addEventListener('click', doLogin);
      document.getElementById('s-code').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    }
    document.getElementById('btn-logout').addEventListener('click', doLogout);
    document.getElementById('btn-clock-day').addEventListener('click', () => doClock('day'));
    document.getElementById('btn-clock-night').addEventListener('click', () => doClock('night'));
    document.getElementById('btn-clock-out').addEventListener('click', doClockOut);
    document.getElementById('btn-hire').addEventListener('click', doHire);
    const sc = document.getElementById('btn-seed-coverage');
    if (sc) sc.addEventListener('click', function () { window.RFX.staffSeedCoverage && window.RFX.staffSeedCoverage(); });
    const ss = document.getElementById('ss-staff');
    if (ss) {
      const fill = () => {
        const cur = ss.value;
        ss.innerHTML = db.staff().map(s => '<option value="' + s.id + '">' + ui.esc(s.name) + ' · ' + s.id + (s.shiftStart ? ' (currently ' + s.shiftStart + ')' : '') + '</option>').join('');
        if (cur && db.staffById(cur)) ss.value = cur;
      };
      fill();
      const bt = document.getElementById('btn-shift-time');
      if (bt) bt.addEventListener('click', function () {
        window.RFX.staffSetShiftTime && window.RFX.staffSetShiftTime();
        fill();
      });
    }
    refreshPill();
  });
})();
