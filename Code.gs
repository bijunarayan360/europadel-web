/**
 * EUROPADEL — booking & membership backend (Google Apps Script)
 * ---------------------------------------------------------------
 * Records every website booking, membership and interest form in this
 * Google Sheet, checks court availability live, and takes card /
 * Apple Pay payments through Stripe Checkout.
 *
 * Setup: see SETUP-GUIDE.html. In short:
 *   1. Extensions → Apps Script, paste this file, Save.
 *   2. Project Settings → Script properties: add the keys listed in CONFIG below.
 *   3. Run setup() once (creates the tabs and the 5-minute checker).
 *   4. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 *   5. Put the Web app URL into config.js on the website.
 *
 * CONFIG (Script properties):
 *   SITE_URL             https://europadel.ae          (no trailing slash)
 *   STRIPE_SECRET_KEY    sk_live_...  (or sk_test_... while testing). Leave empty = pay at club only
 *   NOTIFY_EMAIL         reception@...  (gets an email for every booking; optional)
 *   CUSTOMER_EMAILS      yes / no       (send confirmation emails to customers; optional)
 *   AUTO_RELEASE_UNPAID  yes / no       (release unpaid pay-at-club bookings 15 min before start)
 *   ADMIN_KEY            staff password for the admin dashboard (admin.html). Required for the dashboard.
 */

// Prices are generated from the website's price list — keep them identical.
var PRICES = {
  "players": 4,
  "walkin": {
    "padel": {
      "120": {
        "peak": 580,
        "off": 450
      },
      "90": {
        "peak": 440,
        "off": 340
      },
      "60": {
        "peak": 320,
        "off": 240
      },
      "courts": 4
    },
    "pickleball": {
      "120": {
        "peak": 370,
        "off": 290
      },
      "90": {
        "peak": 280,
        "off": 220
      },
      "60": {
        "peak": 200,
        "off": 160
      },
      "courts": 5
    }
  },
  "membership": {
    "standard": {
      "name": "Standard",
      "monthly": 450,
      "annual": 4500,
      "free": "offpeak"
    },
    "platinum": {
      "name": "Platinum",
      "monthly": 790,
      "annual": 7900,
      "free": "any"
    },
    "business": {
      "name": "Business Club",
      "monthly": 1490,
      "annual": 14900,
      "free": "any"
    }
  },
  "coaching": {
    "private": {
      "name": "Private",
      "who": "1 player",
      "single": 400,
      "p5": 1900,
      "p10": 3600
    },
    "duo": {
      "name": "Duo",
      "who": "2 players",
      "single": 480,
      "p5": 2280,
      "p10": 4320
    },
    "group": {
      "name": "Group",
      "who": "3 players",
      "single": 520,
      "p5": 2470,
      "p10": 4680
    },
    "performance": {
      "name": "Performance Pack",
      "who": "1 player \u00b7 match play and tactics",
      "single": 500,
      "p5": 2375,
      "p10": 4500,
      "online": false
    }
  },
  "playWithCoach": 150,
  "extras": {
    "padel": [
      {
        "id": "racket",
        "name": "Padel racket hire",
        "unit": "Per racket, per session",
        "short": "racket",
        "price": 25,
        "max": 4
      },
      {
        "id": "pballs",
        "name": "Padel balls",
        "unit": "Can of 3 new balls",
        "short": "can of padel balls",
        "price": 38,
        "max": 6
      }
    ],
    "pickleball": [
      {
        "id": "paddle",
        "name": "Pickleball paddle hire",
        "unit": "Per paddle, per session",
        "short": "paddle",
        "price": 20,
        "max": 4
      },
      {
        "id": "kballs",
        "name": "Pickleball balls",
        "unit": "Pack of 3 balls",
        "short": "pack of pickleballs",
        "price": 30,
        "max": 6
      }
    ]
  }
};

var OPEN_MIN = 6 * 60, CLOSE_MIN = 24 * 60, HOLD_MINUTES = 30, MAX_DAYS_AHEAD = 60;

var BK = ['Ref', 'Created', 'Date', 'Sport', 'Activity', 'Start', 'End', 'Minutes', 'Court', 'Coaching', 'Equipment',
          'Name', 'Email', 'WhatsApp', 'Amount (AED)', 'Payment', 'Status', 'Hold until', 'Stripe session', 'Source', 'Notes'];
var MB = ['Ref', 'Member no', 'Joined', 'Name', 'Email', 'WhatsApp', 'Plan', 'Billing', 'Amount (AED)', 'Payment', 'Status',
          'Next renewal', 'Hold until', 'Stripe session', 'Stripe subscription', 'Notes'];
var IN = ['Received', 'Name', 'Email', 'WhatsApp', 'Interested in', 'Sport', 'Level', 'Message'];
var BL = ['Date', 'Sport', 'Court', 'Start', 'End', 'Reason'];

var BOOKING_STATUS = ['Pending payment', 'Confirmed', 'Cancelled', 'Expired', 'No-show', 'Released (unpaid)'];
var PAYMENT_TYPES = ['Card / Apple Pay (paid)', 'Card / Apple Pay (pending)', 'Pay at club', 'Paid at club', 'Member', 'Refunded'];
var MEMBER_STATUS = ['Pending payment', 'Pay at club', 'Active', 'Paused', 'Overdue', 'Cancelled', 'Expired'];

/* ================= web endpoints ================= */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'slots') return out_(slots_(p.date, p.sport));
    if (p.action === 'confirm') return out_(confirm_(p.ref));
    if (p.action === 'config') return out_({ ok: true, card: !!cfg_('STRIPE_SECRET_KEY', '') });
    return out_({ ok: true, service: 'Europadel bookings' });
  } catch (err) { return out_({ ok: false, error: msg_(err) }); }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'book') return out_(book_(body));
    if (body.action === 'join') return out_(join_(body));
    if (body.action === 'interest') return out_(interest_(body));
    if (body.action === 'release') return out_(release_(body.ref));
    if (body.action === 'admin') return out_(admin_(body));
    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) { return out_({ ok: false, error: msg_(err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function msg_(err) { return String((err && err.message) || err); }
function cfg_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return (v === null || v === undefined || v === '') ? d : v; }

/* ================= sheet helpers ================= */

function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Dubai'; }
function sheet_(name, head) {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (head && sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}
function readAll_(name, head) {
  var sh = sheet_(name, head), last = sh.getLastRow();
  if (last < 2) return { sh: sh, rows: [] };
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var rows = vals.map(function (r, i) { var o = { _row: i + 2 }; head.forEach(function (h, j) { o[h] = r[j]; }); return o; });
  return { sh: sh, rows: rows };
}
function setCells_(sh, head, rowNo, obj) {
  Object.keys(obj).forEach(function (k) { var c = head.indexOf(k); if (c > -1) sh.getRange(rowNo, c + 1).setValue(obj[k]); });
}
function pad_(n) { return (n < 10 ? '0' : '') + n; }
function hm_(m) { return pad_(Math.floor(m / 60)) + ':' + pad_(m % 60); }

// Dates and times typed by reception may be text or real Sheets dates — accept both.
function asDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var s = String(v || '').trim(), m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return m[1] + '-' + pad_(+m[2]) + '-' + pad_(+m[3]);
  if ((m = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/.exec(s))) return m[3] + '-' + pad_(+m[2]) + '-' + pad_(+m[1]); // dd/mm/yyyy
  return s;
}
function asMin_(v) {
  if (v instanceof Date) { var t = Utilities.formatDate(v, tz_(), 'HH:mm').split(':'); return (+t[0]) * 60 + (+t[1]); }
  if (typeof v === 'number' && v < 1) return Math.round(v * 24 * 60);
  var s = String(v || '').trim().toLowerCase(), m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return NaN;
  var h = +m[1], mi = +(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h === 24 && mi === 0) return 24 * 60;
  return h * 60 + mi;
}
function nowParts_() {
  var d = new Date(), z = tz_();
  return { date: Utilities.formatDate(d, z, 'yyyy-MM-dd'), min: (+Utilities.formatDate(d, z, 'H')) * 60 + (+Utilities.formatDate(d, z, 'm')), ms: d.getTime() };
}
function dayOfWeek_(dateStr) { var a = dateStr.split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay(); }
function addDays_(dateStr, n) { var a = dateStr.split('-'), d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n)); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()); }
function ref_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 6).toUpperCase(); }
function cap_(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

/* ================= pricing (same rules as the website) ================= */

function isPeak_(dateStr, startMin) {
  var d = dayOfWeek_(dateStr);
  if (d === 0 || d === 6) return true;          // Saturday, Sunday
  if (d === 5) return startMin >= 15 * 60;      // Friday from 3 PM
  return startMin >= 17 * 60;                   // Mon–Thu from 5 PM
}
function extrasList_(sport, extras) {
  var out = [];
  (PRICES.extras[sport] || []).forEach(function (x) {
    var q = Math.floor(+((extras || {})[x.id]) || 0);
    if (q < 0 || q > x.max) throw new Error('Too many ' + x.name.toLowerCase() + '.');
    if (q > 0) out.push({ id: x.id, name: x.name, qty: q, total: q * x.price });
  });
  return out;
}
function courtPrice_(b) {
  if (b.act === 'coaching') return PRICES.coaching[b.fmt].single;
  var r = PRICES.walkin[b.act][String(b.dur)];
  return isPeak_(b.date, b.start) ? r.peak : r.off;
}

/* ================= availability ================= */

function busy_(date, sport) {
  var list = [], nowMs = Date.now();
  readAll_('Bookings', BK).rows.forEach(function (r) {
    if (asDate_(r.Date) !== date || String(r.Sport).toLowerCase() !== sport) return;
    var st = String(r.Status);
    var hold = r['Hold until'] instanceof Date ? r['Hold until'].getTime() : Date.parse(r['Hold until']);
    var live = st === 'Confirmed' || (st === 'Pending payment' && hold > nowMs);
    if (!live) return;
    var s = asMin_(r.Start), e = asMin_(r.End);
    if (isNaN(e)) e = s + (+r.Minutes || 60);
    if (!isNaN(s)) list.push({ court: +r.Court, start: s, end: e });
  });
  readAll_('Blocks', BL).rows.forEach(function (r) {
    if (asDate_(r.Date) !== date) return;
    var sp = String(r.Sport || 'All').toLowerCase();
    if (sp !== 'all' && sp !== sport) return;
    var s = asMin_(r.Start), e = asMin_(r.End);
    if (isNaN(s)) s = OPEN_MIN;
    if (isNaN(e)) e = CLOSE_MIN;
    var courts = String(r.Court || 'All').toLowerCase() === 'all' ? range_(PRICES.walkin[sport].courts) : [+r.Court];
    courts.forEach(function (c) { list.push({ court: c, start: s, end: e, block: true }); });
  });
  return list;
}
function range_(n) { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; }
function slots_(date, sport) {
  date = asDate_(date); sport = String(sport || '').toLowerCase();
  if (!PRICES.walkin[sport]) throw new Error('Unknown sport');
  return { ok: true, date: date, sport: sport, busy: busy_(date, sport).map(function (b) { return { court: b.court, start: b.start, end: b.end }; }) };
}
function clash_(date, sport, court, start, end) {
  return busy_(date, sport).some(function (b) { return b.court === court && start < b.end && b.start < end; });
}

/* ================= members ================= */

function activeMember_(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return null;
  var hit = null;
  readAll_('Members', MB).rows.forEach(function (r) { if (String(r.Email).toLowerCase().trim() === email && r.Status === 'Active') hit = r; });
  return hit;
}
function memberFree_(email, b) {
  if (b.act === 'coaching' || b.dur > 90) return '';
  var m = activeMember_(email); if (!m) return '';
  var key = Object.keys(PRICES.membership).filter(function (k) { return PRICES.membership[k].name === m.Plan; })[0];
  if (!key) return '';
  var already = readAll_('Bookings', BK).rows.some(function (r) {
    return asDate_(r.Date) === b.date && String(r.Email).toLowerCase().trim() === String(email).toLowerCase().trim() && r.Payment === 'Member' && r.Status === 'Confirmed';
  });
  if (already) return '';
  var t = PRICES.membership[key];
  if (t.free === 'any') return t.name;
  var wd = dayOfWeek_(b.date);
  if (wd >= 1 && wd <= 5 && b.start + b.dur <= 17 * 60) return t.name;
  return '';
}

/* ================= booking ================= */

function cleanCustomer_(c) {
  c = c || {};
  var name = String(((c.first || '') + ' ' + (c.last || '')).trim() || c.name || '').trim();
  var email = String(c.email || '').trim(), phone = String(c.phone || '').trim();
  if (!name) throw new Error('Please add your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Please add a valid email.');
  if (phone.replace(/\D/g, '').length < 9) throw new Error('Please add your WhatsApp number.');
  return { name: name, email: email, phone: phone };
}

function validateBooking_(raw, staff) {
  var b = {
    act: String(raw.act || ''), sport: String(raw.sport || raw.act || '').toLowerCase(), fmt: raw.fmt || null,
    date: asDate_(raw.date), start: asMin_(raw.time), dur: +raw.dur, court: +raw.court, extras: raw.extras || {}
  };
  if (b.act === 'coaching') {
    if (!PRICES.coaching[b.fmt] || (!staff && PRICES.coaching[b.fmt].online === false)) throw new Error('This coaching session cannot be booked online.');
    b.dur = 60;
  } else {
    if (!PRICES.walkin[b.act]) throw new Error('Unknown activity.');
    b.sport = b.act;
    if (!PRICES.walkin[b.act][String(b.dur)]) throw new Error('Choose 60, 90 or 120 minutes.');
  }
  if (!PRICES.walkin[b.sport]) throw new Error('Unknown sport.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) throw new Error('Invalid date.');
  if (isNaN(b.start) || b.start % 30 !== 0 || b.start < OPEN_MIN || b.start + b.dur > CLOSE_MIN) throw new Error('That time is outside opening hours.');
  if (!(b.court >= 1 && b.court <= PRICES.walkin[b.sport].courts)) throw new Error('Unknown court.');
  var now = nowParts_();
  if (!staff && (b.date < now.date || (b.date === now.date && b.start <= now.min + 15))) throw new Error('That time has already passed.');
  if (b.date > addDays_(now.date, MAX_DAYS_AHEAD)) throw new Error('Bookings open ' + MAX_DAYS_AHEAD + ' days ahead.');
  b.extrasList = extrasList_(b.sport, b.extras);
  return b;
}

function book_(body) {
  var b = validateBooking_(body.booking || {}), c = cleanCustomer_(body.customer);
  var pay = body.pay === 'card' ? 'card' : 'club';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (clash_(b.date, b.sport, b.court, b.start, b.start + b.dur)) return { ok: false, error: 'taken' };
    var perk = memberFree_(c.email, b);
    var court = perk ? 0 : courtPrice_(b);
    var extras = b.extrasList.reduce(function (s, x) { return s + x.total; }, 0);
    var amount = court + extras;
    var ref = ref_('EP-');
    var row = {
      'Ref': ref, 'Created': new Date(), 'Date': b.date, 'Sport': cap_(b.sport), 'Activity': b.act === 'coaching' ? 'Coaching' : 'Court',
      'Start': hm_(b.start), 'End': hm_(b.start + b.dur), 'Minutes': b.dur, 'Court': b.court,
      'Coaching': b.act === 'coaching' ? PRICES.coaching[b.fmt].name : '',
      'Equipment': b.extrasList.map(function (x) { return x.qty + ' × ' + x.name; }).join(', '),
      'Name': c.name, 'Email': c.email, 'WhatsApp': c.phone, 'Amount (AED)': amount,
      'Payment': '', 'Status': '', 'Hold until': '', 'Stripe session': '', 'Source': 'Website',
      'Notes': perk ? 'Free session on ' + perk + ' membership — check member card' : ''
    };
    var result = { ok: true, ref: ref, amount: amount, member: perk || '' };
    if (amount === 0) { row.Payment = 'Member'; row.Status = 'Confirmed'; result.status = 'Confirmed'; }
    else if (pay === 'club') { row.Payment = 'Pay at club'; row.Status = 'Confirmed'; result.status = 'Confirmed'; }
    else {
      if (!cfg_('STRIPE_SECRET_KEY', '')) throw new Error('Card payments are not switched on yet. Please choose pay at the club.');
      var label = (b.act === 'coaching' ? cap_(b.sport) + ' coaching · ' + PRICES.coaching[b.fmt].name : cap_(b.sport) + ' court ' + b.court) +
                  ' · ' + b.date + ' ' + hm_(b.start) + '–' + hm_(b.start + b.dur) + (row.Equipment ? ' · ' + row.Equipment : '');
      var session = checkout_(ref, label, amount, c.email, 'payment');
      row.Payment = 'Card / Apple Pay (pending)'; row.Status = 'Pending payment';
      row['Hold until'] = new Date(Date.now() + HOLD_MINUTES * 60000); row['Stripe session'] = session.id;
      result.status = 'Pending payment'; result.url = session.url;
    }
    var sh = sheet_('Bookings', BK);
    sh.appendRow(BK.map(function (h) { return row[h]; }));
    if (row.Status === 'Confirmed') notifyBooking_(row);
    return result;
  } finally { lock.releaseLock(); }
}

/* ================= membership ================= */

function join_(body) {
  var tier = String(body.tier || ''), billing = body.billing === 'annual' ? 'annual' : 'monthly';
  var t = PRICES.membership[tier]; if (!t) throw new Error('Unknown membership plan.');
  var c = cleanCustomer_(body.customer), pay = body.pay === 'card' ? 'card' : 'club';
  var amount = billing === 'annual' ? t.annual : t.monthly;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var all = readAll_('Members', MB);
    var ref = ref_('M-'), no = 'EP' + (100001 + all.rows.length);
    var row = { 'Ref': ref, 'Member no': no, 'Joined': new Date(), 'Name': c.name, 'Email': c.email, 'WhatsApp': c.phone,
                'Plan': t.name, 'Billing': billing === 'annual' ? 'Yearly' : 'Monthly', 'Amount (AED)': amount,
                'Payment': '', 'Status': '', 'Next renewal': '', 'Hold until': '', 'Stripe session': '', 'Stripe subscription': '', 'Notes': '' };
    var result = { ok: true, ref: ref, memberNo: no, amount: amount };
    if (pay === 'club') { row.Payment = 'Pay at club'; row.Status = 'Pay at club'; result.status = 'Pay at club'; }
    else {
      if (!cfg_('STRIPE_SECRET_KEY', '')) throw new Error('Card payments are not switched on yet. Please choose pay at the club.');
      var s = checkout_(ref, 'Europadel ' + t.name + ' membership (' + (billing === 'annual' ? 'yearly' : 'monthly') + ')', amount, c.email,
                        billing === 'annual' ? 'payment' : 'subscription');
      row.Payment = 'Card / Apple Pay (pending)'; row.Status = 'Pending payment';
      row['Hold until'] = new Date(Date.now() + HOLD_MINUTES * 60000); row['Stripe session'] = s.id;
      result.status = 'Pending payment'; result.url = s.url;
    }
    all.sh.appendRow(MB.map(function (h) { return row[h]; }));
    if (row.Status !== 'Pending payment') notifyMember_(row);
    return result;
  } finally { lock.releaseLock(); }
}

/* ================= interest form ================= */

function interest_(body) {
  var c = cleanCustomer_(body.customer || body);
  sheet_('Interest', IN).appendRow([new Date(), c.name, c.email, c.phone, (body.interests || []).join(', '), body.sport || '', body.level || '', String(body.msg || '').slice(0, 1000)]);
  var to = cfg_('NOTIFY_EMAIL', '');
  if (to) try { MailApp.sendEmail(to, 'New interest: ' + c.name, c.name + '\n' + c.email + '\n' + c.phone + '\nInterested in: ' + (body.interests || []).join(', ') + '\n\n' + (body.msg || '')); } catch (e) {}
  return { ok: true };
}

/* ================= Stripe ================= */

function checkout_(ref, label, amountAed, email, mode) {
  var site = cfg_('SITE_URL', '').replace(/\/$/, '');
  if (!site) throw new Error('SITE_URL is not set in Script properties.');
  var line = { price_data: { currency: 'aed', unit_amount: Math.round(amountAed * 100), product_data: { name: label } }, quantity: 1 };
  if (mode === 'subscription') line.price_data.recurring = { interval: 'month' };
  var params = {
    mode: mode, line_items: [line], customer_email: email, client_reference_id: ref, metadata: { ref: ref },
    success_url: site + '/checkout.html#paid-' + ref, cancel_url: site + '/checkout.html#cancelled-' + ref,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60 + 60
  };
  if (mode === 'payment') params.payment_intent_data = { metadata: { ref: ref } };
  else params.subscription_data = { metadata: { ref: ref } };
  return stripe_('post', 'checkout/sessions', params);
}
function stripe_(method, path, params) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + cfg_('STRIPE_SECRET_KEY', '') }, muteHttpExceptions: true };
  if (params) { opt.payload = form_(params); opt.contentType = 'application/x-www-form-urlencoded'; }
  var r = UrlFetchApp.fetch('https://api.stripe.com/v1/' + path, opt), j = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() >= 300) throw new Error((j.error && j.error.message) || 'Payment provider error');
  return j;
}
function form_(obj, prefix, outArr) {
  outArr = outArr || [];
  Object.keys(obj).forEach(function (k) {
    var v = obj[k], key = prefix ? prefix + '[' + k + ']' : k;
    if (v === null || v === undefined) return;
    if (typeof v === 'object') form_(v, key, outArr);
    else outArr.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  });
  return prefix ? outArr : outArr.join('&');
}

/* ================= confirm / release / sweep ================= */

function find_(ref) {
  var tabs = [['Bookings', BK], ['Members', MB]];
  for (var i = 0; i < tabs.length; i++) {
    var all = readAll_(tabs[i][0], tabs[i][1]);
    for (var j = 0; j < all.rows.length; j++) if (all.rows[j].Ref === ref) return { tab: tabs[i][0], head: tabs[i][1], sh: all.sh, row: all.rows[j] };
  }
  return null;
}
function settle_(f) {
  // Ask Stripe whether a pending checkout was paid; update the sheet. Returns the row's status.
  var r = f.row;
  if (r.Status !== 'Pending payment' || !r['Stripe session']) return r.Status;
  var s = stripe_('get', 'checkout/sessions/' + encodeURIComponent(r['Stripe session']));
  var paid = s.payment_status === 'paid' || (s.mode === 'subscription' && s.status === 'complete');
  if (paid) {
    if (f.tab === 'Bookings') {
      setCells_(f.sh, f.head, r._row, { 'Status': 'Confirmed', 'Payment': 'Card / Apple Pay (paid)', 'Hold until': '' });
      r.Status = 'Confirmed'; r.Payment = 'Card / Apple Pay (paid)'; notifyBooking_(r);
    } else {
      var next = r.Billing === 'Yearly' ? addDays_(nowParts_().date, 365) : addDays_(nowParts_().date, 30);
      setCells_(f.sh, f.head, r._row, { 'Status': 'Active', 'Payment': 'Card / Apple Pay (paid)', 'Hold until': '', 'Next renewal': next, 'Stripe subscription': s.subscription || '' });
      r.Status = 'Active'; notifyMember_(r);
    }
    return f.tab === 'Bookings' ? 'Confirmed' : 'Active';
  }
  var hold = r['Hold until'] instanceof Date ? r['Hold until'].getTime() : Date.parse(r['Hold until']);
  if (s.status === 'expired' || hold < Date.now()) {
    setCells_(f.sh, f.head, r._row, { 'Status': 'Expired', 'Payment': '', 'Hold until': '' });
    try { if (s.status === 'open') stripe_('post', 'checkout/sessions/' + encodeURIComponent(r['Stripe session']) + '/expire'); } catch (e) {}
    return 'Expired';
  }
  return 'Pending payment';
}
function confirm_(ref) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var f = find_(String(ref || '')); if (!f) return { ok: false, error: 'Booking not found' };
    var status = settle_(f), r = f.row;
    return { ok: true, ref: r.Ref, kind: f.tab === 'Bookings' ? 'booking' : 'membership', status: status, amount: r['Amount (AED)'], memberNo: r['Member no'] || '' };
  } finally { lock.releaseLock(); }
}
function release_(ref) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var f = find_(String(ref || '')); if (!f) return { ok: false, error: 'Booking not found' };
    if (settle_(f) === 'Pending payment') {
      setCells_(f.sh, f.head, f.row._row, { 'Status': 'Expired', 'Payment': '', 'Hold until': '' });
      try { stripe_('post', 'checkout/sessions/' + encodeURIComponent(f.row['Stripe session']) + '/expire'); } catch (e) {}
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Runs every 5 minutes (installed by setup): settles card payments and frees expired holds. */
function sweep() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return;
  try {
    [['Bookings', BK], ['Members', MB]].forEach(function (t) {
      var all = readAll_(t[0], t[1]);
      all.rows.forEach(function (r) {
        if (r.Status === 'Pending payment' && r['Stripe session']) { try { settle_({ tab: t[0], head: t[1], sh: all.sh, row: r }); } catch (e) {} }
      });
    });
    if (cfg_('AUTO_RELEASE_UNPAID', 'no') === 'yes') {
      var now = nowParts_(), all = readAll_('Bookings', BK);
      all.rows.forEach(function (r) {
        if (r.Status === 'Confirmed' && r.Payment === 'Pay at club' && asDate_(r.Date) === now.date && asMin_(r.Start) - now.min <= 15) {
          setCells_(all.sh, BK, r._row, { 'Status': 'Released (unpaid)' });
        }
      });
    }
  } finally { lock.releaseLock(); }
}

/** Runs daily: keeps monthly memberships in step with Stripe (renewals, failed payments, cancellations). */
function syncMembers() {
  if (!cfg_('STRIPE_SECRET_KEY', '')) return;
  var all = readAll_('Members', MB);
  all.rows.forEach(function (r) {
    if (!r['Stripe subscription'] || r.Status === 'Cancelled' || r.Status === 'Paused') return;
    try {
      var s = stripe_('get', 'subscriptions/' + encodeURIComponent(r['Stripe subscription']));
      var map = { active: 'Active', trialing: 'Active', past_due: 'Overdue', unpaid: 'Overdue', canceled: 'Cancelled', incomplete_expired: 'Expired' };
      var st = map[s.status] || r.Status;
      var next = s.current_period_end ? Utilities.formatDate(new Date(s.current_period_end * 1000), tz_(), 'yyyy-MM-dd') : r['Next renewal'];
      setCells_(all.sh, MB, r._row, { 'Status': st, 'Next renewal': next });
    } catch (e) {}
  });
}

/* ================= notifications ================= */

function notifyBooking_(r) {
  var lines = [r.Ref, (r.Activity === 'Coaching' ? r.Sport + ' coaching · ' + r.Coaching : r.Sport + ' court ' + r.Court), asDate_(r.Date) + ' ' + r.Start + '–' + r.End,
               r.Equipment ? 'Equipment: ' + r.Equipment : '', 'Amount: AED ' + r['Amount (AED)'] + ' · ' + r.Payment, r.Name + ' · ' + r.WhatsApp + ' · ' + r.Email].filter(String).join('\n');
  var to = cfg_('NOTIFY_EMAIL', '');
  if (to) try { MailApp.sendEmail(to, 'New booking ' + r.Ref + ' · ' + asDate_(r.Date) + ' ' + r.Start, lines); } catch (e) {}
  if (cfg_('CUSTOMER_EMAILS', 'no') === 'yes' && r.Email) try {
    MailApp.sendEmail(r.Email, 'Europadel booking confirmed · ' + r.Ref, 'Thank you for booking with Europadel.\n\n' + lines +
      '\n\nFree cancellation up to 24 hours before your start time. Questions: WhatsApp +971 52 539 2908.\n\nEuropadel · Dubai Investment Park 1, Plot 598-389');
  } catch (e) {}
}
function notifyMember_(r) {
  var lines = r.Ref + '\n' + r.Plan + ' membership (' + r.Billing + ')\nMember no: ' + r['Member no'] + '\n' + r.Name + ' · ' + r.WhatsApp + ' · ' + r.Email + '\nAED ' + r['Amount (AED)'] + ' · ' + r.Status;
  var to = cfg_('NOTIFY_EMAIL', '');
  if (to) try { MailApp.sendEmail(to, 'New member ' + r['Member no'] + ' · ' + r.Plan, lines); } catch (e) {}
}

/* ================= admin dashboard (admin.html) ================= */

function admin_(body) {
  var key = cfg_('ADMIN_KEY', '');
  if (!key || String(body.key || '') !== key) return { ok: false, error: 'auth' };
  var op = body.op;
  if (op === 'ping') return { ok: true };
  if (op === 'day') return adminDay_(asDate_(body.date));
  if (op === 'members') return { ok: true, rows: readAll_('Members', MB).rows.map(plain_) };
  if (op === 'interest') return { ok: true, rows: readAll_('Interest', IN).rows.map(plain_).reverse() };
  if (op === 'update') return adminUpdate_(String(body.ref || ''), body.fields || {});
  if (op === 'book') return adminBook_(body);
  if (op === 'block') return adminBlock_(body);
  if (op === 'unblock') return adminUnblock_(body);
  if (op === 'range') return adminRange_(asDate_(body.from), asDate_(body.to));
  return { ok: false, error: 'Unknown admin action' };
}
function plain_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { var v = r[k]; o[k] = v instanceof Date ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm') : v; });
  return o;
}
function bookingOut_(r) {
  var s = asMin_(r.Start), e = asMin_(r.End);
  if (isNaN(e)) e = s + (+r.Minutes || 60);
  return { ref: r.Ref, date: asDate_(r.Date), sport: String(r.Sport).toLowerCase(), activity: r.Activity, start: s, end: e, court: +r.Court,
           coaching: r.Coaching, equipment: r.Equipment, name: r.Name, email: r.Email, whatsapp: String(r.WhatsApp || ''),
           amount: +r['Amount (AED)'] || 0, payment: r.Payment, status: r.Status, source: r.Source, notes: r.Notes,
           created: r.Created instanceof Date ? Utilities.formatDate(r.Created, tz_(), 'yyyy-MM-dd HH:mm') : String(r.Created || '') };
}
function adminDay_(date) {
  var bookings = readAll_('Bookings', BK).rows.filter(function (r) { return asDate_(r.Date) === date; }).map(bookingOut_);
  var blocks = readAll_('Blocks', BL).rows.filter(function (r) { return asDate_(r.Date) === date; }).map(function (r) {
    var s = asMin_(r.Start), e = asMin_(r.End);
    return { row: r._row, sport: String(r.Sport || 'All').toLowerCase(), court: String(r.Court || 'All'), start: isNaN(s) ? OPEN_MIN : s, end: isNaN(e) ? CLOSE_MIN : e, reason: r.Reason };
  });
  return { ok: true, date: date, bookings: bookings, blocks: blocks };
}
function adminRange_(from, to) {
  var rows = readAll_('Bookings', BK).rows.filter(function (r) { var d = asDate_(r.Date); return d >= from && d <= to; }).map(bookingOut_);
  return { ok: true, from: from, to: to, bookings: rows };
}
function adminUpdate_(ref, fields) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var f = find_(ref); if (!f) return { ok: false, error: 'Not found' };
    var allowed = f.tab === 'Bookings' ? { Status: BOOKING_STATUS, Payment: PAYMENT_TYPES } : { Status: MEMBER_STATUS, Payment: PAYMENT_TYPES };
    var set = {};
    Object.keys(fields).forEach(function (k) {
      if (k === 'Notes') set.Notes = String(fields.Notes).slice(0, 500);
      else if (allowed[k] && allowed[k].indexOf(fields[k]) > -1) set[k] = fields[k];
    });
    if (set.Status === 'Confirmed' && f.tab === 'Bookings' && f.row.Status !== 'Confirmed') {
      var r = f.row, s = asMin_(r.Start), e = asMin_(r.End);
      if (clash_(asDate_(r.Date), String(r.Sport).toLowerCase(), +r.Court, s, isNaN(e) ? s + (+r.Minutes || 60) : e)) return { ok: false, error: 'That court is now taken by another booking.' };
    }
    setCells_(f.sh, f.head, f.row._row, set);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function adminBook_(body) {
  var b = validateBooking_(body.booking || {}, true);
  var c = body.customer || {};
  var name = String(c.name || '').trim(); if (!name) throw new Error('Add the customer name.');
  var payment = ['Pay at club', 'Paid at club', 'Member'].indexOf(body.payment) > -1 ? body.payment : 'Pay at club';
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (clash_(b.date, b.sport, b.court, b.start, b.start + b.dur)) return { ok: false, error: 'That court is already booked or blocked at that time.' };
    var amount = payment === 'Member' ? 0 : courtPrice_(b);
    amount += b.extrasList.reduce(function (s, x) { return s + x.total; }, 0);
    var ref = ref_('EP-');
    var row = { 'Ref': ref, 'Created': new Date(), 'Date': b.date, 'Sport': cap_(b.sport), 'Activity': b.act === 'coaching' ? 'Coaching' : 'Court',
      'Start': hm_(b.start), 'End': hm_(b.start + b.dur), 'Minutes': b.dur, 'Court': b.court, 'Coaching': b.act === 'coaching' ? PRICES.coaching[b.fmt].name : '',
      'Equipment': b.extrasList.map(function (x) { return x.qty + ' × ' + x.name; }).join(', '), 'Name': name, 'Email': String(c.email || ''), 'WhatsApp': String(c.phone || ''),
      'Amount (AED)': amount, 'Payment': payment, 'Status': 'Confirmed', 'Hold until': '', 'Stripe session': '',
      'Source': ['Phone', 'WhatsApp', 'Walk-in'].indexOf(body.source) > -1 ? body.source : 'Phone', 'Notes': String(body.notes || '').slice(0, 500) };
    sheet_('Bookings', BK).appendRow(BK.map(function (h) { return row[h]; }));
    return { ok: true, ref: ref, amount: amount };
  } finally { lock.releaseLock(); }
}
function adminBlock_(body) {
  var date = asDate_(body.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a date.');
  var sport = ['all', 'padel', 'pickleball'].indexOf(String(body.sport).toLowerCase()) > -1 ? cap_(String(body.sport).toLowerCase()) : 'All';
  var court = String(body.court || 'All'), s = body.start ? asMin_(body.start) : NaN, e = body.end ? asMin_(body.end) : NaN;
  sheet_('Blocks', BL).appendRow([date, sport, court === 'All' ? 'All' : +court, isNaN(s) ? '' : hm_(s), isNaN(e) ? '' : hm_(e), String(body.reason || '').slice(0, 200)]);
  return { ok: true };
}
function adminUnblock_(body) {
  var all = readAll_('Blocks', BL), row = +body.row;
  var hit = all.rows.filter(function (r) { return r._row === row; })[0];
  if (!hit || asDate_(hit.Date) !== asDate_(body.date)) return { ok: false, error: 'Block not found. Refresh and try again.' };
  all.sh.deleteRow(row);
  return { ok: true };
}

/* ================= one-time setup ================= */

/** Run once from the Apps Script editor. Creates the tabs, formats and the automatic checkers. */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Asia/Dubai');
  var bk = sheet_('Bookings', BK), mb = sheet_('Members', MB), bl = sheet_('Blocks', BL);
  sheet_('Interest', IN);
  // keep dates and times as plain text so reception can type 2026-10-12 and 18:00
  ['Date', 'Start', 'End'].forEach(function (h) { bk.getRange(2, BK.indexOf(h) + 1, bk.getMaxRows() - 1, 1).setNumberFormat('@'); });
  ['Date', 'Start', 'End'].forEach(function (h) { bl.getRange(2, BL.indexOf(h) + 1, bl.getMaxRows() - 1, 1).setNumberFormat('@'); });
  var dv = function (list) { return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build(); };
  bk.getRange(2, BK.indexOf('Status') + 1, bk.getMaxRows() - 1, 1).setDataValidation(dv(BOOKING_STATUS));
  bk.getRange(2, BK.indexOf('Payment') + 1, bk.getMaxRows() - 1, 1).setDataValidation(dv(PAYMENT_TYPES));
  bk.getRange(2, BK.indexOf('Sport') + 1, bk.getMaxRows() - 1, 1).setDataValidation(dv(['Padel', 'Pickleball']));
  bk.getRange(2, BK.indexOf('Activity') + 1, bk.getMaxRows() - 1, 1).setDataValidation(dv(['Court', 'Coaching']));
  bk.getRange(2, BK.indexOf('Source') + 1, bk.getMaxRows() - 1, 1).setDataValidation(dv(['Website', 'Phone', 'WhatsApp', 'Walk-in']));
  mb.getRange(2, MB.indexOf('Status') + 1, mb.getMaxRows() - 1, 1).setDataValidation(dv(MEMBER_STATUS));
  bl.getRange(2, BL.indexOf('Sport') + 1, bl.getMaxRows() - 1, 1).setDataValidation(dv(['All', 'Padel', 'Pickleball']));
  // Today tab: live list of today's bookings for reception
  var today = ss.getSheetByName('Today') || ss.insertSheet('Today', 0);
  today.clear();
  today.getRange('A1').setFormula('=QUERY(Bookings!A:U,"select F,G,D,I,E,J,K,L,N,O,P,Q,A where C = \'"&TEXT(TODAY(),"yyyy-mm-dd")&"\' and Q <> \'Cancelled\' and Q <> \'Expired\' order by D, I, F",1)');
  today.setFrozenRows(1);
  // automatic checkers
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sweep').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncMembers').timeBased().everyDays(1).atHour(4).create();
  return 'Setup complete';
}
