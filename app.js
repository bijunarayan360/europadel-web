/* Europadel site script — navigation, demo member account, booking and checkout.
   PREVIEW: sign-in, bookings and payments are simulated in the visitor's browser. */
(function(){
'use strict';
var P = {"players": 4, "walkin": {"padel": {"120": {"peak": 580, "off": 450}, "90": {"peak": 440, "off": 340}, "60": {"peak": 320, "off": 240}, "courts": 4}, "pickleball": {"120": {"peak": 370, "off": 290}, "90": {"peak": 280, "off": 220}, "60": {"peak": 200, "off": 160}, "courts": 5}}, "membership": {"standard": {"name": "Standard", "monthly": 450, "annual": 4500, "free": "offpeak"}, "platinum": {"name": "Platinum", "monthly": 790, "annual": 7900, "free": "any"}, "business": {"name": "Business Club", "monthly": 1490, "annual": 14900, "free": "any"}}, "coaching": {"private": {"name": "Private", "who": "1 player", "single": 400, "p5": 1900, "p10": 3600}, "duo": {"name": "Duo", "who": "2 players", "single": 480, "p5": 2280, "p10": 4320}, "group": {"name": "Group", "who": "3 players", "single": 520, "p5": 2470, "p10": 4680}, "performance": {"name": "Performance Pack", "who": "1 player \u00b7 match play and tactics", "single": 500, "p5": 2375, "p10": 4500, "online": false}}, "playWithCoach": 150, "extras": {"padel": [{"id": "racket", "name": "Padel racket hire", "unit": "Per racket, per session", "short": "racket", "price": 25, "max": 4}, {"id": "pballs", "name": "Padel balls", "unit": "Can of 3 new balls", "short": "can of padel balls", "price": 38, "max": 6}], "pickleball": [{"id": "paddle", "name": "Pickleball paddle hire", "unit": "Per paddle, per session", "short": "paddle", "price": 20, "max": 4}, {"id": "kballs", "name": "Pickleball balls", "unit": "Pack of 3 balls", "short": "pack of pickleballs", "price": 30, "max": 6}]}};
window.EP_PRICES = P;

/* ---------- live mode: set EP_CONFIG.api in config.js to the Google Apps Script web app URL ---------- */
var CFG = window.EP_CONFIG || {}, LIVE = !!CFG.api;
function qs(o){ return Object.keys(o).map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
function apiGet(o){ return fetch(CFG.api + (CFG.api.indexOf('?') > -1 ? '&' : '?') + qs(o)).then(function(r){ return r.json(); }); }
function apiPost(o){ return fetch(CFG.api, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(o)}).then(function(r){ return r.json(); }); }
var BUSY = {};
function loadBusy(sport, date){
  var k = sport + '|' + date;
  if(BUSY[k]) return Promise.resolve(BUSY[k]);
  return apiGet({action:'slots', date:date, sport:sport}).then(function(r){ if(!r.ok) throw new Error(r.error || 'error'); BUSY[k] = r.busy; return r.busy; });
}
var NET_ERR = "We couldn't reach the booking system. Check your connection and try again, or book on WhatsApp +971 52 539 2908.";

/* ---------- storage (per-browser, safe if blocked) ---------- */
var mem = {};
function get(k, d){ try{ var v = localStorage.getItem('ep_'+k); return v ? JSON.parse(v) : (k in mem ? mem[k] : d); }catch(e){ return k in mem ? mem[k] : d; } }
function set(k, v){ mem[k] = v; try{ if(v === null) localStorage.removeItem('ep_'+k); else localStorage.setItem('ep_'+k, JSON.stringify(v)); }catch(e){} }
var user = get('user', null);
function bookings(){ return get('bookings', []); }

/* ---------- helpers ---------- */
function $(s, r){ return (r||document).querySelector(s); }
function $$(s, r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
function fmt(n){ return 'AED ' + Number(n).toLocaleString('en-GB'); }
function pad(n){ return (n<10?'0':'') + n; }
function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function parseYmd(s){ var a = s.split('-'); return new Date(+a[0], +a[1]-1, +a[2]); }
function hm(min){ return pad(Math.floor(min/60)) + ':' + pad(min%60); }
function toMin(t){ var a = t.split(':'); return (+a[0])*60 + (+a[1]); }
function niceTime(min){ var h = Math.floor(min/60) % 24, m = min%60, ap = h<12 ? 'AM' : 'PM', hh = h%12 || 12; return hh + (m ? ':'+pad(m) : '') + ' ' + ap; }
function niceDate(s, opts){ return parseYmd(s).toLocaleDateString('en-GB', opts || {weekday:'long', day:'numeric', month:'long'}); }
function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function toast(msg){ var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); t.textContent = msg; document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2600); }
function sportName(s){ return s === 'pickleball' ? 'Pickleball' : 'Padel'; }
function actLabel(b){ return b.act === 'coaching' ? sportName(b.sport) + ' coaching · ' + P.coaching[b.fmt].name : sportName(b.act) + ' court'; }

/* Peak: Mon–Thu from 5 PM, Fri from 3 PM, Sat & Sun all day */
function isPeak(dateStr, startMin){
  var d = parseYmd(dateStr).getDay();
  if(d === 0 || d === 6) return true;
  if(d === 5) return startMin >= 15*60;
  return startMin >= 17*60;
}
function memberFreeReason(dateStr, startMin, dur, act){
  if(!user || !user.membership || act === 'coaching' || dur > 90) return '';
  var t = P.membership[user.membership.tier]; if(!t) return '';
  var already = bookings().some(function(b){ return b.date === dateStr && b.pay === 'free' && b.status === 'confirmed'; });
  if(already) return '';
  if(t.free === 'any') return 'Included with your ' + t.name + ' membership';
  var wd = parseYmd(dateStr).getDay();
  if(wd >= 1 && wd <= 5 && startMin + dur <= 17*60) return 'Included with your ' + t.name + ' membership';
  return '';
}
function priceOf(b){
  if(b.act === 'coaching') return P.coaching[b.fmt].single;
  var r = P.walkin[b.act][String(b.dur)];
  return isPeak(b.date, toMin(b.time)) ? r.peak : r.off;
}

/* deterministic "already booked" pattern so the grid looks lived-in */
function hash(s){ var h = 2166136261; for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h>>>0) % 100; }
function courtCount(act, sport){ return P.walkin[act === 'coaching' ? sport : act].courts; }
function courtFree(courtSport, dateStr, startMin, dur, court){
  if(LIVE){
    var L = BUSY[courtSport + '|' + dateStr]; if(!L) return false;
    return !L.some(function(b){ return +b.court === court && startMin < b.end && b.start < startMin + dur; });
  }
  var mine = bookings().some(function(b){
    var bs = b.act === 'coaching' ? b.sport : b.act;
    if(b.status !== 'confirmed' || bs !== courtSport || b.date !== dateStr || +b.court !== court) return false;
    var s = toMin(b.time), e = s + (+b.dur); return startMin < e && s < startMin + dur;
  });
  if(mine) return false;
  var busy = isPeak(dateStr, startMin) ? 58 : 30;
  for(var t = startMin; t < startMin + dur; t += 30){ if(hash(courtSport + dateStr + t + 'c' + court) < busy) return false; }
  return true;
}

/* equipment hire */
function extrasList(b){
  var out = [], q = b.extras || {};
  (P.extras[b.sport] || []).forEach(function(x){ var n = +q[x.id] || 0; if(n > 0) out.push({id:x.id, name:x.name, short:x.short, qty:n, price:x.price, total:n * x.price}); });
  return out;
}
function extrasTotal(b){ return extrasList(b).reduce(function(s, x){ return s + x.total; }, 0); }
function extrasText(b){ return extrasList(b).map(function(x){ return x.qty + ' × ' + x.short; }).join(', '); }

/* booking <-> hash token (letters, digits, dashes only) */
function encodeBooking(b){
  var t = 'b-' + b.act + '-' + b.date.replace(/-/g,'') + '-' + b.time.replace(':','') + '-' + b.dur + '-' + b.court;
  if(b.act === 'coaching') t += '-' + b.sport + '-' + b.fmt;
  var ex = extrasList(b);
  if(ex.length) t += '-x' + ex.map(function(x){ return x.id + x.qty; }).join('_');
  return t;
}
function decode(token){
  var a = (token||'').split('-'), extras = {};
  if(a.length > 1 && /^x/.test(a[a.length-1])){
    a.pop().slice(1).split('_').forEach(function(p){ var m = /^([a-z]+)(\d+)$/.exec(p); if(m) extras[m[1]] = Math.min(9, +m[2]); });
  }
  if(a[0] === 'm' && P.membership[a[1]] && (a[2] === 'monthly' || a[2] === 'annual')) return {kind:'membership', tier:a[1], billing:a[2]};
  if(a[0] === 'b' && a.length >= 6){
    var b = {kind:'booking', act:a[1], date:a[2].slice(0,4)+'-'+a[2].slice(4,6)+'-'+a[2].slice(6,8), time:a[3].slice(0,2)+':'+a[3].slice(2,4), dur:+a[4], court:+a[5]};
    if(b.act === 'coaching'){ b.sport = a[6] || 'padel'; b.fmt = a[7] || 'private'; if(!P.coaching[b.fmt] || P.coaching[b.fmt].online === false) return null; }
    else if(!P.walkin[b.act]) return null;
    b.sport = b.sport || b.act; b.extras = extras;
    return b;
  }
  return null;
}

/* ---------- navigation ---------- */
(function(){
  var nav = $('#nav'), btn = $('#menuBtn'), menu = $('#menu'); if(!nav) return;
  function close(){ nav.classList.remove('open'); btn.setAttribute('aria-expanded','false'); btn.setAttribute('aria-label','Open menu'); }
  btn.addEventListener('click', function(){
    var open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  });
  $$('.dd-btn', nav).forEach(function(b){
    b.addEventListener('click', function(){ var li = b.parentNode, o = li.classList.toggle('sub-open'); b.setAttribute('aria-expanded', o ? 'true' : 'false'); });
  });
  menu.addEventListener('click', function(e){ if(e.target.closest('a')) close(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && nav.classList.contains('open')){ close(); btn.focus(); } });
  document.addEventListener('click', function(e){ if(nav.classList.contains('open') && !e.target.closest('#menu') && !e.target.closest('#menuBtn')) close(); });
  if(user){
    $$('[data-auth-link]').forEach(function(a){
      a.href = 'account.html';
      var s = a.querySelector('span'); (s || a).textContent = 'My Account';
    });
  }
})();

/* ---------- membership billing toggles (pricing + membership pages) ---------- */
$$('[data-billing]').forEach(function(seg){
  var scope = seg.closest('section') || document;
  seg.addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    var bill = b.getAttribute('data-bill');
    $$('button', seg).forEach(function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    $$('[data-price-m]', scope).forEach(function(el){ el.textContent = Number(el.getAttribute(bill === 'annual' ? 'data-price-y' : 'data-price-m')).toLocaleString('en-GB'); });
    $$('[data-per]', scope).forEach(function(el){ el.textContent = bill === 'annual' ? 'per year' : 'per month'; });
    $$('[data-note-y]', scope).forEach(function(el){ el.textContent = el.getAttribute(bill === 'annual' ? 'data-note-y' : 'data-note-m'); });
    $$('[data-join]', scope).forEach(function(a){ a.href = 'checkout.html#m-' + a.getAttribute('data-join') + '-' + bill; });
  });
});

/* ---------- generic tabs ---------- */
function initTabs(list, onChange){
  var tabs = $$('[role="tab"]', list);
  function show(id, focus){
    tabs.forEach(function(t){
      var on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      var p = document.getElementById(t.getAttribute('aria-controls')); if(p) p.hidden = !on;
      if(on && focus) t.focus();
    });
    if(onChange) onChange(id);
  }
  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ show(t.getAttribute('aria-controls')); });
    t.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if(!d) return;
      show(tabs[(i + d + tabs.length) % tabs.length].getAttribute('aria-controls'), true);
    });
  });
  return show;
}

var page = ($('.page') || document.body).getAttribute('data-page');
document.documentElement.classList.toggle('live', LIVE);
if(LIVE) $$('.demo-bar').forEach(function(el){ el.hidden = true; });
document.addEventListener('input', function(e){ var f = e.target.closest && e.target.closest('.field.bad'); if(f){ f.classList.remove('bad'); var er = f.querySelector('.err'); if(er) er.textContent = ''; } });
if(page === 'book' || page === 'checkout') window.addEventListener('hashchange', function(){ location.reload(); });

/* ---------- PRICING ---------- */
if(page === 'pricing'){
  var show = initTabs($('[role="tablist"]'), function(id){ try{ history.replaceState(null, '', '#' + id); }catch(e){} });
  var h = location.hash.replace('#','');
  if(['walkin','membership','coaching'].indexOf(h) > -1) show(h);
  window.addEventListener('hashchange', function(){ var x = location.hash.replace('#',''); if(['walkin','membership','coaching'].indexOf(x) > -1){ show(x); $('.tabbar').scrollIntoView({behavior:'smooth'}); } });
  var seg = $('[data-sport-seg]');
  seg.addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return; var s = b.getAttribute('data-sport');
    $$('button', seg).forEach(function(x){ x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
    $$('[data-sport-table]').forEach(function(t){ t.hidden = t.getAttribute('data-sport-table') !== s; });
    $('[data-walkin-book]').href = 'book.html#' + s;
  });
}

/* ---------- REGISTER INTEREST (membership page) ---------- */
if($('#interestForm')){
  $('#interestForm').addEventListener('submit', function(e){
    e.preventDefault();
    function er(input, msg){ var f = input.closest('.field'); f.classList.toggle('bad', !!msg); f.querySelector('.err').textContent = msg || ''; return !msg; }
    var f = $('#ri-first'), l = $('#ri-last'), em = $('#ri-email'), ph = $('#ri-phone');
    var ok = er(f, f.value.trim() ? '' : 'Enter your first name.');
    ok = er(l, l.value.trim() ? '' : 'Enter your last name.') && ok;
    ok = er(em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim()) ? '' : 'Enter an email like name@example.com.') && ok;
    ok = er(ph, ph.value.replace(/\D/g,'').length >= 9 ? '' : 'Enter a WhatsApp number, like +971 50 123 4567.') && ok;
    var ints = $$('input[name="ri-int"]:checked').map(function(x){ return x.value; });
    $('#ri-int-err').textContent = ints.length ? '' : 'Choose at least one option.'; ok = ok && ints.length > 0;
    if(!ok) return;
    var rec = {first:f.value.trim(), last:l.value.trim(), email:em.value.trim(), phone:ph.value.trim(), interests:ints, sport:$('#ri-sport').value, level:$('#ri-level').value, msg:$('#ri-msg').value.trim()};
    if(LIVE){
      var btn = $('#interestForm button[type="submit"]'); btn.disabled = true; btn.textContent = 'Sending…';
      apiPost({action:'interest', customer:rec, interests:ints, sport:rec.sport, level:rec.level, msg:rec.msg}).then(function(r){
        if(r.ok) thanks(); else { btn.disabled = false; btn.textContent = 'Register My Interest'; $('#ri-int-err').textContent = r.error || NET_ERR; }
      }, function(){ btn.disabled = false; btn.textContent = 'Register My Interest'; $('#ri-int-err').textContent = NET_ERR; });
      return;
    }
    var list = get('interest', []); rec.at = Date.now(); list.push(rec); set('interest', list);
    thanks();
    function thanks(){ $('#interestBox').innerHTML = '<div class="done" style="gap:16px;padding:20px 0"><div class="tick"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h3 style="font-size:40px">Thank you, <em>' + esc(f.value.trim()) + '.</em></h3><p class="lead" style="text-align:center">You\'re on the list for ' + esc(ints.join(', ').toLowerCase()) + '. We\'ll be in touch on WhatsApp or email.</p></div>'; }
  });
}

/* ---------- LOGIN ---------- */
if(page === 'login'){
  var showAuth = initTabs($('[role="tablist"]'), function(id){
    $('#authTitle').innerHTML = id === 'create' ? 'Join <em>the club.</em>' : 'Welcome <em>back.</em>';
    $('#authLead').textContent = id === 'create' ? 'Create your account to book courts, join a membership and keep your bookings in one place.' : 'Sign in to book courts, manage your membership and see your bookings.';
  });
  if(location.hash === '#create') showAuth('create');
  window.addEventListener('hashchange', function(){ showAuth(location.hash === '#create' ? 'create' : 'signin'); });
  var rt = get('returnTo', null), gl = $('#guestLink');
  if(rt && rt.indexOf('checkout.html#b-') === 0){ gl.href = rt; gl.firstChild.textContent = 'Continue as a guest '; }
  gl.addEventListener('click', function(){ set('returnTo', null); });
  $$('[data-goto]').forEach(function(b){ b.addEventListener('click', function(){ showAuth(b.getAttribute('data-goto')); }); });

  function fieldErr(input, msg){ var f = input.closest('.field'); f.classList.toggle('bad', !!msg); f.querySelector('.err').textContent = msg || ''; return !msg; }
  function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function finish(u){
    var prev = get('accounts', {}), existing = prev[u.email.toLowerCase()];
    if(existing){ u.membership = existing.membership || null; if(!u.first) { u.first = existing.first; u.last = existing.last; u.phone = existing.phone; } }
    prev[u.email.toLowerCase()] = u; set('accounts', prev); set('user', u);
    var back = get('returnTo', null); set('returnTo', null);
    location.href = back || 'account.html';
  }
  $('#signin').addEventListener('submit', function(e){
    e.preventDefault();
    var em = $('#si-email'), pw = $('#si-pass');
    var ok = fieldErr(em, validEmail(em.value.trim()) ? '' : 'Enter the email you signed up with, like name@example.com.');
    ok = fieldErr(pw, pw.value.length >= 8 ? '' : 'Your password has at least 8 characters.') && ok;
    if(!ok) return;
    var acc = get('accounts', {})[em.value.trim().toLowerCase()];
    var nm = em.value.trim().split('@')[0].split(/[._-]/)[0];
    finish(acc ? Object.assign({}, acc) : {first: nm.charAt(0).toUpperCase() + nm.slice(1), last:'', email: em.value.trim(), phone:'', provider:'email', membership:null});
  });
  $('#create').addEventListener('submit', function(e){
    e.preventDefault();
    var f = $('#cr-first'), l = $('#cr-last'), em = $('#cr-email'), ph = $('#cr-phone'), pw = $('#cr-pass');
    var ok = fieldErr(f, f.value.trim() ? '' : 'Enter your first name.');
    ok = fieldErr(l, l.value.trim() ? '' : 'Enter your last name.') && ok;
    ok = fieldErr(em, validEmail(em.value.trim()) ? '' : 'Enter an email like name@example.com.') && ok;
    ok = fieldErr(ph, ph.value.replace(/\D/g,'').length >= 9 ? '' : 'Enter a WhatsApp number, like +971 50 123 4567.') && ok;
    ok = fieldErr(pw, pw.value.length >= 8 ? '' : 'Use at least 8 characters.') && ok;
    if(!ok) return;
    finish({first:f.value.trim(), last:l.value.trim(), email:em.value.trim(), phone:ph.value.trim(), sport:$('#cr-sport').value, provider:'email', membership:null});
  });
  var gm = $('#gModal');
  $('#googleBtn').addEventListener('click', function(){ gm.hidden = false; $('#g-name').focus(); });
  $('[data-close]', gm).addEventListener('click', function(){ gm.hidden = true; });
  gm.addEventListener('click', function(e){ if(e.target === gm) gm.hidden = true; });
  $('#gForm').addEventListener('submit', function(e){
    e.preventDefault();
    var n = $('#g-name'), em = $('#g-email');
    var ok = fieldErr(n, n.value.trim() ? '' : 'Enter a name.');
    ok = fieldErr(em, validEmail(em.value.trim()) ? '' : 'Enter an email like name@gmail.com.') && ok;
    if(!ok) return;
    var parts = n.value.trim().split(/\s+/);
    finish({first:parts[0], last:parts.slice(1).join(' '), email:em.value.trim(), phone:'', provider:'google', membership:null});
  });
}

/* ---------- BOOK ---------- */
if(page === 'book'){
  var st = {act:'padel', sport:'padel', fmt:'private', date:null, dur:90, time:null, court:null, extras:{}};
  var hs = location.hash.replace('#','');
  if(hs === 'pickleball' || hs === 'coaching' || hs === 'padel') st.act = hs;
  var pend = decode(hs); if(pend && pend.kind === 'booking'){ Object.assign(st, pend); if(pend.act !== 'coaching') st.sport = pend.act; }

  var days = [], now = new Date();
  for(var i=0;i<14;i++){ var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()+i); days.push(ymd(d)); }
  function slotsFor(date){
    var out = [], dur = st.act === 'coaching' ? 60 : st.dur, cs = st.act === 'coaching' ? st.sport : st.act, n = courtCount(st.act, st.sport);
    var nowMin = now.getHours()*60 + now.getMinutes();
    for(var t = 6*60; t + dur <= 24*60; t += 30){
      var past = date === ymd(now) && t <= nowMin + 30, free = 0;
      if(!past) for(var c=1;c<=n;c++) if(courtFree(cs, date, t, dur, c)) free++;
      out.push({t:t, past:past, free:free});
    }
    return out;
  }
  if(!st.date || days.indexOf(st.date) < 0){
    st.date = days[0];
    if(!slotsFor(days[0]).some(function(s){ return !s.past && (LIVE || s.free); })) st.date = days[1];
  }

  var fmtSeg = $('#coachFmt');
  fmtSeg.innerHTML = Object.keys(P.coaching).filter(function(k){ return P.coaching[k].online !== false; }).map(function(k){ return '<button type="button" aria-pressed="' + (k===st.fmt) + '" data-v="' + k + '">' + P.coaching[k].name + '</button>'; }).join('');

  function pressSeg(seg, v){ $$('button', seg).forEach(function(x){ x.setAttribute('aria-pressed', x.getAttribute('data-v') === String(v) ? 'true' : 'false'); }); }
  function renderDates(){
    $('#dates').innerHTML = days.map(function(s, i){
      var d = parseYmd(s);
      return '<button type="button" class="date" data-d="' + s + '" aria-pressed="' + (s===st.date) + '" aria-label="' + niceDate(s) + '"><small>' + (i===0 ? 'Today' : d.toLocaleDateString('en-GB',{weekday:'short'})) + '</small><b>' + d.getDate() + '</b><small>' + d.toLocaleDateString('en-GB',{month:'short'}) + '</small></button>';
    }).join('');
  }
  function renderSlots(){
    var liveKey = (st.act === 'coaching' ? st.sport : st.act) + '|' + st.date;
    if(LIVE && !BUSY[liveKey]){
      $('#slots').innerHTML = '<p class="empty" style="grid-column:1/-1">Checking live availability…</p>';
      var want = liveKey;
      loadBusy(liveKey.split('|')[0], st.date).then(function(){ if(want === (st.act === 'coaching' ? st.sport : st.act) + '|' + st.date){ renderSlots(); renderCourts(); renderSummary(); } },
        function(){ $('#slots').innerHTML = '<p class="empty" style="grid-column:1/-1">' + NET_ERR + '</p>'; });
      return;
    }
    var list = slotsFor(st.date), dur = st.act === 'coaching' ? 60 : st.dur;
    if(st.time && !list.some(function(s){ return hm(s.t) === st.time && !s.past && s.free; })){ st.time = null; st.court = null; }
    var open = list.filter(function(s){ return !s.past; });
    if(!open.length){ $('#slots').innerHTML = '<p class="empty" style="grid-column:1/-1">No more times today. Choose another day.</p>'; return; }
    $('#slots').innerHTML = open.map(function(s){
      var t = hm(s.t), pk = isPeak(st.date, s.t), price = st.act === 'coaching' ? P.coaching[st.fmt].single : P.walkin[st.act][String(dur)][pk ? 'peak' : 'off'];
      return '<button type="button" class="slot' + (pk ? ' peak' : '') + '" data-t="' + t + '" aria-pressed="' + (t===st.time) + '"' + (s.free ? '' : ' disabled') + ' aria-label="' + niceTime(s.t) + (s.free ? ', ' + s.free + ' courts free, ' + fmt(price) : ', fully booked') + '"><b>' + t + '</b><small>' + (s.free ? fmt(price).replace('AED ','AED ') : 'Full') + '</small></button>';
    }).join('');
  }
  function renderCourts(){
    var box = $('#courts');
    $('#courtTitle').textContent = st.act === 'coaching' ? 'Court for your session' : 'Choose a court';
    if(!st.time){ box.innerHTML = '<p class="empty" style="width:100%">Choose a time to see which courts are free.</p>'; return; }
    var n = courtCount(st.act, st.sport), cs = st.act === 'coaching' ? st.sport : st.act, dur = st.act === 'coaching' ? 60 : st.dur, h = '';
    var firstFree = null;
    for(var c=1;c<=n;c++){ var ok = courtFree(cs, st.date, toMin(st.time), dur, c); if(ok && firstFree === null) firstFree = c; h += '<button type="button" class="court" data-c="' + c + '"' + (ok ? '' : ' disabled') + ' aria-pressed="false">Court ' + c + '</button>'; }
    if(!st.court || !courtFree(cs, st.date, toMin(st.time), dur, st.court)) st.court = firstFree;
    box.innerHTML = h;
    $$('.court', box).forEach(function(b){ b.setAttribute('aria-pressed', +b.getAttribute('data-c') === st.court ? 'true' : 'false'); });
  }
  function current(){ return {act:st.act, sport:st.act === 'coaching' ? st.sport : st.act, fmt:st.fmt, date:st.date, time:st.time, dur:st.act === 'coaching' ? 60 : st.dur, court:st.court, extras:st.extras}; }
  function renderExtras(){
    var sp = st.act === 'coaching' ? st.sport : st.act;
    $('#extras').innerHTML = P.extras[sp].map(function(x){
      var q = +st.extras[x.id] || 0;
      return '<div class="extra"><div><b>' + x.name + '</b><small>' + x.unit + ' · ' + fmt(x.price) + '</small></div>' +
        '<div class="stepper" role="group" aria-label="' + x.name + ' quantity"><button type="button" data-x="' + x.id + '" data-d="-1" aria-label="Remove one"' + (q ? '' : ' disabled') + '>−</button><output aria-live="polite">' + q + '</output><button type="button" data-x="' + x.id + '" data-d="1" aria-label="Add one"' + (q >= x.max ? ' disabled' : '') + '>+</button></div>' +
        '<span class="line">' + (q ? fmt(q * x.price) : '') + '</span></div>';
    }).join('');
  }
  function renderSummary(){
    var b = current(), rows = [['Activity', actLabel(b)], ['Date', niceDate(b.date, {weekday:'short', day:'numeric', month:'short'})]];
    rows.push(['Time', b.time ? niceTime(toMin(b.time)) + ' – ' + niceTime(toMin(b.time) + b.dur) : 'Choose a time']);
    rows.push(['Duration', b.dur + ' minutes']);
    rows.push(['Court', b.court ? 'Court ' + b.court : '–']);
    if(b.time && b.act !== 'coaching') rows.push(['Rate', isPeak(b.date, toMin(b.time)) ? 'Peak' : 'Off-peak']);
    extrasList(b).forEach(function(x){ rows.push([x.qty + ' × ' + x.name.replace(' hire',''), fmt(x.total)]); });
    $('#sumList').innerHTML = rows.map(function(r){ return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
    var ready = !!(b.time && b.court), perk = ready ? memberFreeReason(b.date, toMin(b.time), b.dur, b.act) : '';
    var price = ready ? priceOf(b) : 0;
    $('#sumPerk').innerHTML = perk ? '<p class="perk">' + perk + '</p>' : '';
    var grand = (perk ? 0 : price) + extrasTotal(b);
    $('#sumTotal').textContent = ready ? (grand ? fmt(grand) : 'Free') : '–';
    $('#sumPP').textContent = ready && !perk && b.act !== 'coaching' ? 'Court ' + fmt(Math.round(price / P.players)) + ' per player, split four ways' : '';
    $('#toPay').disabled = !ready;
    $('#toPay').textContent = perk && !extrasTotal(b) ? 'Continue to Confirm' : 'Continue to Payment';
    $('#sumFine').textContent = user ? 'Pay online with Apple Pay or card, or pay at the club by cash or card.' : 'No account needed. Book as a guest, or sign in at checkout.';
  }
  function renderAct(){
    $$('.choice').forEach(function(c){ c.setAttribute('aria-pressed', c.getAttribute('data-act') === st.act ? 'true' : 'false'); });
    $('#coachOpts').hidden = st.act !== 'coaching';
    $('#durWrap').hidden = st.act === 'coaching';
    pressSeg($('#coachSport'), st.sport); pressSeg(fmtSeg, st.fmt); pressSeg($('#dur'), st.dur);
  }
  function all(){ renderAct(); renderDates(); renderSlots(); renderCourts(); renderExtras(); renderSummary(); }
  all();
  var sel = $('#dates [aria-pressed="true"]'); if(sel) sel.scrollIntoView({block:'nearest', inline:'nearest'});

  $$('.choice').forEach(function(c){ c.addEventListener('click', function(){ st.act = c.getAttribute('data-act'); if(st.act !== 'coaching') st.sport = st.act; all(); }); });
  $('#coachSport').addEventListener('click', function(e){ var b = e.target.closest('button'); if(!b) return; st.sport = b.getAttribute('data-v'); all(); });
  fmtSeg.addEventListener('click', function(e){ var b = e.target.closest('button'); if(!b) return; st.fmt = b.getAttribute('data-v'); all(); });
  $('#dur').addEventListener('click', function(e){ var b = e.target.closest('button'); if(!b) return; st.dur = +b.getAttribute('data-v'); all(); });
  $('#dates').addEventListener('click', function(e){ var b = e.target.closest('.date'); if(!b) return; st.date = b.getAttribute('data-d'); all(); });
  $('#slots').addEventListener('click', function(e){ var b = e.target.closest('.slot'); if(!b || b.disabled) return; st.time = b.getAttribute('data-t'); st.court = null; renderSlots(); renderCourts(); renderSummary(); });
  $('#courts').addEventListener('click', function(e){ var b = e.target.closest('.court'); if(!b || b.disabled) return; st.court = +b.getAttribute('data-c'); renderCourts(); renderSummary(); });
  $('#extras').addEventListener('click', function(e){
    var b = e.target.closest('button[data-x]'); if(!b || b.disabled) return;
    var id = b.getAttribute('data-x'), sp = st.act === 'coaching' ? st.sport : st.act, def = P.extras[sp].filter(function(x){ return x.id === id; })[0];
    var q = Math.max(0, Math.min(def.max, (+st.extras[id] || 0) + (+b.getAttribute('data-d'))));
    st.extras[id] = q; renderExtras(); renderSummary();
    var again = $('#extras button[data-x="' + id + '"][data-d="' + b.getAttribute('data-d') + '"]'); if(again && !again.disabled) again.focus();
  });
  $('#toPay').addEventListener('click', function(){
    var tok = encodeBooking(current());
    location.href = 'checkout.html#' + tok;
  });
}

/* ---------- CHECKOUT ---------- */
if(page === 'checkout'){
  var token = location.hash.replace('#',''), ret = /^(paid|cancelled)-([A-Z0-9-]+)$/.exec(token), ctx = null;
  if(ret){ ctx = get('pendingCheckout', null); if(ctx && ctx.ref === ret[2]) token = ctx.token; else ctx = null; }
  var item = decode(token);
  var view = $('#coView'), done = $('#doneView');
  if(ret && !ctx){
    // returned from the payment page on a different browser: just confirm the reference
    view.innerHTML = '<div class="done"><div class="spin"></div><h1>Checking <em>your payment.</em></h1><p class="lead" id="retMsg">Reference ' + esc(ret[2]) + '</p></div>';
    if(LIVE) apiGet({action:'confirm', ref:ret[2]}).then(function(r){
      var okSt = r.ok && (r.status === 'Confirmed' || r.status === 'Active');
      view.innerHTML = '<div class="done"><h1>' + (okSt ? "You're <em>booked.</em>" : (ret[1] === 'cancelled' ? 'Payment <em>not completed.</em>' : 'Payment <em>pending.</em>')) + '</h1><p class="lead" style="text-align:center">Reference ' + esc(ret[2]) + '. ' + (okSt ? 'Show it at reception when you arrive.' : 'Nothing has been charged. Message us on WhatsApp if you need help.') + '</p><div class="actions"><a class="btn btn-navy" href="book.html">Book a Court</a></div></div>';
    }, function(){ $('#retMsg').textContent = NET_ERR; });
  } else if(!item){
    view.innerHTML = '<div class="done"><h1>Nothing to <em>pay for yet.</em></h1><p class="lead">Choose a court or a membership first.</p><div class="actions"><a class="btn btn-navy" href="book.html">Book a Court</a><a class="btn btn-line" href="membership.html">See Membership</a></div></div>';
  } else if(!user && item.kind === 'membership'){
    set('returnTo', 'checkout.html#' + token); location.replace('login.html');
  } else {
    var total, free = '', rows, guest = !user, needDetails = guest || LIVE;
    if(item.kind === 'membership'){
      var t = P.membership[item.tier];
      total = item.billing === 'annual' ? t.annual : t.monthly;
      rows = [['Membership', t.name], ['Billing', item.billing === 'annual' ? 'Yearly' : 'Monthly'], ['Member', user.first + ' ' + (user.last||'')], ['Starts', 'Today']];
      $('#coLead').textContent = 'Join the club. Choose how you would like to pay.';
      $('#coBack').href = 'membership.html#plans'; $('#coBack').textContent = '← Change plan';
      $('#clubNote').textContent = 'Pay at reception by cash or card when you collect your membership card. Your membership starts once payment is received.';
      $('#clubBtn').textContent = 'Confirm and Pay at the Club';
    } else {
      free = memberFreeReason(item.date, toMin(item.time), item.dur, item.act);
      var courtPrice = free ? 0 : priceOf(item);
      total = courtPrice + extrasTotal(item);
      rows = [['Activity', actLabel(item)], ['Date', niceDate(item.date, {weekday:'short', day:'numeric', month:'short'})], ['Time', niceTime(toMin(item.time)) + ' – ' + niceTime(toMin(item.time) + item.dur)], ['Court', 'Court ' + item.court]];
      if(item.act !== 'coaching') rows.push(['Rate', isPeak(item.date, toMin(item.time)) ? 'Peak' : 'Off-peak']);
      if(extrasList(item).length){
        rows.push([item.act === 'coaching' ? 'Session' : 'Court booking', free ? 'Free' : fmt(courtPrice)]);
        extrasList(item).forEach(function(x){ rows.push([x.qty + ' × ' + x.name.replace(' hire',''), fmt(x.total)]); });
      }
      $('#coBack').href = 'book.html#' + token;
      var stillFree = LIVE || courtFree(item.act === 'coaching' ? item.sport : item.act, item.date, toMin(item.time), item.dur, item.court);
      if(LIVE && !ret){
        var cs = item.act === 'coaching' ? item.sport : item.act;
        loadBusy(cs, item.date).then(function(){ if(!courtFree(cs, item.date, toMin(item.time), item.dur, item.court)) goneView(); }, function(){});
      }
      if(!stillFree){ view.innerHTML = '<div class="done"><h1>That court has <em>just gone.</em></h1><p class="lead">Someone booked Court ' + item.court + ' at that time. Pick another time or court.</p><div class="actions"><a class="btn btn-navy" href="book.html">Choose Again</a></div></div>'; item = null; }
    }
    if(item){
      $('#coList').innerHTML = rows.map(function(r){ return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
      $('#coPerk').innerHTML = free ? '<p class="perk">' + free + '</p>' : '';
      $('#coTotal').textContent = total ? fmt(total) : 'Free';
      $('#coPP').textContent = item.kind === 'booking' && item.act !== 'coaching' && courtPrice ? 'Court ' + fmt(Math.round(courtPrice / P.players)) + ' per player' : (item.kind === 'membership' && item.billing === 'annual' ? 'About 2 months free compared with monthly' : '');
      $('#cardBtn').textContent = 'Pay ' + fmt(total);
      $('#apAmt').textContent = fmt(total);
      $('#cc-name').value = user ? (user.first + ' ' + (user.last||'')).trim() : '';
      if(needDetails){
        $('#guestBox').hidden = false;
        var pre = (ctx && ctx.who) || user;
        if(pre){ $('#gu-first').value = pre.first || ''; $('#gu-last').value = pre.last || ''; $('#gu-email').value = pre.email || ''; $('#gu-phone').value = pre.phone || ''; }
        if(guest){ $('#coLead').textContent = 'Booking as a guest. Add your details, then choose how to pay.'; }
        else { $('#guestBox .sub').textContent = 'Check your details. We use them for your booking reference and WhatsApp updates.'; }
        $('#guestSignIn') && $('#guestSignIn').addEventListener('click', function(){ set('returnTo', 'checkout.html#' + token); });
      }
      function gErr(input, msg){ var f = input.closest('.field'); f.classList.toggle('bad', !!msg); f.querySelector('.err').textContent = msg || ''; return !msg; }
      function guestOk(){
        if(!needDetails) return true;
        var f = $('#gu-first'), l = $('#gu-last'), em = $('#gu-email'), ph = $('#gu-phone');
        var ok = gErr(f, f.value.trim() ? '' : 'Enter your first name.');
        ok = gErr(l, l.value.trim() ? '' : 'Enter your last name.') && ok;
        ok = gErr(em, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em.value.trim()) ? '' : 'Enter an email like name@example.com.') && ok;
        ok = gErr(ph, ph.value.replace(/\D/g,'').length >= 9 ? '' : 'Enter a WhatsApp number, like +971 50 123 4567.') && ok;
        if(!ok){ $('#guestBox').scrollIntoView({behavior:'smooth', block:'start'}); var bad = $('#guestBox .bad input'); if(bad) bad.focus({preventScroll:true}); }
        return ok;
      }
      function who(){ return needDetails ? {first:$('#gu-first').value.trim(), last:$('#gu-last').value.trim(), email:$('#gu-email').value.trim(), phone:$('#gu-phone').value.trim()} : user; }
      if(free && !total){ $('#payBox').hidden = true; $('#freeBox').hidden = false; }

      $$('input[name="pm"]').forEach(function(r){ r.addEventListener('change', function(){ ['apple','card','club'].forEach(function(k){ $('#pd-' + k).hidden = r.value !== k; }); }); });

      var busy = $('#busy');
      function goneView(){ view.innerHTML = '<div class="done"><h1>That court has <em>just gone.</em></h1><p class="lead">Someone booked Court ' + item.court + ' at that time. Pick another time or court.</p><div class="actions"><a class="btn btn-navy" href="book.html">Choose Again</a></div></div>'; }
      function showErr(m){ var e = $('#coErr'); e.textContent = m; e.hidden = false; e.scrollIntoView({behavior:'smooth', block:'center'}); }
      function complete(pay, refIn, amountIn, whoIn, extra){
        var ref = refIn || 'EP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
        if(amountIn !== undefined && amountIn !== null) total = +amountIn;
        var W = whoIn || who();
        if(item.kind === 'membership'){
          var since = ymd(new Date());
          user.membership = {tier:item.tier, billing:item.billing, since:since, no:(extra && extra.memberNo) || 'EP' + String(100000 + hash(user.email + since) * 997 % 900000).slice(0,6), pay:pay};
          set('user', user); var acc = get('accounts', {}); acc[user.email.toLowerCase()] = user; set('accounts', acc);
          var pays = get('payments', []); pays.push({id:ref, owner:user.email.toLowerCase(), created:Date.now(), desc:P.membership[item.tier].name + ' membership · ' + (item.billing === 'annual' ? 'yearly' : 'monthly'), pay:pay, amount:total, status:'confirmed'}); set('payments', pays);
        } else {
          var list = bookings();
          var w = W;
          list.push({id:ref, owner:w.email.toLowerCase(), guest:guest ? w : null, act:item.act, sport:item.act === 'coaching' ? item.sport : item.act, fmt:item.fmt || null, date:item.date, time:item.time, dur:item.dur, court:item.court, extras:extrasList(item), price:total, pay:pay, status:'confirmed', created:Date.now()});
          set('bookings', list);
        }
        var payTxt = {apple:'Paid with Apple Pay', card:'Paid by card', online:'Paid online (card or Apple Pay)', club:'Pay at the club by cash or card', free:'Included with your membership'}[pay];
        var title = item.kind === 'membership' ? 'Welcome to <em>the club.</em>' : "You're <em>booked.</em>";
        var lines = rows.concat([['Payment', payTxt], ['Total', total ? fmt(total) : 'Free']]);
        view.hidden = true; done.hidden = false;
        done.innerHTML = '<div class="done"><div class="tick">' + '<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' + '</div>' +
          '<p class="ref">Reference ' + ref + '</p><h1>' + title + '</h1>' +
          '<p class="lead" style="text-align:center">' + (item.kind === 'membership' ? 'Your ' + P.membership[item.tier].name + ' membership is ' + (pay === 'club' ? 'reserved. Collect your card and pay at reception.' : 'active. Collect your card at reception on your next visit.') : (pay === 'club' ? 'Your court is held. Pay at reception before you play.' : 'See you on court, ' + esc(W.first) + '.')) + '</p>' +
          '<div class="box summary"><dl>' + lines.map(function(r){ return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</dl></div>' +
          (guest ? '<p class="fine" style="text-align:center;margin:0">Show your reference at reception. Booking details are for ' + esc(W.email) + '.</p>' : '') +
          '<div class="actions">' + (guest ? '<a class="btn btn-navy" href="login.html#create">Create an Account</a>' : '<a class="btn btn-navy" href="account.html">' + (item.kind === 'membership' ? 'View My Card' : 'My Bookings') + '</a>') + '<a class="btn btn-line" href="book.html">Book ' + (item.kind === 'membership' ? 'a Court' : 'Another') + '</a></div></div>';
        window.scrollTo(0, 0);
      }
      function process(pay){ busy.hidden = false; setTimeout(function(){ busy.hidden = true; complete(pay); }, 1400); }
      function liveSubmit(method){
        $('#coErr').hidden = true;
        $('#busy p').textContent = method === 'card' ? 'Opening secure payment…' : 'Confirming your booking…'; busy.hidden = false;
        var w = who(), body = item.kind === 'membership'
          ? {action:'join', tier:item.tier, billing:item.billing, customer:w, pay:method}
          : {action:'book', booking:{act:item.act, sport:item.sport || item.act, fmt:item.fmt || null, date:item.date, time:item.time, dur:item.dur, court:item.court, extras:item.extras || {}}, customer:w, pay:method};
        apiPost(body).then(function(r){
          if(!r.ok){ busy.hidden = true; if(r.error === 'taken') goneView(); else showErr(r.error || NET_ERR); return; }
          if(r.url){ set('pendingCheckout', {token:token, ref:r.ref, amount:r.amount, who:w}); location.href = r.url; return; }
          busy.hidden = true;
          complete(item.kind === 'booking' && r.amount === 0 ? 'free' : 'club', r.ref, r.amount, w, {memberNo:r.memberNo});
        }, function(){ busy.hidden = true; showErr(NET_ERR); });
      }
      if(LIVE){
        $('#cardBtn').textContent = 'Pay ' + fmt(total) + ' securely';
        apiGet({action:'config'}).then(function(r){
          if(r.ok && !r.card){
            ['apple','card'].forEach(function(k){ var inp = $('input[name="pm"][value="' + k + '"]'); inp.closest('.pay').hidden = true; $('#pd-' + k).hidden = true; });
            $('input[name="pm"][value="club"]').checked = true; $('#pd-club').hidden = false;
          }
        }, function(){});
        if(ret && ctx){
          if(ret[1] === 'cancelled'){
            apiPost({action:'release', ref:ctx.ref}).then(function(){}, function(){});
            set('pendingCheckout', null);
            showErr("Payment wasn't completed, so nothing was charged. Choose a payment method to try again.");
          } else {
            $('#busy p').textContent = 'Confirming your payment…'; busy.hidden = false;
            var tries = 0;
            (function poll(){
              apiGet({action:'confirm', ref:ctx.ref}).then(function(r){
                if(r.ok && (r.status === 'Confirmed' || r.status === 'Active')){ busy.hidden = true; set('pendingCheckout', null); complete('online', ctx.ref, r.amount, ctx.who, {memberNo:r.memberNo}); return; }
                if(r.ok && r.status === 'Pending payment' && ++tries < 8){ setTimeout(poll, 2500); return; }
                busy.hidden = true;
                showErr(r.ok && r.status === 'Pending payment' ? 'We are still waiting for the payment confirmation for ' + ctx.ref + '. We will message you on WhatsApp as soon as it arrives.' : 'This payment could not be confirmed (' + (r.status || r.error || 'unknown') + '). Nothing was charged. Please try again.');
              }, function(){ busy.hidden = true; showErr(NET_ERR); });
            })();
          }
        }
      }

      var ap = $('#apModal');
      $('#appleBtn').addEventListener('click', function(){ if(!guestOk()) return; if(LIVE){ liveSubmit('card'); return; } ap.hidden = false; $('#apConfirm').focus(); });
      $('[data-close]', ap).addEventListener('click', function(){ ap.hidden = true; });
      $('#apConfirm').addEventListener('click', function(){ ap.hidden = true; process('apple'); });
      $('#clubBtn').addEventListener('click', function(){ if(!guestOk()) return; if(LIVE) liveSubmit('club'); else complete('club'); });
      $('#freeBtn').addEventListener('click', function(){ if(LIVE){ if(guestOk()) liveSubmit('club'); } else complete('free'); });

      function err(input, msg){ var f = input.closest('.field'); f.classList.toggle('bad', !!msg); f.querySelector('.err').textContent = msg || ''; return !msg; }
      function luhn(n){ var s = 0, alt = false; for(var i = n.length - 1; i >= 0; i--){ var d = +n[i]; if(alt){ d *= 2; if(d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; }
      $('#cc-num').addEventListener('input', function(e){ var v = e.target.value.replace(/\D/g,'').slice(0,19); e.target.value = v.replace(/(.{4})/g,'$1 ').trim(); });
      $('#cc-exp').addEventListener('input', function(e){ var v = e.target.value.replace(/\D/g,'').slice(0,4); e.target.value = v.length > 2 ? v.slice(0,2) + '/' + v.slice(2) : v; });
      $('#pd-card').addEventListener('submit', function(e){
        e.preventDefault();
        if(LIVE){ if(guestOk()) liveSubmit('card'); return; }
        var n = $('#cc-num').value.replace(/\D/g,''), nm = $('#cc-name').value.trim(), ex = $('#cc-exp').value, cvc = $('#cc-cvc').value.replace(/\D/g,'');
        var ok = err($('#cc-num'), n.length >= 13 && luhn(n) ? '' : 'Check the card number. It should be 13 to 19 digits.');
        ok = err($('#cc-name'), nm ? '' : 'Enter the name shown on the card.') && ok;
        var m = /^(\d{2})\/(\d{2})$/.exec(ex), valid = false;
        if(m){ var mm = +m[1], yy = 2000 + (+m[2]), today = new Date(); valid = mm >= 1 && mm <= 12 && (yy > today.getFullYear() || (yy === today.getFullYear() && mm >= today.getMonth() + 1)); }
        ok = err($('#cc-exp'), valid ? '' : 'Enter a future expiry date as MM/YY.') && ok;
        ok = err($('#cc-cvc'), cvc.length >= 3 && cvc.length <= 4 ? '' : 'Enter the 3 or 4 digits on the back of the card.') && ok;
        if(ok && guestOk()) process('card');
      });
    }
  }
}

/* ---------- ACCOUNT ---------- */
if(page === 'account'){
  if(!user){ $('#acctOut').hidden = false; }
  else {
    $('#acctIn').hidden = false;
    $('#acName').textContent = user.first + '.';
    var m = user.membership, mc = $('#mcard');
    if(m && P.membership[m.tier]){
      mc.innerHTML = '<div class="mcard"><span class="tierlbl">' + P.membership[m.tier].name + '</span><img src="img/crest-gold.png" alt="Europadel crest"><div><div class="who">' + esc(user.first + ' ' + (user.last||'')) + '</div></div><div class="meta"><span>No. ' + esc(m.no) + '</span><span>Since ' + parseYmd(m.since).toLocaleDateString('en-GB',{month:'short', year:'numeric'}) + '</span></div></div>' +
        '<p class="fine">' + (m.billing === 'annual' ? 'Annual plan' : 'Monthly plan') + (m.pay === 'club' ? ' · payment due at reception' : '') + '</p>';
    } else {
      mc.innerHTML = '<div class="mcard none"><span class="tierlbl" style="color:var(--body)">Not a member yet</span><img src="img/crest-olive.png" alt="Europadel crest"><div class="who">Free court time starts at AED ' + P.membership.standard.monthly + ' a month.</div><div class="meta" style="color:var(--body)"><a class="link" href="membership.html#plans" style="color:var(--navy)">See plans <span aria-hidden="true">→</span></a></div></div>';
    }
    $('#profile').innerHTML = [['Name', (user.first + ' ' + (user.last||'')).trim()], ['Email', user.email], ['WhatsApp', user.phone || 'Not added'], ['Signed in with', user.provider === 'google' ? 'Google' : 'Email']].map(function(r){ return '<div><dt>' + r[0] + '</dt><dd style="overflow-wrap:anywhere">' + esc(r[1]) + '</dd></div>'; }).join('');
    $('#signOut').addEventListener('click', function(){ set('user', null); location.href = 'index.html'; });

    function renderBk(){
      var me = user.email.toLowerCase();
      var list = bookings().filter(function(b){ return !b.owner || b.owner === me; }).sort(function(a,b){ return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
      var nowKey = ymd(new Date()) + hm(new Date().getHours()*60 + new Date().getMinutes());
      function isUp(b){ return b.status === 'confirmed' && (b.date + b.time) >= nowKey; }
      var games = list.filter(function(b){ return b.act !== 'coaching'; }), coach = list.filter(function(b){ return b.act === 'coaching'; });
      var up = games.filter(isUp), past = games.filter(function(b){ return !isUp(b); }).reverse();
      var cUp = coach.filter(isUp), cPast = coach.filter(function(b){ return !isUp(b); }).reverse();
      function hoursTo(b){ return (parseYmd(b.date).getTime() + toMin(b.time) * 60000 - Date.now()) / 3600000; }
      function row(b, canCancel){
        var d = parseYmd(b.date), pill = b.status === 'cancelled' ? '<span class="pill cx">Cancelled</span>' : b.pay === 'club' ? '<span class="pill club">Pay at club</span>' : b.pay === 'free' ? '<span class="pill free">Member</span>' : '<span class="pill paid">Paid</span>';
        return '<div class="bk ' + esc(b.sport) + '"><div class="d"><small>' + d.toLocaleDateString('en-GB',{weekday:'short'}) + '</small><b>' + d.getDate() + '</b><small>' + d.toLocaleDateString('en-GB',{month:'short'}) + '</small></div>' +
          '<div><h4>' + esc(actLabel(b)) + pill + '</h4><p>' + niceTime(toMin(b.time)) + ' – ' + niceTime(toMin(b.time) + (+b.dur)) + ' · Court ' + b.court + (b.extras && b.extras.length ? ' · + ' + esc(b.extras.map(function(x){ return x.qty + ' × ' + x.short; }).join(', ')) : '') + ' · ' + (b.price ? fmt(b.price) : 'Free') + ' · Ref ' + esc(b.id) + '</p></div>' +
          (canCancel ? (hoursTo(b) >= 24 ? '<div data-cx="' + esc(b.id) + '"><button class="txt-btn" type="button" data-ask>Cancel</button></div>' : '<div class="late-note">Within 24 hours.<br><a href="https://wa.me/971525392908" target="_blank" rel="noopener">Message reception</a></div>') : '<div></div>') + '</div>';
      }
      $('#upcoming').innerHTML = up.length ? up.map(function(b){ return row(b, true); }).join('') : '<p class="empty">No upcoming games. <a class="link" href="book.html" style="margin-left:8px">Book a court <span aria-hidden="true">→</span></a></p>';
      $('#coachList').innerHTML = (cUp.length || cPast.length) ? cUp.map(function(b){ return row(b, true); }).join('') + cPast.map(function(b){ return row(b, false); }).join('') : '<p class="empty">No coaching sessions yet. <a class="link" href="coaching.html" style="margin-left:8px">Explore coaching <span aria-hidden="true">→</span></a></p>';
      $('#past').innerHTML = past.length ? past.map(function(b){ return row(b, false); }).join('') : '<p class="empty">Your past and cancelled games will show here.</p>';
      // payment history: bookings with a charge + membership payments
      var pays = list.filter(function(b){ return b.price > 0; }).map(function(b){ return {created:b.created || 0, desc:actLabel(b) + ' · ' + niceDate(b.date, {day:'numeric', month:'short'}), pay:b.pay, amount:b.price, status:b.status, id:b.id}; })
        .concat(get('payments', []).filter(function(p){ return p.owner === me; }))
        .sort(function(a, b){ return b.created - a.created; });
      var method = {apple:'Apple Pay', card:'Card', club:'At the club'};
      $('#payments').innerHTML = pays.length ? '<div class="table-wrap"><table class="ptable paytable"><caption class="sr">Payment history</caption><thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col">Method</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead><tbody>' +
        pays.map(function(p){
          var st = p.status === 'cancelled' ? (p.pay === 'club' ? '<span class="pill cx">Cancelled</span>' : '<span class="pill cx">Refund due</span>') : p.pay === 'club' ? '<span class="pill club">Due at club</span>' : '<span class="pill paid">Paid</span>';
          return '<tr><td>' + (p.created ? new Date(p.created).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}) : '–') + '</td><td>' + esc(p.desc) + '<small>Ref ' + esc(p.id) + '</small></td><td>' + (method[p.pay] || '–') + '</td><td>' + st + '</td><td class="amt">' + fmt(p.amount) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="empty">Payments for bookings, coaching and membership will show here.</p>';
    }
    renderBk();
    function onCancel(e){
      var w = e.target.closest('[data-cx]'); if(!w) return;
      if(e.target.closest('[data-ask]')){ var bx = bookings().filter(function(b){ return b.id === w.getAttribute('data-cx'); })[0], refundTxt = bx && bx.price > 0 && bx.pay !== 'club' ? 'You will be refunded ' + fmt(bx.price) + '. ' : '';
        w.innerHTML = '<span class="confirm-inline">' + refundTxt + 'Cancel this booking? <button class="txt-btn" type="button" data-yes>Yes, cancel</button><button class="txt-btn" type="button" data-no style="color:var(--body)">Keep it</button></span>'; return; }
      if(e.target.closest('[data-no]')){ renderBk(); return; }
      if(e.target.closest('[data-yes]')){
        var list = bookings(); list.forEach(function(b){ if(b.id === w.getAttribute('data-cx')) b.status = 'cancelled'; }); set('bookings', list); renderBk(); toast(bx && bx.price > 0 && bx.pay !== 'club' ? 'Booking cancelled. Refund on its way.' : 'Booking cancelled');
      }
    }
    $('#upcoming').addEventListener('click', onCancel);
    $('#coachList').addEventListener('click', onCancel);
  }
}
})();
