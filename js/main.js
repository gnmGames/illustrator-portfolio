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
  function makeThumbCanvas(imgEl, cropPos, size) {
    var w = imgEl.naturalWidth, h = imgEl.naturalHeight;
    var side = Math.min(w, h);
    var sx = 0, sy = 0;
    if (w > h) sx = (w - side) * cropPos;
    else if (h > w) sy = (h - side) * cropPos;
    var canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    canvas.getContext("2d").drawImage(imgEl, sx, sy, side, side, 0, 0, size, size);
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
        cropPos: typeof d.cropPos === "number" ? d.cropPos : 0.5,
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
        byId[a.id] = { id: a.id, w: a.w, h: a.h, title: "", category: "", year: "", description: "", cropPos: 0.5 };
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
        edits[it.id] = { title: it.title, category: it.category, year: it.year, description: it.description, cropPos: it.cropPos == null ? 0.5 : it.cropPos };
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

      var frame = document.createElement("div");
      frame.className = "card__frame";

      var img = document.createElement("img");
      img.src = thumbSrc(item.id);
      img.loading = "lazy";
      img.alt = displayTitle(item, idx);

      var badge = document.createElement("span");
      badge.className = "card__cover-badge";
      badge.textContent = "COVER";

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
          var thumbCanvas = makeThumbCanvas(img, 0.5, THUMB_SIZE);
          return Promise.all([canvasToWebp(fullCanvas, 0.85), canvasToWebp(thumbCanvas, 0.8)]).then(function (blobs) {
            var fullBlob = blobs[0], thumbBlob = blobs[1];
            var fullKey = id + ":full", thumbKey = id + ":thumb";
            blobRaw[fullKey] = fullBlob; blobMap[fullKey] = URL.createObjectURL(fullBlob);
            blobRaw[thumbKey] = thumbBlob; blobMap[thumbKey] = URL.createObjectURL(thumbBlob);
            state.items.push({ id: id, w: img.naturalWidth, h: img.naturalHeight, title: "", category: "", year: "", description: "", cropPos: 0.5 });
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
  }

  // ---------- thumbnail crop ----------
  function computeImageScreenRect() {
    var mediaRect = els.stageMedia.getBoundingClientRect();
    var cs = getComputedStyle(els.stageMedia);
    var padLeft = parseFloat(cs.paddingLeft) || 0;
    var padRight = parseFloat(cs.paddingRight) || 0;
    var padTop = parseFloat(cs.paddingTop) || 0;
    var padBottom = parseFloat(cs.paddingBottom) || 0;
    var contentLeft = mediaRect.left + padLeft;
    var contentTop = mediaRect.top + padTop;
    var contentWidth = mediaRect.width - padLeft - padRight;
    var contentHeight = mediaRect.height - padTop - padBottom;

    var nw = els.stageImage.naturalWidth, nh = els.stageImage.naturalHeight;
    if (!nw || !nh || contentWidth <= 0 || contentHeight <= 0) return null;
    var scale = Math.min(contentWidth / nw, contentHeight / nh);
    var rw = nw * scale, rh = nh * scale;
    return {
      left: contentLeft + (contentWidth - rw) / 2,
      top: contentTop + (contentHeight - rh) / 2,
      width: rw, height: rh, mediaRect: mediaRect,
    };
  }

  function positionCropBox() {
    var rect = computeImageScreenRect();
    if (!rect || state.currentIndex === null) return;
    var square = Math.min(rect.width, rect.height);
    var item = state.items[state.currentIndex];
    var cropPos = item.cropPos == null ? 0.5 : item.cropPos;
    var x, y;
    if (rect.width > rect.height) {
      x = (rect.left - rect.mediaRect.left) + (rect.width - square) * cropPos;
      y = rect.top - rect.mediaRect.top;
    } else {
      x = rect.left - rect.mediaRect.left;
      y = (rect.top - rect.mediaRect.top) + (rect.height - square) * cropPos;
    }
    els.cropBox.style.left = x + "px";
    els.cropBox.style.top = y + "px";
    els.cropBox.style.width = square + "px";
    els.cropBox.style.height = square + "px";
  }

  var cropDrag = null;
  function enterCropMode() {
    if (state.currentIndex === null) return;
    var item = state.items[state.currentIndex];
    if (item.w === item.h) { flashStatus("정사각형 이미지는 썸네일 조정이 필요 없습니다"); return; }
    els.stage.classList.add("is-cropping");
    positionCropBox();
  }
  function exitCropMode() {
    if (!els.stage.classList.contains("is-cropping")) return;
    els.stage.classList.remove("is-cropping");
    cropDrag = null;
  }

  els.cropBox.addEventListener("pointerdown", function (e) {
    var rect = computeImageScreenRect();
    if (!rect) return;
    var square = Math.min(rect.width, rect.height);
    var axisWide = rect.width > rect.height;
    var travel = (axisWide ? rect.width : rect.height) - square;
    var item = state.items[state.currentIndex];
    cropDrag = {
      startClient: axisWide ? e.clientX : e.clientY,
      startPos: item.cropPos == null ? 0.5 : item.cropPos,
      travel: travel,
      axisWide: axisWide,
    };
    els.cropBox.classList.add("is-dragging");
    try { els.cropBox.setPointerCapture(e.pointerId); } catch (err) {}
  });
  els.cropBox.addEventListener("pointermove", function (e) {
    if (!cropDrag || state.currentIndex === null) return;
    var delta = (cropDrag.axisWide ? e.clientX : e.clientY) - cropDrag.startClient;
    var deltaFrac = cropDrag.travel > 0 ? delta / cropDrag.travel : 0;
    var next = Math.max(0, Math.min(1, cropDrag.startPos + deltaFrac));
    state.items[state.currentIndex].cropPos = next;
    positionCropBox();
  });
  function endCropDrag() {
    if (!cropDrag) return;
    cropDrag = null;
    els.cropBox.classList.remove("is-dragging");
  }
  els.cropBox.addEventListener("pointerup", endCropDrag);
  els.cropBox.addEventListener("pointercancel", endCropDrag);

  els.cropEditBtn.addEventListener("click", enterCropMode);
  els.cropCancelBtn.addEventListener("click", exitCropMode);
  els.cropCenterBtn.addEventListener("click", function () {
    if (state.currentIndex === null) return;
    state.items[state.currentIndex].cropPos = 0.5;
    positionCropBox();
  });
  els.cropApplyBtn.addEventListener("click", function () {
    var idx = state.currentIndex;
    if (idx === null) return;
    var item = state.items[idx];
    var thumbCanvas = makeThumbCanvas(els.stageImage, item.cropPos == null ? 0.5 : item.cropPos, THUMB_SIZE);
    canvasToWebp(thumbCanvas, 0.8).then(function (blob) {
      var key = item.id + ":thumb";
      if (blobMap[key]) URL.revokeObjectURL(blobMap[key]);
      blobRaw[key] = blob;
      blobMap[key] = URL.createObjectURL(blob);
      idbSet(key, blob).catch(function () {});
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
    return "  { id: " + JSON.stringify(it.id) + ", w: " + it.w + ", h: " + it.h +
      ", title: " + JSON.stringify(it.title) + ", category: " + JSON.stringify(it.category) +
      ", year: " + JSON.stringify(it.year) + ", description: " + JSON.stringify(it.description) +
      ", cropPos: " + (it.cropPos == null ? 0.5 : it.cropPos) + " }";
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
  function flashStatus(msg) {
    clearTimeout(statusTimer);
    els.editStatus.textContent = msg;
    statusTimer = setTimeout(function () {
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
    els.stage.classList.remove("is-piece");
    exitCropMode();
    renderMeta();
    setStageImageInitial();
    renderGrid();
    flashStatus("편집 내용을 초기화했습니다");
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
