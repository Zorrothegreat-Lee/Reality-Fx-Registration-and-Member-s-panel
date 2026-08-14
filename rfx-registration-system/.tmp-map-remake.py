# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding='utf-8')

NEW_HTML = '''<div class="campus-wrap">
  <div class="campus">
    <svg class="map" viewBox="0 0 1000 590" role="img" aria-label="Campus map — how students arrive at the RFX OS Academy">
      <defs>
        <pattern id="cmap-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M 26 0 L 0 0 0 26" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
        </pattern>
        <linearGradient id="cmap-acad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(212,175,55,0.16)"/>
          <stop offset="1" stop-color="rgba(212,175,55,0.03)"/>
        </linearGradient>
      </defs>
      <rect class="c-bound" x="18" y="18" width="964" height="554" rx="16"/>
      <rect class="c-grid" x="19" y="19" width="962" height="552" rx="15" fill="url(#cmap-grid)"/>
      <text class="c-tag" x="40" y="52">REALITY FX · CAMPUS GUIDE</text>
      <g class="compass" transform="translate(938,42)" aria-hidden="true">
        <circle class="cmp-ring" cx="0" cy="0" r="10"/>
        <path class="cmp-head" d="M0 -6.5 L5 2.5 L0 0.6 L-5 2.5 Z"/>
        <path class="cmp-stem" d="M0 0.6 L0 8"/>
        <text class="cmp-n" x="0" y="-14">N</text>
      </g>
      <g class="roads">
        <path class="road main" d="M 265 245 H 410"/>
        <path class="road main" d="M 595 245 H 740"/>
        <path class="road" d="M 172.5 462 V 320"/>
        <path class="road" d="M 420 462 V 400 H 502.5 V 320"/>
        <path class="road" d="M 585 462 V 400 H 502.5"/>
        <text class="rd-lbl" x="337" y="270">PURCHASE → INVOICE → REG. LINK</text>
        <text class="rd-lbl gold" x="667" y="270">APPROVED + VERIFIED → HANDOFF</text>
        <circle class="jnt" cx="265" cy="245" r="4"/>
        <circle class="jnt" cx="410" cy="245" r="4"/>
        <circle class="jnt" cx="595" cy="245" r="4"/>
        <circle class="jnt" cx="740" cy="245" r="4"/>
        <circle class="jnt" cx="172.5" cy="320" r="4"/>
        <circle class="jnt" cx="502.5" cy="320" r="4"/>
      </g>
      <g class="origin">
        <circle class="stn-halo" cx="172.5" cy="462" r="10"/>
        <circle class="stn" cx="172.5" cy="462" r="6"/>
        <text class="o-lbl" x="172.5" y="492">Wandering visitor</text>
        <text class="o-way" x="172.5" y="509">the long way →</text>
      </g>
      <g class="origin">
        <circle class="stn-halo" cx="420" cy="462" r="10"/>
        <circle class="stn" cx="420" cy="462" r="6"/>
        <text class="o-lbl" x="420" y="492">Hand-picked by staff</text>
        <text class="o-way" x="420" y="509">skips the front desk →</text>
      </g>
      <g class="origin">
        <circle class="stn-halo" cx="585" cy="462" r="10"/>
        <circle class="stn" cx="585" cy="462" r="6"/>
        <text class="o-lbl" x="585" y="492">Referred by a friend</text>
        <text class="o-way" x="585" y="509">skips the front desk →</text>
      </g>
      <g class="bldg">
        <rect class="b-bg" x="80" y="170" width="185" height="150" rx="12"/>
        <g class="b-ic" transform="translate(152.5,182)">
          <rect class="b-ic-bg" width="40" height="40" rx="10"/>
          <g transform="translate(8,8)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><path d="M6 14h4"/>
          </g>
        </g>
        <text class="b-tag" x="172.5" y="240">Building 1 · the website</text>
        <text class="b-name" x="172.5" y="258">Front Desk</text>
        <text class="b-note" x="172.5" y="277">Where a course is bought</text>
        <text class="b-route" x="172.5" y="299">ENTRY · PAYMENT</text>
      </g>
      <g class="bldg gate">
        <rect class="b-bg" x="410" y="170" width="185" height="150" rx="12"/>
        <g class="b-ic" transform="translate(482.5,182)">
          <rect class="b-ic-bg" width="40" height="40" rx="10"/>
          <g transform="translate(8,8)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>
          </g>
        </g>
        <text class="b-tag" x="502.5" y="240">The gate · every route passes here</text>
        <text class="b-name" x="502.5" y="258">Registration &amp; Verification</text>
        <text class="b-note" x="502.5" y="276">Identity · selfie · agreements · approval</text>
        <text class="b-note" x="502.5" y="290">your Student ID is issued here</text>
        <text class="b-route" x="502.5" y="304">ENTRY · REGISTRATION LINK</text>
      </g>
      <g class="bldg academy">
        <rect class="b-bg" x="740" y="170" width="185" height="150" rx="12"/>
        <g class="b-ic" transform="translate(812.5,182)">
          <rect class="b-ic-bg" width="40" height="40" rx="10"/>
          <g transform="translate(8,8)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12.5v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/><line x1="22" y1="10" x2="22" y2="15.5"/>
          </g>
        </g>
        <text class="b-tag" x="832.5" y="240">The destination</text>
        <text class="b-name" x="832.5" y="258">RFX OS Academy</text>
        <text class="b-note" x="832.5" y="276">The learning environment — only</text>
        <text class="b-note" x="832.5" y="290">after the handoff completes</text>
        <text class="b-route" x="832.5" y="304">ENTRY · APPROVED IDENTITY</text>
      </g>
    </svg>
  </div>
</div>'''

NEW_CSS = '''/* ---------------- the campus map ---------------- */
.campus-wrap { overflow-x: auto; border-radius: 12px; }
.campus { width: 100%; min-width: 720px; }
.campus svg.map { display: block; width: 100%; height: auto; }
.campus .c-bound { fill: rgba(255,255,255,0.012); stroke: rgba(212,175,55,0.30); stroke-width: 1.4; stroke-dasharray: 6 8; }
.campus .c-tag { font-size: 9px; letter-spacing: .24em; fill: rgba(212,175,55,0.9); font-family: SERIFVAR; }
.campus .compass .cmp-ring { fill: rgba(212,175,55,0.05); stroke: rgba(212,175,55,0.35); stroke-width: 1.2; }
.campus .compass .cmp-head { fill: var(--gold-bright); }
.campus .compass .cmp-stem { stroke: rgba(255,255,255,0.3); stroke-width: 1.5; stroke-linecap: round; }
.campus .compass .cmp-n { font-size: 7px; fill: var(--faint); letter-spacing: .1em; font-family: 'Inter', sans-serif; }
.campus .road { fill: none; stroke: rgba(212,175,55,0.30); stroke-width: 2.4; stroke-dasharray: 6 7; stroke-linecap: round; }
.campus .road.main { stroke: rgba(212,175,55,0.62); stroke-width: 3; }
.campus .rd-lbl { font-size: 8.5px; letter-spacing: .09em; fill: var(--faint); font-family: 'Inter', sans-serif; }
.campus .rd-lbl.gold { fill: var(--gold); }
.campus .jnt { fill: var(--gold-bright); opacity: .9; }
.campus .stn-halo { fill: none; stroke: rgba(212,175,55,0.4); stroke-width: 1.4; }
.campus .stn { fill: #0b0b0a; stroke: var(--gold-bright); stroke-width: 2.2; }
.campus .o-lbl { font-size: 9px; letter-spacing: .13em; fill: var(--muted); font-family: 'Inter', sans-serif; }
.campus .o-way { font-size: 8px; letter-spacing: .07em; fill: var(--gold); font-family: 'Inter', sans-serif; }
.campus .origin { transition: transform .25s cubic-bezier(.22,1,.36,1); }
.campus .origin:hover { transform: translateY(-3px); }
.campus .bldg { transition: transform .25s cubic-bezier(.22,1,.36,1); cursor: default; }
.campus .bldg:hover { transform: translateY(-3px); }
.campus .b-bg { fill: #0d0d0c; stroke: var(--border); stroke-width: 1.2; }
.campus .bldg:hover .b-bg { stroke: rgba(212,175,55,0.5); }
.campus .bldg.academy .b-bg { fill: url(#cmap-acad); stroke: rgba(212,175,55,0.5); }
.campus .b-ic { color: var(--gold-bright); }
.campus .b-ic-bg { fill: rgba(212,175,55,0.10); stroke: rgba(212,175,55,0.25); }
.campus .bldg.academy .b-ic-bg { fill: rgba(212,175,55,0.2); stroke: rgba(212,175,55,0.45); }
.campus .b-tag { font-size: 7.5px; letter-spacing: .18em; fill: var(--faint); font-family: 'Inter', sans-serif; }
.campus .b-name { font-size: 13.5px; fill: var(--text); font-family: SERIFVAR; }
.campus .b-note { font-size: 8.5px; fill: var(--muted); font-family: 'Inter', sans-serif; }
.campus .b-route { font-size: 8px; letter-spacing: .13em; fill: var(--gold); font-family: 'Inter', sans-serif; }
.campus svg .b-tag, .campus svg .b-name, .campus svg .b-note, .campus svg .b-route,
.campus svg .rd-lbl, .campus svg .o-lbl, .campus svg .o-way, .campus svg .cmp-n { text-anchor: middle; }
.map-legend { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
.map-legend span { font-size: 10.5px; color: var(--faint); display: inline-flex; align-items: center; gap: 7px; }
.map-legend .sw { width: 26px; height: 2.5px; border-radius: 2px; display: inline-block; }
.map-legend .sw.main { background: rgba(212,175,55,0.6); }
.map-legend .sw.side { background: rgba(212,175,55,0.3); }
.map-legend .sw.dot { width: 11px; height: 11px; border-radius: 50%; background: #0b0b0a; border: 2px solid var(--gold-bright); }'''

LEG_OLD = '<span><i class="sw dash"></i>Every route ends at the Gate</span>'
LEG_NEW = '<span><i class="sw dot"></i>Station — where a route begins</span>'

SERIF = {'index.html': 'var(--font-serif)', 'operating-guide.html': 'var(--serif)'}

def replace_html(path):
    s = open(path, encoding='utf-8').read()
    start = s.index('<div class="campus-wrap">')
    end = s.index('<div class="map-legend">')
    s = s[:start] + NEW_HTML + '\n    ' + s[end:]
    assert LEG_OLD in s, 'legend not found in ' + path
    s = s.replace(LEG_OLD, LEG_NEW)
    open(path, 'w', encoding='utf-8').write(s)
    print('HTML ok:', path)

def replace_css(path):
    s = open(path, encoding='utf-8').read()
    css = NEW_CSS.replace('SERIFVAR', SERIF[path])
    start = s.index('/* ---------------- the campus map ---------------- */')
    if path == 'css/system.css':
        end = s.index('.tl-step.fail .tl-node', start)
    else:
        end = s.index('/* ---------- staff role ---------- */', start)
    s = s[:start] + css + '\n\n' + s[end:]
    open(path, 'w', encoding='utf-8').write(s)
    print('CSS ok:', path)

replace_html('index.html')
replace_html('operating-guide.html')
replace_css('css/system.css')
replace_css('operating-guide.html')
print('ALL DONE')
