(() => {
  "use strict";

  const CONFIG = Object.freeze({
    pageCount: 40,
    hashSalt: "tss-pilot-v1::",
    passwordHash: "88d15a8509f9aab4de01c3cb49cadd556a50fcfc689cbd3a2d60bed12e7dce06",
    accessKey: "tss:pilot:access:v1",
    positionKey: "tss:pilot:position:v1",
    accessValue: "unsealed"
  });

  const dom = {
    body: document.body,
    gate: document.querySelector("#accessGate"),
    form: document.querySelector("#accessForm"),
    input: document.querySelector("#passwordInput"),
    toggle: document.querySelector("#togglePassword"),
    message: document.querySelector("#gateMessage"),
    reader: document.querySelector("#reader"),
    chapter: document.querySelector("#chapter"),
    pages: document.querySelector(".pages"),
    progress: document.querySelector("#progressBar"),
    indicator: document.querySelector("#pageIndicator")
  };

  let currentPage = 1;
  let progressFrame = 0;
  let positionWriteTimer = 0;
  let indicatorTimer = 0;
  let pageObserver = null;

  function createPages() {
    const fragment = document.createDocumentFragment();

    for (let page = 1; page <= CONFIG.pageCount; page += 1) {
      const pageNumber = String(page).padStart(2, "0");
      const sheet = document.createElement("figure");
      const image = document.createElement("img");
      const status = document.createElement("figcaption");

      sheet.className = "manga-sheet";
      sheet.dataset.kind = "page";
      sheet.dataset.page = String(page);

      image.dataset.src = `assets/pages/page-${pageNumber}.png`;
      image.width = 1024;
      image.height = 1536;
      image.alt = `The Seventh Silence — Page ${pageNumber}`;
      image.decoding = "async";
      image.loading = page === 1 ? "eager" : "lazy";
      if (page === 1) image.fetchPriority = "high";

      status.className = "image-status";
      status.setAttribute("aria-live", "polite");

      sheet.append(image, status);
      fragment.append(sheet);
    }

    dom.pages.append(fragment);
  }

  async function sha256(value) {
    if (!window.crypto?.subtle) return "";
    const bytes = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function hasSessionAccess() {
    try { return sessionStorage.getItem(CONFIG.accessKey) === CONFIG.accessValue; }
    catch { return false; }
  }

  function rememberSessionAccess() {
    try { sessionStorage.setItem(CONFIG.accessKey, CONFIG.accessValue); }
    catch { /* The reader still works when storage is unavailable. */ }
  }

  function showGateMessage(text) {
    dom.form.classList.remove("is-denied");
    void dom.form.offsetWidth;
    dom.form.classList.add("is-denied");
    dom.message.textContent = text;
  }

  async function handleAccess(event) {
    event.preventDefault();
    const candidate = dom.input.value;

    if (!candidate) {
      showGateMessage("Enter the chapter password.");
      dom.input.focus();
      return;
    }

    dom.form.querySelector("button[type='submit']").disabled = true;
    let accepted = false;

    try {
      accepted = await sha256(`${CONFIG.hashSalt}${candidate}`) === CONFIG.passwordHash;
    } catch {
      dom.message.textContent = "Unable to verify access in this browser.";
    }

    if (!accepted) {
      showGateMessage("Access denied.");
      dom.input.select();
      dom.form.querySelector("button[type='submit']").disabled = false;
      return;
    }

    rememberSessionAccess();
    dom.message.textContent = "Access granted.";
    dom.gate.classList.add("is-accepting");
    window.setTimeout(unlockReader, prefersReducedMotion() ? 0 : 360);
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function prepareImages() {
    const images = Array.from(dom.chapter.querySelectorAll("img[data-src]"));

    images.forEach((image, index) => {
      const sheet = image.closest(".manga-sheet");
      const status = sheet.querySelector(".image-status");

      const markLoaded = () => sheet.classList.add("is-loaded");
      const markFailed = () => {
        sheet.classList.add("is-error");
        status.textContent = "This page could not be loaded.";
      };

      image.addEventListener("load", markLoaded, { once: true });
      image.addEventListener("error", markFailed, { once: true });
      if (index < 3) image.loading = "eager";
      image.src = image.dataset.src;
      image.removeAttribute("data-src");
      if (image.complete && image.naturalWidth) markLoaded();
    });
  }

  function unlockReader() {
    prepareImages();
    dom.reader.classList.add("is-ready");
    dom.reader.setAttribute("aria-hidden", "false");
    dom.body.classList.remove("is-locked");

    requestAnimationFrame(() => {
      dom.reader.classList.add("is-visible");
      dom.gate.classList.add("is-leaving");
      initializeReader();
    });

    window.setTimeout(() => {
      dom.gate.hidden = true;
    }, prefersReducedMotion() ? 20 : 760);
  }

  function updateProgress() {
    progressFrame = 0;
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
    dom.progress.style.transform = `scaleY(${progress})`;
  }

  function requestProgressUpdate() {
    if (!progressFrame) progressFrame = requestAnimationFrame(updateProgress);
    schedulePositionWrite();
  }

  function showPageIndicator(page) {
    currentPage = page;
    dom.indicator.value = `${page} / ${CONFIG.pageCount}`;
    dom.indicator.textContent = `${page} / ${CONFIG.pageCount}`;
    dom.indicator.classList.add("is-visible");
    clearTimeout(indicatorTimer);
    indicatorTimer = window.setTimeout(() => dom.indicator.classList.remove("is-visible"), 1300);
  }

  function observeCurrentPage() {
    const sheets = Array.from(dom.pages.querySelectorAll("[data-page]"));
    pageObserver = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
      if (visible.length) showPageIndicator(Number(visible[0].target.dataset.page));
    }, { rootMargin: "-18% 0px -55% 0px", threshold: [0, 0.01] });

    sheets.forEach(sheet => pageObserver.observe(sheet));
  }

  function getPositionState() {
    const sheet = dom.pages.querySelector(`[data-page="${currentPage}"]`);
    if (!sheet) return { page: 1, ratio: 0 };
    const rect = sheet.getBoundingClientRect();
    const ratio = Math.min(Math.max(-rect.top / Math.max(rect.height, 1), 0), 1);
    return { page: currentPage, ratio };
  }

  function schedulePositionWrite() {
    clearTimeout(positionWriteTimer);
    positionWriteTimer = window.setTimeout(() => {
      try { sessionStorage.setItem(CONFIG.positionKey, JSON.stringify(getPositionState())); }
      catch { /* Position restoration is an enhancement. */ }
    }, 180);
  }

  function readSavedPosition() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(CONFIG.positionKey) || "null");
      if (!saved || !Number.isInteger(saved.page) || saved.page < 1 || saved.page > CONFIG.pageCount) return null;
      return { page: saved.page, ratio: Math.min(Math.max(Number(saved.ratio) || 0, 0), 1) };
    } catch { return null; }
  }

  function restorePosition() {
    const saved = readSavedPosition();
    if (!saved || (saved.page === 1 && saved.ratio === 0)) return;

    const sheet = dom.pages.querySelector(`[data-page="${saved.page}"]`);
    const image = sheet?.querySelector("img");
    if (!sheet || !image) return;

    image.loading = "eager";
    const apply = () => {
      const top = window.scrollY + sheet.getBoundingClientRect().top + (sheet.offsetHeight * saved.ratio);
      window.scrollTo({ top, behavior: "auto" });
      updateProgress();
    };

    // Every sheet reserves its exact 2:3 source ratio, so restoration does not
    // need to wait for a distant lazy image to download before it can scroll.
    requestAnimationFrame(apply);
  }

  function initializeReader() {
    observeCurrentPage();
    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressUpdate, { passive: true });
    window.addEventListener("pagehide", schedulePositionWrite);
    updateProgress();
    restorePosition();
  }

  function togglePasswordVisibility() {
    const reveal = dom.input.type === "password";
    dom.input.type = reveal ? "text" : "password";
    dom.toggle.setAttribute("aria-pressed", String(reveal));
    dom.toggle.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
    dom.input.focus({ preventScroll: true });
  }

  function initialize() {
    createPages();
    dom.form.addEventListener("submit", handleAccess);
    dom.toggle.addEventListener("click", togglePasswordVisibility);
    dom.input.addEventListener("input", () => {
      dom.form.classList.remove("is-denied");
      dom.message.textContent = "";
    });

    if (hasSessionAccess()) unlockReader();
    else requestAnimationFrame(() => dom.input.focus({ preventScroll: true }));
  }

  initialize();
})();
