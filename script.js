// ---------------------------------------------------------------------------
// App version — bump this on every deploy. Shown as a small, subtle tag in
// the bottom-right corner of the page so you can tell at a glance which
// build is currently live (pairs well with the auto hard-refresh in
// index.html, in case a visitor's browser/CDN is holding a stale copy).
// ---------------------------------------------------------------------------
const APP_VERSION = "2.0.5";

// ---------------------------------------------------------------------------
// Template definitions
// Coordinates below come directly from the original PSD layer bounding boxes,
// so the live preview lines up with the original designs.
//
// Each template has one or more "slots" — rectangular areas where a user
// photo can be placed, panned, and zoomed. Single-background templates just
// have one slot covering the whole canvas; the اتصالات template has two
// small slots for the two call-participant photos.
// ---------------------------------------------------------------------------
const TEMPLATES = {
  story: {
    label: "ستوري (1080×1920)",
    width: 1080,
    height: 1920,
    overlay: "assets/story_overlay.png",
    blendLayers: [
      { src: "assets/story_multiply.png", mode: "multiply", alpha: 1.0 },
      { src: "assets/story_dodge1.png", mode: "color-dodge", alpha: 0.1412 },
      { src: "assets/story_dodge2.png", mode: "color-dodge", alpha: 0.2314 }
    ],
    slots: [
      // h stays the full canvas (1920) so the photo always has real pixels
      // for the Multiply/Color-Dodge fade below to blend against — clipping
      // it short causes those blend layers to paint their own raw color
      // where there's no backdrop, which looks like a black band. coverH is
      // just the reference used for the *default zoom/pan framing*: below
      // that point the overlay is already ~100% opaque, so it's invisible
      // regardless of what the photo does there, and cropping the framing
      // reference there avoids forcing an unnecessarily tight zoom just to
      // reach pixels nobody will ever see.
      { key: "main", x: 0, y: 0, w: 1080, h: 1920, coverH: 1450, defaultSrc: "assets/story_default_bg.jpg", label: null }
    ],
    text: {
      x: 104, y: 1330, width: 997 - 104, height: 1800 - 1330,
      baseFontSize: 66, minFontSize: 30, lineHeight: 1.35,
      color: "#ffffff",
      default: "البيتكوين فقد أكثر من نصف قيمته منذ ذروته العام الماضي مع انسحاب المستثمرين من العملات المشفرة"
    },
    highlight: { color: "#70e6f4", default: "" }
  },
  card70e6f4: {
    label: "بطاقة (1080×1350)",
    width: 1080,
    height: 1350,
    overlay: "assets/card70e6f4_overlay.png",
    blendLayers: [],
    slots: [
      { key: "main", x: 0, y: 0, w: 1080, h: 928, defaultSrc: "assets/card70e6f4_default_bg.jpg", label: null }
    ],
    text: {
      x: 77, y: 928, width: 1003 - 77, height: 1262 - 928,
      baseFontSize: 65, minFontSize: 26, lineHeight: 1.35,
      color: "#ffffff",
      default: "25% الزيادة المتوقعة في سعر iPhone 18 Pro بسبب أزمة ندرة المكونات الإلكترونية"
    },
    highlight: { color: "#70e6f4", default: "25%" }
  },
  comms: {
    label: "اتصالات (1080×1350)",
    width: 1080,
    height: 1350,
    overlay: "assets/comms_frame.png",
    blendLayers: [],
    slots: [
      { key: "left", x: 71, y: 258, w: 347, h: 373, defaultSrc: null, label: "الصورة اليسرى" },
      { key: "right", x: 660, y: 258, w: 349, h: 374, defaultSrc: null, label: "الصورة اليمنى" }
    ],
    text: {
      x: 112, y: 928, width: 1003 - 112, height: 1245 - 928,
      baseFontSize: 49, minFontSize: 26, lineHeight: 1.35,
      color: "#ffffff",
      default: "محمد بن زايد ورئيس وزراء اليونان يبحثان هاتفياً التعاون في الاقتصاد والاستثمار والذكاء الاصطناعي والطاقة المتجددة والاستدامة"
    },
    highlight: { color: "#70e6f4", default: "" }
  }
};

const FONT_FAMILY = "NeoSansArabicBold";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentKey = "story";
let currentSlots = []; // runtime slot objects for the active template: { config, img, state:{zoom,dx,dy} }

const overlayCache = {};      // templateKey -> HTMLImageElement
const blendLayerCache = {};   // templateKey -> array of {img, mode, alpha}
const defaultImgCache = {};   // src -> HTMLImageElement (shared cache for any default photo)

const canvas = document.getElementById("designCanvas");
const ctx = canvas.getContext("2d");

const templateSelect = document.getElementById("templateSelect");

const singleBgGroup = document.getElementById("singleBgGroup");
const bgInput = document.getElementById("bgInput");
const zoomField = document.getElementById("zoomField");
const zoomInput = document.getElementById("zoomInput");
const resetPosBtn = document.getElementById("resetPosBtn");

const dualPhotoGroup = document.getElementById("dualPhotoGroup");
const photo1Input = document.getElementById("photo1Input");
const photo1Zoom = document.getElementById("photo1Zoom");
const photo1Reset = document.getElementById("photo1Reset");
const photo2Input = document.getElementById("photo2Input");
const photo2Zoom = document.getElementById("photo2Zoom");
const photo2Reset = document.getElementById("photo2Reset");

const textInput = document.getElementById("textInput");
const highlightField = document.getElementById("highlightField");
const highlightInput = document.getElementById("highlightInput");
const downloadBtn = document.getElementById("downloadBtn");
const statusMsg = document.getElementById("statusMsg");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadDefaultImage(src) {
  if (!defaultImgCache[src]) {
    defaultImgCache[src] = await loadImage(src);
  }
  return defaultImgCache[src];
}

function baseCoverScale(img, boxW, boxH) {
  return Math.max(boxW / img.width, boxH / img.height);
}

// The box used for computing zoom/pan — usually the same as the slot's full
// render size, but a slot can override with a smaller coverW/coverH (see the
// ستوري slot above) so the default framing/zoom isn't calibrated against
// area that ends up invisible anyway.
function coverDims(config) {
  return { w: config.coverW || config.w, h: config.coverH || config.h };
}

// Computes the scale + draw position for an image in a slot, given the
// current zoom and pan offsets. Scale is based on the (possibly smaller)
// cover reference box, so a slot doesn't force more zoom than the visible
// area actually needs. Vertical centering, though, falls back to the FULL
// slot height whenever the image is already tall enough to cover it (which
// is always true for the pre-cropped default photos) — otherwise an image
// that exactly fits the full canvas would get needlessly shifted as if it
// only had to fill the smaller cover box.
function slotScale(slot) {
  const { w, h } = coverDims(slot.config);
  return baseCoverScale(slot.img, w, h) * slot.state.zoom;
}

function centeredPosition(slot, zoom) {
  const { w: fullW, h: fullH } = slot.config;
  const cover = coverDims(slot.config);
  const scale = baseCoverScale(slot.img, cover.w, cover.h) * zoom;
  const drawW = slot.img.width * scale;
  const drawH = slot.img.height * scale;
  const dx = (fullW - drawW) / 2;
  const dy = drawH >= fullH ? (fullH - drawH) / 2 : (cover.h - drawH) / 2;
  return { dx, dy };
}

function clampSlotState(slot) {
  const { w: fullW, h: fullH } = slot.config;
  const cover = coverDims(slot.config);
  const scale = slotScale(slot);
  const drawW = slot.img.width * scale;
  const drawH = slot.img.height * scale;

  const minDx = fullW - drawW; // <= 0
  const minDy = drawH >= fullH ? fullH - drawH : cover.h - drawH; // <= 0
  slot.state.dx = Math.min(0, Math.max(minDx, slot.state.dx));
  slot.state.dy = Math.min(0, Math.max(minDy, slot.state.dy));
}

function resetSlot(slot) {
  slot.state.zoom = 1;
  if (slot.img) {
    const pos = centeredPosition(slot, 1);
    slot.state.dx = pos.dx;
    slot.state.dy = pos.dy;
  } else {
    slot.state.dx = 0;
    slot.state.dy = 0;
  }
}

function applyZoom(slot, newZoom) {
  if (!slot.img) {
    slot.state.zoom = newZoom;
    return;
  }
  const oldScale = slotScale(slot);
  const { w: fullW, h: fullH } = slot.config;
  const cx = fullW / 2;
  const cy = fullH / 2;
  const imgX = (cx - slot.state.dx) / oldScale;
  const imgY = (cy - slot.state.dy) / oldScale;

  const cover = coverDims(slot.config);
  const newScale = baseCoverScale(slot.img, cover.w, cover.h) * newZoom;
  slot.state.zoom = newZoom;
  slot.state.dx = cx - imgX * newScale;
  slot.state.dy = cy - imgY * newScale;
  clampSlotState(slot);
}

function drawSlot(slot) {
  const { x, y, w, h } = slot.config;

  if (!slot.img) {
    // Empty placeholder so it's obvious where a photo is needed while editing.
    if (slot.config.label) {
      ctx.save();
      ctx.fillStyle = "#d8dee8";
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    return;
  }

  clampSlotState(slot);
  const scale = slotScale(slot);
  const drawW = slot.img.width * scale;
  const drawH = slot.img.height * scale;

  // Clip to the FULL slot box (not just the smaller cover reference) so the
  // image still extends as far as it naturally reaches — anything beyond
  // the cover reference is fine to leave uncovered, since that area is
  // always fully masked by the design's own opaque overlay on top.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(slot.img, x + slot.state.dx, y + slot.state.dy, drawW, drawH);
  ctx.restore();
}

function wrapText(context, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (context.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitText(context, text, box, baseFontSize, minFontSize, lineHeight) {
  let fontSize = baseFontSize;
  let lines = [text];
  while (fontSize >= minFontSize) {
    context.font = `${fontSize}px "${FONT_FAMILY}"`;
    lines = wrapText(context, text, box.width);
    const totalHeight = lines.length * fontSize * lineHeight;
    if (totalHeight <= box.height || fontSize === minFontSize) break;
    fontSize -= 2;
  }
  return { fontSize, lines };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
async function render() {
  const tpl = TEMPLATES[currentKey];

  canvas.width = tpl.width;
  canvas.height = tpl.height;

  ctx.clearRect(0, 0, tpl.width, tpl.height);

  // 1. Photo slot(s) — background photo, or the 2 call-participant photos.
  for (const slot of currentSlots) {
    drawSlot(slot);
  }

  // 2. Blend-mode design elements (e.g. multiply/color-dodge vignettes) —
  // rendered with the browser's native blend modes so they react correctly
  // to whatever photo is behind them.
  const blendLayers = blendLayerCache[currentKey] || [];
  for (const layer of blendLayers) {
    ctx.globalCompositeOperation = layer.mode;
    ctx.globalAlpha = layer.alpha;
    ctx.drawImage(layer.img, 0, 0, tpl.width, tpl.height);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // 3. Overlay / frame (decorative elements — fixed per template)
  const overlay = overlayCache[currentKey];
  if (overlay) {
    ctx.drawImage(overlay, 0, 0, tpl.width, tpl.height);
  }

  // 4. Headline text
  // Strip invisible bidi control characters (LRM/RLM/embedding/isolate marks)
  // that some keyboards/OSes silently insert around numbers in RTL text —
  // left in place, they silently break exact-text highlight matching.
  const BIDI_MARKS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
  const rawText = textInput.value.trim().replace(BIDI_MARKS, "");
  if (rawText) {
    const box = { x: tpl.text.x, y: tpl.text.y, width: tpl.text.width, height: tpl.text.height };
    const { fontSize, lines } = fitText(ctx, rawText, box, tpl.text.baseFontSize, tpl.text.minFontSize, tpl.text.lineHeight);

    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.font = `${fontSize}px "${FONT_FAMILY}"`;

    const rightX = box.x + box.width;
    const lineStep = fontSize * tpl.text.lineHeight;
    const highlightWord = tpl.highlight ? highlightInput.value.trim().replace(BIDI_MARKS, "") : "";

    // Find the highlight phrase against the full (normalized) wrapped text so
    // matches that straddle a line break are still found — not just matches
    // that happen to land entirely within a single line.
    let matchStart = -1;
    let matchEnd = -1;
    if (highlightWord) {
      const normalizedText = lines.join(" ");
      const idx = normalizedText.indexOf(highlightWord);
      if (idx !== -1) {
        matchStart = idx;
        matchEnd = idx + highlightWord.length;
      }
    }

    let cursor = 0; // running character offset into the normalized joined text
    lines.forEach((line, i) => {
      const y = box.y + i * lineStep;
      const lineStart = cursor;
      const lineEnd = lineStart + line.length;
      cursor = lineEnd + 1; // +1 for the single space that joins this line to the next

      // Base line in the default color
      ctx.fillStyle = tpl.text.color;
      ctx.fillText(line, rightX, y);

      // Portion (if any) of the highlighted phrase that falls on this line —
      // handles phrases that span two or more wrapped lines too.
      if (matchStart !== -1) {
        const overlapStart = Math.max(matchStart, lineStart);
        const overlapEnd = Math.min(matchEnd, lineEnd);
        if (overlapStart < overlapEnd) {
          const localStart = overlapStart - lineStart;
          const localEnd = overlapEnd - lineStart;
          const before = line.slice(0, localStart);
          const match = line.slice(localStart, localEnd);
          const beforeWidth = ctx.measureText(before).width;
          const matchAnchorX = rightX - beforeWidth;

          // A highlighted segment with no Arabic letters (e.g. a lone "25%")
          // has nothing to anchor its reading order, and some browsers'
          // canvas text shaping visually reverses it when drawn in isolation
          // under direction="rtl" — even though the exact same text renders
          // correctly as part of the full line above. Switching direction to
          // "ltr" just for this draw call fixes the ordering while textAlign
          // "right" keeps it anchored at the same spot.
          const hasArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(match);
          ctx.direction = hasArabic ? "rtl" : "ltr";
          ctx.fillStyle = tpl.highlight.color;
          ctx.fillText(match, matchAnchorX, y);
          ctx.fillStyle = tpl.text.color;
          ctx.direction = "rtl";
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Template switching
// ---------------------------------------------------------------------------
async function switchTemplate(key) {
  currentKey = key;
  const tpl = TEMPLATES[key];

  // Reset text fields to this template's defaults
  textInput.value = tpl.text.default;
  if (tpl.highlight) {
    highlightField.hidden = false;
    highlightInput.value = tpl.highlight.default;
  } else {
    highlightField.hidden = true;
    highlightInput.value = "";
  }

  // Load overlay if not cached yet
  if (!overlayCache[key]) {
    overlayCache[key] = await loadImage(tpl.overlay);
  }

  // Load blend-mode layers if not cached yet
  if (!blendLayerCache[key]) {
    blendLayerCache[key] = await Promise.all(
      tpl.blendLayers.map(async (layer) => ({
        img: await loadImage(layer.src),
        mode: layer.mode,
        alpha: layer.alpha
      }))
    );
  }

  // Build runtime slots for this template
  currentSlots = [];
  for (const slotConfig of tpl.slots) {
    const img = slotConfig.defaultSrc ? await loadDefaultImage(slotConfig.defaultSrc) : null;
    const slot = { config: slotConfig, img, state: { zoom: 1, dx: 0, dy: 0 } };
    resetSlot(slot);
    currentSlots.push(slot);
  }

  // Show the right controls for this template's slot layout
  const isDual = tpl.slots.length === 2;
  singleBgGroup.hidden = isDual;
  zoomField.hidden = isDual || !currentSlots[0].img;
  dualPhotoGroup.hidden = !isDual;

  if (!isDual) {
    bgInput.value = "";
    zoomInput.value = "1";
  } else {
    photo1Input.value = "";
    photo2Input.value = "";
    photo1Zoom.value = "1";
    photo2Zoom.value = "1";
  }

  await render();
}

// ---------------------------------------------------------------------------
// Pointer-based drag panning — works out which slot (if any) the pointer is
// over and pans that one.
// ---------------------------------------------------------------------------
let dragSlot = null;
let dragStart = { x: 0, y: 0, dx: 0, dy: 0 };

function canvasScaleFactor() {
  const rect = canvas.getBoundingClientRect();
  return canvas.width / rect.width;
}

function slotAtCanvasPoint(px, py) {
  for (const slot of currentSlots) {
    const { x, y, w, h } = slot.config;
    if (px >= x && px <= x + w && py >= y && py <= y + h) {
      return slot;
    }
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const factor = canvasScaleFactor();
  const px = (e.clientX - rect.left) * factor;
  const py = (e.clientY - rect.top) * factor;
  const slot = slotAtCanvasPoint(px, py);
  if (!slot || !slot.img) return;

  dragSlot = slot;
  canvas.classList.add("dragging");
  canvas.setPointerCapture(e.pointerId);
  dragStart = { x: e.clientX, y: e.clientY, dx: slot.state.dx, dy: slot.state.dy };
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragSlot) return;
  const factor = canvasScaleFactor();
  const deltaX = (e.clientX - dragStart.x) * factor;
  const deltaY = (e.clientY - dragStart.y) * factor;
  dragSlot.state.dx = dragStart.dx + deltaX;
  dragSlot.state.dy = dragStart.dy + deltaY;
  render();
});

function endDrag() {
  if (!dragSlot) return;
  dragSlot = null;
  canvas.classList.remove("dragging");
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// ---------------------------------------------------------------------------
// Single-background controls (ستوري / بطاقة – كلمة مميزة)
// ---------------------------------------------------------------------------
zoomInput.addEventListener("input", () => {
  const slot = currentSlots[0];
  if (!slot || !slot.img) return;
  applyZoom(slot, parseFloat(zoomInput.value));
  render();
});

resetPosBtn.addEventListener("click", () => {
  const slot = currentSlots[0];
  if (!slot) return;
  resetSlot(slot);
  zoomInput.value = "1";
  render();
});

bgInput.addEventListener("change", () => {
  const file = bgInput.files[0];
  if (!file) return;
  const slot = currentSlots[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    slot.img = await loadImage(e.target.result);
    zoomField.hidden = false;
    resetSlot(slot);
    zoomInput.value = "1";
    render();
  };
  reader.readAsDataURL(file);
});

// ---------------------------------------------------------------------------
// Dual-photo controls (اتصالات)
// ---------------------------------------------------------------------------
function wireDualSlotControls(input, zoomEl, resetBtn, slotIndex) {
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    const slot = currentSlots[slotIndex];
    if (!slot) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      slot.img = await loadImage(e.target.result);
      resetSlot(slot);
      zoomEl.value = "1";
      render();
    };
    reader.readAsDataURL(file);
  });

  zoomEl.addEventListener("input", () => {
    const slot = currentSlots[slotIndex];
    if (!slot || !slot.img) return;
    applyZoom(slot, parseFloat(zoomEl.value));
    render();
  });

  resetBtn.addEventListener("click", () => {
    const slot = currentSlots[slotIndex];
    if (!slot) return;
    resetSlot(slot);
    zoomEl.value = "1";
    render();
  });
}

wireDualSlotControls(photo1Input, photo1Zoom, photo1Reset, 0);
wireDualSlotControls(photo2Input, photo2Zoom, photo2Reset, 1);

// ---------------------------------------------------------------------------
// Other events
// ---------------------------------------------------------------------------
templateSelect.addEventListener("change", () => switchTemplate(templateSelect.value));
textInput.addEventListener("input", render);
highlightInput.addEventListener("input", render);

downloadBtn.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentKey}-design.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusMsg.textContent = "تم تنزيل الصورة ✓";
    setTimeout(() => (statusMsg.textContent = ""), 2500);
  }, "image/png");
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
(async function init() {
  // Populate template dropdown
  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = tpl.label;
    templateSelect.appendChild(opt);
  }
  templateSelect.value = currentKey;

  const versionTag = document.getElementById("versionTag");
  if (versionTag) versionTag.textContent = `v${APP_VERSION}`;

  statusMsg.textContent = "جارٍ تحميل الخط...";

  try {
    const font = new FontFace(FONT_FAMILY, "url(fonts/NeoSansArabicBold.ttf)");
    await font.load();
    document.fonts.add(font);
  } catch (err) {
    console.error("Font load failed", err);
  }

  statusMsg.textContent = "";

  await switchTemplate(currentKey);
})();
