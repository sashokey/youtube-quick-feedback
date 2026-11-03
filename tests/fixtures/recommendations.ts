export interface FixtureOptions {
  language?: string;
  cards?: string;
  history?: boolean;
  delay?: number;
  missingAction?: boolean;
  path?: string;
}

interface CardOptions {
  ad?: boolean;
  standalone?: boolean;
  menu?: boolean;
  hidden?: boolean;
}

export function videoCard(id: string, title: string, { ad = false, standalone = false, menu = true, hidden = false }: CardOptions = {}): string {
  const lockup = `<yt-lockup-view-model class="ytLockupViewModelHost${standalone ? ' ytd-item-section-renderer' : ''}"${standalone ? ` id="${id}"` : ''}><a class="ytLockupViewModelContentImage" href="/watch?v=${id}"${hidden ? ' hidden' : ''}><yt-thumbnail-view-model>${title}</yt-thumbnail-view-model></a><h3>${title}</h3>${menu ? '<div class="ytLockupMetadataViewModelMenuButton"><button aria-label="Action menu">More</button></div>' : ''}${ad ? '<ytd-ad-slot-renderer>Advertisement</ytd-ad-slot-renderer>' : ''}</yt-lockup-view-model>`;
  return standalone ? lockup : `<ytd-rich-item-renderer id="${id}">${lockup}</ytd-rich-item-renderer>`;
}

export function recommendations({ language = 'en', cards, history = false }: FixtureOptions = {}): string {
  const initial = cards ?? videoCard('alpha', 'Alpha') + videoCard('beta', 'Beta');
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><style>ytd-rich-item-renderer,yt-lockup-view-model{display:block;position:relative;width:320px;margin:12px;padding:8px}a.ytLockupViewModelContentImage{display:block;width:300px;height:160px;background:#ddd}yt-thumbnail-view-model{display:block;width:300px;height:160px}yt-sheet-view-model,yt-list-view-model{display:block}yt-sheet-view-model{position:fixed;top:20px;right:20px;background:#fff;padding:12px}yt-list-view-model button{display:block}[hidden]{display:none!important}</style></head><body><button id="navigate">Navigate</button><button id="outside">Outside action</button><div id="unrelated"></div><output role="status"></output><ytd-app><ytd-page-manager id="page-manager"><ytd-browse page-subtype="${history ? 'history' : 'home'}"><div id="feed">${initial}</div></ytd-browse></ytd-page-manager><ytd-popup-container></ytd-popup-container></ytd-app></body></html>`;
}

export function installNativeFixture({ language = 'en', delay = 0, missingAction = false }: FixtureOptions): void {
  const labels = language === 'ru' ? ['Не интересует', 'Не рекомендовать видео с этого канала'] : ['Not interested', "Don't recommend channel"];
  const messages = language === 'ru' ? ['Видео удалено', 'Этот канал будет исключен из ваших рекомендаций.'] : ['Video removed', 'This channel will not be recommended to you again.'];
  const originalCards = new WeakMap<Element, string>();
  const cardSelector = 'ytd-rich-item-renderer, yt-lockup-view-model.ytd-item-section-renderer';
  const rememberCards = (root: Element): void => {
    for (const card of [root, ...root.querySelectorAll(cardSelector)]) {
      if (card.matches(cardSelector) && !originalCards.has(card)) originalCards.set(card, card.innerHTML);
    }
  };
  const feed = document.querySelector('#feed');
  if (!feed) throw new Error('Missing fixture feed');
  rememberCards(feed);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) rememberCards(node);
  }).observe(feed, { childList: true, subtree: true });
  const closeMenu = (): void => { document.querySelector('yt-sheet-view-model')?.remove(); };
  document.body.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target === document.body || target.closest('#outside')) closeMenu();
    const native = target.closest('.ytLockupMetadataViewModelMenuButton button');
    const card = native?.closest(cardSelector);
    if (!native || !card) return;
    const title = card.querySelector('h3')?.textContent ?? '';
    setTimeout(() => {
      closeMenu();
      const sheet = document.createElement('yt-sheet-view-model');
      const menu = document.createElement('yt-list-view-model');
      menu.setAttribute('role', 'menu');
      const available = missingAction ? ['Save to Watch later'] : labels;
      available.forEach((label, action) => {
        const button = document.createElement('button');
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.addEventListener('click', () => {
          const output = document.querySelector('output');
          if (missingAction) {
            if (output) output.textContent = 'Saved: ' + title;
          } else {
            const original = originalCards.get(card);
            const message = document.createElement('p');
            message.textContent = messages[action] ?? '';
            const undo = document.createElement('button');
            undo.textContent = language === 'ru' ? 'Отменить' : 'Undo';
            undo.addEventListener('click', () => { if (original !== undefined) card.innerHTML = original; });
            card.replaceChildren(message, undo);
            if (output) output.textContent = (action ? 'Channel blocked: ' : 'Video removed: ') + title;
          }
          closeMenu();
        });
        menu.append(button);
      });
      sheet.append(menu);
      document.querySelector('ytd-popup-container')?.append(sheet);
    }, delay);
  });
  document.querySelector('#navigate')?.addEventListener('click', () => {
    history.pushState({}, '', '/results?search_query=example');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
}

export function instrumentRuntime(): void {
  const output = document.createElement('output');
  output.id = 'test-resources';
  output.hidden = true;
  document.body.append(output);
  const add = (name: string, delta = 1): void => { output.dataset[name] = String(Number(output.dataset[name] ?? '0') + delta); };
  const nativeAdd: unknown = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener')?.value;
  if (typeof nativeAdd !== 'function') throw new Error('Missing EventTarget listener method');
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    if (this === document || this instanceof Element && this.matches('ytd-app, ytd-page-manager, body')) add('listeners');
    Reflect.apply(nativeAdd, this, [type, callback, options]);
  };
  const NativeMutationObserver = MutationObserver;
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback: MutationCallback) {
      super((records, observer) => {
        add('mutationCallbacks');
        callback(records, observer);
      });
      add('mutationObservers');
    }
  };
  const NativeResizeObserver = ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    targets = new Set<Element>();
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      add('resizeObservers');
    }
    override observe(target: Element, options?: ResizeObserverOptions): void {
      if (!this.targets.has(target)) add('resizeTargets');
      this.targets.add(target);
      super.observe(target, options);
    }
    override unobserve(target: Element): void {
      if (this.targets.delete(target)) add('resizeTargets', -1);
      super.unobserve(target);
    }
    override disconnect(): void {
      add('resizeTargets', -this.targets.size);
      this.targets.clear();
      super.disconnect();
    }
  };
  Object.defineProperty(window, 'GM_addStyle', { configurable: true, value: (css: string): HTMLStyleElement => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    return style;
  } });
}
