// ==UserScript==
// @name         YouTube Quick Feedback
// @namespace    https://www.youtube.com/
// @version      1.0.16
// @description  Violentmonkey: adds native-style "Not interested" and "Don't recommend channel" buttons to YouTube recommendations.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @inject-into  content
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
  ] as const;
  const html = document.documentElement;
  const body = document.body;
  const appNode = document.querySelector("ytd-app");
  if (!(appNode instanceof HTMLElement)) return;
  const app = appNode;
  if (html.hasAttribute("data-yqf-initialized") || !/^(en|ru)(-|$)/i.test(html.lang || navigator.language)) return;
  html.setAttribute("data-yqf-initialized", "");
  const ACTIONS = [["Not interested", "\u041d\u0435 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u0443\u0435\u0442"], ["Don't recommend channel", "\u041d\u0435 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u0442\u044c \u0432\u0438\u0434\u0435\u043e \u0441 \u044d\u0442\u043e\u0433\u043e \u043a\u0430\u043d\u0430\u043b\u0430", "\u041d\u0435 \u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u043e\u0432\u0430\u0442\u044c \u043a\u0430\u043d\u0430\u043b"]] as const;
  type WaitValue = boolean | HTMLElement | undefined;
  interface Waiter {
    test: () => WaitValue;
    resolve: (value: WaitValue) => void;
    timer: number | undefined;
  }
  interface Operation {
    card: HTMLElement;
    panel: HTMLElement;
    thumbnail: HTMLAnchorElement;
    menu: HTMLElement;
    href: string;
    page: string;
    generation: number;
  }
  const waiters = new Set<Waiter>();
  const flashes = new Map<HTMLButtonElement, number>();
  let root: HTMLElement | undefined;
  let enabled = false;
  let generation = 0;
  let operation: Operation | undefined;
  let hoveredThumbnail: HTMLAnchorElement | undefined;

  GM_addStyle('.yqf-card{position:relative!important}html.yqf-menu-hidden :is(ytd-popup-container,tp-yt-iron-dropdown,ytd-menu-popup-renderer,yt-sheet-view-model,[role="menu"]){opacity:0!important;pointer-events:none!important}.yqf-panel{position:absolute;z-index:999;display:flex;flex-direction:column;gap:4px;pointer-events:none;opacity:0;visibility:hidden}.yqf-card:has(a.ytLockupViewModelContentImage:hover,a#thumbnail:hover) .yqf-panel,.yqf-card:focus-within .yqf-panel,.yqf-panel:hover{opacity:1;visibility:visible}.yqf-panel[hidden]{display:none}:where(.yqf-button){position:relative;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:32px;border:0;border-radius:50%;color:#fff;background:rgb(0 0 0/30%);backdrop-filter:blur(8px)}.yqf-button{padding:0;cursor:pointer;pointer-events:auto}.yqf-button svg{display:block;width:24px;height:24px;fill:currentColor;pointer-events:none;filter:drop-shadow(0 1px 4px rgb(0 0 0/30%))}.yqf-button:focus-visible{outline:2px solid #fff;outline-offset:2px}.yqf-button[data-unavailable]::after{content:attr(title);position:absolute;right:calc(100% + 8px);padding:6px 8px;border-radius:4px;background:rgb(33 33 33/95%);color:#fff;font:12px Roboto,Arial,sans-serif;white-space:nowrap}@media(hover:none){.yqf-card .yqf-panel{opacity:1;visibility:visible}}');

  const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (element: Element): boolean => !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
  const relevant = (): boolean => /^(?:\/(?:results|watch)?\/?|\/feed\/(?:subscriptions|trending|explore)\/?)$/.test(location.pathname);
  const getThumbnail = (card: Element): HTMLAnchorElement | undefined => {
    const thumbnail = card.querySelector(THUMBNAIL);
    return thumbnail instanceof HTMLAnchorElement ? thumbnail : undefined;
  };
  const findPopup = () => [...document.querySelectorAll(POPUP)].find(visible);
  function findItem(popup: Element, wanted: readonly string[]): HTMLElement | undefined {
    for (const item of popup.querySelectorAll(ITEM)) {
      if (item instanceof HTMLElement && visible(item) && wanted.includes(normalize(item.innerText))) return item;
    }
  }

  function closePopup(popup: Element): boolean | Promise<WaitValue> {
    if (!popup.isConnected || !visible(popup)) return true;
    body.click();
    return wait(() => !popup.isConnected || !visible(popup), 350);
  }

  const menuChanges = new MutationObserver(flushWaiters);

  function flushWaiters(): void {
    for (const waiter of [...waiters]) {
      const value = waiter.test();
      if (value) finish(waiter, value);
    }
  }

  function finish(waiter: Waiter, value: WaitValue): void {
    if (!waiters.delete(waiter)) return;
    window.clearTimeout(waiter.timer);
    if (!waiters.size) {
      menuChanges.disconnect();
      app?.removeEventListener("transitionend", flushWaiters, true);
      app?.removeEventListener("animationend", flushWaiters, true);
    }
    waiter.resolve(value);
  }

  function wait(test: () => WaitValue, timeout: number): Promise<WaitValue> {
    return new Promise(resolve => {
      if (!waiters.size) {
        menuChanges.observe(app, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "class", "style"] });
        app?.addEventListener("transitionend", flushWaiters, true);
        app?.addEventListener("animationend", flushWaiters, true);
      }
      const waiter: Waiter = { test, resolve, timer: undefined };
      waiter.timer = window.setTimeout(() => finish(waiter, waiter.test()), timeout);
      waiters.add(waiter);
      flushWaiters();
    });
  }

  function flash(button: HTMLButtonElement): void {
    const labels = button.dataset.action === "0" ? ACTIONS[0] : button.dataset.action === "1" ? ACTIONS[1] : undefined;
    if (!labels || !enabled || !root?.contains(button)) return;
    window.clearTimeout(flashes.get(button));
    button.title = "Unavailable";
    button.setAttribute("aria-label", button.title);
    button.dataset.unavailable = "";
    flashes.set(button, window.setTimeout(() => {
      flashes.delete(button);
      if (!enabled || !root?.contains(button)) return;
      button.title = labels[0];
      button.setAttribute("aria-label", button.title);
      delete button.dataset.unavailable;
    }, 1200));
  }

  function valid(current: Operation): boolean {
    return operation === current && enabled && generation === current.generation && relevant() && location.href === current.page && current.card.isConnected && !!root?.contains(current.card) && current.card.contains(current.menu) && getThumbnail(current.card) === current.thumbnail && current.thumbnail.href === current.href;
  }

  function cancelOperation(): void {
    operation = undefined;
    for (const waiter of [...waiters]) finish(waiter, false);
    html.classList.remove("yqf-menu-hidden");
  }

  async function run(button: HTMLButtonElement): Promise<void> {
    if (operation || !enabled) return;

    const card = button.closest(CARD);
    const menu = card?.querySelector(MENU);
    const panel = button.parentElement;
    const thumbnail = card ? getThumbnail(card) : undefined;
    const labels = button.dataset.action === "0" ? ACTIONS[0] : button.dataset.action === "1" ? ACTIONS[1] : undefined;

    if (!(card instanceof HTMLElement) || !(menu instanceof HTMLElement) || !panel || !thumbnail?.href || !labels || !root?.contains(card)) return flash(button);

    const current: Operation = { card, menu, panel, thumbnail, href: thumbnail.href, page: location.href, generation };
    operation = current;
    panel.hidden = true;
    html.classList.add("yqf-menu-hidden");
    let success = false;
    let completed = false;
    let popup: Element | undefined;

    try {
      const opened = findPopup();
      if ((!opened || await closePopup(opened)) && valid(current)) {
        menu.click();
        const wanted = labels.map(normalize);
        const item = await wait(() => {
          popup ||= findPopup();
          return !valid(current) || popup && findItem(popup, wanted);
        }, 1800);

        if (valid(current) && item instanceof HTMLElement && popup?.contains(item)) {
          item.click();
          success = !!await wait(() => {
            const thumbnail = getThumbnail(card);
            return !valid(current) || !thumbnail || !visible(thumbnail);
          }, 2400);
        }
      }
    } catch {
    } finally {
      if (popup && valid(current)) await closePopup(popup);
      if (operation === current) {
        completed = true;
        operation = undefined;
        html.classList.remove("yqf-menu-hidden");
        if (enabled && generation === current.generation && root?.contains(card)) decorate(card);
      }
    }

    if (completed && !success && enabled && generation === current.generation && root?.contains(button)) flash(button);
  }

  function decorate(card: Element): void {
    const panel = card.querySelector(".yqf-panel");
    const thumbnail = getThumbnail(card);

    if (!enabled || !root?.contains(card) || !thumbnail || card.querySelector("ytd-ad-slot-renderer") || card.closest('ytd-browse[page-subtype="history"]')) {
      panel?.remove();
      card.classList.remove("yqf-card");
      return;
    }

    if (panel instanceof HTMLElement) {
      const hidden = !visible(thumbnail);
      if (panel !== operation?.panel && panel.hidden !== hidden) panel.hidden = hidden;
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
      button.dataset.action = String(action);
      button.title = labels[0];
      button.setAttribute("aria-label", labels[0]);
      const icon = document.createElement("div");
      icon.className = "ytSpecButtonShapeNextIcon ytSpecButtonShapeNextElevatedContent";
      icon.setAttribute("aria-hidden", "true");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", action === 0 ? ICONS[0] : ICONS[1]);
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

  function position(panel: HTMLElement, thumbnail: HTMLAnchorElement): void {
    const host = panel.offsetParent;
    if (!host) return;
    const bounds = host.getBoundingClientRect();
    const thumb = (thumbnail.querySelector("yt-thumbnail-view-model") || thumbnail).getBoundingClientRect();
    const size = panel.firstElementChild?.getBoundingClientRect().width || 32;
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
    if (!hoveredThumbnail?.isConnected || !enabled || !root?.contains(hoveredThumbnail)) return releaseHover();
    const panel = hoveredThumbnail?.closest(CARD)?.querySelector(".yqf-panel");
    if (panel instanceof HTMLElement) position(panel, hoveredThumbnail);
    else releaseHover();
  });

  function releaseHover(): void {
    resize.disconnect();
    hoveredThumbnail = undefined;
  }

  function hover(event: Event): void {
    if (!enabled || !(event.target instanceof Element) || !root?.contains(event.target)) return;
    const card = event.target.closest(CARD);
    const thumbnail = card ? getThumbnail(card) : undefined;
    const panel = card?.querySelector(".yqf-panel");
    if (!(panel instanceof HTMLElement) || !thumbnail) return;
    if (thumbnail !== hoveredThumbnail) {
      resize.disconnect();
      hoveredThumbnail = thumbnail;
      resize.observe(thumbnail);
    }
    position(panel, thumbnail);
  }

  document.addEventListener("pointerover", hover, true);
  document.addEventListener("focusin", hover, true);
  document.addEventListener("yt-navigate-finish", navigate);

  const scan = (root: Element, cards: Set<Element>): void => {
    const card = root.closest(CARD);
    if (card) cards.add(card);
    root.querySelectorAll(CARD).forEach(card => cards.add(card));
  };

  document.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest(".yqf-button") : null;
    if (!(button instanceof HTMLButtonElement)) {
      if (operation && event.isTrusted) {
        const card = operation.card;
        cancelOperation();
        if (card.isConnected) decorate(card);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void run(button);
  }, true);

  const changes = new MutationObserver(records => {
    if (!enabled) return;
    if (hoveredThumbnail && (!hoveredThumbnail.isConnected || !root?.contains(hoveredThumbnail))) releaseHover();
    if (operation && !valid(operation)) cancelOperation();
    for (const [button, timer] of flashes) {
      if (root?.contains(button)) continue;
      window.clearTimeout(timer);
      flashes.delete(button);
    }
    const cards = new Set<Element>();
    for (const { target, addedNodes, attributeName } of records) {
      if (!(target instanceof Element) || target.closest(".yqf-panel")) continue;
      const card = target.closest(CARD);
      if (card) cards.add(card);
      else if (attributeName === "hidden" || attributeName === "page-subtype") scan(target, cards);
      for (const node of addedNodes) {
        if (node instanceof Element) scan(node, cards);
      }
    }
    cards.forEach(decorate);
  });

  function clearControls(container: Element | undefined): void {
    container?.querySelectorAll(".yqf-panel").forEach(panel => panel.remove());
    container?.querySelectorAll(".yqf-card").forEach(card => card.classList.remove("yqf-card"));
  }

  function navigate(): void {
    generation++;
    cancelOperation();
    releaseHover();
    changes.disconnect();
    for (const [button, timer] of flashes) {
      window.clearTimeout(timer);
      delete button.dataset.unavailable;
      const labels = button.dataset.action === "0" ? ACTIONS[0] : ACTIONS[1];
      button.title = labels[0];
      button.setAttribute("aria-label", labels[0]);
    }
    flashes.clear();
    const next = app?.querySelector("ytd-page-manager");
    if (root !== next) clearControls(root);
    root = next instanceof HTMLElement ? next : undefined;
    enabled = !!root && relevant();
    if (!enabled || !root) return clearControls(root);
    root.querySelectorAll(CARD).forEach(decorate);
    changes.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "hidden", "aria-hidden", "page-subtype"] });
  }

  navigate();
})();

