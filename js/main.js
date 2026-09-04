(function () {
  "use strict";

  var STORAGE_KEY = "illustPortfolio:v1";
  var COUNTER_KEY = "illustPortfolio:counter";
  var DB_NAME = "illustPortfolioDB";
  var DB_STORE = "images";
  var FULL_MAX = 2200;
  var THUMB_SIZE = 720;

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
    grid: document.getElementById("grid"),
    galleryCount: document.getElementById("galleryCount"),
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
  };

  var state = {
    items: [],
    meta: { siteName: "", tagline: "" },
    currentIndex: null,
    editMode: false,
  };

  var dragSrcIndex = null;
  var io = null;
  var blobMap = {}; // "{id}:full" | "{id}:thumb" -> object URL
  var blobRaw = {}; // same key -> Blob

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
  function makeFullCanvas(imgEl, maxDim) {
    var w = imgEl.naturalWidth, h = imgEl.naturalHeight;
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
    var w = imgEl.naturalWidth, h = imgEl.naturalHeight;
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
        byId[a.id] = { id: a.id, w: a.w, h: a.h, title: "", category: "", year: "", description: "", cropScale: 1, cropX: 0.5, cropY: 0.5, video: "" };
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
        edits[it.id] = { title: it.title, category: it.category, year: it.year, description: it.description, cropScale: crop.scale, cropX: crop.x, cropY: crop.y, video: it.video || "" };
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
      edits[it.id] = { title: it.title, category: it.category, year: it.year, description: it.description, cropScale: crop.scale, cropX: crop.x, cropY: crop.y, video: it.video || "" };
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
    els.grid.innerHTML = "";
    els.galleryCount.textContent = state.items.length;
    els.panelTotal.textContent = pad(state.items.length);

    state.items.forEach(function (item, idx) {
      var card = document.createElement("div");
      card.className = "card";
      card.dataset.id = item.id;
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
      prevBtn.setAttribute("aria-label", "앞으로 이동");
      prevBtn.addEventListener("click", function (e) { e.stopPropagation(); moveTo(idx, idx - 1); });

      var nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className = "card__move card__move--next";
      nextBtn.textContent = "›";
      nextBtn.setAttribute("aria-label", "뒤로 이동");
      nextBtn.addEventListener("click", function (e) { e.stopPropagation(); moveTo(idx, idx + 1); });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "card__delete";
      deleteBtn.textContent = "✕";
      deleteBtn.setAttribute("aria-label", "삭제");
      deleteBtn.addEventListener("click", function (e) { e.stopPropagation(); deleteItem(idx); });

      card.appendChild(prevBtn);
      card.appendChild(frame);
      card.appendChild(nextBtn);
      card.appendChild(deleteBtn);

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
        if (dragSrcIndex === null || dragSrcIndex === idx) return;
        moveTo(dragSrcIndex, idx);
        dragSrcIndex = null;
      });

      els.grid.appendChild(card);
    });

    var addTile = document.createElement("button");
    addTile.type = "button";
    addTile.className = "card add-tile";
    var plus = document.createElement("span");
    plus.className = "add-tile__plus";
    plus.textContent = "+";
    var addLabel = document.createElement("span");
    addLabel.textContent = "이미지 추가";
    addTile.appendChild(plus);
    addTile.appendChild(addLabel);
    addTile.addEventListener("click", function () { els.fileInput.click(); });
    els.grid.appendChild(addTile);

    observeCards();
  }

  function clearDragOver() {
    Array.prototype.forEach.call(els.grid.querySelectorAll(".drag-over"), function (el) {
      el.classList.remove("drag-over");
    });
  }

  function updateCardCaption(idx) {
    var card = els.grid.children[idx];
    if (!card) return;
    var item = state.items[idx];
    var titleEl = card.querySelector(".card__title");
    var imgEl = card.querySelector("img");
    var label = displayTitle(item, idx);
    if (titleEl) titleEl.textContent = label;
    if (imgEl) imgEl.alt = label;
  }

  function updateCardThumb(idx) {
    var card = els.grid.children[idx];
    if (!card) return;
    var imgEl = card.querySelector(".card__frame > img");
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
    var cards = els.grid.querySelectorAll(".card");
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
    var files = Array.prototype.filter.call(fileList, function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;

    var chain = Promise.resolve();
    var addedCount = 0;
    files.forEach(function (file) {
      chain = chain.then(function () {
        return loadImageFile(file).then(function (img) {
          var id = nextImageId();
          var fullCanvas = makeFullCanvas(img, FULL_MAX);
          var thumbCanvas = makeThumbCanvas(img, { scale: 1, x: 0.5, y: 0.5 }, THUMB_SIZE);
          return Promise.all([canvasToWebp(fullCanvas, 0.85), canvasToWebp(thumbCanvas, 0.8)]).then(function (blobs) {
            var fullBlob = blobs[0], thumbBlob = blobs[1];
            var fullKey = id + ":full", thumbKey = id + ":thumb";
            blobRaw[fullKey] = fullBlob; blobMap[fullKey] = URL.createObjectURL(fullBlob);
            blobRaw[thumbKey] = thumbBlob; blobMap[thumbKey] = URL.createObjectURL(thumbBlob);
            state.items.push({ id: id, w: img.naturalWidth, h: img.naturalHeight, title: "", category: "", year: "", description: "", cropScale: 1, cropX: 0.5, cropY: 0.5, video: "" });
            addedCount++;
            return Promise.all([idbSet(fullKey, fullBlob), idbSet(thumbKey, thumbBlob)]);
          });
        }).catch(function (err) { console.error("이미지 추가 실패:", file.name, err); });
      });
    });

    chain.then(function () {
      persist();
      renderGrid();
      flashStatus(addedCount + "개 이미지를 추가했습니다 — 준비되면 \"이미지 파일 내보내기\"로 저장하세요");
    });
  }

  function deleteItem(idx) {
    if (state.items.length <= 1) {
      window.alert("최소 1개의 이미지는 남아있어야 합니다.");
      return;
    }
    var item = state.items[idx];
    if (!window.confirm('"' + displayTitle(item, idx) + '" 작품을 삭제할까요? 이 동작은 되돌릴 수 없습니다.')) return;

    state.items.splice(idx, 1);
    ["full", "thumb"].forEach(function (kind) {
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
    flashStatus("작품을 삭제했습니다");
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
    setStageImage(fullSrc(item.id));
    applyVideo(item);
    fillPanel(item, idx);
    highlightActiveCard();
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closePiece() {
    exitCropMode();
    showCover();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function step(dir) {
    if (state.currentIndex === null) return;
    var n = state.items.length;
    var next = (state.currentIndex + dir + n) % n;
    openPiece(next, { scroll: true });
  }

  function highlightActiveCard() {
    var cards = els.grid.querySelectorAll(".card");
    cards.forEach(function (card, i) {
      card.classList.toggle("is-active", i === state.currentIndex);
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

    /* 같은 작품을 다시 그릴 때만 입력 중인 값을 보존한다.
       작품이 바뀌면 포커스가 있어도 무조건 새 값으로 덮어쓴다. */
    if (videoInputItemId !== item.id || document.activeElement !== els.videoUrlInput) {
      els.videoUrlInput.value = item.video || "";
    }
    videoInputItemId = item.id;
    var vid = parseYouTubeId(item.video);
    els.videoStatus.textContent = !item.video
      ? ""
      : (vid ? "영상 연결됨 · " + vid : "YouTube 주소를 인식하지 못했습니다");
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
    frame.title = "제작 과정 영상";
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
      : (id ? "영상 연결됨 · " + id : "YouTube 주소를 인식하지 못했습니다");
    els.videoStatus.classList.toggle("is-bad", !!item.video && !id);
    applyVideo(item);
    updateCardVideo(state.currentIndex);
    persist();
  });

  function updateCardVideo(idx) {
    var card = els.grid.children[idx];
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
    if (item.w === item.h) { flashStatus("정사각형 이미지는 썸네일 조정이 필요 없습니다"); return; }
    closeVideo();                      /* 크롭 중에는 영상 바를 숨기므로 재생도 멈춘다 */
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
      flashStatus("썸네일을 갱신했습니다 — 준비되면 \"이미지 파일 내보내기\"로 저장하세요");
    });
  });

  window.addEventListener("resize", function () {
    if (els.stage.classList.contains("is-cropping")) positionCropBox();
  });

  // ---------- edit mode ----------
  function setEditMode(on) {
    state.editMode = on;
    els.body.classList.toggle("edit-mode", on);
    els.editToggle.textContent = on ? "편집 종료" : "편집하기";
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

  els.brandName.addEventListener("click", function (e) { if (state.editMode) e.preventDefault(); });

  // ---------- export / reset ----------
  function formatItem(it) {
    var crop = normalizeCrop(it);
    return "  { id: " + JSON.stringify(it.id) + ", w: " + it.w + ", h: " + it.h +
      ", title: " + JSON.stringify(it.title) + ", category: " + JSON.stringify(it.category) +
      ", year: " + JSON.stringify(it.year) + ", description: " + JSON.stringify(it.description) +
      ", cropScale: " + crop.scale + ", cropX: " + crop.x + ", cropY: " + crop.y +
      ", video: " + JSON.stringify(it.video || "") + " }";
  }

  function buildDataFileText() {
    var lines = [];
    lines.push("/*");
    lines.push("  편집 모드에서 내보낸 데이터입니다.");
    lines.push("  js/data.js 를 이 파일 내용으로 덮어쓰면 편집한 내용이 기본값이 됩니다.");
    lines.push("  새로 추가했거나 썸네일을 다시 자른 이미지가 있다면, \"이미지 파일 내보내기\"로 받은");
    lines.push("  webp 파일도 assets/img/full·assets/img/thumb 폴더에 함께 넣어주세요.");
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
    els.editStatus.classList.toggle("is-bad", kind === "bad");
    statusTimer = setTimeout(function () {
      els.editStatus.classList.remove("is-ok");
      els.editStatus.classList.remove("is-bad");
      els.editStatus.textContent = "편집 모드 · 변경 사항은 이 브라우저에 자동 저장됩니다";
    }, 3200);
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
    flashStatus("data.js 파일을 내보냈습니다 — js/data.js를 이 파일로 바꿔주세요");
  });

  els.exportImagesBtn.addEventListener("click", function () {
    var keys = Object.keys(blobRaw);
    if (!keys.length) { flashStatus("내보낼 새 이미지 파일이 없습니다"); return; }
    keys.forEach(function (key) {
      var parts = key.split(":");
      downloadBlob(blobRaw[key], parts[0] + "-" + parts[1] + ".webp");
    });
    flashStatus(keys.length + "개 이미지 파일을 내보냈습니다 — 파일명에서 -full/-thumb를 지우고 assets/img/full·thumb 폴더에 넣어주세요");
  });

  els.resetBtn.addEventListener("click", function () {
    if (!window.confirm("편집한 순서·내용·추가한 이미지를 모두 초기화할까요? 이 동작은 되돌릴 수 없습니다.")) return;
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
    flashStatus("편집 내용을 초기화했습니다");
  });

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
    if (e && e.status === 401) return "토큰이 유효하지 않습니다 — 다시 발급해 주세요";
    if (e && e.status === 403) return "권한이 부족합니다 — Contents 를 Read and write 로 설정했는지 확인해 주세요";
    if (e && e.status === 404) return "저장소에 접근할 수 없습니다 — 토큰에 illustrator-portfolio 를 선택했는지 확인해 주세요";
    if (e && (e.status === 409 || e.status === 422)) return "저장소가 그 사이 바뀌었습니다 — 새로고침 후 다시 시도해 주세요";
    if (e && e.status) return "저장 실패 (오류 " + e.status + ")";
    return "저장 실패 — 네트워크를 확인해 주세요";
  }

  function publishToSite() {
    var token = getToken();
    if (!token) { openTokenPanel(); return; }

    els.publishBtn.disabled = true;
    var keys = Object.keys(blobRaw);
    var baseSha, baseTree, tree = [];
    flashStatus("저장 준비 중…", "");

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
            flashStatus("이미지 업로드 " + (i + 1) + "/" + keys.length + "…", "");
            return blobToBase64(blobRaw[key])
              .then(function (b64) {
                return ghApi("POST", "/git/blobs", token, { content: b64, encoding: "base64" });
              })
              .then(function (blob) {
                var parts = key.split(":");   /* [id, "full"|"thumb"] */
                tree.push({
                  path: "assets/img/" + parts[1] + "/" + parts[0] + ".webp",
                  mode: "100644", type: "blob", sha: blob.sha
                });
              });
          });
        }, Promise.resolve());
      })
      .then(function () {
        flashStatus("커밋 중…", "");
        return ghApi("POST", "/git/trees", token, { base_tree: baseTree, tree: tree });
      })
      .then(function (newTree) {
        var msg = "site: 작품 " + state.items.length + "개 저장"
          + (keys.length ? " (이미지 " + keys.length + "개)" : "");
        return ghApi("POST", "/git/commits", token, {
          message: msg, tree: newTree.sha, parents: [baseSha]
        });
      })
      .then(function (commit) {
        return ghApi("PATCH", "/git/refs/heads/" + REPO_BRANCH, token, { sha: commit.sha });
      })
      .then(function () {
        flashStatus("저장했습니다 — 1~2분 뒤 사이트에 반영됩니다", "ok");
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
    flashStatus("저장된 토큰을 지웠습니다", "");
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
  els.worksLink.addEventListener("click", function () { els.gallery.scrollIntoView({ behavior: "smooth" }); });

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
