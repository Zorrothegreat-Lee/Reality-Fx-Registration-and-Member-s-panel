/* Student Registration Portal (register.html) */
(function () {
  'use strict';
  const db = RFX.db, ui = RFX.ui;

  const token = new URLSearchParams(location.search).get('token') || '';
  let enr = null;
  let step = 0;
  let captchaAnswer = '';
  let selfieDataUrl = null;

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
    if (v.code === 'APPROVED' || v.code === 'ACTIVE') return renderApproved();
    if (enr.registration.submittedAt) return renderSubmitted();
    // returning student: skip the welcome gate and resume where they left off
    if (enr.registration.personal) { resume(); return; }
    renderWelcome();
  }

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
    $('btn-begin').addEventListener('click', () => {
      // The single-use link is consumed at SUBMISSION (see db.submitRegistration),
      // so an in-progress registration survives refreshes. A second person
      // cannot use this link after submission.
      hide('screen-welcome');
      show('screen-form');
      resume();
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
    $('p-name').value = p.fullName || '';
    $('p-dob').value = p.dob || '';
    $('p-country').value = p.country || '';
    $('p-email').value = enr.payment.email;
  }

  /* ---------------- step 1: personal ---------------- */
  $('next-personal').addEventListener('click', () => {
    const fullName = $('p-name').value.trim();
    const dob = $('p-dob').value;
    const country = $('p-country').value.trim();
    if (!fullName) { ui.toastErr('Please enter your full name.'); return; }
    if (!dob) { ui.toastErr('Please select your date of birth.'); return; }
    if (!country) { ui.toastErr('Please enter your country.'); return; }
    db.savePersonal(enr, { fullName, dob, country });
    ui.toastOk('Details saved.');
    step = 1; showStep();
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
      $('ev-hint').textContent = 'In the demo, open the Mailbox to see the code.';
    }
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
  $('ev-resend').addEventListener('click', () => {
    db.resendVerifyCode(enr);
    ui.toastOk('A new code was emailed to ' + enr.payment.email + ' (see the Mailbox). Attempts reset.');
  });
  $('verify-email').addEventListener('click', () => {
    const row = $('ev-codes');
    const code = Array.from(row.children).map(i => i.value).join('');
    if (code.length < 6) { ui.toastErr('Please enter all 6 digits.'); return; }
    const r = db.checkVerifyCode(enr, code);
    if (r.ok) {
      ui.toastOk('Email verified.');
      step = 2; showStep();
    } else {
      ui.toastErr(r.locked ? r.msg : 'Incorrect code. ' + (r.attemptsLeft ? r.attemptsLeft + ' attempt' + (r.attemptsLeft === 1 ? '' : 's') + ' left before the code locks. Check the Mailbox for the latest code.' : r.msg));
      row.querySelectorAll('input').forEach(i => { i.value = ''; });
      row.children[0].focus();
    }
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
  // TEST/DEMO HOOK ONLY — lets automated demos read the on-screen challenge.
  // Production replaces this CAPTCHA with a server-verified provider (Turnstile/hCaptcha).
  window.__RFX_CAPTCHA_ANSWER = function () { return captchaAnswer; };
  $('captcha-refresh').addEventListener('click', generateCaptcha);
  $('verify-captcha').addEventListener('click', () => {
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

  const dz = $('dz'), dzInput = $('dz-input');
  dz.addEventListener('click', () => dzInput.click());
  dzInput.addEventListener('change', () => {
    const file = dzInput.files && dzInput.files[0];
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
        dz.classList.add('has-img');
        dz.innerHTML = '<img src="' + selfieDataUrl + '" alt="Selfie preview"><div class="small faint" style="margin-top:8px;">Tap to replace</div>';
        ui.toastOk('Selfie captured.');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('next-identity').addEventListener('click', () => {
    const phone = $('i-phone').value.trim();
    const idNumber = $('i-id').value.trim();
    const address = $('i-address').value.trim();
    if (!phone) { ui.toastErr('Please enter your phone number.'); return; }
    const req = db.getSettings().registrationRequirements || {};
    if (req.idNumber === 'required' && !idNumber) { ui.toastErr('Please enter your ID / passport number.'); return; }
    if (!address) { ui.toastErr('Please enter your address.'); return; }
    if (!selfieDataUrl) { ui.toastErr('Please upload your identity selfie.'); return; }
    db.saveIdentity(enr, { phone, idNumber, address }, selfieDataUrl);
    ui.toastOk('Identity saved.');
    step = 4; showStep();
  });

  /* ---------------- step 5: agreements ---------------- */
  const AGREEMENT_SUMMARIES = {
    tcs: 'The rules of your Reality FX course: how lessons, quizzes and the Academy operate, and what is expected of you as a student.',
    fup: 'One student, one account. How the Academy protects its education through integrity monitoring, and what counts as a violation.',
    privacy: 'What personal data Reality FX collects (your name, contact details and a verification selfie), why, and how it is protected. Reality FX does not collect government ID or passport numbers — ever.',
    refund: 'If your registration cannot be approved, you choose between an instant, fee-free RFX account credit — valid 24 months, usable for any Reality FX course, a seat transfer to one family member, or mentorship sessions — and a cash refund paid via PayPal in a single consolidated monthly batch. For cross-border payments, Reality FX may recommend (or require) the fee-free RFX account credit where a cash refund\'s transfer and FX costs would exceed its value; your credit is always honoured in full, with no deduction. Where the issue is fixable, you may instead correct and re-apply within 7 days. IMPORTANT — an approved refund revokes all rights and ownership of Reality FX course material, immediately terminates RFX OS access, and starts a 30-day period during which the refunding identity may not re-enroll or re-apply. Every refund request is scored against the identity\'s history — prior refunds, timing, payment method and links to other accounts. Flags are reviewed by a moderator; repeated, rapid or abusive refund activity, or refund farming across multiple identities, may result in denial of future enrollment and is grounds for action under the Fair Usage Policy.',
    protection: 'Every Reality FX lesson page is watermarked with your Student ID and Reality FX branding, text cannot be copied, printing is blacked out by default, and attempted screen-capture or screen-recording is detected and logged to the Academy\'s integrity team. Course material is yours to learn from — never to resell, redistribute or share. Print access is a privilege granted only to students who have earned the Academy\'s trust, is recorded against your identity, and can be withdrawn at any time if that trust is broken. These protections exist so the education you paid for keeps its value — for you, and for every student after you.',
    referral: 'Reality FX rewards students who grow the Academy. Share your personal referral code; when a friend enrols with it and becomes a fully locked-in student, you earn a commission in your RFX account — starting at 15% and climbing to 30% as you refer more students. Your commission is only truly earned once the student you brought in survives the refund window, exactly like money subject to change: if they refund or are removed for a serious integrity violation, the commission is forfeited or clawed back. Referrals are tracked against your identity, and any attempt to refer yourself or game the programme is refused and recorded. The house always wins — but so do you, for every student you genuinely bring in.',
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
    const ids = Array.from(document.querySelectorAll('#agreements-list input:checked')).map(i => i.value);
    const all = db.getSettings().agreements.map(a => a.id);
    if (ids.length !== all.length) { ui.toastErr('Please accept all agreements to continue.'); return; }
    const agreed = db.acceptAgreements(enr, ids);
    ui.toastOk('Accepted ' + agreed.length + ' agreements — versions and times recorded.');
    step = 5; showStep();
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
    $('submit-reg').disabled = true;
    db.submitRegistration(enr);
    ui.toastOk('Registration submitted for verification.');
    if (enr.state === 'APPROVED') renderApproved();
    else renderSubmitted();
  });

  /* ---------------- submitted / approved / rejected ---------------- */
  function renderSubmitted() {
    show('screen-submitted');
    const note = $('sub-reapply');
    if ((enr.registration.reapplyCount || 0) > 0) {
      note.hidden = false;
      note.textContent = 'This is re-application attempt ' + enr.registration.reapplyCount + ' — Reality FX will re-review your corrected details.';
    }
    $('check-status').addEventListener('click', boot);
  }
  function renderRejected() {
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
