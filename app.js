/* Құлаққа кітап — сайттың негізгі коды */
(function () {
  "use strict";

  var cfg = window.KK_CONFIG || {};
  var configured = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);
  var sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  var BUCKET = "media";
  var MAX_BYTES = 50 * 1024 * 1024;

  var TOPICS = ["Әңгіме", "Өсиет", "Ертегі", "Тарих", "Салт-дәстүр", "Басқа"];
  var TABS = [
    { id: "angimeler", name: "Әңгімелер", key: "stories" },
    { id: "suretter", name: "Ескі суреттер", key: "photos" },
    { id: "sozdik", name: "Көне сөздер", key: "words" }
  ];

  var data = { stories: [], photos: [], words: [] };
  var ui = {
    tab: "angimeler", topic: "Барлығы", q: "",
    loading: configured, loadError: false,
    adding: null, busy: false, msg: "", err: false, progress: -1,
    role: null, loginOpen: false, loginMsg: "", loginBusy: false,
    confirmDel: null, lightbox: null
  };
  var app = document.getElementById("app");

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDate(d) {
    if (!d) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? m[3] + "." + m[2] + "." + m[1] : "";
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function safeLink(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function uid() {
    try { return crypto.randomUUID(); } catch (e) { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  }
  function mediaUrl(path) {
    return cfg.supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/public/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/");
  }
  function siteUrl() { return location.origin + location.pathname.replace(/index\.html$/, ""); }
  function canAdd() { return !!ui.role; }
  function isTeacher() { return ui.role === "teacher"; }
  function match(fields) {
    var q = ui.q.trim().toLowerCase();
    return !q || fields.join(" ").toLowerCase().indexOf(q) > -1;
  }
  function storyById(id) {
    for (var i = 0; i < data.stories.length; i++) if (data.stories[i].id === id) return data.stories[i];
    return null;
  }
  function curKey() {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === ui.tab) return TABS[i].key;
    return "stories";
  }

  var ORN = '<svg class="orn" width="168" height="18" viewBox="0 0 168 18" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
    [0, 42, 84, 126].map(function (x) {
      return '<path d="M' + (x + 4) + ' 16 C' + (x + 4) + ' 4 ' + (x + 18) + ' 2 ' + (x + 18) + ' 9 C' + (x + 18) + ' 13 ' + (x + 13) + ' 13 ' + (x + 13) + ' 9 M' + (x + 38) + ' 16 C' + (x + 38) + ' 4 ' + (x + 24) + ' 2 ' + (x + 24) + ' 9 C' + (x + 24) + ' 13 ' + (x + 29) + ' 13 ' + (x + 29) + ' 9 M' + (x + 4) + ' 16 H' + (x + 38) + '"/>';
    }).join("") + "</g></svg>";

  /* ---------- delete control (teacher only) ---------- */
  function delCtl(kind, id) {
    if (!isTeacher()) return "";
    var key = kind + ":" + id;
    return ui.confirmDel === key
      ? '<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn danger small" data-act="del-yes" data-kind="' + kind + '" data-id="' + esc(id) + '">Иә, өшіру</button><button class="btn ghost small" data-act="del-no">Жоқ</button></span>'
      : '<button class="btn ghost small" data-act="del" data-kind="' + kind + '" data-id="' + esc(id) + '">Өшіру</button>';
  }

  /* ---------- stories ---------- */
  function storiesFiltered() {
    return data.stories.slice().sort(function (a, b) {
      return (b.recorded_on || "").localeCompare(a.recorded_on || "") || (b.created_at || "").localeCompare(a.created_at || "");
    }).filter(function (s) {
      if (ui.topic !== "Барлығы" && s.topic !== ui.topic) return false;
      return match([s.title, s.elder, s.village, s.student, s.description, s.relation, s.thanks]);
    });
  }
  function mediaHtml(s) {
    var out = "";
    if (s.media_path) {
      var src = esc(mediaUrl(s.media_path));
      out += s.kind === "video"
        ? '<video controls preload="metadata" playsinline src="' + src + '"></video>'
        : '<audio controls preload="none" src="' + src + '"></audio>';
    }
    var l = safeLink(s.link);
    if (l) out += '<a href="' + esc(l) + '" target="_blank" rel="noopener">Жазбаны ашу ↗</a>';
    return out;
  }
  function storyHtml(s) {
    var d = delCtl("stories", s.id);
    return '<article class="story"><div class="row"><span class="tag">' + esc(s.topic || "Әңгіме") + '</span>' +
      (s.recorded_on ? '<span class="count">Жазылған: ' + esc(fmtDate(s.recorded_on)) + '</span>' : '') + '</div>' +
      '<h3>' + esc(s.title) + '</h3>' +
      '<div class="meta"><span>Айтушы: <strong>' + esc(s.elder) + '</strong>' + (s.relation ? ' <span class="kin">· ' + esc(s.relation) + '</span>' : '') + '</span>' +
      (s.village ? '<span>' + esc(s.village) + '</span>' : '') + (s.student ? '<span>Жазып алған: ' + esc(s.student) + '</span>' : '') + '</div>' +
      (s.description ? '<p>' + esc(s.description) + '</p>' : '') + mediaHtml(s) +
      (s.thanks ? '<div class="letter"><span class="lh">Алғыс хат</span><p>' + esc(s.thanks) + '</p>' + (s.student ? '<span class="sig">— ' + esc(s.student) + '</span>' : '') + '</div>' : '') +
      (d ? '<div class="row"><span></span>' + d + '</div>' : '') + '</article>';
  }
  function storyForm() {
    return '<form class="panel" data-form="story"><h2>Жаңа әңгіме қосу</h2>' +
      '<div class="grid2"><label>Әңгіменің атауы *<input id="f-title" required maxlength="120" placeholder="Мысалы: Атамның ақылы"></label>' +
      '<label>Тақырыбы<select id="f-topic">' + TOPICS.map(function (t) { return "<option>" + t + "</option>"; }).join("") + '</select></label>' +
      '<label>Айтушы (ауыл ақсақалы, әжесі) *<input id="f-elder" required maxlength="80" placeholder="Аты-жөні"></label>' +
      '<label>Айтушы сізге кім болады?<input id="f-relation" maxlength="80" placeholder="Мысалы: менің атам"></label>' +
      '<label>Ауылы<input id="f-village" maxlength="80" placeholder="Ауыл, аудан"></label>' +
      '<label>Жазып алған оқушы<input id="f-student" maxlength="80" placeholder="Аты-жөні, сыныбы"></label>' +
      '<label>Жазылған күні<input id="f-date" type="date" max="' + todayStr() + '" value="' + todayStr() + '"></label>' +
      '<label>Жазба файлы (аудио не видео)<input id="f-file" type="file" accept="audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.amr,.flac,.mp4,.mov,.webm,.3gp"></label></div>' +
      '<p class="hint">Кез келген аудио (MP3, M4A, WhatsApp дауыстық хабары т.б.) не видео, 50 МБ-қа дейін. Үлкен видеоны YouTube-қа салып, сілтемесін төменге қойыңыз.</p>' +
      '<label>Немесе сілтеме (YouTube, Google Drive)<input id="f-link" type="url" placeholder="https://..."></label>' +
      '<label>Қысқаша мазмұны<textarea id="f-desc" rows="3" maxlength="600" placeholder="Әңгіме не туралы, қандай өсиет айтылады"></textarea></label>' +
      '<label>Алғыс хат (айтушыға арналған сөзіңіз)<textarea id="f-thanks" rows="3" maxlength="800" placeholder="Құрметті атажан, әңгімеңіз үшін рахмет…"></textarea></label>' +
      formFoot("Сайтқа салу") + "</form>";
  }

  /* ---------- photos ---------- */
  function photosFiltered() {
    return data.photos.slice().sort(function (a, b) { return (a.year || "9999").localeCompare(b.year || "9999"); })
      .filter(function (p) { return match([p.caption, p.year, p.owner, p.student, p.place]); });
  }
  function photoHtml(p) {
    var d = delCtl("photos", p.id);
    return '<figure class="photo"><button class="img" data-act="zoom" data-id="' + esc(p.id) + '" aria-label="Үлкейту: ' + esc(p.caption) + '"><img loading="lazy" src="' + esc(mediaUrl(p.media_path)) + '" alt="' + esc(p.caption) + '"></button>' +
      '<figcaption>' + (p.year ? '<span class="yr">' + esc(p.year) + '</span>' : '') + '<b>' + esc(p.caption) + '</b>' +
      (p.place ? '<span class="muted">' + esc(p.place) + '</span>' : '') +
      (p.owner ? '<span class="muted">Сурет иесі: ' + esc(p.owner) + '</span>' : '') +
      (p.student ? '<span class="muted">Салған: ' + esc(p.student) + '</span>' : '') +
      (d ? '<div class="row"><span></span>' + d + '</div>' : '') + '</figcaption></figure>';
  }
  function photoForm() {
    return '<form class="panel" data-form="photo"><h2>Ескі сурет қосу</h2>' +
      '<label>Сурет файлы *<input id="p-file" type="file" accept="image/*" required></label>' +
      '<p class="hint">Ескі суретті телефонмен жарық жерде, тура үстінен түсіріңіз. Сурет салынар алдында автоматты түрде кішірейтіледі.</p>' +
      '<label>Суретте не бейнеленген? *<textarea id="p-caption" rows="2" maxlength="300" required placeholder="Мысалы: Ауыл мектебінің алғашқы түлектері"></textarea></label>' +
      '<div class="grid2"><label>Қай жылы түсірілген?<input id="p-year" maxlength="20" placeholder="Мысалы: 1968 не 1960-жылдар"></label>' +
      '<label>Қай жерде?<input id="p-place" maxlength="80" placeholder="Ауыл, жер атауы"></label>' +
      '<label>Сурет кімдікі?<input id="p-owner" maxlength="80" placeholder="Мысалы: Сәуле әжей"></label>' +
      '<label>Салған оқушы<input id="p-student" maxlength="80" placeholder="Аты-жөні, сыныбы"></label></div>' +
      formFoot("Суретті салу") + "</form>";
  }

  /* ---------- words ---------- */
  function wordsFiltered() {
    return data.words.slice().sort(function (a, b) { return a.word.localeCompare(b.word, "kk"); })
      .filter(function (w) { return match([w.word, w.meaning, w.example, w.student]); });
  }
  function wordsHtml(list) {
    var out = "", last = "";
    list.forEach(function (w) {
      var L = (w.word || "").charAt(0).toUpperCase();
      if (L !== last) { out += '<div class="letterhead" aria-hidden="true">' + esc(L) + "</div>"; last = L; }
      var st = w.story_id ? storyById(w.story_id) : null;
      var d = delCtl("words", w.id);
      var src = (st ? "«" + esc(st.title) + "» әңгімесінен" : "") + (st && w.student ? " · " : "") + (w.student ? "Жазған: " + esc(w.student) : "");
      out += '<dl class="word"><dt>' + esc(w.word) + "</dt><dd>" + esc(w.meaning) + "</dd>" +
        (w.example ? '<dd class="ex">«' + esc(w.example) + "»</dd>" : "") +
        (src ? '<dd class="src">' + src + "</dd>" : "") +
        (d ? '<dd class="row"><span></span>' + d + "</dd>" : "") + "</dl>";
    });
    return '<div class="words">' + out + "</div>";
  }
  function wordForm() {
    var opts = '<option value="">— таңдалмаған —</option>' + data.stories.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.title) + "</option>";
    }).join("");
    return '<form class="panel" data-form="word"><h2>Көне сөз қосу</h2>' +
      '<div class="grid2"><label>Сөз *<input id="w-word" required maxlength="60" placeholder="Мысалы: кебеже"></label>' +
      '<label>Қай әңгімеде кездесті?<select id="w-story">' + opts + "</select></label></div>" +
      '<label>Мағынасы *<textarea id="w-meaning" rows="2" maxlength="400" required placeholder="Мысалы: ағаштан жасалған, ас-су сақтайтын сандық"></textarea></label>' +
      '<label>Сөйлемде қолданылуы<input id="w-example" maxlength="200" placeholder="Мысалы: Әжем құртты кебежеге салып қоятын"></label>' +
      '<label>Жазған оқушы<input id="w-student" maxlength="80" placeholder="Аты-жөні, сыныбы"></label>' +
      formFoot("Сөздікке қосу") + "</form>";
  }

  function formFoot(label) {
    return (ui.progress >= 0 ? '<div class="bar" aria-hidden="true"><i id="pbar" style="width:' + Math.round(ui.progress * 100) + '%"></i></div>' : "") +
      (ui.msg ? '<p class="msg' + (ui.err ? " err" : "") + '" role="status">' + esc(ui.msg) + "</p>" : "") +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit" ' + (ui.busy ? "disabled" : "") + ">" + (ui.busy ? "Жүктелуде…" : label) + '</button><button class="btn ghost" type="button" data-act="cancel" ' + (ui.busy ? "disabled" : "") + ">Болдырмау</button></div>";
  }

  /* ---------- login ---------- */
  function loginPanel() {
    if (ui.role) {
      return '<div class="panel"><h2>Сіз кірдіңіз</h2><p class="note">' + (isTeacher() ? "Мұғалім ретінде: қосуға және өшіруге болады." : "Оқушы ретінде: әңгіме, сурет және сөз қосуға болады.") +
        '</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-act="logout">Шығу</button><button class="btn ghost" data-act="login-close">Жабу</button></div></div>';
    }
    return '<form class="panel" data-form="login"><h2>Материал қосу үшін кіру</h2>' +
      '<p class="note">Құпиясөзді мұғалімнен сұраңыз. Тыңдау үшін кірудің қажеті жоқ.</p>' +
      '<label>Құпиясөз<input id="l-pass" type="password" autocomplete="current-password" required></label>' +
      (ui.loginMsg ? '<p class="msg err" role="status">' + esc(ui.loginMsg) + "</p>" : "") +
      '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" type="submit" ' + (ui.loginBusy ? "disabled" : "") + ">" + (ui.loginBusy ? "Тексерілуде…" : "Кіру") + '</button><button class="btn ghost" type="button" data-act="login-close">Болдырмау</button></div></form>';
  }

  /* ---------- page ---------- */
  var EMPTY = {
    stories: "<b>Әзірге әңгіме жоқ</b>Алғашқы жазбаны оқушылар салады. Мұнда әр әңгіменің атауы, айтушысы, ауылы, ойнатқышы және алғыс хаты көрінеді.",
    photos: "<b>Әзірге сурет жоқ</b>Үлкендердің қолындағы ескі суреттерді телефонмен түсіріп, жылын және кім екенін жазып салыңыз.",
    words: "<b>Сөздік әзірге бос</b>Әңгімелерде естіген ұмыт бола бастаған сөздерді (келсап, ошақ, кебеже…) мағынасымен осында жинаңыз."
  };
  var ADD_LABEL = { stories: "+ Әңгіме қосу", photos: "+ Сурет қосу", words: "+ Сөз қосу" };
  var FORM_OF = { stories: "story", photos: "photo", words: "word" };
  var UNIT = { stories: "әңгіме", photos: "сурет", words: "сөз" };
  var INTRO = {
    stories: '<section class="how" aria-label="Қалай жұмыс істейді"><div><b>Тыңдау</b><p>Үлкен кісінің әңгімесін оқушы телефонға жазып алады.</p></div><div><b>Жүктеу</b><p>Мұғалім берген құпиясөзбен кіріп, «Әңгіме қосу» батырмасымен жазбаны салады.</p></div><div><b>Тарату</b><p>Жазба осында сақталады, оны бәрі күні-түні тыңдай алады.</p></div></section>',
    photos: '<p class="secintro">Ауылдың, мектептің, отбасылардың ескі суреттері. Суретті басып, үлкейтіп көріңіз.</p>',
    words: '<p class="secintro">Үлкендердің әңгімесінде кездескен, бүгін сирек айтылатын сөздер және олардың мағынасы.</p>'
  };

  function bodyInner() {
    var k = curKey(), list, html;
    if (!configured) {
      return { count: "", html: '<div class="notice"><b>Сайт әлі бапталмаған.</b> config.js файлына Supabase жобасының мекенжайы мен кілтін енгізіңіз (нұсқаулықтың 4-қадамы).</div>' };
    }
    if (ui.loading) return { count: "", html: '<div class="empty">Жүктелуде…</div>' };
    if (ui.loadError) return { count: "", html: '<div class="empty"><b>Деректер жүктелмеді</b>Интернетті тексеріп, қайталап көріңіз.<br><br><button class="btn ghost" data-act="reload">Қайталау</button></div>' };
    if (k === "stories") { list = storiesFiltered(); html = list.length ? '<div class="list">' + list.map(storyHtml).join("") + "</div>" : ""; }
    else if (k === "photos") { list = photosFiltered(); html = list.length ? '<div class="photos">' + list.map(photoHtml).join("") + "</div>" : ""; }
    else { list = wordsFiltered(); html = list.length ? wordsHtml(list) : ""; }
    if (!list.length) html = '<div class="empty">' + (data[k].length ? "<b>Ештеңе табылмады</b>Басқа сөзбен іздеп көріңіз." : EMPTY[k]) + "</div>";
    var cnt = list.length + " " + UNIT[k] + (list.length !== data[k].length ? " (барлығы " + data[k].length + ")" : "");
    return { html: html, count: cnt };
  }

  function render() {
    var k = curKey();
    var active = document.activeElement && document.activeElement.id;
    var draft = {};
    app.querySelectorAll("form.panel input:not([type=file]):not([type=password]),form.panel select,form.panel textarea").forEach(function (el) { if (el.id) draft[el.id] = el.value; });
    var b = bodyInner();
    var formMine = ui.adding === FORM_OF[k];
    var html = '<header class="band"><div class="wrap"><div><p class="eyebrow">Ауыл үлкендерінің аманаты</p><h1>Құлаққа кітап</h1>' +
      '<p class="lede">Ата-әжелеріміздің әңгімесі, өсиеті мен ақылы. Оқушылар оларды аудио не видеоға жазып алып, осында салады. Кез келген адам кез келген уақытта тыңдай алады.</p>' + ORN + "</div>" +
      '<div class="qr"><div id="qrbox" aria-label="Сайттың QR-коды"></div><small>Телефонмен сканерлеп, сайтқа кіріңіз</small><button type="button" data-act="copy">Сілтемені көшіру</button></div></div></header>' +
      '<nav class="tabs" aria-label="Бөлімдер"><div class="wrap">' + TABS.map(function (t) {
        return '<a href="#' + t.id + '"' + (t.id === ui.tab ? ' aria-current="page"' : "") + ">" + t.name + (configured && !ui.loading ? "<span>" + data[t.key].length + "</span>" : "") + "</a>";
      }).join("") + "</div></nav>" +
      '<main><div class="wrap">' + INTRO[k] +
      (ui.loginOpen ? loginPanel() : "") +
      (formMine ? (k === "stories" ? storyForm() : k === "photos" ? photoForm() : wordForm()) : "") +
      '<div class="tools"><input type="search" id="q" placeholder="Іздеу…" value="' + esc(ui.q) + '" aria-label="Іздеу">' +
      (canAdd() && !formMine ? '<button class="btn" data-act="add">' + ADD_LABEL[k] + "</button>" : "") +
      (!canAdd() && configured && !ui.loginOpen ? '<button class="btn ghost" data-act="login-open">Материал қосу</button>' : "") + "</div>" +
      (k === "stories" ? '<div class="chips" role="group" aria-label="Тақырып">' + ["Барлығы"].concat(TOPICS).map(function (t) {
        return '<button class="chip" data-act="topic" data-t="' + t + '" aria-pressed="' + (ui.topic === t) + '">' + t + "</button>";
      }).join("") + "</div>" : "") +
      '<p class="count" id="cnt">' + esc(b.count) + "</p>" +
      '<section id="body">' + b.html + "</section>" +
      "</div></main>" +
      '<footer><div class="wrap"><span>Құлаққа кітап · ауыл мұрасын сақтайық</span>' +
      (configured ? (ui.role ? '<button data-act="login-open">' + (isTeacher() ? "Мұғалім" : "Оқушы") + " ретінде кірдіңіз</button>" : '<button data-act="login-open">Кіру</button>') : "") +
      "</div></footer>" + lightboxHtml();
    app.innerHTML = html;
    Object.keys(draft).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = draft[id]; });
    if (active) {
      var a = document.getElementById(active);
      if (a) { a.focus(); if (a.id === "q") { var v = a.value; a.setSelectionRange(v.length, v.length); } }
    }
    drawQR();
  }

  function renderBody() {
    var b = bodyInner();
    var sec = document.getElementById("body"), cnt = document.getElementById("cnt");
    if (sec) sec.innerHTML = b.html;
    if (cnt) cnt.textContent = b.count;
    app.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", String(c.getAttribute("data-t") === ui.topic)); });
  }

  function lightboxHtml() {
    if (!ui.lightbox) return "";
    var p = null;
    data.photos.forEach(function (x) { if (x.id === ui.lightbox) p = x; });
    if (!p) return "";
    return '<div class="lightbox" data-act="unzoom" role="dialog" aria-label="Сурет"><button class="close" data-act="unzoom">Жабу ✕</button><figure><img src="' + esc(mediaUrl(p.media_path)) + '" alt="' + esc(p.caption) + '"><figcaption>' + (p.year ? esc(p.year) + " · " : "") + esc(p.caption) + "</figcaption></figure></div>";
  }

  function drawQR() {
    var box = document.getElementById("qrbox");
    if (!box || typeof QRCode === "undefined") return;
    box.innerHTML = "";
    try { new QRCode(box, { text: siteUrl(), width: 148, height: 148, colorDark: "#14336B", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
  }

  /* ---------- data ---------- */
  function load() {
    if (!sb) return;
    ui.loading = true; ui.loadError = false; render();
    Promise.all([
      sb.from("stories").select("*").order("created_at", { ascending: false }),
      sb.from("photos").select("*").order("created_at", { ascending: false }),
      sb.from("words").select("*").order("word")
    ]).then(function (r) {
      if (r[0].error || r[1].error || r[2].error) throw r[0].error || r[1].error || r[2].error;
      data.stories = r[0].data || []; data.photos = r[1].data || []; data.words = r[2].data || [];
      ui.loading = false; render();
    }).catch(function (e) {
      console.error(e);
      ui.loading = false; ui.loadError = true; render();
    });
  }

  function roleFromSession(session) {
    var email = session && session.user && session.user.email;
    if (!email) return null;
    if (email === cfg.teacherEmail) return "teacher";
    return "student";
  }

  function setMsg(m, err) {
    ui.msg = m; ui.err = !!err;
    var el = app.querySelector("form.panel .msg");
    if (el) { el.textContent = m; el.className = "msg" + (err ? " err" : ""); } else render();
  }
  function setProgress(p) {
    ui.progress = p;
    var el = document.getElementById("pbar");
    if (el) el.style.width = Math.round(p * 100) + "%"; else render();
  }
  function fail(m) { ui.busy = false; ui.progress = -1; ui.err = true; ui.msg = m; render(); }
  function done() { ui.busy = false; ui.progress = -1; ui.adding = null; ui.msg = ""; render(); }

  function dbErrText(e) {
    var c = e && (e.code || e.status);
    if (c === "23505") return "Бұл сөз сөздікте бар.";
    if (c === "42501" || c === 401 || c === 403) return "Рұқсат жоқ. Қайта кіріп көріңіз.";
    return "Сақталмады. Интернетті тексеріп, қайталап көріңіз.";
  }

  /* upload with progress straight to Supabase Storage */
  function uploadFile(blob, path, contentType) {
    return sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (!session) throw { code: "auth" };
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", cfg.supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"));
        xhr.setRequestHeader("Authorization", "Bearer " + session.access_token);
        xhr.setRequestHeader("apikey", cfg.supabaseKey);
        xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");
        xhr.setRequestHeader("cache-control", "max-age=31536000");
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) setProgress(e.loaded / e.total); };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve(path);
          else reject({ code: "upload", status: xhr.status, body: xhr.responseText });
        };
        xhr.onerror = function () { reject({ code: "network" }); };
        xhr.send(blob);
      });
    });
  }
  function uploadErrText(e) {
    if (e && e.code === "auth") return "Кіру мерзімі бітті. Қайта кіріңіз.";
    if (e && e.code === "network") return "Интернет байланысы үзілді. Қайталап көріңіз.";
    var s = e && e.status;
    if (s === 413) return "Файл тым үлкен (50 МБ-тан асады).";
    if (s === 401 || s === 403) return "Файл жүктеуге рұқсат жоқ. Қайта кіріп көріңіз.";
    return "Файл жүктелмеді. Қайталап көріңіз." + (s ? " (код: " + s + ")" : "");
  }

  var EXT_TYPE = {
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg",
    opus: "audio/ogg", amr: "audio/amr", flac: "audio/flac", weba: "audio/webm",
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp"
  };
  function extOf(name) { return (String(name).split(".").pop() || "").toLowerCase(); }

  /* audio-only MP4s (WhatsApp) look like video: check whether there is a picture */
  function detectKind(file) {
    var t = (file.type || "").toLowerCase(), ext = extOf(file.name);
    if (t.indexOf("audio/") === 0 || /^(mp3|m4a|aac|wav|ogg|oga|opus|amr|flac|weba)$/.test(ext)) return Promise.resolve("audio");
    if (t.indexOf("video/") !== 0 && !/^(mp4|m4v|mov|webm|3gp)$/.test(ext)) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), v = document.createElement("video"), settled = false;
      function finish(k) { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(k); }
      v.preload = "metadata"; v.muted = true;
      v.onloadedmetadata = function () { finish(v.videoWidth > 0 ? "video" : "audio"); };
      v.onerror = function () { finish("video"); };
      setTimeout(function () { finish("video"); }, 5000);
      v.src = url;
    });
  }

  function g(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }

  function insertRow(table, row) {
    return sb.from(table).insert(row).select().single().then(function (r) {
      if (r.error) throw r.error;
      data[table].push(r.data);
      return r.data;
    });
  }

  function submitStory() {
    var fileEl = document.getElementById("f-file");
    var file = fileEl && fileEl.files[0], link = g("f-link");
    if (!g("f-title") || !g("f-elder")) return fail("Атауы мен айтушының атын жазыңыз.");
    if (!file && !link) return fail("Жазба файлын таңдаңыз не сілтеме қойыңыз.");
    if (link && !safeLink(link)) return fail("Сілтеме https:// деп басталуы керек.");
    var dv = g("f-date");
    if (dv && dv > todayStr()) return fail("Жазылған күні болашақта бола алмайды.");
    if (file && file.size > MAX_BYTES) return fail("Файл 50 МБ-тан үлкен. Оны YouTube не Google Drive-қа салып, сілтемесін қойыңыз.");
    var row = {
      title: g("f-title"), topic: g("f-topic") || "Әңгіме", elder: g("f-elder"), relation: g("f-relation") || null,
      village: g("f-village") || null, student: g("f-student") || null, recorded_on: dv || null,
      description: g("f-desc") || null, thanks: g("f-thanks") || null, link: link || null, kind: "link", media_path: null
    };
    ui.busy = true; ui.err = false; ui.msg = "Дайындалуда…"; render();
    var step = file ? detectKind(file).then(function (kind) {
      if (!kind) throw { code: "type" };
      row.kind = kind;
      var ext = extOf(file.name) || (kind === "audio" ? "m4a" : "mp4");
      var type = file.type || EXT_TYPE[ext] || "application/octet-stream";
      if (kind === "audio" && /^video\//.test(type)) type = type.replace("video/", "audio/");
      setMsg("Жазба жүктелуде… Бетті жаппаңыз."); setProgress(0);
      return uploadFile(file, "stories/" + uid() + "." + ext, type).then(function (p) { row.media_path = p; });
    }) : Promise.resolve();
    step.then(function () {
      setMsg("Сақталуда…");
      return insertRow("stories", row).then(done, function (e) { console.error(e); fail(dbErrText(e)); });
    }, function (e) {
      console.error(e);
      fail(e && e.code === "type" ? "Бұл файл аудио не видео емес сияқты. Басқа файл таңдаңыз не сілтеме қойыңыз." : uploadErrText(e));
    });
  }

  function shrinkImage(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1800, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, max / Math.max(w, h));
        try {
          var c = document.createElement("canvas");
          c.width = Math.round(w * s); c.height = Math.round(h * s);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (b) { URL.revokeObjectURL(url); res(b || file); }, "image/jpeg", 0.86);
        } catch (e) { URL.revokeObjectURL(url); res(file); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  function submitPhoto() {
    var file = document.getElementById("p-file").files[0];
    if (!file) return fail("Сурет файлын таңдаңыз.");
    if (!g("p-caption")) return fail("Суретте не бейнеленгенін жазыңыз.");
    var row = { caption: g("p-caption"), year: g("p-year") || null, place: g("p-place") || null, owner: g("p-owner") || null, student: g("p-student") || null };
    ui.busy = true; ui.err = false; ui.msg = "Сурет дайындалуда…"; render();
    shrinkImage(file).then(function (b) {
      if (!b) return fail("Бұл суретті ашу мүмкін болмады. JPG не PNG пішіміндегі суретті таңдаңыз.");
      if (b.size > MAX_BYTES) return fail("Сурет тым үлкен.");
      setMsg("Сурет жүктелуде…"); setProgress(0);
      var jpeg = (b.type || "").indexOf("jpeg") > -1;
      uploadFile(b, "photos/" + uid() + "." + (jpeg ? "jpg" : extOf(file.name) || "jpg"), b.type || "image/jpeg").then(function (p) {
        row.media_path = p;
        setMsg("Сақталуда…");
        return insertRow("photos", row).then(done, function (e) { console.error(e); fail(dbErrText(e)); });
      }, function (e) { console.error(e); fail(uploadErrText(e)); });
    });
  }
  function submitWord() {
    if (!g("w-word") || !g("w-meaning")) return fail("Сөзді және оның мағынасын жазыңыз.");
    var w = g("w-word").toLowerCase();
    if (data.words.some(function (x) { return x.word.toLowerCase() === w; })) return fail("Бұл сөз сөздікте бар.");
    var row = { word: g("w-word"), meaning: g("w-meaning"), example: g("w-example") || null, story_id: g("w-story") || null, student: g("w-student") || null };
    ui.busy = true; ui.err = false; ui.msg = "Сақталуда…"; render();
    insertRow("words", row).then(done, function (e) { console.error(e); fail(dbErrText(e)); });
  }

  function submitLogin() {
    var pass = document.getElementById("l-pass").value;
    if (!pass) return;
    ui.loginBusy = true; ui.loginMsg = ""; render();
    var tryLogin = function (email) { return sb.auth.signInWithPassword({ email: email, password: pass }); };
    tryLogin(cfg.teacherEmail).then(function (r) {
      return r.error ? tryLogin(cfg.studentEmail) : r;
    }).then(function (r) {
      ui.loginBusy = false;
      if (r.error) { ui.loginMsg = "Құпиясөз дұрыс емес."; render(); return; }
      ui.role = roleFromSession(r.data.session); ui.loginOpen = false; render();
    }).catch(function () { ui.loginBusy = false; ui.loginMsg = "Байланыс жоқ. Қайталап көріңіз."; render(); });
  }

  function deleteItem(kind, id) {
    var item = null;
    data[kind].forEach(function (x) { if (x.id === id) item = x; });
    if (!item) return;
    ui.confirmDel = null;
    sb.from(kind).delete().eq("id", id).then(function (r) {
      if (r.error) { console.error(r.error); alertInline(dbErrText(r.error)); return; }
      data[kind] = data[kind].filter(function (x) { return x.id !== id; });
      if (item.media_path) sb.storage.from(BUCKET).remove([item.media_path]).then(function () {}, function () {});
      render();
    });
  }
  function alertInline(m) {
    var c = document.getElementById("cnt");
    if (c) { c.textContent = m; c.style.color = "var(--danger)"; }
  }

  /* ---------- events ---------- */
  app.addEventListener("submit", function (e) {
    var f = e.target.getAttribute("data-form");
    if (!f) return;
    e.preventDefault();
    if (f === "login") return submitLogin();
    if (ui.busy) return;
    if (f === "story") submitStory(); else if (f === "photo") submitPhoto(); else if (f === "word") submitWord();
  });

  app.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "topic") { ui.topic = b.getAttribute("data-t"); renderBody(); }
    else if (act === "add") { ui.adding = FORM_OF[curKey()]; ui.msg = ""; ui.loginOpen = false; render(); var t = app.querySelector("form.panel input,form.panel textarea"); if (t) t.focus(); }
    else if (act === "cancel") { ui.adding = null; ui.msg = ""; render(); }
    else if (act === "login-open") { ui.loginOpen = true; ui.loginMsg = ""; render(); var p = document.getElementById("l-pass"); if (p) p.focus(); window.scrollTo(0, (app.querySelector(".panel") || app).offsetTop - 16); }
    else if (act === "login-close") { ui.loginOpen = false; render(); }
    else if (act === "logout") { sb.auth.signOut().then(function () { ui.role = null; ui.loginOpen = false; ui.adding = null; render(); }); }
    else if (act === "del") { ui.confirmDel = b.getAttribute("data-kind") + ":" + b.getAttribute("data-id"); render(); }
    else if (act === "del-no") { ui.confirmDel = null; render(); }
    else if (act === "del-yes") { deleteItem(b.getAttribute("data-kind"), b.getAttribute("data-id")); }
    else if (act === "zoom") { ui.lightbox = b.getAttribute("data-id"); render(); }
    else if (act === "unzoom") { if (e.target === b || b.classList.contains("close")) { ui.lightbox = null; render(); } }
    else if (act === "reload") { load(); }
    else if (act === "copy") {
      var u = siteUrl(), fallback = function () { b.textContent = u; };
      try { navigator.clipboard.writeText(u).then(function () { b.textContent = "Көшірілді"; }, fallback); } catch (x) { fallback(); }
    }
  });
  app.addEventListener("input", function (e) { if (e.target.id === "q") { ui.q = e.target.value; renderBody(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ui.lightbox) { ui.lightbox = null; render(); } });

  function fromHash() {
    var h = (location.hash || "").replace("#", "");
    var next = TABS.some(function (t) { return t.id === h; }) ? h : "angimeler";
    if (next !== ui.tab) { ui.tab = next; ui.q = ""; ui.adding = null; ui.msg = ""; ui.confirmDel = null; }
  }
  window.addEventListener("hashchange", function () { fromHash(); render(); window.scrollTo(0, 0); });
  window.addEventListener("load", drawQR);

  fromHash();
  render();
  if (sb) {
    sb.auth.getSession().then(function (r) { ui.role = roleFromSession(r.data && r.data.session); render(); });
    sb.auth.onAuthStateChange(function (_ev, session) { var nr = roleFromSession(session); if (nr !== ui.role) { ui.role = nr; render(); } });
    load();
  }
})();
