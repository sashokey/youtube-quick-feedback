// ==UserScript==
// @name         YouTube Quick Feedback
// @namespace    https://www.youtube.com/
// @version      1.0.11
// @description  Adds native-style "Not interested" and "Don't recommend channel" buttons to YouTube recommendations.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/sashokey/youtube-quick-feedback/master/youtube-quick-feedback.user.js
// @downloadURL  https://raw.githubusercontent.com/sashokey/youtube-quick-feedback/master/youtube-quick-feedback.user.js
// ==/UserScript==

(() => {
  "use strict";

  const CARD = "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model.ytd-item-section-renderer";
  const THUMBNAIL = "a.ytLockupViewModelContentImage, a#thumbnail";
  const MENU = ".ytLockupMetadataViewModelMenuButton button, ytd-menu-renderer button, #menu button, button[aria-label='\u0415\u0449\u0451'], button[aria-label='Action menu']";
  const ITEM = "ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitem']";
  const POPUP = "ytd-menu-popup-renderer, yt-sheet-view-model, [role='menu']";
  const OVERLAY = "yt-thumbnail-hover-overlay-toggle-actions-view-model button, ytd-thumbnail-overlay-toggle-button-renderer";
  const BUTTON = "ytSpecButtonShapeNextHost ytSpecButtonShapeNextTonal ytSpecButtonShapeNextOverlayDark ytSpecButtonShapeNextSizeS ytSpecButtonShapeNextIconButton ytSpecButtonShapeNextOverrideSmallSizeIcon ytSpecButtonShapeNextEnableBackdropFilterExperiment ytSpecButtonShapeNextMainstageIconSize ytSpecButtonShapeNextMainstagePadding";
  const ICONS = [
    "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z",
    "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm4 8H8a1 1 0 000 2h8a1 1 0 000-2Z"
  ];
  const html = document.documentElement;
  const body = document.body;
  if (!/^(en|ru)(-|$)/i.test(html.lang || navigator.language)) return;
  const ACTIONS = [["Not interested", "\u041d\u0435 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u0443\u0435\u0442"], ["Don't recommend channel", "\u041d\u0435 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u0442\u044c \u0432\u0438\u0434\u0435\u043e \u0441 \u044d\u0442\u043e\u0433\u043e \u043a\u0430\u043d\u0430\u043b\u0430", "\u041d\u0435 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u0442\u044c \u043a\u0430\u043d\u0430\u043b"]];
  const waiters = new Set();
  const flashes = new WeakMap();
  let busy = false;
  let interrupted = false;
  let activePanel;
  let hoveredThumbnail;

  GM_addStyle('.yqf-card{position:relative!important}html.yqf-menu-hidden :is(ytd-popup-container,tp-yt-iron-dropdown,ytd-menu-popup-renderer,yt-sheet-view-model,[role="menu"]){opacity:0!important;pointer-events:none!important}.yqf-panel{position:absolute;z-index:999;display:flex;flex-direction:column;gap:4px;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .12s,visibility 0s linear .12s}.yqf-card:has(a.ytLockupViewModelContentImage:hover,a#thumbnail:hover) .yqf-panel,.yqf-card:focus-within .yqf-panel,.yqf-panel:hover{opacity:1;visibility:visible;transition-delay:0s}.yqf-panel[hidden]{display:none}:where(.yqf-button){position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:32px;border:0;border-radius:50%;color:#fff;background:rgb(0 0 0/30%);backdrop-filter:blur(8px)}.yqf-button{padding:0;cursor:pointer;pointer-events:auto}.yqf-button svg{display:block;width:24px;height:24px;fill:currentColor;pointer-events:none;filter:drop-shadow(0 1px 4px rgb(0 0 0/30%))}.yqf-button:focus-visible{outline:2px solid #fff;outline-offset:2px}.yqf-button[data-unavailable]::after{content:attr(title);position:absolute;right:calc(100% + 8px);padding:6px 8px;border-radius:4px;background:rgb(33 33 33/95%);color:#fff;font:12px Roboto,Arial,sans-serif;white-space:nowrap}@media(hover:none){.yqf-card .yqf-panel{opacity:1;visibility:visible;transition-delay:0s}}');

  const normalize = text => text.replace(/\s+/g, " ").trim().toLowerCase();
  const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
  const findPopup = () => [...document.querySelectorAll(POPUP)].find(visible);
  function findItem(popup, wanted) {
    for (const item of popup.querySelectorAll(ITEM)) {
      if (visible(item) && wanted.includes(normalize(item.innerText))) return item;
    }
  }

  function closePopup(popup) {
    if (!popup.isConnected || !visible(popup)) return true;
    body.click();
    return wait(() => !popup.isConnected || !visible(popup), 350);
  }

  function flushWaiters() {
    for (const waiter of [...waiters]) {
      const value = waiter.test();
      if (value) finish(waiter, value);
    }
  }

  function finish(waiter, value) {
    if (!waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }

  function wait(test, timeout) {
    return new Promise(resolve => {
      const waiter = { test, resolve };
      waiter.timer = setTimeout(() => finish(waiter, waiter.test()), timeout);
      waiters.add(waiter);
      flushWaiters();
    });
  }

  function flash(button) {
    clearTimeout(flashes.get(button));
    button.title = "Unavailable";
    button.setAttribute("aria-label", button.title);
    button.dataset.unavailable = "";
    flashes.set(button, setTimeout(() => {
      button.title = ACTIONS[button.dataset.action][0];
      button.setAttribute("aria-label", button.title);
      delete button.dataset.unavailable;
      flashes.delete(button);
    }, 1200));
  }

  async function run(button) {
    if (busy) return;

    const card = button.closest(CARD);
    const menu = card?.querySelector(MENU);
    const panel = button.parentElement;
    const thumbnail = card?.querySelector(THUMBNAIL);
    const href = thumbnail?.href;
    const page = location.href;
    const valid = () => !interrupted && location.href === page && card.isConnected && card.contains(menu) && card.querySelector(THUMBNAIL)?.href === href;

    if (!menu || !href) return flash(button);

    busy = true;
    interrupted = false;
    activePanel = panel;
    panel.hidden = true;
    html.classList.add("yqf-menu-hidden");
    let success = false;
    let popup;

    try {
      const opened = findPopup();
      if ((!opened || await closePopup(opened)) && valid()) {
        menu.click();
        const wanted = ACTIONS[button.dataset.action].map(normalize);
        const item = await wait(() => {
          popup ||= findPopup();
          return !valid() || popup && findItem(popup, wanted);
        }, 1800);

        if (valid() && item?.nodeType === 1 && popup?.contains(item)) {
          item.click();
          success = !!await wait(() => {
            const current = card.querySelector(THUMBNAIL);
            return !valid() || !current || !visible(current);
          }, 2400);
        }
      }
    } catch {
    } finally {
      if (popup && !interrupted && location.href === page) await closePopup(popup);
      html.classList.remove("yqf-menu-hidden");
      busy = false;
      activePanel = undefined;
      if (card.isConnected) decorate(card);
    }

    if (!success && valid() && button.isConnected) flash(button);
  }

  function decorate(card) {
    const panel = card.querySelector(".yqf-panel");
    const thumbnail = card.querySelector(THUMBNAIL);

    if (!thumbnail || /^\/feed\/history\/?$/.test(location.pathname) || card.closest('ytd-browse[page-subtype="history"]')) {
      panel?.remove();
      card.classList.remove("yqf-card");
      return;
    }

    if (panel) {
      const hidden = !visible(thumbnail);
      if (panel !== activePanel && panel.hidden !== hidden) panel.hidden = hidden;
      if (!panel.hidden) position(panel, thumbnail);
      return;
    }

    card.classList.add("yqf-card");
    const newPanel = document.createElement("div");
    newPanel.className = "yqf-panel";
    newPanel.hidden = !visible(thumbnail);

    ACTIONS.forEach((labels, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yqf-button " + BUTTON;
      button.dataset.action = action;
      button.title = labels[0];
      button.setAttribute("aria-label", labels[0]);
      const icon = document.createElement("div");
      icon.className = "ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent";
      icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", ICONS[action]);
      svg.append(path);
      icon.append(svg);
      const feedback = document.createElement("yt-touch-feedback-shape");
      feedback.className = "ytSpecTouchFeedbackShapeHost ytSpecTouchFeedbackShapeOverlayTouchResponseInverse";
      feedback.setAttribute("aria-hidden", "true");
      for (const part of ["Stroke", "Fill"]) {
        const layer = document.createElement("div");
        layer.className = "ytSpecTouchFeedbackShape" + part;
        feedback.append(layer);
      }
      button.append(icon, feedback);
      newPanel.append(button);
    });

    (thumbnail.closest(".ytLockupViewModelHost") || card).append(newPanel);
    if (!newPanel.hidden) position(newPanel, thumbnail);
  }

  function position(panel, thumbnail) {
    const host = panel.offsetParent;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const thumb = thumbnail.getBoundingClientRect();
    const size = panel.firstElementChild.getBoundingClientRect().width || 32;
    let left = thumb.right - bounds.left - size - 4;
    let top = thumb.top - bounds.top + 4;
    for (const control of thumbnail.querySelectorAll(OVERLAY)) {
      const rect = control.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      left = rect.right - bounds.left - size;
      top = Math.max(top, rect.bottom - bounds.top + 4);
    }
    const x = left + "px";
    const y = top + "px";
    if (panel.style.left !== x) panel.style.left = x;
    if (panel.style.top !== y) panel.style.top = y;
  }

  const resize = new ResizeObserver(() => {
    const panel = hoveredThumbnail?.closest(CARD)?.querySelector(".yqf-panel");
    if (panel) position(panel, hoveredThumbnail);
  });

  function hover(event) {
    const card = event.target.closest?.(CARD);
    const thumbnail = card?.querySelector(THUMBNAIL);
    const panel = card?.querySelector(".yqf-panel");
    if (!panel || !thumbnail) return;
    if (thumbnail !== hoveredThumbnail) {
      resize.disconnect();
      hoveredThumbnail = thumbnail;
      resize.observe(thumbnail);
    }
    position(panel, thumbnail);
  }

  document.addEventListener("pointerover", hover, true);
  document.addEventListener("focusin", hover, true);
  document.addEventListener("yt-navigate-finish", () => {
    resize.disconnect();
    hoveredThumbnail = undefined;
    body.querySelectorAll(CARD).forEach(decorate);
  });

  const scan = (root, cards) => {
    const card = root.closest(CARD);
    if (card) cards.add(card);
    root.querySelectorAll(CARD).forEach(card => cards.add(card));
  };

  document.addEventListener("click", event => {
    const button = event.target.closest?.(".yqf-button");
    if (!button) {
      if (busy && event.isTrusted) interrupted = true;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    run(button);
  }, true);

  body.querySelectorAll(CARD).forEach(decorate);
  body.addEventListener("transitionend", flushWaiters, true);
  body.addEventListener("animationend", flushWaiters, true);
  new MutationObserver(records => {
    flushWaiters();
    const cards = new Set();
    for (const { target, addedNodes, attributeName } of records) {
      if (attributeName === "class" || attributeName === "style") continue;
      if (target.nodeType === 1 && target.closest(".yqf-panel")) continue;
      const card = target.nodeType === 1 && target.closest(CARD);
      if (card) cards.add(card);
      else if (attributeName === "hidden" || attributeName === "page-subtype") scan(target, cards);
      for (const node of addedNodes) {
        if (node.nodeType === 1) scan(node, cards);
      }
    }
    cards.forEach(decorate);
  }).observe(body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["href", "hidden", "aria-hidden", "class", "style", "page-subtype"] });
})();
