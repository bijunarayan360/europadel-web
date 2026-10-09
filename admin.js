/* Europadel staff dashboard — reads and updates the club's Google Sheet through the booking script.
   Preview mode (no EP_CONFIG.api): shows demo data plus bookings made on this browser. */
(function(){
'use strict';
var P = window.EP_PRICES, CFG = window.EP_CONFIG || {}, LIVE = !!CFG.api;
var OPEN = 360, CLOSE = 1440, SPAN = CLOSE - OPEN;
function $(s, r){ return (r || document).querySelector(s); }
function $$(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function pad(n){ return (n < 10 ? '0' : '') + n; }
function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseYmd(s){ var a = s.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
function hm(m){ return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
function toMin(t){ var a = String(t).split(':'); return (+a[0]) * 60 + (+a[1] || 0); }
function aed(n){ return 'AED ' + Number(n || 0).toLocaleString('en-GB'); }
function cap(s){ s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function addDays(s, n){ var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function sget(k){ try{ return sessionStorage.getItem('ep_admin_' + k); }catch(e){ return null; } }
function sset(k, v){ try{ if(v === null) sessionStorage.removeItem('ep_admin_' + k); else sessionStorage.setItem('ep_admin_' + k, v); }catch(e){} }
function lget(k, d){ try{ var v = localStorage.getItem('ep_' + k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function toast(m){ var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2600); }
function isPeak(dateStr, startMin){ var d = parseYmd(dateStr).getDay(); if(d === 0 || d === 6) return true; if(d === 5) return startMin >= 900; return startMin >= 1020; }

var state = { key: sget('key') || '', date: ymd(new Date()), tab: 'day', day: null, members: null, interest: null, search: '' };

/* ---------------- data access ---------------- */
function api(op, extra){
  var body = Object.assign({action:'admin', key:state.key, op:op}, extra || {});
  return fetch(CFG.api, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(body)})
    .then(function(r){ return r.json(); })
    .then(function(j){ if(j.error === 'auth'){ signOut('Staff password not recognised.'); throw new Error('auth'); } return j; });
}

// ---- preview data (demo) ----
var demo = { edits:{}, extra:[], blocks:[] };
var NAMES = ['Omar K.', 'Sara M.', 'Daniel R.', 'Layla H.', 'Marco P.', 'Aisha N.', 'Tom W.', 'Noor A.', 'Lucas B.', 'Hana S.', 'Ravi T.', 'Elena V.', 'Yousef D.', 'Chloe F.', 'Karim Z.', 'Mei L.'];
function hsh(s){ var h = 2166136261; for(var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function demoDay(date){
  var out = [];
  ['padel', 'pickleball'].forEach(function(sport){
    for(var c = 1; c <= P.walkin[sport].courts; c++){
      var t = OPEN;
      while(t < CLOSE - 60){
        var h = hsh(sport + date + c + 't' + t) % 100, busy = isPeak(date, t) ? 62 : 34;
        if(h < busy){
          var dur = h % 3 === 0 ? 60 : 90; if(t + dur > CLOSE) dur = CLOSE - t;
          var coach = sport === 'padel' && h % 11 === 0, pay = ['Card / Apple Pay (paid)', 'Card / Apple Pay (paid)', 'Pay at club', 'Paid at club', 'Member'][h % 5];
          var r = coach ? P.coaching.private.single : (P.walkin[sport][String(dur)] || P.walkin[sport]['90'])[isPeak(date, t) ? 'peak' : 'off'];
          var eq = h % 4 === 0 ? (sport === 'padel' ? '2 × Padel racket hire' : '2 × Pickleball paddle hire') : (h % 7 === 0 ? (sport === 'padel' ? '1 × Padel balls' : '1 × Pickleball balls') : '');
          var ref = 'EP-' + (hsh(sport + date + c + t).toString(36).toUpperCase() + 'XXXXXX').slice(0, 6);
          out.push({ ref:ref, date:date, sport:sport, activity:coach ? 'Coaching' : 'Court', start:t, end:t + (coach ? 60 : dur), court:c, coaching:coach ? 'Private' : '',
            equipment:eq, name:NAMES[h % NAMES.length], email:'', whatsapp:'+97150' + String(1000000 + (h * 7919) % 8999999), amount:pay === 'Member' ? 0 : r,
            payment:pay, status:h % 23 === 0 ? 'Cancelled' : 'Confirmed', source:h % 6 === 0 ? 'Phone' : 'Website', notes:'', created:date });
          t += (coach ? 60 : dur);
        } else t += 30;
      }
    }
  });
  // bookings made on this browser in the website preview
  lget('bookings', []).forEach(function(b){
    if(b.date !== date) return;
    out.push({ ref:b.id, date:b.date, sport:b.sport, activity:b.act === 'coaching' ? 'Coaching' : 'Court', start:toMin(b.time), end:toMin(b.time) + (+b.dur), court:+b.court,
      coaching:b.fmt ? P.coaching[b.fmt].name : '', equipment:(b.extras || []).map(function(x){ return x.qty + ' × ' + x.name; }).join(', '),
      name:b.guest ? (b.guest.first + ' ' + b.guest.last) : (b.owner || 'Website customer'), email:b.owner || '', whatsapp:b.guest ? b.guest.phone : '',
      amount:b.price, payment:{apple:'Card / Apple Pay (paid)', card:'Card / Apple Pay (paid)', online:'Card / Apple Pay (paid)', club:'Pay at club', free:'Member'}[b.pay] || 'Pay at club',
      status:b.status === 'cancelled' ? 'Cancelled' : 'Confirmed', source:'Website (this browser)', notes:'', created:'' });
  });
  // remove demo bookings that overlap a real preview booking
  var real = out.filter(function(b){ return b.source === 'Website (this browser)'; });
  out = out.filter(function(b){ return b.source === 'Website (this browser)' || !real.some(function(r){ return r.sport === b.sport && r.court === b.court && b.start < r.end && r.start < b.end; }); });
  out = out.concat(demo.extra.filter(function(b){ return b.date === date; }));
  out.forEach(function(b){ if(demo.edits[b.ref]) Object.assign(b, demo.edits[b.ref]); });
  return { ok:true, date:date, bookings:out, blocks:demo.blocks.filter(function(b){ return b.date === date; }) };
}
function demoMembers(){
  var rows = [
    {'Member no':'EP100001', Name:'Omar K.', Plan:'Platinum', Billing:'Monthly', Status:'Active', 'Next renewal':addDays(ymd(new Date()), 12), WhatsApp:'+971501234567', Email:'omar@example.com', 'Amount (AED)':790, Payment:'Card / Apple Pay (paid)', Ref:'M-DEMO01'},
    {'Member no':'EP100002', Name:'Sara M.', Plan:'Standard', Billing:'Yearly', Status:'Active', 'Next renewal':addDays(ymd(new Date()), 300), WhatsApp:'+971502345678', Email:'sara@example.com', 'Amount (AED)':4500, Payment:'Card / Apple Pay (paid)', Ref:'M-DEMO02'},
    {'Member no':'EP100003', Name:'Daniel R.', Plan:'Business Club', Billing:'Monthly', Status:'Overdue', 'Next renewal':addDays(ymd(new Date()), -2), WhatsApp:'+971503456789', Email:'daniel@example.com', 'Amount (AED)':1490, Payment:'Card / Apple Pay (paid)', Ref:'M-DEMO03'},
    {'Member no':'EP100004', Name:'Layla H.', Plan:'Standard', Billing:'Monthly', Status:'Pay at club', 'Next renewal':'', WhatsApp:'+971504567890', Email:'layla@example.com', 'Amount (AED)':450, Payment:'Pay at club', Ref:'M-DEMO04'}
  ];
  var u = lget('user', null);
  if(u && u.membership){ rows.unshift({'Member no':u.membership.no, Name:(u.first + ' ' + (u.last || '')).trim(), Plan:P.membership[u.membership.tier].name, Billing:u.membership.billing === 'annual' ? 'Yearly' : 'Monthly', Status:u.membership.pay === 'club' ? 'Pay at club' : 'Active', 'Next renewal':'', WhatsApp:u.phone || '', Email:u.email, 'Amount (AED)':u.membership.billing === 'annual' ? P.membership[u.membership.tier].annual : P.membership[u.membership.tier].monthly, Payment:u.membership.pay === 'club' ? 'Pay at club' : 'Card / Apple Pay (paid)', Ref:'M-LOCAL'}); }
  rows.forEach(function(r){ if(demo.edits[r.Ref]) Object.assign(r, demo.edits[r.Ref]); });
  return { ok:true, rows:rows };
}
function demoInterest(){
  var rows = lget('interest', []).slice().reverse().map(function(i){ return { Received:new Date(i.at).toISOString().slice(0, 16).replace('T', ' '), Name:i.first + ' ' + i.last, Email:i.email, WhatsApp:i.phone, 'Interested in':i.interests.join(', '), Sport:i.sport, Level:i.level, Message:i.msg }; });
  rows.push({ Received:ymd(new Date()) + ' 09:12', Name:'Hana S.', Email:'hana@example.com', WhatsApp:'+971505551234', 'Interested in':'Membership, Coaching', Sport:'Padel', Level:'Beginner', Message:'Interested in weekday mornings.' });
  return { ok:true, rows:rows };
}

function loadDay(){
  if(!LIVE){ state.day = demoDay(state.date); return Promise.resolve(); }
  return api('day', {date:state.date}).then(function(j){ if(!j.ok) throw new Error(j.error); state.day = j; });
}
function loadMembers(){ if(!LIVE){ state.members = demoMembers().rows; return Promise.resolve(); } return api('members').then(function(j){ if(!j.ok) throw new Error(j.error); state.members = j.rows.slice().reverse(); }); }
function loadInterest(){ if(!LIVE){ state.interest = demoInterest().rows; return Promise.resolve(); } return api('interest').then(function(j){ if(!j.ok) throw new Error(j.error); state.interest = j.rows; }); }
function update(ref, fields){
  if(!LIVE){ demo.edits[ref] = Object.assign(demo.edits[ref] || {}, fields.Status ? {status:fields.Status, Status:fields.Status} : {}, fields.Payment ? {payment:fields.Payment, Payment:fields.Payment} : {}); return Promise.resolve({ok:true}); }
  return api('update', {ref:ref, fields:fields});
}

/* ---------------- rendering ---------------- */
var STATUS_LIVE = { 'Confirmed':1, 'Pending payment':1 };
function payClass(b){
  if(b.status === 'Pending payment') return 'pending';
  if(b.payment === 'Member') return 'member';
  if(b.payment === 'Pay at club') return 'due';
  return 'paid';
}
function payLabel(b){ return b.status === 'Pending payment' ? 'Paying now' : ({'Card / Apple Pay (paid)':'Paid online', 'Paid at club':'Paid at club', 'Pay at club':'Due at club', 'Member':'Member', 'Refunded':'Refunded', 'Card / Apple Pay (pending)':'Paying now'}[b.payment] || b.payment || '–'); }
function statusPill(s){ var c = {'Confirmed':'ok', 'Pending payment':'wait', 'Cancelled':'off', 'Expired':'off', 'No-show':'bad', 'Released (unpaid)':'off', 'Active':'ok', 'Pay at club':'wait', 'Paused':'off', 'Overdue':'bad'}[s] || 'off'; return '<span class="ap-pill ' + c + '">' + esc(s || '–') + '</span>'; }

function render(){
  $$('.ap-tabs button').forEach(function(b){ b.setAttribute('aria-selected', b.getAttribute('data-tab') === state.tab ? 'true' : 'false'); });
  $('#dayBar').hidden = state.tab !== 'day';
  $$('.ap-view').forEach(function(v){ v.hidden = v.id !== 'view-' + state.tab; });
  if(state.tab === 'day') renderDay();
  if(state.tab === 'members') renderMembers();
  if(state.tab === 'interest') renderInterest();
}

function renderDay(){
  var d = state.day; if(!d) return;
  var dt = parseYmd(state.date), today = ymd(new Date()) === state.date;
  $('#dayLabel').textContent = dt.toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'}) + (today ? ' · Today' : '');
  $('#dayInput').value = state.date;
  var live = d.bookings.filter(function(b){ return STATUS_LIVE[b.status]; });
  // KPIs
  var mins = live.reduce(function(s, b){ return s + (b.end - b.start); }, 0), capMin = (P.walkin.padel.courts + P.walkin.pickleball.courts) * SPAN;
  var paid = live.filter(function(b){ return b.payment === 'Card / Apple Pay (paid)' || b.payment === 'Paid at club'; }).reduce(function(s, b){ return s + b.amount; }, 0);
  var due = live.filter(function(b){ return b.payment === 'Pay at club'; }).reduce(function(s, b){ return s + b.amount; }, 0);
  var eq = {}; live.forEach(function(b){ String(b.equipment || '').split(',').forEach(function(p){ var m = /(\d+)\s*×\s*(.+)/.exec(p.trim()); if(m) eq[m[2]] = (eq[m[2]] || 0) + (+m[1]); }); });
  var eqTxt = Object.keys(eq).map(function(k){ return eq[k] + ' × ' + k.replace(' hire', ''); });
  $('#kpis').innerHTML =
    kpi('Bookings', live.length, live.filter(function(b){ return b.activity === 'Coaching'; }).length + ' coaching') +
    kpi('Court occupancy', Math.round(mins / capMin * 100) + '%', Math.round(mins / 60) + ' of ' + (capMin / 60) + ' court hours') +
    kpi('Paid', aed(paid), 'Online and at the desk') +
    kpi('Due at club', aed(due), (function(n){ return n + (n === 1 ? ' booking' : ' bookings') + ' to collect'; })(live.filter(function(b){ return b.payment === 'Pay at club'; }).length), due ? 'warn' : '') +
    kpi('Equipment to prepare', eqTxt.length ? eqTxt.reduce(function(s, t){ return s + (+t.split(' ')[0]); }, 0) : 0, eqTxt.join(' · ') || 'Nothing booked');
  // grid
  var head = '<div class="g-head"><div class="g-label"></div><div class="g-track">';
  for(var h = 6; h < 24; h++) head += '<span style="left:' + ((h * 60 - OPEN) / SPAN * 100) + '%">' + (h % 12 || 12) + (h < 12 ? 'am' : 'pm') + '</span>';
  head += '</div></div>';
  var html = '';
  ['padel', 'pickleball'].forEach(function(sport){
    html += '<div class="g-sport">' + cap(sport) + '</div>';
    for(var c = 1; c <= P.walkin[sport].courts; c++){
      html += '<div class="g-row"><div class="g-label">Court ' + c + '</div><div class="g-track">';
      for(var hh = 6; hh < 24; hh++) html += '<i style="left:' + ((hh * 60 - OPEN) / SPAN * 100) + '%"></i>';
      d.blocks.forEach(function(bl){
        if((bl.sport !== 'all' && bl.sport !== sport) || (String(bl.court).toLowerCase() !== 'all' && +bl.court !== c)) return;
        html += '<button type="button" class="g-blk block" data-block="' + esc(bl.row || bl.id) + '" style="left:' + pos(bl.start) + '%;width:' + wid(bl.start, bl.end) + '%" title="Blocked: ' + esc(bl.reason) + '"><b>Blocked</b><small>' + esc(bl.reason || '') + '</small></button>';
      });
      live.filter(function(b){ return b.sport === sport && b.court === c; }).forEach(function(b){
        html += '<button type="button" class="g-blk ' + payClass(b) + (b.activity === 'Coaching' ? ' coach' : '') + '" data-ref="' + esc(b.ref) + '" style="left:' + pos(b.start) + '%;width:' + wid(b.start, b.end) + '%" title="' + esc(hm(b.start) + '–' + hm(b.end) + ' · ' + b.name + ' · ' + payLabel(b)) + '">' +
          '<b>' + esc(b.name) + '</b><small>' + hm(b.start) + '–' + hm(b.end) + (b.activity === 'Coaching' ? ' · Coaching' : '') + (b.equipment ? ' · Kit' : '') + '</small></button>';
      });
      html += '</div></div>';
    }
  });
  if(today){ var nowM = new Date().getHours() * 60 + new Date().getMinutes(); if(nowM >= OPEN) html += '<div class="g-now" style="left:calc(var(--lab) + (100% - var(--lab)) * ' + ((nowM - OPEN) / SPAN) + ')"></div>'; }
  $('#grid').innerHTML = head + '<div class="g-body">' + html + '</div>';
  // list
  var q = state.search.toLowerCase();
  var list = d.bookings.slice().sort(function(a, b){ return a.start - b.start || a.sport.localeCompare(b.sport) || a.court - b.court; })
    .filter(function(b){ return !q || [b.name, b.ref, b.whatsapp, b.email].join(' ').toLowerCase().indexOf(q) > -1; });
  $('#list').innerHTML = list.length ? list.map(function(b){
    return '<tr data-ref="' + esc(b.ref) + '" class="' + (STATUS_LIVE[b.status] ? '' : 'dim') + '"><td class="t">' + hm(b.start) + '–' + hm(b.end) + '</td><td>' + cap(b.sport) + ' ' + b.court + '</td><td>' + esc(b.activity === 'Coaching' ? 'Coaching · ' + b.coaching : 'Court') + '</td>' +
      '<td><b>' + esc(b.name) + '</b><small>' + esc(b.whatsapp || b.email || '') + '</small></td><td>' + esc(b.equipment || '–') + '</td><td class="n">' + aed(b.amount) + '</td><td><span class="ap-pay ' + payClass(b) + '">' + esc(payLabel(b)) + '</span></td><td>' + statusPill(b.status) + '</td><td class="ref">' + esc(b.ref) + '<small>' + esc(b.source || '') + '</small></td></tr>';
  }).join('') : '<tr><td colspan="9" class="empty-row">' + (q ? 'No bookings match "' + esc(state.search) + '".' : 'No bookings on this day yet.') + '</td></tr>';
}
function kpi(label, val, sub, cls){ return '<div class="kpi ' + (cls || '') + '"><span>' + label + '</span><b>' + esc(val) + '</b><small>' + esc(sub) + '</small></div>'; }
function pos(m){ return Math.max(0, (m - OPEN) / SPAN * 100); }
function wid(s, e){ return Math.max(1.2, (Math.min(e, CLOSE) - Math.max(s, OPEN)) / SPAN * 100); }

function renderMembers(){
  var rows = state.members || [], q = ($('#mSearch').value || '').toLowerCase();
  var cnt = {}; rows.forEach(function(r){ cnt[r.Status] = (cnt[r.Status] || 0) + 1; });
  $('#mKpis').innerHTML = kpi('Members', rows.length, Object.keys(cnt).map(function(k){ return cnt[k] + ' ' + k.toLowerCase(); }).join(' · ') || '–') +
    kpi('Active', cnt.Active || 0, 'Free court time applies') + kpi('Overdue', cnt.Overdue || 0, 'Payment failed: follow up', cnt.Overdue ? 'warn' : '') + kpi('To collect at club', cnt['Pay at club'] || 0, 'Activate when paid');
  var f = rows.filter(function(r){ return !q || [r.Name, r.Email, r.WhatsApp, r['Member no']].join(' ').toLowerCase().indexOf(q) > -1; });
  $('#mList').innerHTML = f.length ? f.map(function(r){
    var opts = ['Pending payment', 'Pay at club', 'Active', 'Paused', 'Overdue', 'Cancelled'].map(function(s){ return '<option' + (s === r.Status ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    return '<tr><td class="ref">' + esc(r['Member no']) + '</td><td><b>' + esc(r.Name) + '</b><small>' + esc(r.Email) + '</small></td><td>' + esc(r.Plan) + '<small>' + esc(r.Billing) + ' · ' + aed(r['Amount (AED)']) + '</small></td><td>' + esc(r.WhatsApp) + '</td><td>' + esc(r['Next renewal'] || '–') + '</td><td>' + statusPill(r.Status) + '</td>' +
      '<td><label class="sr" for="ms-' + esc(r.Ref) + '">Change status</label><select id="ms-' + esc(r.Ref) + '" data-mref="' + esc(r.Ref) + '">' + opts + '</select></td></tr>';
  }).join('') : '<tr><td colspan="7" class="empty-row">No members yet.</td></tr>';
}
function renderInterest(){
  var rows = state.interest || [];
  $('#iList').innerHTML = rows.length ? rows.map(function(r){
    var wa = String(r.WhatsApp || '').replace(/\D/g, '');
    return '<tr><td class="t">' + esc(r.Received) + '</td><td><b>' + esc(r.Name) + '</b><small>' + esc(r.Email) + '</small></td><td>' + (wa ? '<a href="https://wa.me/' + wa + '" target="_blank" rel="noopener">' + esc(r.WhatsApp) + '</a>' : '–') + '</td><td>' + esc(r['Interested in']) + '</td><td>' + esc(r.Sport) + '<small>' + esc(r.Level) + '</small></td><td>' + esc(r.Message || '') + '</td></tr>';
  }).join('') : '<tr><td colspan="6" class="empty-row">No interest forms yet.</td></tr>';
}

/* ---------------- booking drawer ---------------- */
function openBooking(ref){
  var b = state.day.bookings.filter(function(x){ return x.ref === ref; })[0]; if(!b) return;
  var wa = String(b.whatsapp || '').replace(/\D/g, '');
  $('#drawerBody').innerHTML = '<p class="ap-eyebrow">' + esc(b.ref) + ' · ' + esc(b.source || '') + '</p><h3>' + esc(b.name) + '</h3>' +
    '<dl class="ap-dl">' +
    row('When', parseYmd(b.date).toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + ' · ' + hm(b.start) + '–' + hm(b.end)) +
    row('Court', cap(b.sport) + ' court ' + b.court) + row('Booking', b.activity === 'Coaching' ? 'Coaching · ' + b.coaching : 'Court hire') +
    row('Equipment', b.equipment || 'None') + row('Amount', aed(b.amount)) + row('Payment', payLabel(b)) + row('Status', b.status) +
    row('WhatsApp', b.whatsapp || '–') + row('Email', b.email || '–') + (b.notes ? row('Notes', b.notes) : '') + '</dl>' +
    '<div class="ap-actions">' +
      (b.payment === 'Pay at club' && STATUS_LIVE[b.status] ? '<button class="btn btn-olive" type="button" data-act="paid">Mark paid at club</button>' : '') +
      (STATUS_LIVE[b.status] ? '<button class="btn btn-line" type="button" data-act="noshow">No-show</button><button class="btn btn-line danger" type="button" data-act="cancel">Cancel booking</button>' : '<button class="btn btn-line" type="button" data-act="restore">Restore booking</button>') +
      (wa ? '<a class="btn btn-line" href="https://wa.me/' + wa + '" target="_blank" rel="noopener">WhatsApp customer</a>' : '') +
    '</div><p class="ap-confirm" id="drawerConfirm" hidden></p>' +
    (b.payment === 'Card / Apple Pay (paid)' ? '<p class="ap-fine">Paid by card. If you cancel more than 24 hours ahead, refund it in Stripe → Payments, then set Payment to Refunded in the sheet.</p>' : '');
  $('#drawer').hidden = false; $('#drawer').setAttribute('data-ref', ref);
  $('#drawerClose').focus();
}
function row(k, v){ return '<div><dt>' + k + '</dt><dd>' + esc(v) + '</dd></div>'; }
function drawerAction(act){
  var ref = $('#drawer').getAttribute('data-ref'), conf = $('#drawerConfirm');
  if(act === 'cancel' && conf.hidden){ conf.hidden = false; conf.innerHTML = 'Cancel this booking and free the court? <button class="txt-btn" type="button" data-act="cancel-yes">Yes, cancel</button> <button class="txt-btn" type="button" data-act="cancel-no">Keep it</button>'; return; }
  if(act === 'cancel-no'){ conf.hidden = true; return; }
  var fields = { paid:{Payment:'Paid at club'}, noshow:{Status:'No-show'}, 'cancel-yes':{Status:'Cancelled'}, restore:{Status:'Confirmed'} }[act];
  if(!fields) return;
  update(ref, fields).then(function(j){
    if(!j.ok){ conf.hidden = false; conf.textContent = j.error || 'Could not update.'; return; }
    $('#drawer').hidden = true; toast({paid:'Marked as paid', noshow:'Marked as no-show', 'cancel-yes':'Booking cancelled', restore:'Booking restored'}[act]); refresh();
  }, function(e){ if(e.message !== 'auth'){ conf.hidden = false; conf.textContent = 'Could not reach the booking system.'; } });
}

/* ---------------- new booking / block ---------------- */
function fillTimes(sel, from, to){ var h = ''; for(var t = from; t <= to; t += 30) h += '<option value="' + hm(t) + '">' + hm(t) + '</option>'; sel.innerHTML = h; }
function syncNewForm(){
  var sport = $('#nb-sport').value, act = $('#nb-act').value, n = P.walkin[sport].courts;
  $('#nb-court').innerHTML = Array.apply(null, Array(n)).map(function(_, i){ return '<option value="' + (i + 1) + '">Court ' + (i + 1) + '</option>'; }).join('');
  $('#nb-fmtWrap').hidden = act !== 'coaching'; $('#nb-durWrap').hidden = act === 'coaching';
  var dur = act === 'coaching' ? 60 : +$('#nb-dur').value, t = toMin($('#nb-start').value || '18:00'), pay = $('#nb-pay').value;
  var price = pay === 'Member' ? 0 : act === 'coaching' ? P.coaching[$('#nb-fmt').value].single : P.walkin[sport][String(dur)][isPeak($('#nb-date').value, t) ? 'peak' : 'off'];
  $('#nb-price').textContent = aed(price) + (act !== 'coaching' ? ' · ' + (isPeak($('#nb-date').value, t) ? 'peak' : 'off-peak') : '');
}
function openNew(prefill){
  var f = $('#newForm'); f.reset(); $('#nb-err').textContent = '';
  $('#nb-date').value = state.date; fillTimes($('#nb-start'), OPEN, CLOSE - 60);
  if(prefill){ $('#nb-sport').value = prefill.sport; syncNewForm(); $('#nb-court').value = prefill.court; $('#nb-start').value = hm(prefill.start); } else { $('#nb-start').value = '18:00'; }
  syncNewForm(); $('#newModal').hidden = false; $('#nb-name').focus();
}
function submitNew(e){
  e.preventDefault();
  var act = $('#nb-act').value, sport = $('#nb-sport').value, name = $('#nb-name').value.trim();
  if(!name){ $('#nb-err').textContent = 'Add the customer name.'; return; }
  var booking = { act:act === 'coaching' ? 'coaching' : sport, sport:sport, fmt:act === 'coaching' ? $('#nb-fmt').value : null, date:$('#nb-date').value, time:$('#nb-start').value, dur:act === 'coaching' ? 60 : +$('#nb-dur').value, court:+$('#nb-court').value, extras:{} };
  var body = { booking:booking, customer:{name:name, phone:$('#nb-phone').value.trim(), email:$('#nb-email').value.trim()}, payment:$('#nb-pay').value, source:$('#nb-source').value, notes:$('#nb-notes').value.trim() };
  var btn = $('#newForm button[type="submit"]'); btn.disabled = true;
  var done = function(j){
    btn.disabled = false;
    if(!j.ok){ $('#nb-err').textContent = j.error || 'Could not save.'; return; }
    $('#newModal').hidden = true; toast('Booked · ' + j.ref); if(booking.date !== state.date){ state.date = booking.date; } refresh();
  };
  if(!LIVE){
    var s = toMin(booking.time), e2 = s + booking.dur, dd = demoDay(booking.date);
    var taken = dd.bookings.some(function(b){ return STATUS_LIVE[b.status] && b.sport === sport && b.court === booking.court && s < b.end && b.start < e2; });
    if(taken) return done({ok:false, error:'That court is already booked or blocked at that time.'});
    var ref = 'EP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    demo.extra.push({ ref:ref, date:booking.date, sport:sport, activity:act === 'coaching' ? 'Coaching' : 'Court', start:s, end:e2, court:booking.court, coaching:act === 'coaching' ? P.coaching[booking.fmt].name : '', equipment:'', name:name, email:body.customer.email, whatsapp:body.customer.phone, amount:body.payment === 'Member' ? 0 : (act === 'coaching' ? P.coaching[booking.fmt].single : P.walkin[sport][String(booking.dur)][isPeak(booking.date, s) ? 'peak' : 'off']), payment:body.payment, status:'Confirmed', source:body.source, notes:body.notes });
    return done({ok:true, ref:ref});
  }
  api('book', body).then(done, function(err){ btn.disabled = false; if(err.message !== 'auth') $('#nb-err').textContent = 'Could not reach the booking system.'; });
}
function openBlock(){
  $('#blockForm').reset(); $('#bl-err').textContent = ''; $('#bl-date').value = state.date;
  fillTimes($('#bl-start'), OPEN, CLOSE - 30); fillTimes($('#bl-end'), OPEN + 30, CLOSE - 30);
  $('#bl-end').insertAdjacentHTML('beforeend', '<option value="24:00">24:00</option>');
  $('#bl-start').value = '06:00'; $('#bl-end').value = '24:00'; syncBlockCourts(); $('#blockModal').hidden = false;
}
function syncBlockCourts(){
  var sp = $('#bl-sport').value, n = sp === 'all' ? Math.max(P.walkin.padel.courts, P.walkin.pickleball.courts) : P.walkin[sp].courts;
  $('#bl-court').innerHTML = '<option value="All">All courts</option>' + (sp === 'all' ? '' : Array.apply(null, Array(n)).map(function(_, i){ return '<option value="' + (i + 1) + '">Court ' + (i + 1) + '</option>'; }).join(''));
}
function submitBlock(e){
  e.preventDefault();
  var b = { date:$('#bl-date').value, sport:$('#bl-sport').value, court:$('#bl-court').value, start:$('#bl-start').value, end:$('#bl-end').value, reason:$('#bl-reason').value.trim() };
  if(toMin(b.end) <= toMin(b.start)){ $('#bl-err').textContent = 'End time must be after the start time.'; return; }
  if(!LIVE){ demo.blocks.push({ id:'d' + Date.now(), date:b.date, sport:b.sport, court:b.court, start:toMin(b.start), end:toMin(b.end), reason:b.reason }); $('#blockModal').hidden = true; toast('Court blocked'); refresh(); return; }
  api('block', b).then(function(j){ if(!j.ok){ $('#bl-err').textContent = j.error; return; } $('#blockModal').hidden = true; toast('Court blocked'); refresh(); }, function(){ $('#bl-err').textContent = 'Could not reach the booking system.'; });
}
function unblock(id){
  var bl = state.day.blocks.filter(function(b){ return String(b.row || b.id) === String(id); })[0]; if(!bl) return;
  $('#drawerBody').innerHTML = '<p class="ap-eyebrow">Court closure</p><h3>Blocked ' + hm(bl.start) + '–' + hm(bl.end) + '</h3><dl class="ap-dl">' + row('Sport', cap(bl.sport)) + row('Court', bl.court) + row('Reason', bl.reason || '–') + '</dl><div class="ap-actions"><button class="btn btn-line danger" type="button" id="doUnblock">Remove block</button></div>';
  $('#drawer').hidden = false;
  $('#doUnblock').addEventListener('click', function(){
    var fin = function(){ $('#drawer').hidden = true; toast('Block removed'); refresh(); };
    if(!LIVE){ demo.blocks = demo.blocks.filter(function(b){ return b.id !== bl.id; }); return fin(); }
    api('unblock', {row:bl.row, date:state.date}).then(function(j){ if(j.ok) fin(); else toast(j.error); });
  });
}

/* ---------------- shell ---------------- */
function setLoading(on){ $('#loading').hidden = !on; }
function refresh(){
  setLoading(true);
  var job = state.tab === 'day' ? loadDay() : state.tab === 'members' ? loadMembers() : loadInterest();
  return job.then(function(){ setLoading(false); $('#err').hidden = true; render(); $('#updated').textContent = 'Updated ' + hm(new Date().getHours() * 60 + new Date().getMinutes()); },
    function(e){ setLoading(false); if(e.message === 'auth') return; $('#err').hidden = false; $('#err').textContent = "Couldn't load from the booking sheet. Check the connection and press Refresh."; });
}
function signOut(msg){ sset('key', null); state.key = ''; $('#app').hidden = true; $('#gate').hidden = false; $('#gateErr').textContent = msg || ''; $('#gateKey').value = ''; $('#gateKey').focus(); }
function start(){
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#mode').innerHTML = LIVE ? '<span class="ap-live">Live · Google Sheet</span>' : '<span class="ap-demo">Preview · demo data</span>';
  refresh();
  if(LIVE) setInterval(function(){ if(document.visibilityState === 'visible' && $('#drawer').hidden && $('#newModal').hidden && $('#blockModal').hidden) refresh(); }, 60000);
}

document.addEventListener('DOMContentLoaded', function(){
  // sign-in gate
  if(!LIVE){ $('#gateHint').textContent = 'Preview mode: any password opens the demo dashboard.'; }
  $('#gateForm').addEventListener('submit', function(e){
    e.preventDefault(); var k = $('#gateKey').value.trim(); if(!k){ $('#gateErr').textContent = 'Enter the staff password.'; return; }
    state.key = k;
    if(!LIVE){ start(); return; }
    $('#gateErr').textContent = 'Checking…';
    api('ping').then(function(j){ if(j.ok){ sset('key', k); $('#gateErr').textContent = ''; start(); } }, function(e){ if(e.message !== 'auth') $('#gateErr').textContent = "Couldn't reach the booking system."; });
  });
  if(state.key && LIVE) start(); else $('#gateKey').focus();

  $$('.ap-tabs button').forEach(function(b){ b.addEventListener('click', function(){ state.tab = b.getAttribute('data-tab'); render(); refresh(); }); });
  $('#prevDay').addEventListener('click', function(){ state.date = addDays(state.date, -1); refresh(); });
  $('#nextDay').addEventListener('click', function(){ state.date = addDays(state.date, 1); refresh(); });
  $('#todayBtn').addEventListener('click', function(){ state.date = ymd(new Date()); refresh(); });
  $('#dayInput').addEventListener('change', function(e){ if(e.target.value){ state.date = e.target.value; refresh(); } });
  $('#refreshBtn').addEventListener('click', refresh);
  $('#signOutBtn').addEventListener('click', function(){ signOut(''); });
  $('#search').addEventListener('input', function(e){ state.search = e.target.value; renderDay(); });
  $('#mSearch').addEventListener('input', renderMembers);
  $('#grid').addEventListener('click', function(e){
    var b = e.target.closest('[data-ref]'); if(b){ openBooking(b.getAttribute('data-ref')); return; }
    var bl = e.target.closest('[data-block]'); if(bl){ unblock(bl.getAttribute('data-block')); return; }
    var tr = e.target.closest('.g-track'); if(tr && tr.parentNode.classList.contains('g-row')){
      var rect = tr.getBoundingClientRect(), t = OPEN + Math.floor((e.clientX - rect.left) / rect.width * SPAN / 30) * 30;
      var lbl = tr.parentNode.querySelector('.g-label').textContent;
      var r = tr.parentNode, sp = 'padel'; while(r && !r.classList.contains('g-sport')) r = r.previousElementSibling; if(r) sp = r.textContent.toLowerCase();
      openNew({sport:sp, court:+lbl.replace(/\D/g, ''), start:Math.min(t, CLOSE - 60)});
    }
  });
  $('#list').addEventListener('click', function(e){ var tr = e.target.closest('tr[data-ref]'); if(tr) openBooking(tr.getAttribute('data-ref')); });
  $('#drawer').addEventListener('click', function(e){ if(e.target === $('#drawer')) $('#drawer').hidden = true; var a = e.target.closest('[data-act]'); if(a) drawerAction(a.getAttribute('data-act')); });
  $('#drawerClose').addEventListener('click', function(){ $('#drawer').hidden = true; });
  $('#newBtn').addEventListener('click', function(){ openNew(null); });
  $('#blockBtn').addEventListener('click', openBlock);
  ['nb-sport', 'nb-act', 'nb-dur', 'nb-start', 'nb-date', 'nb-pay', 'nb-fmt'].forEach(function(id){ $('#' + id).addEventListener('change', syncNewForm); });
  $('#newForm').addEventListener('submit', submitNew);
  $('#bl-sport').addEventListener('change', syncBlockCourts);
  $('#blockForm').addEventListener('submit', submitBlock);
  $$('[data-close-modal]').forEach(function(b){ b.addEventListener('click', function(){ b.closest('.modal').hidden = true; }); });
  $('#mList').addEventListener('change', function(e){
    var s = e.target.closest('select[data-mref]'); if(!s) return;
    update(s.getAttribute('data-mref'), {Status:s.value}).then(function(j){ if(j.ok){ toast('Member updated'); refresh(); } else toast(j.error); });
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') $$('.modal').forEach(function(m){ m.hidden = true; }); });
  // coaching formats available to staff (all formats)
  $('#nb-fmt').innerHTML = Object.keys(P.coaching).map(function(k){ return '<option value="' + k + '">' + P.coaching[k].name + '</option>'; }).join('');
});
})();
