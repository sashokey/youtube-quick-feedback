// ==UserScript==
// @name         YouTube — быстрый фидбек
// @namespace    https://www.youtube.com/
// @version      1.0.6
// @description  Добавляет к рекомендациям YouTube кнопки «Не интересует» и «Не рекомендовать канал».
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
  const MENU = ".ytLockupMetadataViewModelMenuButton button, ytd-menu-renderer button, #menu button, button[aria-label='Ещё'], button[aria-label='Action menu']";
  const ITEM = "ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitem']";
  const POPUP = "ytd-menu-popup-renderer, yt-sheet-view-model, [role='menu']";
  const html = document.documentElement;
  const body = document.body;
  const ACTIONS = {
    ru: [["Не интересует"], ["Не рекомендовать видео с этого канала", "Не рекомендовать канал"]],
    en: [["Not interested"], ["Don't recommend channel"]]
  }[(html.lang || navigator.language).split("-")[0].toLowerCase()];
  if (!ACTIONS) return;
  const waiters = new Set();
  const flashes = new WeakMap();
  let busy = false;
  let interrupted = false;
  let activePanel;

  GM_addStyle('.yqf-card{position:relative!important}html.yqf-menu-hidden :is(ytd-popup-container,tp-yt-iron-dropdown,ytd-menu-popup-renderer,yt-sheet-view-model,[role="menu"]){opacity:0!important;pointer-events:none!important}.yqf-panel{position:absolute;z-index:999;top:8px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:5px;pointer-events:none;font-family:Roboto,Arial,sans-serif;opacity:0;visibility:hidden;transition:opacity .12s,visibility 0s linear .12s}.yqf-card:has(a.ytLockupViewModelContentImage:hover,a#thumbnail:hover) .yqf-panel,.yqf-panel:hover{opacity:1;visibility:visible;transition-delay:0s}.yqf-panel[hidden]{display:none}.yqf-button{box-sizing:border-box;border:1px solid rgb(255 255 255/14%);border-radius:18px;color:#f1f1f1;background:rgb(15 15 15/72%);box-shadow:0 1px 3px rgb(0 0 0/35%);cursor:pointer;pointer-events:auto;opacity:.4;white-space:nowrap;transition:opacity .12s,transform 60ms}.yqf-button[data-action="0"]{height:35px;padding:0 15px;font-size:13px;font-weight:500}.yqf-button[data-action="1"]{height:25px;padding:0 9px;font-size:10px;background:rgb(15 15 15/62%)}.yqf-button:hover{opacity:1}.yqf-button:active{transform:scale(.97)}@media(hover:none){.yqf-card .yqf-panel{opacity:1;visibility:visible;transition-delay:0s}}');

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
    button.textContent = "Недоступно";
    flashes.set(button, setTimeout(() => {
      button.textContent = ACTIONS[button.dataset.action][0];
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

    if (!thumbnail) {
      panel?.remove();
      card.classList.remove("yqf-card");
      return;
    }

    if (panel) {
      const hidden = !visible(thumbnail);
      if (panel !== activePanel && panel.hidden !== hidden) panel.hidden = hidden;
      return;
    }

    card.classList.add("yqf-card");
    const newPanel = document.createElement("div");
    newPanel.className = "yqf-panel";
    newPanel.hidden = !visible(thumbnail);

    ACTIONS.forEach((labels, action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "yqf-button";
      button.dataset.action = action;
      button.title = button.textContent = labels[0];
      newPanel.append(button);
    });

    (thumbnail.closest(".ytLockupViewModelHost") || card).append(newPanel);
  }

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
  new MutationObserver(records => {
    const cards = new Set();
    for (const { target, addedNodes, attributeName } of records) {
      if (target.nodeType === 1 && target.closest(".yqf-panel")) continue;
      const card = target.nodeType === 1 && target.closest(CARD);
      if (card) cards.add(card);
      else if (attributeName === "hidden") scan(target, cards);
      for (const node of addedNodes) {
        if (node.nodeType === 1) scan(node, cards);
      }
    }
    cards.forEach(decorate);
    flushWaiters();
  }).observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "hidden", "aria-hidden"] });
})();
