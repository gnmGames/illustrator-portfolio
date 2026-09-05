(function () {
  "use strict";

  var STORAGE_KEY = "illustPortfolio:v1";
  var COUNTER_KEY = "illustPortfolio:counter";
  var DB_NAME = "illustPortfolioDB";
  var DB_STORE = "images";
  var FULL_MAX = 2200;
  var THUMB_SIZE = 720;

  /* 파트는 반드시 셋 중 하나다. 값이 없거나 모르는 값이면 일러스트로 본다.
     어느 파트에도 속하지 않는 작품이 생기면 그리는 섹션이 없어서 화면에서
     그대로 사라진다 — 기본값을 두는 이유는 편의가 아니라 안전장치다. */
  var PART_KEYS = ["illust", "anim", "ai", "dev"];
  var DEFAULT_PART = "illust";
  function normalizePart(p) {
    return PART_KEYS.indexOf(p) >= 0 ? p : DEFAULT_PART;
  }

  var els = {
    body: document.body,
    brandName: document.getElementById("brandName"),
    editToggle: document.getElementById("editToggle"),
    worksLink: document.getElementById("worksLink"),
    stage: document.getElementById("stage"),
    stageMedia: document.getElementById("stageMedia"),
    stageImage: document.getElementById("stageImage"),
    coverTagline: document.getElementById("coverTagline"),
    scrollCue: document.getElementById("scrollCue"),
    stageClose: document.getElementById("stageClose"),
    panelIndex: document.getElementById("panelIndex"),
    panelTotal: document.getElementById("panelTotal"),
    panelCategory: document.getElementById("panelCategory"),
    panelTitle: document.getElementById("panelTitle"),
    panelYear: document.getElementById("panelYear"),
    panelDesc: document.getElementById("panelDesc"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    arrowPrev: document.getElementById("arrowPrev"),
    arrowNext: document.getElementById("arrowNext"),
    gallery: document.getElementById("gallery"),
    footYear: document.getElementById("footYear"),
    exportBtn: document.getElementById("exportBtn"),
    exportImagesBtn: document.getElementById("exportImagesBtn"),
    resetBtn: document.getElementById("resetBtn"),
    editStatus: document.getElementById("editStatus"),
    cursorDot: document.getElementById("cursorDot"),
    fileInput: document.getElementById("fileInput"),
    stageEditActions: document.getElementById("stageEditActions"),
    cropEditBtn: document.getElementById("cropEditBtn"),
    deleteItemBtn: document.getElementById("deleteItemBtn"),
    cropOverlay: document.getElementById("cropOverlay"),
    cropBox: document.getElementById("cropBox"),
    cropControls: document.getElementById("cropControls"),
    cropCenterBtn: document.getElementById("cropCenterBtn"),
    cropCancelBtn: document.getElementById("cropCancelBtn"),
    cropApplyBtn: document.getElementById("cropApplyBtn"),
    cropZoomRange: document.getElementById("cropZoomRange"),
    stageMotion: document.getElementById("stageMotion"),
    stageVideo: document.getElementById("stageVideo"),
    videoFacade: document.getElementById("videoFacade"),
    videoThumb: document.getElementById("videoThumb"),
    videoFrame: document.getElementById("videoFrame"),
    videoClose: document.getElementById("videoClose"),
    videoEdit: document.getElementById("videoEdit"),
    videoUrlInput: document.getElementById("videoUrlInput"),
    videoStatus: document.getElementById("videoStatus"),
    publishBtn: document.getElementById("publishBtn"),
    tokenPanel: document.getElementById("tokenPanel"),
    tokenInput: document.getElementById("tokenInput"),
    tokenRemember: document.getElementById("tokenRemember"),
    tokenSaveBtn: document.getElementById("tokenSaveBtn"),
    tokenCancelBtn: document.getElementById("tokenCancelBtn"),
    tokenForgetBtn: document.getElementById("tokenForgetBtn"),
    tokenBtn: document.getElementById("tokenBtn"),
    sections: document.getElementById("sections"),
    partEdit: document.getElementById("partEdit"),
    partPick: document.getElementById("partPick"),
  };

  var state = {
    items: [],
    meta: { siteName: "", tagline: "" },
    currentIndex: null,
    editMode: false,
    filter: "",
  };

  var dragSrcIndex = null;
  var io = null;
  var blobMap = {}; // "{id}:full" | "{id}:thumb" -> object URL
  var blobRaw = {}; // same key -> Blob

  /* blobRaw 키("{id}:full|thumb|motion") -> 저장소 내 경로 */
  function assetPath(key) {
    var parts = key.split(":");
    if (parts[1] !== "motion") return "assets/img/" + parts[1] + "/" + parts[0] + ".webp";
    var it = state.items.filter(function (x) { return x.id === parts[0]; })[0];
    return "assets/img/motion/" + parts[0] + "." + ((it && it.motion) || "gif");
  }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fullSrc(id) { return blobMap[id + ":full"] || ("assets/img/full/" + id + ".webp"); }
  function thumbSrc(id) { return blobMap[id + ":thumb"] || ("assets/img/thumb/" + id + ".webp"); }
  function displayTitle(item, idx) {
    return item.title && item.title.trim() ? item.title : ("Work " + pad(idx + 1));
  }

  // ---------- IndexedDB (holds added/re-cropped image files) ----------
  var dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("no indexedDB")); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(DB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function idbSet(key, blob) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(blob, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbDelete(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbClearAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGetAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var store = tx.objectStore(DB_STORE);
        var keysReq = store.getAllKeys();
        var valsReq = store.getAll();
        tx.oncomplete = function () { resolve({ keys: keysReq.result, vals: valsReq.result }); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function loadBlobsFromDB() {
    return idbGetAll().then(function (res) {
      (res.keys || []).forEach(function (key, i) {
        var blob = res.vals[i];
        blobRaw[key] = blob;
        blobMap[key] = URL.createObjectURL(blob);
      });
    }).catch(function () {});
  }

  // ---------- image processing (canvas) ----------
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  function canvasToWebp(canvas, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) { resolve(blob); }, "image/webp", quality || 0.85);
    });
  }
  function srcW(el) { return el.naturalWidth || el.videoWidth || 0; }
  function srcH(el) { return el.naturalHeight || el.videoHeight || 0; }

  function makeFullCanvas(imgEl, maxDim) {
    var w = srcW(imgEl), h = srcH(imgEl);
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d").drawImage(imgEl, 0, 0, cw, ch);
    return canvas;
  }
  function normalizeCrop(item) {
    return {
      scale: item.cropScale == null ? 1 : item.cropScale,
      x: item.cropX == null ? 0.5 : item.cropX,
      y: item.cropY == null ? 0.5 : item.cropY,
    };
  }
  function makeThumbCanvas(imgEl, crop, size) {
    var w = srcW(imgEl), h = srcH(imgEl);
    var minSide = Math.min(w, h);
    var boxSide = minSide * crop.scale;
    var sx = (w - boxSide) * crop.x;
    var sy = (h - boxSide) * crop.y;
    var canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    canvas.getContext("2d").drawImage(imgEl, sx, sy, boxSide, boxSide, 0, 0, size, size);
    return canvas;
  }

  function nextImageId() {
    var maxN = 0;
    state.items.forEach(function (it) {
      var m = /^img-(\d+)$/.exec(it.id);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    var stored = parseInt(localStorage.getItem(COUNTER_KEY) || "0", 10);
    var n = Math.max(maxN, stored) + 1;
    try { localStorage.setItem(COUNTER_KEY, String(n)); } catch (e) {}
    return "img-" + (n < 10 ? "0" + n : n);
  }

  // ---------- persistence ----------
  function loadState() {
    var defaults = (window.PORTFOLIO_DATA || []).map(function (d) {
      return {
        id: d.id, w: d.w, h: d.h,
        title: d.title || "", category: d.category || "", year: d.year || "", description: d.description || "",
        cropScale: typeof d.cropScale === "number" ? d.cropScale : 1,
        cropX: typeof d.cropX === "number" ? d.cropX : 0.5,
        cropY: typeof d.cropY === "number" ? d.cropY : 0.5,
        video: d.video || "",
        motion: d.motion || "",
        part: normalizePart(d.part),
      };
    });
    var meta = Object.assign({ siteName: "", tagline: "" }, window.SITE_META || {});

    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { raw = null; }
    if (!raw) return { items: defaults, meta: meta };

    var byId = {};
    defaults.forEach(function (d) { byId[d.id] = d; });

    (raw.added || []).forEach(function (a) {
      if (!byId[a.id]) {
        byId[a.id] = { id: a.id, w: a.w, h: a.h, title: "", category: "", year: "", description: "", cropScale: 1, cropX: 0.5, cropY: 0.5, video: "", motion: "", part: DEFAULT_PART };
      }
    });

    if (raw.edits) {
      Object.keys(raw.edits).forEach(function (id) {
        if (byId[id]) Object.assign(byId[id], raw.edits[id]);
      });
    }

    var allItems = Object.keys(byId).map(function (id) { return byId[id]; });
    var items = allItems;
    if (Array.isArray(raw.order) && raw.order.length) {
      var ordered = raw.order.map(function (id) { return byId[id]; }).filter(Boolean);
      var seen = {};
      ordered.forEach(function (d) { seen[d.id] = true; });
      allItems.forEach(function (d) { if (!seen[d.id]) ordered.push(d); });
      items = ordered;
    }

    if (raw.meta) meta = Object.assign(meta, raw.meta);

    /* 편집본을 덮어쓴 뒤 마지막으로 한 번 더 — 예전 저장본에는 part:"" 가
       들어 있어서 Object.assign 이 위에서 잡아둔 기본값을 되돌려 놓는다. */
    items.forEach(function (it) { it.part = normalizePart(it.part); });

    return { items: items, meta: meta };
  }

  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      var defaultIds = {};
      (window.PORTFOLIO_DATA || []).forEach(function (d) { defaultIds[d.id] = true; });

      var edits = {}, added = [];
      state.items.forEach(function (it) {
        var crop = normalizeCrop(it);
        edits[it.id] = { title: it.title, category: it.category, year: it.year, description: it.description, cropScale: crop.scale, cropX: crop.x, cropY: crop.y, video: it.video || "", motion: it.motion || "", part: normalizePart(it.part) };
        if (!defaultIds[it.id]) added.push({ id: it.id, w: it.w, h: it.h });
      });
      var payload = {
        order: state.items.map(function (it) { return it.id; }),
        edits: edits,
        added: added,
        meta: state.meta,
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) {}
    }, 300);
  }

  /* persist()는 300ms 디바운스라, 편집 직후 다른 페이지로 이동하면
     마지막 입력이 저장되지 않은 채 사라진다. 화면이 숨겨지기 전에 강제로 flush 한다. */
  function flushPersist() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    var defaultIds = {};
    (window.PORTFOLIO_DATA || []).forEach(function (d) { defaultIds[d.id] = true; });
    var edits = {}, added = [];
    state.items.forEach(function (it) {
      var crop = normalizeCrop(it);
      edits[it.id] = { title: it.title, category: it.category, year: it.year, description: it.description, cropScale: crop.scale, cropX: crop.x, cropY: crop.y, video: it.video || "", motion: it.motion || "", part: normalizePart(it.part) };
      if (!defaultIds[it.id]) added.push({ id: it.id, w: it.w, h: it.h });
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        order: state.items.map(function (it) { return it.id; }),
        edits: edits,
        added: added,
        meta: state.meta
      }));
    } catch (e) {}
  }

  window.addEventListener("pagehide", flushPersist);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushPersist();
  });

  // ---------- rendering: meta ----------
  function renderMeta() {
    els.brandName.textContent = state.meta.siteName || "PORTFOLIO";
    els.coverTagline.textContent = state.meta.tagline || "";
    syncSiteNameMirrors();
  }

  function syncSiteNameMirrors() {
    var footBrand = document.querySelector('[data-field="siteName2"]');
    if (footBrand) footBrand.textContent = state.meta.siteName || "";
    document.title = (state.meta.siteName || "Portfolio") + " — Illustration Portfolio";
  }

  // ---------- rendering: grid ----------
  function renderGrid() {
    els.sections.innerHTML = "";
    els.panelTotal.textContent = pad(state.items.length);

    PART_SECTIONS.forEach(function (g) {
      var idxs = partIndices(g.key);
      /* 빈 파트는 보는 사람에게 굳이 보여주지 않는다. 편집 중에는 올릴 자리가
         필요하므로 남겨둔다. */
      if (!idxs.length && !state.editMode) return;

      var sec = document.createElement("section");
      sec.className = "part-sec";
      sec.id = "part-" + g.key;
      sec.dataset.part = g.key;

      var head = document.createElement("div");
      head.className = "gallery__head";
      var h2 = document.createElement("h2");
      h2.textContent = g.label;
      var cnt = document.createElement("p");
      cnt.className = "gallery__count";
      cnt.textContent = idxs.length + " pieces";
      head.appendChild(h2);
      head.appendChild(cnt);
      sec.appendChild(head);

      var grid = document.createElement("div");
      grid.className = "grid";
      idxs.forEach(function (abs) { grid.appendChild(buildCard(abs, g.key)); });
      grid.appendChild(buildAddTile(g.key));
      sec.appendChild(grid);

      els.sections.appendChild(sec);
    });

    observeCards();
  }

  function buildAddTile(partKey) {
    var t = document.createElement("button");
    t.type = "button";
    t.className = "card add-tile";
    var plus = document.createElement("span");
    plus.className = "add-tile__plus";
    plus.textContent = "+";
    var label = document.createElement("span");
    label.textContent = "Add to " + partLabel(partKey);
    t.appendChild(plus);
    t.appendChild(label);
    t.addEventListener("click", function () {
      pendingPart = partKey;      /* 올린 파일이 이 파트로 들어간다 */
      els.fileInput.click();
    });
    return t;
  }

  function buildCard(idx, partKey) {
    var item = state.items[idx];
    var card = document.createElement("div");
    card.className = "card";
    card.dataset.id = item.id;
    card.dataset.abs = idx;
    card.draggable = true;
    if (idx === 0) card.classList.add("is-cover");
    if (state.currentIndex === idx) card.classList.add("is-active");
    if (parseYouTubeId(item.video)) card.classList.add("has-video");

    var frame = document.createElement("div");
    frame.className = "card__frame";

    var img = document.createElement("img");
    img.src = thumbSrc(item.id);
    img.loading = "lazy";
    img.alt = displayTitle(item, idx);

    var badge = document.createElement("span");
    badge.className = "card__cover-badge";
    badge.textContent = "COVER";

    var videoMark = document.createElement("span");
    videoMark.className = "card__video";
    videoMark.setAttribute("aria-hidden", "true");

    var overlay = document.createElement("div");
    overlay.className = "card__overlay";
    var num = document.createElement("span");
    num.className = "card__num";
    num.textContent = pad(idx + 1);
    var titleSpan = document.createElement("span");
    titleSpan.className = "card__title";
    titleSpan.textContent = displayTitle(item, idx);
    overlay.appendChild(num);
    overlay.appendChild(titleSpan);

    frame.appendChild(img);
    frame.appendChild(badge);
    frame.appendChild(videoMark);
    frame.appendChild(overlay);

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "card__move card__move--prev";
    prevBtn.textContent = "‹";
    prevBtn.setAttribute("aria-label", "Move earlier");
    prevBtn.addEventListener("click", function (e) { e.stopPropagation(); moveWithinPart(idx, -1, partKey); });

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "card__move card__move--next";
    nextBtn.textContent = "›";
    nextBtn.setAttribute("aria-label", "Move later");
    nextBtn.addEventListener("click", function (e) { e.stopPropagation(); moveWithinPart(idx, 1, partKey); });

    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "card__delete";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", "Delete");
    deleteBtn.addEventListener("click", function (e) { e.stopPropagation(); deleteItem(idx); });

    card.appendChild(prevBtn);
    card.appendChild(frame);
    card.appendChild(nextBtn);
    card.appendChild(deleteBtn);

    attachMotionHover(card, item);
    card.addEventListener("click", function () { openPiece(idx, { scroll: true }); });

    card.addEventListener("dragstart", function (e) {
      dragSrcIndex = idx;
      card.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", String(idx)); } catch (err) {}
    });
    card.addEventListener("dragend", function () {
      card.classList.remove("is-dragging");
      clearDragOver();
      dragSrcIndex = null;
    });
    card.addEventListener("dragover", function (e) {
      if (!state.editMode) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", function () { card.classList.remove("drag-over"); });
    card.addEventListener("drop", function (e) {
      if (!state.editMode) return;
      e.preventDefault();
      clearDragOver();
      if (dragSrcIndex === null || dragSrcIndex === idx) { dragSrcIndex = null; return; }
      /* 파트를 가로지르는 드래그는 순서가 아니라 소속을 바꾸는 일이라 막는다.
         파트 변경은 오른쪽 패널에서 한다. */
      if ((state.items[dragSrcIndex].part || "") !== partKey) { dragSrcIndex = null; return; }
      moveTo(dragSrcIndex, idx);
      dragSrcIndex = null;
    });

    return card;
  }

  function clearDragOver() {
    Array.prototype.forEach.call(els.sections.querySelectorAll(".drag-over"), function (el) {
      el.classList.remove("drag-over");
    });
  }

  function updateCardCaption(idx) {
    var card = cardByIndex(idx);
    if (!card) return;
    var item = state.items[idx];
    var titleEl = card.querySelector(".card__title");
    var imgEl = card.querySelector("img");
    var label = displayTitle(item, idx);
    if (titleEl) titleEl.textContent = label;
    if (imgEl) imgEl.alt = label;
  }

  function updateCardThumb(idx) {
    var card = cardByIndex(idx);
    if (!card) return;
    var imgEl = card.querySelector(".card__frame > img:not(.card__motion-gif)");
    if (imgEl) imgEl.src = thumbSrc(state.items[idx].id);
  }

  function observeCards() {
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    var cards = els.sections.querySelectorAll(".card");
    cards.forEach(function (card, i) {
      card.style.transitionDelay = (Math.min(i % 8, 8) * 45) + "ms";
      io.observe(card);
    });
  }

  // ---------- reordering ----------
  function moveTo(from, to) {
    if (to < 0 || to >= state.items.length || from === to) return;
    var moved = state.items.splice(from, 1)[0];
    state.items.splice(to, 0, moved);

    if (state.currentIndex === from) {
      state.currentIndex = to;
    } else if (state.currentIndex !== null) {
      if (from < state.currentIndex && to >= state.currentIndex) state.currentIndex--;
      else if (from > state.currentIndex && to <= state.currentIndex) state.currentIndex++;
    }

    persist();
    renderGrid();
    if (state.currentIndex !== null) fillPanel(state.items[state.currentIndex], state.currentIndex);
  }

  // ---------- add / delete ----------
  function handleFilesAdded(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return /^image\//.test(f.type) || /^video\//.test(f.type);
    });
    if (!files.length) return;

    var chain = Promise.resolve();
    var addedCount = 0, failed = [], heavy = [];

    files.forEach(function (file) {
      chain = chain.then(function () {
        var mb = Math.round(file.size / 1048576);
        if (file.size > MOTION_MAX_BYTES) {
          failed.push(file.name + " " + mb + "MB");
          return;
        }
        if (file.size > MOTION_WARN_BYTES) heavy.push(file.name + " " + mb + "MB");
        var ext = motionExt(file);
        var loading = /^video\//.test(file.type)
          ? loadVideoFile(file)
          : loadImageFile(file).then(function (img) { return { el: img, revoke: function () {} }; });

        return loading.then(function (src) {
          var el = src.el;
          var w = srcW(el), h = srcH(el);
          if (!w || !h) throw new Error("no frame");
          var fullCanvas = makeFullCanvas(el, FULL_MAX);
          var thumbCanvas = makeThumbCanvas(el, { scale: 1, x: 0.5, y: 0.5 }, THUMB_SIZE);
          return Promise.all([canvasToWebp(fullCanvas, 0.85), canvasToWebp(thumbCanvas, 0.8)])
            .then(function (blobs) {
              src.revoke();
              var id = nextImageId();
              var writes = [];
              function put(key, blob) {
                blobRaw[key] = blob;
                blobMap[key] = URL.createObjectURL(blob);
                writes.push(idbSet(key, blob));
              }
              put(id + ":full", blobs[0]);
              put(id + ":thumb", blobs[1]);
              if (ext) put(id + ":motion", file);   /* 원본을 그대로 보관한다 */
              state.items.push({
                id: id, w: w, h: h, title: "", category: "", year: "", description: "",
                cropScale: 1, cropX: 0.5, cropY: 0.5, video: "", motion: ext,
                part: normalizePart(pendingPart)   /* "+" 를 누른 파트로 들어간다 */
              });
              addedCount++;
              return Promise.all(writes);
            });
        }).catch(function (err) {
          console.error("Failed to add:", file.name, err);
          failed.push(file.name);
        });
      });
    });

    chain.then(function () {
      persist();
      renderGrid();
      var msg = "Added " + addedCount + (addedCount === 1 ? " file" : " files");
      if (heavy.length) {
        msg += " · " + heavy[0] + (heavy.length > 1 ? " and " + (heavy.length - 1) + " more" : "")
             + " is large — saving and loading will be slow";
      }
      if (failed.length) {
        msg += " · " + failed.length + " failed (" + failed[0]
             + (failed.length > 1 ? " and more" : "") + ") — 70MB per file max (GitHub limit)."
             + " MP4/WebM is far smaller than GIF for the same motion";
      }
      flashStatus(msg, failed.length ? "bad" : (heavy.length ? "warn" : ""));
    });
  }

  function deleteItem(idx) {
    if (state.items.length <= 1) {
      window.alert("At least one piece must remain.");
      return;
    }
    var item = state.items[idx];
    if (!window.confirm('Delete "' + displayTitle(item, idx) + '"? This cannot be undone.')) return;

    state.items.splice(idx, 1);
    ["full", "thumb", "motion"].forEach(function (kind) {
      var key = item.id + ":" + kind;
      if (blobRaw[key]) {
        idbDelete(key);
        URL.revokeObjectURL(blobMap[key]);
        delete blobRaw[key];
        delete blobMap[key];
      }
    });

    if (state.currentIndex === idx) {
      showCover();
    } else if (state.currentIndex !== null && state.currentIndex > idx) {
      state.currentIndex--;
    }

    persist();
    renderGrid();
    if (state.currentIndex !== null) fillPanel(state.items[state.currentIndex], state.currentIndex);
    flashStatus("Deleted.");
  }

  els.fileInput.addEventListener("change", function () {
    if (els.fileInput.files && els.fileInput.files.length) handleFilesAdded(els.fileInput.files);
    els.fileInput.value = "";
  });

  els.deleteItemBtn.addEventListener("click", function () {
    if (state.currentIndex !== null) deleteItem(state.currentIndex);
  });

  // ---------- stage (cover / piece) ----------
  function setStageImage(src) {
    els.stageImage.classList.remove("is-loaded");
    var loader = new Image();
    loader.onload = function () {
      els.stageImage.src = src;
      els.stageImage.classList.add("is-loaded");
    };
    loader.src = src;
  }

  function setStageImageInitial() {
    if (!state.items.length) return;
    els.stageImage.src = fullSrc(state.items[0].id);
    els.stageImage.classList.add("is-loaded");
  }

  function showCover() {
    state.currentIndex = null;
    stopStageMotion();
    closeVideo();
    els.stage.classList.remove("has-video");
    els.stage.classList.remove("is-piece");
    setStageImage(fullSrc(state.items[0].id));
    highlightActiveCard();
  }

  function openPiece(idx, opts) {
    opts = opts || {};
    exitCropMode();
    state.currentIndex = idx;
    var item = state.items[idx];
    els.stage.classList.add("is-piece");
    /* GIF 는 <img> 가 직접 재생하므로 포스터 대신 원본을 건다 */
    setStageImage(item.motion === "gif" ? motionSrc(item) : fullSrc(item.id));
    applyMotion(item);
    applyVideo(item);
    fillPanel(item, idx);
    highlightActiveCard();
    if (opts.scroll !== false) els.stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closePiece() {
    exitCropMode();
    showCover();
    els.stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function step(dir) {
    if (state.currentIndex === null) return;
    var list = partIndices(state.items[state.currentIndex].part || "");
    var at = list.indexOf(state.currentIndex);
    if (at === -1) return;
    var next = (at + dir + list.length) % list.length;
    openPiece(list[next], { scroll: true });
  }

  function highlightActiveCard() {
    els.sections.querySelectorAll(".card[data-abs]").forEach(function (card) {
      card.classList.toggle("is-active", Number(card.dataset.abs) === state.currentIndex);
    });
  }

  function setField(el, value, alwaysShow) {
    if (document.activeElement === el) return;
    el.textContent = value || "";
    el.style.display = (!value && !alwaysShow) ? "none" : "";
  }

  function fillPanel(item, idx) {
    els.panelIndex.textContent = pad(idx + 1);
    setField(els.panelCategory, item.category, state.editMode);
    var titleVal = state.editMode ? item.title : displayTitle(item, idx);
    setField(els.panelTitle, titleVal, true);
    setField(els.panelYear, item.year, state.editMode);
    setField(els.panelDesc, item.description, state.editMode);
    els.cropEditBtn.style.display = item.w === item.h ? "none" : "";
    renderPartPick();

    /* 같은 작품을 다시 그릴 때만 입력 중인 값을 보존한다.
       작품이 바뀌면 포커스가 있어도 무조건 새 값으로 덮어쓴다. */
    if (videoInputItemId !== item.id || document.activeElement !== els.videoUrlInput) {
      els.videoUrlInput.value = item.video || "";
    }
    videoInputItemId = item.id;
    var vid = parseYouTubeId(item.video);
    els.videoStatus.textContent = !item.video
      ? ""
      : (vid ? "Video linked · " + vid : "Not a valid YouTube URL");
    els.videoStatus.classList.toggle("is-bad", !!item.video && !vid);
  }

  // ---------- 프로세스 영상 (YouTube) ----------
  /* iframe 은 재생 버튼을 누를 때만 만든다. 미리 심으면 작품을 열 때마다
     유튜브 스크립트를 통째로 받아오고 서드파티 쿠키까지 붙는다. */
  function parseYouTubeId(raw) {
    var v = (raw || "").trim();
    if (!v) return "";
    if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    var m = v.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  var videoInputItemId = null;

  function closeVideo() {
    els.stage.classList.remove("is-video-open");
    els.videoFrame.innerHTML = "";           // iframe 제거 = 재생 중지
    els.videoFacade.setAttribute("aria-expanded", "false");
  }

  function applyVideo(item) {
    closeVideo();
    var id = parseYouTubeId(item && item.video);
    els.stage.classList.toggle("has-video", !!id);
    if (!id) {
      els.videoThumb.removeAttribute("src");
      return;
    }
    els.videoThumb.style.display = "";
    els.videoThumb.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  }

  function openVideo() {
    if (state.currentIndex === null) return;
    var id = parseYouTubeId(state.items[state.currentIndex].video);
    if (!id) return;
    var frame = document.createElement("iframe");
    frame.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0&modestbranding=1";
    frame.title = "Process video";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    els.videoFrame.innerHTML = "";
    els.videoFrame.appendChild(frame);
    els.stage.classList.add("is-video-open");
    els.videoFacade.setAttribute("aria-expanded", "true");
  }

  els.videoThumb.addEventListener("error", function () { els.videoThumb.style.display = "none"; });
  els.videoFacade.addEventListener("click", openVideo);
  els.videoClose.addEventListener("click", closeVideo);

  els.videoUrlInput.addEventListener("input", function () {
    if (state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    item.video = els.videoUrlInput.value.trim();
    var id = parseYouTubeId(item.video);
    els.videoStatus.textContent = !item.video
      ? ""
      : (id ? "Video linked · " + id : "Not a valid YouTube URL");
    els.videoStatus.classList.toggle("is-bad", !!item.video && !id);
    applyVideo(item);
    updateCardVideo(state.currentIndex);
    persist();
  });

  function updateCardVideo(idx) {
    var card = cardByIndex(idx);
    if (!card) return;
    card.classList.toggle("has-video", !!parseYouTubeId(state.items[idx].video));
  }

  // ---------- thumbnail crop ----------
  function computeImageScreenRect() {
    /* 패딩에서 역산하지 말고 이미지 엘리먼트의 실제 박스를 쓴다.
       영상 바가 붙으면 이미지가 flex 로 줄어드는데, 패딩 역산은 그걸 못 본다. */
    var mediaRect = els.stageMedia.getBoundingClientRect();
    var box = els.stageImage.getBoundingClientRect();
    var nw = els.stageImage.naturalWidth, nh = els.stageImage.naturalHeight;
    if (!nw || !nh || box.width <= 0 || box.height <= 0) return null;
    var scale = Math.min(box.width / nw, box.height / nh);
    var rw = nw * scale, rh = nh * scale;
    return {
      left: box.left + (box.width - rw) / 2,
      top: box.top + (box.height - rh) / 2,
      width: rw, height: rh, mediaRect: mediaRect,
    };
  }

  var MIN_CROP_SCALE = 0.2;   /* 슬라이더 최소 배율 (index.html 의 min=20 과 짝) */

  function positionCropBox() {
    var rect = computeImageScreenRect();
    if (!rect || state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    var crop = normalizeCrop(item);
    var maxSquare = Math.min(rect.width, rect.height);
    var square = maxSquare * crop.scale;
    var travelX = rect.width - square;
    var travelY = rect.height - square;
    var x = (rect.left - rect.mediaRect.left) + travelX * crop.x;
    var y = (rect.top - rect.mediaRect.top) + travelY * crop.y;
    els.cropBox.style.left = x + "px";
    els.cropBox.style.top = y + "px";
    els.cropBox.style.width = square + "px";
    els.cropBox.style.height = square + "px";
  }

  var cropDrag = null;
  var cropSnapshot = null;
  function enterCropMode() {
    if (state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    if (item.w === item.h) { flashStatus("Square images need no thumbnail adjustment"); return; }
    closeVideo();                      /* 크롭 중에는 영상 바를 숨기므로 재생도 멈춘다 */
    els.stageMotion.pause();
    if (item.motion === "gif") els.stageImage.src = fullSrc(item.id);   /* 움직이는 프레임 위에서 자를 수 없다 */
    cropSnapshot = normalizeCrop(item);
    els.stage.classList.add("is-cropping");
    els.cropZoomRange.value = String(Math.round(cropSnapshot.scale * 100));
    positionCropBox();
  }
  function exitCropMode() {
    if (!els.stage.classList.contains("is-cropping")) return;
    if (state.currentIndex !== null && cropSnapshot) {
      var item = state.items[state.currentIndex];
      item.cropScale = cropSnapshot.scale;
      item.cropX = cropSnapshot.x;
      item.cropY = cropSnapshot.y;
    }
    els.stage.classList.remove("is-cropping");
    cropDrag = null;
    cropSnapshot = null;
    if (state.currentIndex !== null) {
      var cur = state.items[state.currentIndex];
      if (cur && cur.motion === "gif") els.stageImage.src = motionSrc(cur);
      if (cur && isVideoMotion(cur)) { var pp = els.stageMotion.play(); if (pp && pp.catch) pp.catch(function(){}); }
    }
  }

  els.cropBox.addEventListener("pointerdown", function (e) {
    var rect = computeImageScreenRect();
    if (!rect || state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    var crop = normalizeCrop(item);
    var square = Math.min(rect.width, rect.height) * crop.scale;
    cropDrag = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: crop.x,
      startY: crop.y,
      travelX: rect.width - square,
      travelY: rect.height - square,
    };
    els.cropBox.classList.add("is-dragging");
    try { els.cropBox.setPointerCapture(e.pointerId); } catch (err) {}
  });
  els.cropBox.addEventListener("pointermove", function (e) {
    if (!cropDrag || state.currentIndex === null) return;
    var dx = e.clientX - cropDrag.startClientX;
    var dy = e.clientY - cropDrag.startClientY;
    var item = state.items[state.currentIndex];
    item.cropX = Math.max(0, Math.min(1, cropDrag.travelX > 0 ? cropDrag.startX + dx / cropDrag.travelX : 0.5));
    item.cropY = Math.max(0, Math.min(1, cropDrag.travelY > 0 ? cropDrag.startY + dy / cropDrag.travelY : 0.5));
    positionCropBox();
  });
  function endCropDrag() {
    if (!cropDrag) return;
    cropDrag = null;
    els.cropBox.classList.remove("is-dragging");
  }
  els.cropBox.addEventListener("pointerup", endCropDrag);
  els.cropBox.addEventListener("pointercancel", endCropDrag);

  els.cropZoomRange.addEventListener("input", function () {
    if (state.currentIndex === null) return;
    var pct = Math.max(MIN_CROP_SCALE * 100, Math.min(100, Number(els.cropZoomRange.value)));
    state.items[state.currentIndex].cropScale = pct / 100;
    positionCropBox();
  });

  els.cropEditBtn.addEventListener("click", enterCropMode);
  els.cropCancelBtn.addEventListener("click", exitCropMode);
  els.cropCenterBtn.addEventListener("click", function () {
    if (state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    item.cropX = 0.5;
    item.cropY = 0.5;
    positionCropBox();
  });
  els.cropApplyBtn.addEventListener("click", function () {
    var idx = state.currentIndex;
    if (idx === null) return;
    var item = state.items[idx];
    var thumbCanvas = makeThumbCanvas(els.stageImage, normalizeCrop(item), THUMB_SIZE);
    canvasToWebp(thumbCanvas, 0.8).then(function (blob) {
      var key = item.id + ":thumb";
      if (blobMap[key]) URL.revokeObjectURL(blobMap[key]);
      blobRaw[key] = blob;
      blobMap[key] = URL.createObjectURL(blob);
      idbSet(key, blob).catch(function () {});
      cropSnapshot = normalizeCrop(item);
      persist();
      updateCardThumb(idx);
      exitCropMode();
      flashStatus("Thumbnail updated — use \"Export image files\" when you are ready");
    });
  });

  window.addEventListener("resize", function () {
    if (els.stage.classList.contains("is-cropping")) positionCropBox();
  });

  // ---------- edit mode ----------
  function setEditMode(on) {
    state.editMode = on;
    els.body.classList.toggle("edit-mode", on);
    els.editToggle.textContent = on ? "Done editing" : "Edit";
    if (!on) exitCropMode();

    [els.coverTagline, els.panelCategory, els.panelTitle, els.panelYear, els.panelDesc].forEach(function (el) {
      el.setAttribute("contenteditable", on ? "true" : "false");
    });
    els.brandName.setAttribute("contenteditable", on ? "true" : "false");

    renderGrid();
    if (state.currentIndex !== null) fillPanel(state.items[state.currentIndex], state.currentIndex);
  }

  function bindEditable(el, onChange) {
    el.addEventListener("input", function () {
      onChange(el.textContent.trim());
      persist();
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && el !== els.panelDesc) {
        e.preventDefault();
        el.blur();
      }
    });
  }

  bindEditable(els.coverTagline, function (v) { state.meta.tagline = v; });
  bindEditable(els.brandName, function (v) { state.meta.siteName = v; syncSiteNameMirrors(); });
  bindEditable(els.panelCategory, function (v) { if (state.currentIndex !== null) state.items[state.currentIndex].category = v; });
  bindEditable(els.panelTitle, function (v) {
    if (state.currentIndex !== null) {
      state.items[state.currentIndex].title = v;
      updateCardCaption(state.currentIndex);
    }
  });
  bindEditable(els.panelYear, function (v) { if (state.currentIndex !== null) state.items[state.currentIndex].year = v; });
  bindEditable(els.panelDesc, function (v) { if (state.currentIndex !== null) state.items[state.currentIndex].description = v; });

  Array.prototype.forEach.call(els.partPick.children, function (b) {
    b.addEventListener("click", function () {
      if (state.currentIndex === null) return;
      state.items[state.currentIndex].part = b.dataset.part;
      persist();
      renderPartPick();
      renderGrid();
      flashStatus("Moved to " + partLabel(b.dataset.part));
    });
  });

  els.brandName.addEventListener("click", function (e) { if (state.editMode) e.preventDefault(); });

  // ---------- export / reset ----------
  function formatItem(it) {
    var crop = normalizeCrop(it);
    return "  { id: " + JSON.stringify(it.id) + ", w: " + it.w + ", h: " + it.h +
      ", title: " + JSON.stringify(it.title) + ", category: " + JSON.stringify(it.category) +
      ", year: " + JSON.stringify(it.year) + ", description: " + JSON.stringify(it.description) +
      ", cropScale: " + crop.scale + ", cropX: " + crop.x + ", cropY: " + crop.y +
      ", video: " + JSON.stringify(it.video || "") +
      ", motion: " + JSON.stringify(it.motion || "") +
      ", part: " + JSON.stringify(normalizePart(it.part)) + " }";
  }

  function buildDataFileText() {
    var lines = [];
    lines.push("/*");
    lines.push("  Exported from edit mode.");
    lines.push("  Overwrite js/data.js with this file to make these edits the defaults.");
    lines.push("  If you added images or re-cropped thumbnails, also drop the webp files from");
    lines.push("  \"Export image files\" into assets/img/full and assets/img/thumb.");
    lines.push("*/");
    lines.push("");
    lines.push("window.SITE_META = {");
    lines.push("  siteName: " + JSON.stringify(state.meta.siteName || "") + ",");
    lines.push("  tagline: " + JSON.stringify(state.meta.tagline || ""));
    lines.push("};");
    lines.push("");
    lines.push("window.PORTFOLIO_DATA = [");
    state.items.forEach(function (it, i) {
      lines.push(formatItem(it) + (i < state.items.length - 1 ? "," : ""));
    });
    lines.push("];");
    lines.push("");
    return lines.join("\n");
  }

  var statusTimer = null;
  function flashStatus(msg, kind) {
    clearTimeout(statusTimer);
    els.editStatus.textContent = msg;
    els.editStatus.classList.toggle("is-ok", kind === "ok");
    els.editStatus.classList.toggle("is-warn", kind === "warn");
    els.editStatus.classList.toggle("is-bad", kind === "bad");
    /* 경고·실패는 읽어야 할 내용이 있으니 더 오래 띄운다 */
    var hold = (kind === "bad" || kind === "warn") ? 9000 : 3200;
    statusTimer = setTimeout(function () {
      els.editStatus.classList.remove("is-ok");
      els.editStatus.classList.remove("is-warn");
      els.editStatus.classList.remove("is-bad");
      els.editStatus.textContent = "Edit mode · changes are saved automatically in this browser";
    }, hold);
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  els.exportBtn.addEventListener("click", function () {
    var text = buildDataFileText();
    downloadBlob(new Blob([text], { type: "text/javascript" }), "data.js");
    flashStatus("Exported data.js — replace js/data.js with this file");
  });

  els.exportImagesBtn.addEventListener("click", function () {
    var keys = Object.keys(blobRaw);
    if (!keys.length) { flashStatus("No new image files to export"); return; }
    keys.forEach(function (key) {
      var parts = key.split(":");
      downloadBlob(blobRaw[key], parts[1] === "motion"
        ? parts[0] + "-motion." + assetPath(key).split(".").pop()
        : parts[0] + "-" + parts[1] + ".webp");
    });
    flashStatus("Exported " + keys.length + " image files — strip the -full/-thumb suffix and put them in assets/img/full and assets/img/thumb");
  });

  els.resetBtn.addEventListener("click", function () {
    if (!window.confirm("Reset all edits — order, text and added images? This cannot be undone.")) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    Object.keys(blobMap).forEach(function (key) { URL.revokeObjectURL(blobMap[key]); });
    blobMap = {};
    blobRaw = {};
    idbClearAll().catch(function () {});
    var loaded = loadState();
    state.items = loaded.items;
    state.meta = loaded.meta;
    state.currentIndex = null;
    closeVideo();
    els.stage.classList.remove("has-video");
    els.stage.classList.remove("is-piece");
    exitCropMode();
    renderMeta();
    setStageImageInitial();
    renderGrid();
    flashStatus("Edits reset.");
  });

  // ---------- 파트 (일러스트 / 애니메이션 / 개발) ----------
  /* 탭으로 감추지 않고 아래로 쌓는다. 펼치지 않아도 전부 보인다. */
  var PART_SECTIONS = [
    { key: "illust", label: "Illustration" },
    { key: "anim",   label: "Animation" },
    { key: "ai",     label: "AI-Assisted" },
    { key: "dev",    label: "Development" }
  ];
  var pendingPart = DEFAULT_PART;   /* "+" 를 누른 파트 — 올린 파일이 여기로 들어간다 */

  function partLabel(key) {
    for (var i = 0; i < PART_SECTIONS.length; i++) {
      if (PART_SECTIONS[i].key === key) return PART_SECTIONS[i].label;
    }
    return "Illustration";
  }
  function partIndices(part) {
    var out = [];
    state.items.forEach(function (it, i) { if ((it.part || "") === part) out.push(i); });
    return out;
  }
  function cardByIndex(absIdx) {
    return els.sections.querySelector('.card[data-abs="' + absIdx + '"]');
  }
  /* 같은 파트 안에서만 한 칸 옮긴다 */
  function moveWithinPart(abs, dir, partKey) {
    var list = partIndices(partKey);
    var at = list.indexOf(abs);
    var to = at + dir;
    if (at === -1 || to < 0 || to >= list.length) return;
    moveTo(abs, list[to]);
  }

  function renderPartPick() {
    var item = state.currentIndex === null ? null : state.items[state.currentIndex];
    Array.prototype.forEach.call(els.partPick.children, function (b) {
      var on = item && (item.part || "") === b.dataset.part;
      b.classList.toggle("is-on", !!on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // ---------- 모션 자산 (GIF / 영상) ----------
  /* 원본 파일은 그대로 보관하고 첫 프레임을 포스터(full/thumb webp)로 만든다.
     평소에는 포스터를 보여주고 호버·상세에서만 재생한다 — 그리드 수십 칸이
     한꺼번에 재생되면 브라우저가 버티지 못한다. */
  /* 한 파일의 상한은 우리 취향이 아니라 GitHub 이 정한다 — 한 파일 100MB 를
     넘기면 받아주지 않는다. "Save to site" 버튼은 파일을 base64 로 바꿔 올리는데
     그 과정에서 4/3 배로 부풀기 때문에, 원본이 75MB 를 넘으면 그 시점에
     업로드가 깨진다. 그래서 70MB 를 천장으로 둔다.
     20MB 부터는 막지 않고 알려만 준다 — 올라는 가지만 보는 사람이 기다린다. */
  var MOTION_MAX_BYTES = 70 * 1024 * 1024;
  var MOTION_WARN_BYTES = 20 * 1024 * 1024;

  function motionExt(file) {
    if (file.type === "image/gif") return "gif";
    if (file.type === "video/mp4") return "mp4";
    if (file.type === "video/webm") return "webm";
    if (/^video\//.test(file.type)) {
      var m = /\.([a-z0-9]+)$/i.exec(file.name || "");
      return m ? m[1].toLowerCase() : "mp4";
    }
    return "";
  }
  function motionSrc(item) {
    if (!item || !item.motion) return "";
    return blobMap[item.id + ":motion"] || ("assets/img/motion/" + item.id + "." + item.motion);
  }
  function isVideoMotion(item) { return !!item && !!item.motion && item.motion !== "gif"; }

  /* 영상에서 포스터로 쓸 프레임을 뽑는다 */
  function loadVideoFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement("video");
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve({ el: v, revoke: function () { URL.revokeObjectURL(url); } });
      }
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadeddata = function () {
        /* 0초는 검은 프레임인 경우가 많아 살짝 뒤로 옮긴다 */
        try { v.currentTime = Math.min(0.1, (v.duration || 1) / 10); } catch (e) { finish(); }
      };
      v.onseeked = finish;
      v.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      v.src = url;
      setTimeout(finish, 4000);   /* seeked 가 오지 않는 브라우저 대비 */
    });
  }

  /* 상세 화면 재생 */
  function stopStageMotion() {
    var v = els.stageMotion;
    if (v.getAttribute("src")) {
      v.pause();
      v.removeAttribute("src");
      v.load();          /* src 만 지우면 버퍼가 남아 계속 재생되는 브라우저가 있다 */
    }
    els.stage.classList.remove("is-motion");
  }
  function applyMotion(item) {
    if (!item || !item.motion) { stopStageMotion(); return; }
    if (isVideoMotion(item)) {
      els.stageMotion.src = motionSrc(item);
      els.stage.classList.add("is-motion");
      var p = els.stageMotion.play();
      if (p && p.catch) p.catch(function () {});   /* 막혀도 컨트롤로 재생 가능 */
    } else {
      stopStageMotion();   /* GIF 는 <img> 가 직접 재생한다 */
    }
  }

  /* 썸네일로 잘라둔 그 사각형이 카드를 채우도록 미디어를 직접 앉힌다.
     object-fit:cover 는 무조건 한가운데를 쓰기 때문에, 작가가 지정한 크롭 위치가
     재생 순간 무시된다. makeThumbCanvas 의 계산을 그대로 옮긴다.

       box = min(w,h) * scale
       sx  = (w - box) * cropX
       sy  = (h - box) * cropY

     길이는 전부 카드 '가로'만 기준으로 삼는다. 가로는 너비, 세로는 높이로 재면
     카드가 정사각형이 아닌 순간(그리드 stretch 등) 두 축이 서로 다른 배율로
     늘어나 비율이 깨진다 — 퍼센트 margin 은 세로 방향이라도 가로를 기준으로
     계산되므로 top 대신 이걸 쓴다. 비율은 aspect-ratio 로 못박는다.

     w/h 는 호출부가 넘겨준 실제 미디어 크기를 우선 쓴다. 저장된 값이 원본과
     다를 수 있고, 그러면 그 차이가 그대로 찌그러짐이 된다. */
  function applyCropBox(el, item, w, h) {
    w = w || item.w; h = h || item.h;
    if (!w || !h) return;
    var crop = normalizeCrop(item);
    var box = Math.min(w, h) * crop.scale;
    if (!(box > 0)) return;
    var sx = (w - box) * crop.x;
    var sy = (h - box) * crop.y;
    el.style.position = "absolute";
    el.style.left = "0"; el.style.top = "0";
    /* 전역 리셋의 img{max-width:100%} 가 크롭 상자를 잘라낸다. 크롭을 작게
       잡을수록 상자는 카드보다 커지는데(예: 배율 0.4 -> 너비 750%), 너비만
       100% 로 잘리고 높이는 그대로 남아 엉뚱한 자리가 늘어난 채로 나온다.
       배율이 1 일 때는 너비가 정확히 100% 라 잘릴 게 없어 멀쩡해 보인다. */
    el.style.maxWidth = "none";
    el.style.maxHeight = "none";
    el.style.width = (w / box * 100) + "%";
    el.style.height = "auto";                 /* 세로는 비율이 정한다 */
    el.style.aspectRatio = w + " / " + h;     /* 찌그러짐 자체를 불가능하게 */
    el.style.marginLeft = (-sx / box * 100) + "%";
    el.style.marginTop = (-sy / box * 100) + "%";
    el.style.objectFit = "fill";
  }

  /* 썸네일 호버 재생 */
  function attachMotionHover(card, item) {
    if (!item.motion) return;
    card.classList.add("has-motion");
    var frame = card.querySelector(".card__frame");
    var badge = document.createElement("span");
    badge.className = "card__motion-badge";
    badge.textContent = item.motion.toUpperCase();
    frame.appendChild(badge);

    if (!window.matchMedia("(pointer:fine)").matches) return;   /* 터치기기엔 호버가 없다 */

    /* 재생용 원본은 포스터와 별개의 요소로 둔다.
       포스터가 든 <img> 의 src 를 갈아끼우면, 원본이 도착하기 전까지
       정사각 포스터(720x720)가 원본 비율의 상자에 갇혀 늘어난 채 보이고
       원본이 도착하는 순간 제자리를 찾으면서 화면이 튄다.
       포스터는 그대로 두고, 다 받아온 뒤에만 원본을 그 위에 얹는다. */
    var motionEl = null, ready = false, hovering = false;
    var isGif = item.motion === "gif";

    function reveal() {
      if (!ready || !hovering) return;
      card.classList.add("is-playing");
      if (!isGif) {
        var p = motionEl.play();
        if (p && p.catch) p.catch(function () {});
      }
    }

    function ensureMotion() {
      if (motionEl) return motionEl;
      motionEl = document.createElement(isGif ? "img" : "video");
      motionEl.className = isGif ? "card__motion-gif" : "card__motion-video";
      if (isGif) {
        motionEl.alt = "";
        motionEl.decoding = "async";
        motionEl.addEventListener("load", function () {
          applyCropBox(motionEl, item, motionEl.naturalWidth, motionEl.naturalHeight);
          ready = true; reveal();
        });
      } else {
        motionEl.muted = true; motionEl.loop = true; motionEl.playsInline = true;
        motionEl.preload = "auto";
        motionEl.addEventListener("loadeddata", function () {
          applyCropBox(motionEl, item, motionEl.videoWidth, motionEl.videoHeight);
          ready = true; reveal();
        });
      }
      frame.appendChild(motionEl);
      applyCropBox(motionEl, item);     /* 썸네일로 지정한 그 자리 */
      motionEl.src = motionSrc(item);
      return motionEl;
    }

    card.addEventListener("mouseenter", function () {
      hovering = true;
      var el = ensureMotion();
      /* 크롭을 다시 잡아도 카드는 새로 만들어지지 않는다(썸네일 그림만 갈아끼운다).
         만들어 둘 때 한 번만 앉히면 그 뒤에 바꾼 크롭이 재생에 반영되지 않아,
         썸네일과 재생 화면이 서로 다른 자리·다른 배율이 된다. 매번 다시 앉힌다. */
      applyCropBox(el, item, el.naturalWidth || el.videoWidth, el.naturalHeight || el.videoHeight);
      reveal();                         /* 이미 받아둔 뒤라면 곧바로 나온다 */
    });
    card.addEventListener("mouseleave", function () {
      hovering = false;
      card.classList.remove("is-playing");
      /* GIF 는 받아둔 채로 남겨 둔다 — 다시 올렸을 때 기다리지 않도록.
         영상은 멈춰서 소리 없는 재생이 계속되지 않게 한다. */
      if (motionEl && !isGif) {
        motionEl.pause();
        try { motionEl.currentTime = 0; } catch (e) {}
      }
    });
  }

  // ---------- 사이트에 저장 (GitHub Git Data API) ----------
  /* data.js 와 새/재크롭 이미지를 커밋 하나로 한 번에 올린다.
     파일을 하나씩 올리면 중간에 끊겼을 때 data.js 는 새것인데
     이미지는 아직 없는 상태가 배포된다. */
  var REPO_OWNER = "gnmGames";
  var REPO_NAME = "illustrator-portfolio";
  var REPO_BRANCH = "main";
  var TOKEN_KEY = "illustPortfolio:ghToken";

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }
  function setToken(v, remember) {
    try {
      sessionStorage.setItem(TOKEN_KEY, v);
      if (remember) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }
  function forgetToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  function openTokenPanel() {
    els.tokenInput.value = "";
    try { els.tokenRemember.checked = !!localStorage.getItem(TOKEN_KEY); } catch (e) {}
    els.tokenPanel.classList.add("is-open");
    els.tokenInput.focus();
  }
  function closeTokenPanel() {
    els.tokenPanel.classList.remove("is-open");
    els.tokenInput.value = "";      /* 토큰 문자열을 DOM 에 남기지 않는다 */
  }

  function ghApi(method, path, token, body) {
    return fetch("https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + path, {
      method: method,
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.ok) return res.json();
      var err = new Error("github " + res.status);
      err.status = res.status;
      throw err;
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(new Error("read fail")); };
      r.readAsDataURL(blob);
    });
  }

  function describeGhError(e) {
    if (e && e.status === 401) return "Token is not valid — please issue a new one";
    if (e && e.status === 403) return "Not enough permission — check that Contents is set to Read and write";
    if (e && e.status === 404) return "Cannot reach the repository — check that the token has illustrator-portfolio selected";
    if (e && (e.status === 409 || e.status === 422)) return "The repository changed meanwhile — reload and try again";
    if (e && e.status) return "Save failed (error " + e.status + ")";
    return "Save failed — check your network";
  }

  function publishToSite() {
    var token = getToken();
    if (!token) { openTokenPanel(); return; }

    els.publishBtn.disabled = true;
    var keys = Object.keys(blobRaw);
    var baseSha, baseTree, tree = [];
    flashStatus("Preparing…", "");

    ghApi("GET", "/git/ref/heads/" + REPO_BRANCH, token)
      .then(function (ref) {
        baseSha = ref.object.sha;
        return ghApi("GET", "/git/commits/" + baseSha, token);
      })
      .then(function (commit) {
        baseTree = commit.tree.sha;
        tree.push({ path: "js/data.js", mode: "100644", type: "blob", content: buildDataFileText() });

        /* 이미지는 blob 으로 올린 뒤 트리에 sha 로 엮는다 */
        return keys.reduce(function (chain, key, i) {
          return chain.then(function () {
            flashStatus("Uploading images " + (i + 1) + "/" + keys.length + "…", "");
            return blobToBase64(blobRaw[key])
              .then(function (b64) {
                return ghApi("POST", "/git/blobs", token, { content: b64, encoding: "base64" });
              })
              .then(function (blob) {
                tree.push({
                  path: assetPath(key),
                  mode: "100644", type: "blob", sha: blob.sha
                });
              });
          });
        }, Promise.resolve());
      })
      .then(function () {
        flashStatus("Committing…", "");
        return ghApi("POST", "/git/trees", token, { base_tree: baseTree, tree: tree });
      })
      .then(function (newTree) {
        var msg = "site: save " + state.items.length + " pieces"
          + (keys.length ? " (" + keys.length + " images)" : "");
        return ghApi("POST", "/git/commits", token, {
          message: msg, tree: newTree.sha, parents: [baseSha]
        });
      })
      .then(function (commit) {
        return ghApi("PATCH", "/git/refs/heads/" + REPO_BRANCH, token, { sha: commit.sha });
      })
      .then(function () {
        flashStatus("Saved — live on the site in 1-2 minutes", "ok");
      })
      .catch(function (e) {
        flashStatus(describeGhError(e), "bad");
      })
      .then(function () {
        els.publishBtn.disabled = false;
      });
  }

  els.publishBtn.addEventListener("click", publishToSite);
  /* 토큰이 이미 저장돼 있으면 publishToSite 가 패널을 열지 않으므로,
     토큰을 바꾸거나 지우려면 이 버튼이 필요하다 */
  els.tokenBtn.addEventListener("click", openTokenPanel);
  els.tokenCancelBtn.addEventListener("click", closeTokenPanel);
  els.tokenForgetBtn.addEventListener("click", function () {
    forgetToken();
    closeTokenPanel();
    flashStatus("Stored token cleared", "");
  });
  els.tokenSaveBtn.addEventListener("click", function () {
    var v = els.tokenInput.value.trim();
    if (!v) { els.tokenInput.focus(); return; }
    setToken(v, els.tokenRemember.checked);
    closeTokenPanel();
    publishToSite();
  });
  els.tokenInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); els.tokenSaveBtn.click(); }
    if (e.key === "Escape") { e.preventDefault(); closeTokenPanel(); }
  });
  els.tokenPanel.addEventListener("click", function (e) {
    if (e.target === els.tokenPanel) closeTokenPanel();
  });

  // ---------- nav wiring ----------
  els.prevBtn.addEventListener("click", function () { step(-1); });
  els.nextBtn.addEventListener("click", function () { step(1); });
  els.arrowPrev.addEventListener("click", function () { step(-1); });
  els.arrowNext.addEventListener("click", function () { step(1); });
  els.stageClose.addEventListener("click", closePiece);
  els.editToggle.addEventListener("click", function () { setEditMode(!state.editMode); });
  els.scrollCue.addEventListener("click", function () { els.gallery.scrollIntoView({ behavior: "smooth" }); });
  els.worksLink.addEventListener("click", function () { els.sections.scrollIntoView({ behavior: "smooth", block: "start" }); });

  document.addEventListener("keydown", function (e) {
    var active = document.activeElement;
    if (active && active.getAttribute && active.getAttribute("contenteditable") === "true") return;
    if (els.stage.classList.contains("is-cropping")) {
      if (e.key === "Escape") exitCropMode();
      return;
    }
    /* 폼 입력 중에는 방향키·Esc 를 가로채지 않는다.
       URL 칸에서 캐럿을 옮기려다 작품이 넘어가면, 이전 작품의 주소가
       그대로 남아 다음 타이핑에 엉뚱한 작품으로 저장된다. */
    var tag = active && active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (els.tokenPanel.classList.contains("is-open")) return;

    /* 스페이스바: 작품을 보고 있을 때만 다음으로. 커버·갤러리에서는
       기본 동작(페이지 스크롤)을 그대로 둔다. Shift+Space 는 이전. */
    if (e.key === " " || e.code === "Space") {
      if (state.currentIndex === null) return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Escape" && state.currentIndex !== null) closePiece();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  // ---------- custom cursor ----------
  (function () {
    if (!window.matchMedia("(pointer:fine)").matches) return;
    document.addEventListener("mousemove", function (e) {
      els.cursorDot.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
    });
    var hoverSelector = "a,button,.card,[contenteditable='true']";
    document.addEventListener("mouseover", function (e) {
      if (e.target.closest && e.target.closest(hoverSelector)) els.cursorDot.classList.add("is-hover");
    });
    document.addEventListener("mouseout", function (e) {
      if (e.target.closest && e.target.closest(hoverSelector)) els.cursorDot.classList.remove("is-hover");
    });
  })();

  // ---------- init ----------
  function init() {
    var loaded = loadState();
    state.items = loaded.items;
    state.meta = loaded.meta;
    state.currentIndex = null;

    els.footYear.textContent = new Date().getFullYear();
    renderMeta();
    setStageImageInitial();
    renderGrid();

    loadBlobsFromDB().then(function () {
      renderGrid();
      if (state.currentIndex === null) setStageImageInitial();
    });

    setEditMode(false);
  }

  init();
})();
