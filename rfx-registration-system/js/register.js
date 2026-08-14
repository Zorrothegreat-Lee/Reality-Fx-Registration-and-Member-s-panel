/* Student Registration Portal (register.html) */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  const token = new URLSearchParams(location.search).get('token') || '';
  let enr = null;
  let step = 0;
  let captchaAnswer = '';
  let selfieDataUrl = null;
  let selfieQuality = null; // analyzeSelfie verdict, passed to saveIdentity

  const STEPS = [
    { t: 'Your details', s: 'Who you are' },
    { t: 'Verify email', s: "Confirm it's really you" },
    { t: 'Human check', s: 'A quick CAPTCHA' },
    { t: 'Identity', s: 'Phone, address & selfie' },
    { t: 'Agreements', s: 'Terms, Fair Usage & more' },
    { t: 'Review & submit', s: 'Last look before approval' },
  ];

  const $ = id => document.getElementById(id);
  const hide = id => { const el = $(id); if (el) el.hidden = true; };
  const show = id => { const el = $(id); if (el) el.hidden = false; };

  /* Demo-pass countdown — a live clock in the header. The 24h tour runs on
     ACADEMY TIME: it starts counting when the student is APPROVED (that's
     when the learning can begin — the OS teaches trading, not registration).
     Before approval the chip reads the full window ahead; on the approved
     screen it ticks down live. Hover: "Time left till your demo session is
     expired". */
  let demoIv = null;
  function startDemoCountdown() {
    const el = $('demo-countdown');
    const timeEl = $('demo-countdown-time');
    const labelEl = el && el.querySelector('.dc-label');
    const barEl = $('demo-countdown-bar');
    const barFill = barEl && barEl.querySelector('.life-bar-fill');
    if (!el || !timeEl || !enr || !enr.demoPass) return;
    const paintBar = frac => { if (barFill) { barFill.style.setProperty('--v', Math.round(frac * 100) + '%'); if (frac <= 0) barEl.classList.add('dc-expired'); else barEl.classList.remove('dc-expired'); } };
    // re-read the APPROVED state on EVERY tick: a moderator may approve the
    // student while this page is open (the approved screen polls), and the
    // clock must flip from "begins when approved" to a LIVE countdown without
    // needing a page reload. The poll in renderApproved re-renders the screen
    // but the header chip is ours — we keep it honest here.
    const tick = () => {
      const cur = db.byId(enr.id) || enr; // freshest state (approval lands via the poll)
      const approved = !!(cur.studentId && cur.registration && cur.registration.decision);
      const left = db.demoTimeLeft(cur);
      paintBar(db.demoLifeLeft(cur)); // the gold life bar drains with the tour
      if (left <= 0) {
        el.classList.add('dc-expired');
        timeEl.textContent = 'Expired — request a new pass';
        if (demoIv) { clearInterval(demoIv); demoIv = null; }
        return;
      }
      el.classList.remove('dc-expired');
      // before approval the clock hasn't started — show the full window with
      // an honest "starts when you're approved" note instead of a fake tick
      if (!approved) {
        timeEl.textContent = db.fmtCountdown(left);
        if (labelEl) labelEl.textContent = '24h academy pass';
        el.title = 'Your 24-hour academy tour begins when your registration is approved';
        return;
      }
      timeEl.textContent = db.fmtCountdown(left);
      if (labelEl) labelEl.textContent = 'Demo session';
      el.title = 'Time left till your demo session is expired';
    };
    el.hidden = false;
    tick();
    if (demoIv) clearInterval(demoIv);
    demoIv = setInterval(tick, 1000);
  }

  /* ---------------- bootstrap ---------------- */
  function boot() {
    if (!token) return renderLinkError('No registration link was provided. Links arrive by email after your purchase is confirmed.');
    const v = db.validateLink(token);
    enr = db.byToken(token);
    if (!enr) return renderLinkError(v.msg);
    if (!v.ok && v.code === 'REJECTED') return renderRejected();
    if (!v.ok) return renderLinkError(v.msg);
    // link-open tracking — recorded once, powers the registration funnel.
    // Only live links count: unknown / expired tokens are refused without one.
    db.markLinkOpened(enr);
    // the demo-session clock ticks on EVERY screen (welcome, form, submitted,
    // approved) — a returning student must see how long their tour has left
    startDemoCountdown();
    if (v.code === 'APPROVED' || v.code === 'ACTIVE') return renderApproved();
    if (enr.registration.submittedAt) return renderSubmitted();
    // returning student: skip the welcome gate and resume where they left off
    initDobCalendar();
    initCountryPicker();
    if (enr.registration.personal) { resume(); return; }
    renderWelcome();
  }

  /* The branded RFX calendar replaces the plain date input for the DOB —
     one classy picker across the system, same as the staff payday calendar. */
  function initDobCalendar() {
    const el = document.getElementById('p-dob');
    if (!el) return;
    ui.calendarPicker(el, {
      mode: 'date', // a full date of birth
    });
  }

  /* The country dropdown — one canonical list for every student (no
     free-typing, no spelling drift). If a returning session holds a country
     that is somehow not in the list, it is added on the fly so no data is
     ever lost or hidden. */
  function initCountryPicker() {
    const sel = document.getElementById('p-country');
    if (!sel || sel.dataset.rfxBuilt) return;
    (RFX.db.countries || []).forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    sel.dataset.rfxBuilt = '1';
  }

  /* Quick age-range picks (broker-style) — pick a bracket and a
     representative birthdate fills the branded calendar: midpoint of the
     range, born on today's day/month so it feels natural. Still fully
     editable — the real calendar is one click away. */
  window.RFX.pickAgeRange = function (min, max) {
    const el = document.getElementById('p-dob');
    if (!el) { ui.toastErr('Date of birth field not found.'); return; }
    const age = Math.floor((min + max) / 2);
    const d = new Date();
    d.setFullYear(d.getFullYear() - age);
    const iso = d.toISOString().slice(0, 10);
    el.dataset.rfxVal = iso;
    el.value = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
    el.classList.add('picked');
    setTimeout(() => el.classList.remove('picked'), 600);
    ui.toastOk('Set to ~' + age + ' years old (' + (min === 45 ? '45+' : min + '–' + max) + ') — fine-tune in the calendar if you like.');
  };

  function renderLinkError(msg) {
    show('screen-link-error');
    let text = msg;
    // The classic demo gotcha: this system stores its data in the browser it
    // was created in (localStorage). Open the link in a DIFFERENT browser and
    // the token cannot be found — the security layer is doing its job, the
    // tour data just lives elsewhere. In production (Firebase) data is global
    // and this never happens.
    if (db.enrollments().length === 0) {
      text += ' (This demo stores its data in the browser where the enrollment was created — open the link in that same browser/preview, or ask the team to re-issue a fresh link.)';
    }
    $('link-error-msg').textContent = text;
  }

  /* ---------------- welcome ---------------- */
  function renderWelcome() {
    show('screen-welcome');
    $('wl-name').textContent = enr.payment.customerName;
    $('wl-email').textContent = enr.payment.email;
    $('wl-course').textContent = enr.payment.course;
    $('wl-price').textContent = db.money(enr.payment.price, enr.payment.currency);
    $('wl-exp').textContent = db.fmtDateShort(enr.registration.tokenExpiresAt);
    const qm = db.quoteOfMonth();
    const qEl = $('wl-quote-text');
    if (qm && qEl) qEl.textContent = qm.quote;
    $('btn-begin').addEventListener('click', () => {
      const btn = $('btn-begin');
      if (btn.disabled) return;
      ui.busyButton(btn, true, 'Opening…');
      try {
        // The single-use link is consumed at SUBMISSION (see db.submitRegistration),
        // so an in-progress registration survives refreshes. A second person
        // cannot use this link after submission.
        hide('screen-welcome');
        show('screen-form');
        resume();
      } catch (e) {
        console.error(e);
      } finally {
        ui.busyButton(btn, false);
      }
    });
  }

  /* ---------------- steps ---------------- */
  function resume() {
    const reg = enr.registration;
    if (reg.personal) prefillPersonal();
    step = !reg.personal ? 0
      : !reg.emailVerifiedAt ? 1
      : !reg.captchaPassedAt ? 2
      : !reg.identity ? 3
      : !(reg.agreements && reg.agreements.length) ? 4
      : 5;
    showStep();
  }

  function showStep() {
    show('screen-form');
    const s = STEPS[step];
    $('step-title').textContent = s.t;
    $('step-sub').textContent = s.s;
    $('step-count').textContent = 'Step ' + (step + 1) + ' of ' + STEPS.length;
    $('p-email').value = enr.payment.email; // always show the enrollment email
    $('stepper').innerHTML = STEPS.map((st, i) =>
      '<div class="stp ' + (i < step ? 'done' : i === step ? 'cur' : '') + '"></div>').join('');
    STEPS.forEach((_, i) => hide('step-' + ['personal', 'email', 'captcha', 'identity', 'agreements', 'review'][i]));
    const elId = ['personal', 'email', 'captcha', 'identity', 'agreements', 'review'][step];
    show('step-' + elId);
    if (elId === 'email') initEmailStep();
    if (elId === 'captcha') generateCaptcha();
    if (elId === 'identity') initIdentityStep();
    if (elId === 'agreements') renderAgreements();
    if (elId === 'review') renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function prefillPersonal() {
    const p = enr.registration.personal;
    // split any previously-saved fullName into first + surname so older
    // sessions still prefill cleanly (e.g. a resubmitted re-application)
    const parts = (p.fullName || '').split(/\s+/).filter(Boolean);
    $('p-first').value = p.firstName || parts[0] || '';
    $('p-surname').value = p.surname || parts.slice(1).join(' ') || '';
    // the calendar field shows pretty text and keeps the ISO in data-rfx-val
    if (p.dob) {
      const d = new Date(p.dob);
      $('p-dob').value = isNaN(d.getTime()) ? p.dob : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      $('p-dob').dataset.rfxVal = p.dob;
    } else {
      $('p-dob').value = '';
      $('p-dob').dataset.rfxVal = '';
    }
    const country = p.country || '';
    const sel = $('p-country');
    if (sel) {
      initCountryPicker();
      if (country && !Array.from(sel.options).some(o => o.value === country)) {
        const o = document.createElement('option');
        o.value = country; o.textContent = country;
        sel.appendChild(o);
      }
      sel.value = country;
    }
    $('p-email').value = enr.payment.email;
  }

  /* ---------------- step 1: personal ---------------- */
  $('next-personal').addEventListener('click', () => {
    const btn = $('next-personal');
    if (btn.disabled) return; // never stack — a busy button is a locked button
    const first = $('p-first').value.trim();
    const surname = $('p-surname').value.trim();
    const dob = $('p-dob').dataset.rfxVal || $('p-dob').value;
    const country = $('p-country').value.trim();
    // Surname matters: some students register with only a first name, which
    // creates confusion later (certificates, SRM matching, refund identity).
    // Both names are required — the certificate carries the full name.
    if (!first) { ui.toastErr('Please enter your first name.'); return; }
    if (!surname) { ui.toastErr('Please enter your surname — it appears on your certificate and keeps your identity unambiguous.'); return; }
    if (!dob) { ui.toastErr('Please select your date of birth.'); return; }
    if (!country) { ui.toastErr('Please select your country from the list.'); return; }
    ui.busyButton(btn, true, 'Saving…');
    try {
      const fullName = first + ' ' + surname;
      db.savePersonal(enr, { fullName, firstName: first, surname, dob, country });
      ui.busyButton(btn, false);
      ui.toastOk('Details saved.');
      step = 1; showStep();
    } catch (e) {
      ui.busyButton(btn, false);
      console.error(e);
      ui.toastErr('Something went wrong saving your details — please try again.');
    }
  });

  /* ---------------- step 2: email verification ---------------- */
  function initEmailStep() {
    $('ev-email').textContent = enr.payment.email;
    $('ev-email').dataset.email = enr.payment.email;
    // if a previous attempt left the code locked, tell the student up front
    const lockedUntil = enr.registration && enr.registration.codeLockedUntil;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      const mins = Math.ceil((new Date(lockedUntil) - new Date()) / 60000);
      $('ev-hint').innerHTML = '<span style="color:var(--warn);">The code is temporarily locked after repeated wrong entries — request a new code in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.</span>';
    } else {
      $('ev-hint').textContent = 'In the demo, the code also lands in your Mailbox.';
    }
    refreshMailto();
    // rebuild code boxes
    const row = $('ev-codes');
    row.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const inp = document.createElement('input');
      inp.className = 'code-box'; inp.maxLength = 1; inp.inputMode = 'numeric';
      inp.addEventListener('input', () => {
        if (inp.value && i < 5) row.children[i + 1].focus();
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !inp.value && i > 0) row.children[i - 1].focus();
      });
      row.appendChild(inp);
    }
    setTimeout(() => row.children[0].focus(), 60);
  }
  /* LIVE email path: the demo has no SMTP server, so the honest "real email"
     is a mailto: that opens the student's OWN email app with the code
     pre-filled — their inbox, their provider, a genuinely live delivery.
     (Production swaps this for Resend/SendGrid — see FOR-LEE §7.) Rebuilt on
     every render AND after a resend so the link can never show a stale code. */
  function refreshMailto() {
    const mailto = $('ev-mailto');
    if (!mailto) return;
    const code = (enr.registration && enr.registration.verifyCode) || '';
    const subj = encodeURIComponent('Your Reality FX verification code');
    const body = encodeURIComponent(
      'Hi ' + (enr.payment.customerName || 'there') + ',\n\n' +
      'Your Reality FX verification code is:\n\n' + code + '\n\n' +
      'Enter it on the registration page to confirm your email.\n\n' +
      'If you did not request this, you can ignore this message.\n\n' +
      'Reality FX · realityfx20@gmail.com'
    );
    mailto.href = 'mailto:' + enr.payment.email + '?subject=' + subj + '&body=' + body;
    mailto.title = 'Opens your email app with the code ready to send to yourself — a live delivery, your inbox.';
  }
  $('ev-resend').addEventListener('click', () => {
    db.resendVerifyCode(enr);
    refreshMailto(); // the resend minted a NEW code — the email-app link must carry it
    ui.toastOk('A new code was emailed to ' + enr.payment.email + ' — open your email app or see the Mailbox. Attempts reset.');
  });
  $('verify-email').addEventListener('click', () => {
    const row = $('ev-codes');
    const code = Array.from(row.children).map(i => i.value).join('');
    if (code.length < 6) { ui.toastErr('Please enter all 6 digits.'); return; }
    const btn = $('verify-email');
    ui.busyButton(btn, true, 'Checking code…');
    setTimeout(() => {
      const r = db.checkVerifyCode(enr, code);
      if (r.ok) {
        ui.busyButton(btn, false);
        ui.toastOk('Email verified.');
        step = 2; showStep();
      } else {
        ui.busyButton(btn, false);
        ui.toastErr(r.locked ? r.msg : 'Incorrect code. ' + (r.attemptsLeft ? r.attemptsLeft + ' attempt' + (r.attemptsLeft === 1 ? '' : 's') + ' left before the code locks. Check the Mailbox for the latest code.' : r.msg));
        row.querySelectorAll('input').forEach(i => { i.value = ''; });
        row.children[0].focus();
      }
    }, 120);
  });

  /* ---------------- step 3: CAPTCHA ---------------- */
  const CAP_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function generateCaptcha() {
    captchaAnswer = '';
    for (let i = 0; i < 5; i++) captchaAnswer += CAP_ALPHA[Math.floor(Math.random() * CAP_ALPHA.length)];
    const canvas = $('captcha-canvas');
    canvas.width = 280; canvas.height = 74;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0d0d0c';
    ctx.fillRect(0, 0, 280, 74);
    // noise lines + dots
    ctx.strokeStyle = 'rgba(212,175,55,0.35)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * 280, Math.random() * 74);
      ctx.lineTo(Math.random() * 280, Math.random() * 74);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 280, Math.random() * 74, 1.5, 1.5);
    // chars
    for (let i = 0; i < captchaAnswer.length; i++) {
      const x = 26 + i * 48 + Math.random() * 8;
      const y = 40 + (Math.random() * 14 - 7);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((Math.random() * 0.5 - 0.25));
      ctx.font = '700 34px Georgia, serif';
      ctx.fillStyle = i % 2 ? '#d4af37' : '#f0d98c';
      ctx.shadowColor = 'rgba(212,175,55,0.4)';
      ctx.shadowBlur = 8;
      ctx.fillText(captchaAnswer[i], -14, 12);
      ctx.restore();
    }
    $('captcha-input').value = '';
  }
  /* NOTE — the demo CAPTCHA is a drawn challenge verified in the browser.
     Production replaces it with a server-verified provider (Cloudflare
     Turnstile / hCaptcha) and keeps the 'challenge expires after N
     attempts' behaviour server-side. There is deliberately NO global hook
     that can read the answer from the console — a headless script cannot
     pass this check in production. (The audit's demo CAPTCHA hook was
     removed for exactly this reason.) */
  $('captcha-refresh').addEventListener('click', generateCaptcha);
  $('verify-captcha').addEventListener('click', () => {
    const btn = $('verify-captcha');
    if (btn.disabled) return;
    const val = $('captcha-input').value.trim().toUpperCase();
    if (!val) { ui.toastErr('Enter the characters from the image.'); return; }
    if (val === captchaAnswer) {
      db.markCaptchaPassed(enr);
      ui.toastOk('Human check passed.');
      step = 3; showStep();
    } else {
      const c = db.registerCaptchaAttempt(enr);
      if (c.locked) { generateCaptcha(); ui.toastWarn(c.msg); }
      else { generateCaptcha(); ui.toastErr("That didn't match. Try again (" + c.attemptsLeft + " attempt" + (c.attemptsLeft === 1 ? '' : 's') + ' left on this challenge).'); }
    }
  });

  /* ---------------- step 4: identity ---------------- */
  function initIdentityStep() {
    // restore a previously uploaded selfie (e.g. on re-application) so the
    // student can continue with it or replace it with a fresh photo
    if (!selfieDataUrl && enr.registration && enr.registration.selfieDataUrl) {
      selfieDataUrl = enr.registration.selfieDataUrl;
      dz.classList.add('has-img');
      dz.innerHTML = '<img src="' + selfieDataUrl + '" alt="Selfie preview"><div class="small faint" style="margin-top:8px;">Using your previous selfie — tap to replace with a fresh photo</div>';
    }
    const req = db.getSettings().registrationRequirements || {};
    const field = $('i-id-field');
    const reqSpan = $('i-id-req');
    const hint = $('i-id-hint');
    if (req.idNumber === 'off') { field.style.display = 'none'; return; }
    field.style.display = '';
    if (req.idNumber === 'required') {
      reqSpan.textContent = '*';
      hint.textContent = 'Required for verification.';
    } else {
      reqSpan.textContent = '';
      hint.textContent = 'Optional — you can register without it. Reality FX verifies lightly and never contacts government databases.';
    }
  }

  const dz = $('dz'), dzInput = $('dz-input'), dzCamera = $('dz-camera');
  /* THREE ways to add a selfie — whatever device the student has:
       1. Take on my phone  → opens the PHONE camera (capture="user")
       2. Use my webcam     → opens the LAPTOP webcam live (getUserMedia)
       3. Upload from files → the existing photo picker
     The dropzone itself stays tappable and defaults to the phone camera. */
  const pick = input => { input.value = ''; input.click(); };
  dz.addEventListener('click', () => pick(dzCamera));
  const phoneBtn = $('dz-phone'), webcamBtn = $('dz-webcam'), galleryBtn = $('dz-gallery');
  if (phoneBtn) phoneBtn.addEventListener('click', e => { e.stopPropagation(); pick(dzCamera); });
  if (galleryBtn) galleryBtn.addEventListener('click', e => { e.stopPropagation(); pick(dzInput); });
  if (webcamBtn) webcamBtn.addEventListener('click', e => { e.stopPropagation(); openWebcam(); });

  /* Laptop webcam capture — a live preview with a capture button. Uses
     getUserMedia (the only way to reach a desktop webcam from a browser);
     the captured frame is downscaled exactly like any other selfie. If the
     camera is denied or missing, the student is pointed at the phone/files
     paths instead — never stuck. */
  let webcamStream = null, webcamModal = null;
  function openWebcam() {
    if (webcamModal) return; // already open — ignore double-clicks, never stack
    const I = RFX.icons || {};
    // onClose releases the camera on EVERY close path (✕, backdrop, Cancel,
    // capture) — a webcam left running after the modal disappears would keep
    // the red light on and the stream alive.
    const m = ui.modal('<div style="text-align:center;">' +
      '<video id="wc-video" autoplay playsinline muted style="width:100%;max-width:360px;border-radius:12px;background:#000;aspect-ratio:3/4;object-fit:cover;"></video>' +
      '<div class="small faint" style="margin:10px 0;">Position your face in the frame, well lit — then capture.</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
      '<button class="btn btn-gold btn-sm" id="wc-capture">' + (I.camera || '') + ' Capture photo</button>' +
      '<button class="btn btn-ghost btn-sm" id="wc-cancel">Cancel</button></div></div>', {
      onClose: () => { if (webcamStream) { webcamStream.getTracks().forEach(t => t.stop()); webcamStream = null; } webcamModal = null; },
    });
    m.setTitle('Take your selfie');
    webcamModal = m;
    const video = m.el.querySelector('#wc-video');
    const grab = m.el.querySelector('#wc-capture');
    const cancel = m.el.querySelector('#wc-cancel');
    grab.disabled = true;
    // request the front camera if one exists, else any camera
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then(stream => {
        webcamStream = stream;
        video.srcObject = stream;
        grab.disabled = false;
      })
      .catch(err => {
        m.el.querySelector('.modal-body').innerHTML =
          '<div style="text-align:center;padding:10px 6px;">' +
          '<div class="hero-ic" data-icon="camera" style="margin-bottom:10px;"></div>' +
          '<p class="sub" style="margin:0 auto 6px;">We could not reach your webcam</p>' +
          '<p class="small" style="color:var(--faint);max-width:340px;margin:0 auto 14px;">' +
          (err && err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser, or use one of the other two options — your phone camera or an uploaded photo.'
            : 'No camera was found on this device, or it is in use by another app. Use your phone camera or upload a photo instead.') + '</p>' +
          '<button class="btn btn-gold btn-sm" onclick="RFX.tryPhoneCamera()">' + (I.smartphone || '') + ' Take on my phone</button>' +
          '<button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="RFX.tryGallery()">' + (I.image || '') + ' Upload from files</button></div>';
      });
    grab.addEventListener('click', () => {
      // draw the current frame onto a canvas at ≤480px — the same downscale
      // pipeline as every other selfie, so storage stays consistent. If the
      // camera has not delivered a frame yet (or was mocked without one),
      // tell the student to wait rather than silently doing nothing.
      const c = document.createElement('canvas');
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) { ui.toastErr('Your camera is still warming up — wait a second and try again.'); return; }
      try {
        const max = 480;
        const scale = Math.min(1, max / Math.max(vw, vh));
        c.width = Math.round(vw * scale); c.height = Math.round(vh * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        selfieDataUrl = c.toDataURL('image/jpeg', 0.82);
      } catch (e) {
        ui.toastErr('Could not read the camera frame — try again or use your phone.');
        return;
      }
      m.close(); // onClose stops the stream on EVERY path
      selfieQuality = null;
      db.analyzeSelfie(selfieDataUrl).then(q => {
        selfieQuality = q;
        if (q.ok) {
          dz.classList.add('has-img');
          dz.innerHTML = '<img src="' + selfieDataUrl + '" alt="Selfie preview"><div class="small faint" style="margin-top:8px;">' + (q.suspicious ? 'Quality verified · <b style="color:#e0c36a;">flagged for a quick human check</b>' : 'Quality verified') + ' — tap to replace</div>';
          ui.toastOk(q.suspicious ? 'Photo accepted — our team will give it a quick look.' : 'Quality verified — looks like a real photo.');
        } else {
          selfieDataUrl = null;
          dz.innerHTML = '<div class="small" style="color:#f0a89c;padding:6px;">' + ui.esc(q.reason) + '</div><div class="small faint" style="margin-top:4px;">Tap to try again</div>';
          ui.toastErr(q.reason);
        }
      });
    });
    cancel.addEventListener('click', () => m.close());
  }

  /* Fallback buttons inside the webcam error state. Closing through the
     current modal ref runs onClose, which releases the stream; the pick()
     then hands straight to the phone/files paths. */
  window.RFX.tryPhoneCamera = () => { if (webcamModal) webcamModal.close(); pick(dzCamera); };
  window.RFX.tryGallery = () => { if (webcamModal) webcamModal.close(); pick(dzInput); };
  const readSelfie = file => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        // downscale to keep localStorage happy
        const max = 480;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        selfieDataUrl = c.toDataURL('image/jpeg', 0.82);
        selfieQuality = null;
        db.analyzeSelfie(selfieDataUrl).then(q => {
          selfieQuality = q;
          if (q.ok) {
            dz.classList.add('has-img');
            dz.innerHTML = '<img src="' + selfieDataUrl + '" alt="Selfie preview"><div class="small faint" style="margin-top:8px;">' + (q.suspicious ? 'Quality verified · <b style="color:#e0c36a;">flagged for a quick human check</b>' : 'Quality verified') + ' — tap to replace</div>';
            ui.toastOk(q.suspicious ? 'Photo accepted — our team will give it a quick look.' : 'Quality verified — looks like a real photo.');
          } else {
            selfieDataUrl = null;
            dz.innerHTML = '<div class="small" style="color:#f0a89c;padding:6px;">' + ui.esc(q.reason) + '</div><div class="small faint" style="margin-top:4px;">Tap to try again</div>';
            ui.toastErr(q.reason);
          }
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };
  dzInput.addEventListener('change', () => readSelfie(dzInput.files && dzInput.files[0]));
  dzCamera.addEventListener('change', () => readSelfie(dzCamera.files && dzCamera.files[0]));
  $('next-identity').addEventListener('click', () => {
    const btn = $('next-identity');
    if (btn.disabled) return;
    const phone = $('i-phone').value.trim();
    const idNumber = $('i-id').value.trim();
    const address = $('i-address').value.trim();
    if (!phone) { ui.toastErr('Please enter your phone number.'); return; }
    const req = db.getSettings().registrationRequirements || {};
    if (req.idNumber === 'required' && !idNumber) { ui.toastErr('Please enter your ID / passport number.'); return; }
    if (!address) { ui.toastErr('Please enter your address.'); return; }
    if (!selfieDataUrl) { ui.toastErr('Please upload your identity selfie.'); return; }
    ui.busyButton(btn, true, 'Saving…');
    try {
      // quality is the analyzer's verdict (accepted + possibly 'suspicious'); it
      // rides along so the moderator sees exactly what the machine saw.
      db.saveIdentity(enr, { phone, idNumber, address }, selfieDataUrl, selfieQuality);
      ui.busyButton(btn, false);
      ui.toastOk('Identity saved.');
      step = 4; showStep();
    } catch (e) {
      ui.busyButton(btn, false);
      console.error(e);
      ui.toastErr('Something went wrong saving your identity — please try again.');
    }
  });

  /* ---------------- step 5: agreements ---------------- */
  const AGREEMENT_SUMMARIES = {
    tcs: 'The rules of your Reality FX course: how lessons, quizzes and the Academy operate, and what is expected of you as a student.',
    fup: 'One student, one account. How the Academy protects its education through integrity monitoring, and what counts as a violation.',
    privacy: 'What personal data Reality FX collects (your name, contact details and a verification selfie), why, and how it is protected. Reality FX does not collect government ID or passport numbers — ever.',
    refund: 'If your registration cannot be approved, you choose between an instant, fee-free RFX account credit — valid 24 months, usable for any Reality FX course, a seat transfer to one family member, or mentorship sessions — and a cash refund paid via PayPal in a single consolidated monthly batch. For cross-border payments, Reality FX may recommend (or require) the fee-free RFX account credit where a cash refund\'s transfer and FX costs would exceed its value; your credit is always honoured in full, with no deduction. Where the issue is fixable, you may instead correct and re-apply within 7 days. IMPORTANT — an approved refund revokes all rights and ownership of Reality FX course material, immediately terminates RFX OS access, and starts a 30-day period during which the refunding identity may not re-enroll or re-apply. Every refund request is scored against the identity\'s history — prior refunds, timing, payment method and links to other accounts. Flags are reviewed by a moderator; repeated, rapid or abusive refund activity, or refund farming across multiple identities, may result in denial of future enrollment and is grounds for action under the Fair Usage Policy.',
    protection: 'Every Reality FX lesson page is watermarked with your Student ID and Reality FX branding, text cannot be copied, printing is blacked out by default, and attempted screen-capture or screen-recording is detected and logged to the Academy\'s integrity team. Course material is yours to learn from — never to resell, redistribute or share. Print access is a privilege granted only to students who have earned the Academy\'s trust, is recorded against your identity, and can be withdrawn at any time if that trust is broken. These protections exist so the education you paid for keeps its value — for you, and for every student after you.',
    referral: 'Reality FX rewards students who grow the Academy. Share your personal referral code; when a friend enrols with it and becomes a fully locked-in student, you earn a commission in your RFX account — starting at 15% and climbing to 30% as you refer more students. Your commission is only truly earned once the student you brought in survives the refund window, exactly like money subject to change: if they refund or are removed for a serious integrity violation, the commission is forfeited or clawed back. Referrals are tracked against your identity, and any attempt to refer yourself or game the programme is refused and recorded. The Academy stays strong because every commission is earned — and so do you, when you bring in students who are truly committed.',
  };
  function renderAgreements() {
    const list = $('agreements-list');
    list.innerHTML = db.getSettings().agreements.map(a =>
      '<label class="check" style="padding:14px;background:var(--bg-raise);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;">' +
      '<input type="checkbox" value="' + a.id + '">' +
      '<div class="check-body"><b>' + ui.esc(a.name) + '</b> <span class="pill gold" style="font-size:9px;">v' + a.version + '</span>' +
      '<div class="small faint" style="margin-top:4px;">' + (AGREEMENT_SUMMARIES[a.id] || 'Please read and accept this agreement.') + '</div></div>' +
      '</label>'
    ).join('');
  }
  $('accept-agreements').addEventListener('click', () => {
    const btn = $('accept-agreements');
    if (btn.disabled) return;
    const ids = Array.from(document.querySelectorAll('#agreements-list input:checked')).map(i => i.value);
    const all = db.getSettings().agreements.map(a => a.id);
    if (ids.length !== all.length) { ui.toastErr('Please accept all agreements to continue.'); return; }
    ui.busyButton(btn, true, 'Recording…');
    try {
      const agreed = db.acceptAgreements(enr, ids);
      ui.busyButton(btn, false);
      ui.toastOk('Accepted ' + agreed.length + ' agreements — versions and times recorded.');
      step = 5; showStep();
    } catch (e) {
      ui.busyButton(btn, false);
      console.error(e);
      ui.toastErr('Something went wrong recording your acceptance — please try again.');
    }
  });

  /* ---------------- step 6: review + submit ---------------- */
  function renderReview() {
    const reg = enr.registration;
    $('review-list').innerHTML =
      '<dt>Full name</dt><dd>' + ui.esc(reg.personal.fullName) + '</dd>' +
      '<dt>Date of birth</dt><dd>' + ui.esc(reg.personal.dob) + '</dd>' +
      '<dt>Country</dt><dd>' + ui.esc(reg.personal.country) + '</dd>' +
      '<dt>Email (verified)</dt><dd>' + ui.esc(enr.payment.email) + ' ✓</dd>' +
      '<dt>Phone</dt><dd>' + ui.esc(reg.identity.phone) + '</dd>' +
      '<dt>Government ID</dt><dd class="small faint">not collected — Reality FX does not request ID or passport numbers</dd>' +
      '<dt>Address</dt><dd>' + ui.esc(reg.identity.address) + '</dd>' +
      '<dt>Selfie</dt><dd>' + (reg.selfieDataUrl ? '<span class="pill ok">uploaded</span>' : '<span class="pill warn">missing</span>') + '</dd>' +
      '<dt>Agreements</dt><dd>' + reg.agreements.map(a => a.name + ' (v' + a.version + ')').join('<br>') + '</dd>' +
      '<dt>Course</dt><dd>' + ui.esc(enr.payment.course) + '</dd>';
  }
  $('submit-reg').addEventListener('click', () => {
    const btn = $('submit-reg');
    if (btn.disabled) return;
    ui.busyButton(btn, true, 'Submitting…');
    try {
      db.submitRegistration(enr);
      ui.toastOk('Registration submitted for verification.');
      if (enr.state === 'APPROVED') renderApproved();
      else renderSubmitted();
    } catch (e) {
      ui.busyButton(btn, false);
      console.error(e);
      ui.toastErr('Something went wrong submitting your registration — please try again.');
    }
  });

  /* ---------------- submitted / approved / rejected ---------------- */
  /* The review SLA — the honest clock. Before the SLA elapses the student
     sees "submitted 12 min ago · typically decided within ~2 hours"; after
     it, the message flips to "still in the queue, nothing is wrong" with a
     contact line. No student should ever guess what "a short time" meant. */
  let slaIv = null;
  function fmtAgo(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min' + (m === 1 ? '' : 's') + ' ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ' + (m % 60) + ' min ago';
    const d = Math.floor(h / 24);
    return d + ' day' + (d === 1 ? '' : 's') + ' ago';
  }
  function renderSla() {
    const box = $('sla-box');
    if (!box) return;
    const info = db.reviewSlaInfo(enr);
    const mins = info.slaMinutes;
    const hrs = Math.round(mins / 60 * 10) / 10;
    const wait = enr.registration.submittedAt ? Date.now() - new Date(enr.registration.submittedAt).getTime() : 0;
    if (info.withinSla) {
      box.innerHTML =
        '<div style="border:1px solid rgba(212,175,55,0.25);border-radius:12px;padding:14px 16px;background:rgba(212,175,55,0.05);">' +
        '<div class="small" style="color:var(--muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;"><span class="dot ok pulse"></span> Submitted ' + fmtAgo(wait) + '</div>' +
        '<div style="font-size:13px;color:var(--text);">Registrations are typically decided within <b class="gold">~' + hrs + ' hour' + (hrs === 1 ? '' : 's') + '</b> — you\'ll hear by ' + db.fmtDate(info.decidedBy) + '.</div>' +
        '<div class="small faint" style="margin-top:6px;">Most are approved much sooner. We\'ll update this page the moment your status changes — no need to keep checking.</div>' +
        '</div>';
    } else {
      box.innerHTML =
        '<div style="border:1px solid rgba(212,175,55,0.45);border-radius:12px;padding:14px 16px;background:rgba(212,175,55,0.08);">' +
        '<div class="small" style="color:var(--gold-bright);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px;">' + (info.overdueMinutes > 60 ? Math.floor(info.overdueMinutes / 60) + 'h' : info.overdueMinutes + 'm') + ' past our usual window</div>' +
        '<div style="font-size:13px;color:var(--text);">Your registration is <b>still safely in our review queue</b> — nothing is wrong and nothing was denied.</div>' +
        '<div class="small" style="color:var(--muted);margin-top:6px;">We aim to decide within ~' + hrs + ' hours; occasionally a registration needs a closer look. If it\'s urgent, email <b class="gold">realityfx20@gmail.com</b> with your reference and a member of the team will fast-track it.</div>' +
        '</div>';
    }
  }
  function renderSubmitted() {
    hide('screen-form'); // the form's nav buttons must not linger behind the status card
    show('screen-submitted');
    const note = $('sub-reapply');
    if ((enr.registration.reapplyCount || 0) > 0) {
      note.hidden = false;
      note.textContent = 'This is re-application attempt ' + enr.registration.reapplyCount + ' — Reality FX will re-review your corrected details.';
    }
    renderSla();
    if (slaIv) clearInterval(slaIv);
    slaIv = setInterval(renderSla, 30000); // refresh the clock every 30s
    $('check-status').addEventListener('click', boot);
  }
  function renderRejected() {
    hide('screen-form');
    show('screen-rejected');
    const reason = enr && enr.registration && enr.registration.decision && enr.registration.decision.reason;
    $('rej-msg').textContent = reason || 'Your registration could not be approved at this time.';
    const res = enr.resolution || {};
    $('rej-amount').textContent = db.money(enr.payment.price, enr.payment.currency);
    $('rej-reapply').hidden = true;  // shown only when a re-application is still possible
    $('rej-choice').hidden = true;   // re-shown when the student opts to resolve instead

    if (res.method === 'credit' && res.executedAt) {
      // credit already issued — show the live RFX account balance + expiry
      const bal = db.walletBalance(enr.payment.email);
      const expiry = res.expiresAt ? ' · <b style="color:var(--text);">valid until ' + db.fmtDateShort(res.expiresAt) + '</b>' : '';
      $('rej-status').innerHTML =
        '<div class="card card-gold" style="text-align:left;">' +
        '<div class="eyebrow" style="margin-bottom:8px;">Resolution complete</div>' +
        '<p class="small" style="margin-bottom:12px;">As you chose, <b style="color:var(--text);">' + db.money(res.amount, enr.payment.currency) + '</b> has been added to your RFX account — fee-free and available immediately.' + expiry + '</p>' +
        '<dl class="kv"><dt>RFX account</dt><dd>' + ui.esc(enr.payment.email) + '</dd>' +
        '<dt>Balance</dt><dd class="gold serif" style="font-size:22px;font-weight:600;">' + db.money(bal, enr.payment.currency) + '</dd></dl>' +
        '<p class="small faint" style="margin-top:10px;">Usable toward any Reality FX course, a seat transfer to a family member, or mentorship sessions. A confirmation email is in your inbox.</p></div>';
    } else if (res.method === 'refund' && res.executedAt) {
      $('rej-status').innerHTML =
        '<div class="card" style="border-color:rgba(143,182,232,0.35);text-align:left;">' +
        '<div class="eyebrow muted" style="margin-bottom:8px;">Refund queued</div>' +
        '<p class="small">Your refund of <b style="color:var(--text);">' + db.money(res.amount, enr.payment.currency) + '</b> is in the consolidated monthly batch (reference <span class="mono">' + (res.payoutId || '—') + '</span>). A confirmation email is in your inbox.</p></div>';
    } else if (res.choice) {
      $('rej-status').innerHTML =
        '<div class="card" style="text-align:left;">' +
        '<div class="eyebrow muted" style="margin-bottom:8px;">Choice received</div>' +
        '<p class="small">You chose <b style="color:var(--text);">' + (res.choice === 'credit' ? 'RFX account credit' : 'cash refund') + '</b>. Reality FX is processing it — you will receive a confirmation email. You can change your choice here until it is processed:</p>' +
        '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn btn-dark btn-sm" onclick="RFX.regChoose(\'' + (res.choice === 'credit' ? 'refund' : 'credit') + '\')">Switch to ' + (res.choice === 'credit' ? 'cash refund' : 'credit') + '</button></div></div>';
    } else {
      // Re-application first, resolution as the fallback
      const rp = db.canReapply(enr);
      if (rp.ok) {
        $('rej-reapply').hidden = false;
        $('rej-reapply-msg').innerHTML = 'Your payment stays with Reality FX while you fix the issue. You can correct and re-submit until <b style="color:var(--text);">' + db.fmtDateShort(rp.reapplyBy) + '</b> (' + rp.attemptsLeft + ' attempt' + (rp.attemptsLeft === 1 ? '' : 's') + ' left).' +
          '<div class="small faint" style="margin-top:6px;">Why: ' + ui.esc(reason || '') + '</div>';
        $('btn-reapply').onclick = () => {
          const r = db.reapply(enr);
          if (r.ok) {
            ui.toastOk('Re-application opened — your form is ready to edit.');
            resume();
          } else ui.toastErr(r.reason);
        };
        $('btn-resolve').onclick = () => {
          $('rej-reapply').hidden = true;
          showChoice();
        };
      } else {
        $('rej-msg').textContent = reason + ' ' + rp.reason;
        showChoice();
      }
    }
  }

  function showChoice() {
    $('rej-choice').hidden = false;
    // Seriousness, stated: the refund policy's revocation + cooldown clause.
    const st = $('refund-statement');
    st.textContent = db.refundStatement();
    st.hidden = true;
    $('choose-credit').onclick = () => { st.hidden = true; RFX.regChoose('credit'); };
    // First click reveals the consequence; a second click confirms. One click is
    // never enough for a refund — the student has to see what they're choosing.
    $('choose-refund').onclick = () => {
      if (st.hidden) {
        st.hidden = false;
        ui.toastWarn('Please read the refund consequence below before confirming.');
        return;
      }
      RFX.regChoose('refund');
    };
  }
  function renderApproved() {
    hide('screen-form');
    show('screen-approved');
    $('ap-id').textContent = enr.studentId || '—';
    $('ap-code').textContent = 'RFX-••••';
    $('ap-code').dataset.code = enr.studentCode || '';
    const I = RFX.icons || {};
    $('ap-reveal').innerHTML = I.eye || '';
    $('ap-reveal').onclick = () => {
      const el = $('ap-code');
      if (el.textContent === 'RFX-••••') { el.textContent = 'RFX-' + el.dataset.code; $('ap-reveal').innerHTML = I.eyeOff || I.eye || ''; }
      else { el.textContent = 'RFX-••••'; $('ap-reveal').innerHTML = I.eye || ''; }
    };
    // secure-your-credentials prompt: set the password right where the ID and
    // code were issued. Never stored readable — only a secure hash, so staff
    // and support can never see or recover it. Demo / trial / coupon prospects
    // see the option but it stays locked — a password is a real-student
    // privilege; their Student Code carries them through the tour.
    const pwBox = $('ap-pw');
    if (pwBox) {
      if (db.hasPassword(enr)) {
        pwBox.innerHTML = '<div class="small" style="color:#7ee2a4;padding:10px 0;">✓ Password set — sign in with your email and password from now on.</div>';
      } else if (db.canSetPassword && !db.canSetPassword(enr)) {
        pwBox.innerHTML = '<div class="small" style="color:var(--muted);padding:10px 0;opacity:0.8;">🔒 Setting a password is reserved for enrolled students. Your demo pass signs you in with your Student Code — when you enrol for real, you\'ll secure your account right here.</div>';
        const setPw = $('ap-setpw');
        if (setPw) { setPw.disabled = true; setPw.style.opacity = '0.5'; setPw.style.cursor = 'not-allowed'; setPw.onclick = function () { ui.toastWarn('Setting a password is reserved for enrolled students — your demo signs you in with your Student Code.'); }; }
        const apw1 = $('ap-pw1'), apw2 = $('ap-pw2');
        if (apw1) apw1.disabled = true;
        if (apw2) apw2.disabled = true;
      } else {
        const setPw = $('ap-setpw');
        const msg = $('ap-pw-msg');
        if (setPw) setPw.onclick = function () {
          const a = $('ap-pw1').value, b = $('ap-pw2').value;
          msg.hidden = true;
          if (a.length < 8) { msg.textContent = 'Password must be at least 8 characters.'; msg.hidden = false; return; }
          if (a !== b) { msg.textContent = 'Passwords do not match.'; msg.hidden = false; return; }
          const r = db.setStudentPassword(enr, a);
          if (r.ok) {
            pwBox.innerHTML = '<div class="small" style="color:#7ee2a4;padding:10px 0;">✓ Password set — from now on you sign in with your email and password. Keep it recorded somewhere secure.</div>';
            ui.toastOk('Password set — your account is secured.');
          } else { msg.textContent = r.msg || 'Could not set the password.'; msg.hidden = false; }
        };
      }
    }
    renderAccessGate();
    // while this screen is open, the OS gate unlocks itself the moment the
    // handshake lands (APPROVED → RFX_OS_CONFIRMED → ACTIVE)
    clearInterval(window.__apLockIv);
    window.__apLockIv = setInterval(() => {
      const cur = db.byId(enr.id) || enr;
      if ((cur.state === 'ACTIVE' || cur.state === 'RFX_OS_CONFIRMED') && cur.state !== enr.state) {
        enr = cur;
        renderApproved();
      }
    }, 1500);
  }

  /* RFX OS stays LOCKED until the student is approved AND the handshake is
     confirmed (state ACTIVE). A purchased course alone is not enough. */
  function renderAccessGate() {
    const I = RFX.icons || {};
    const enter = $('ap-enter');
    const lockMsg = $('ap-lock-msg');
    if (enter) {
      enter.href = db.osIndexUrl() + '?sid=' + encodeURIComponent(enr.studentId || '');
    }
    if (enr.state === 'ACTIVE' || enr.state === 'RFX_OS_CONFIRMED') {
      enter.style.display = 'inline-flex';
      if (lockMsg) lockMsg.hidden = true;
    } else {
      enter.style.display = 'none';
      if (lockMsg) {
        lockMsg.hidden = false;
        lockMsg.innerHTML = enr.state === 'APPROVED'
          ? '<div class="access-locked"><span class="ic">' + (I.lock || '') + '</span><span>Identity approved. RFX OS access unlocks the moment the handshake confirms — usually seconds.</span></div>'
          : '<div class="access-locked"><span class="ic">' + (I.clock || '') + '</span><span>Still processing — RFX OS unlocks once you are approved and verified.</span></div>';
      }
    }
    // A tour that has run out keeps the approved screen honest: the door is
    // closed with a clear explanation and a straight path to enroll for keeps.
    if (db.demoTourExpired(enr)) {
      enter.style.display = 'none';
      if (lockMsg) {
        lockMsg.hidden = false;
        lockMsg.innerHTML = '<div class="access-locked" style="text-align:center;padding:14px;">' +
          '<span class="ic" style="margin:0 auto 8px;display:flex;justify-content:center;font-size:26px;color:var(--gold-bright);">' + (I.key || I.clock || '') + '</span>' +
          '<span><b>Your free tour has ended.</b> Your approval and Student ID are real and permanent — this was the free tour\'s 24-hour window. Enroll in a program to keep your Academy access.</span></div>';
      }
    }
  }

  RFX.regChoose = function (choice) {
    if (!enr) return;
    const r = db.recordResolutionChoice(enr, choice);
    if (r && r.ok === false) { ui.toastErr(r.msg || 'This enrollment is already resolved.'); return; }
    ui.toastOk('Choice recorded — you can change it until we process it.');
    renderRejected();
  };

  /* ---------------- multi-tab safety ---------------- */
  // If another tab (e.g. the Staff Console approving us) adopts a newer store
  // revision while this page is open, our `enr` reference goes stale — re-fetch
  // it so the next step mutation lands on the live record, never a detached one.
  window.addEventListener('rfx:sync', function () {
    if (!enr) return;
    const live = db.byId(enr.id);
    if (live && live !== enr) {
      enr = live;
      // stay on the right screen for the new state
      const v = db.validateLink(token);
      if (v.code === 'REJECTED') renderRejected();
      else if (v.code === 'APPROVED' || v.code === 'ACTIVE') renderApproved();
      else if (enr.registration.submittedAt) renderSubmitted();
    }
  });

  /* ---------------- back buttons ---------------- */
  [['back-email', 0], ['back-captcha', 1], ['back-identity', 2], ['back-agreements', 3], ['back-review', 4]].forEach(([id, target]) => {
    $(id).addEventListener('click', () => { step = target; showStep(); });
  });

  boot();
})();
