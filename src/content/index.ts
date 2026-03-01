import './style.css';
import { FAVORITE_API_PATH, RJ_CODE_REGEX, UI_CLASSNAME } from '@/shared/constants';
import type { RuntimeResponse, PriceRecord } from '@/shared/types';
import { extractRjCodeFromUrl, toYen } from '@/shared/utils';

function isProductPage(url: string): boolean {
  return /\/product_id\/[RB]J\d+/i.test(url);
}

function isFavoritePage(url: string): boolean {
  return /\/(favorites?|wishlist)(?:[/?#]|$)/i.test(url);
}

function parseCurrentPrice(): number | undefined {
  const target = document.querySelector('#work_price')?.textContent;
  if (!target) return undefined;

  const cleaned = target.replace(/,/g, '');
  const matched = cleaned.match(/(\d{2,6})\s*円/);
  if (!matched) return undefined;

  return Number(matched[1]);
}

function parseTitle(): string {
  const h1 = document.querySelector('h1')?.textContent?.trim();
  return h1 || document.title;
}

async function sendMessage<T>(message: unknown): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

function renderPriceCard(record: PriceRecord | null, host: Element): void {
  const existed = host.querySelector(`.${UI_CLASSNAME}`);
  if (existed) {
    existed.remove();
  }

  const card = document.createElement('div');
  card.className = UI_CLASSNAME;

  const chip = document.createElement('span');
  chip.className = 'dltracker-chip';

  if (!record) {
    chip.classList.add('dltracker-error');
    chip.textContent = '史低获取失败';
    card.appendChild(chip);
    host.appendChild(card);
    return;
  }

  const discountText =
    typeof record.discountRate === 'number' ? ` (${record.discountRate.toFixed(1)}%OFF)` : '';
  chip.textContent = `史低：${toYen(record.lowestPrice)}${discountText}`;

  const button = document.createElement('a');
  button.className = 'dltracker-btn';
  button.textContent = '查看价格趋势';
  button.href = record.dlwatcherUrl;
  button.target = '_blank';
  button.rel = 'noopener noreferrer';
  button.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  card.appendChild(chip);
  card.appendChild(button);
  host.appendChild(card);
}

function renderLoadingCard(host: Element): void {
  const existed = host.querySelector(`.${UI_CLASSNAME}`);
  if (existed) {
    existed.remove();
  }

  const card = document.createElement('div');
  card.className = UI_CLASSNAME;

  const chip = document.createElement('span');
  chip.className = 'dltracker-chip';
  chip.textContent = '史低获取中...';

  card.appendChild(chip);
  host.appendChild(card);
}

async function enhanceProductPage(): Promise<void> {
  const rjCode = extractRjCodeFromUrl(location.href);
  if (!rjCode) return;

  const host = document.querySelector('#work_price .work_buy_container') || document.querySelector('#work_price');
  if (!host) return;

  renderLoadingCard(host);

  const response = await sendMessage<PriceRecord | null>({
    type: 'GET_OR_FETCH_PRICE',
    payload: {
      rjCode,
      title: parseTitle(),
      currentPrice: parseCurrentPrice(),
    },
  });

  if (!response.ok) {
    renderPriceCard(null, host);
    return;
  }

  renderPriceCard(response.data ?? null, host);
}

async function fetchFavoriteCodesFromApi(): Promise<string[]> {
  const url = `${location.origin}${FAVORITE_API_PATH}?_=${Date.now()}`;
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`收藏接口返回异常: ${response.status}`);
  }

  const data = (await response.json()) as { favorites?: unknown };
  const favorites = Array.isArray(data.favorites) ? data.favorites : [];

  return favorites
    .map((x) => (typeof x === 'string' ? x.toUpperCase() : ''))
    .filter((x): x is string => RJ_CODE_REGEX.test(x));
}

/**
 * 从当前收藏夹页面的 DOM 中提取原始 product_id。
 * 页面 <a> 的 href 格式为：
 *   /girls/work/=/product_id/RJ01407467.html/?translation=RJ01407468
 *   /girls-drama/work/=/product_id/BJ02023185.html
 * 其中 product_id 后面的才是 DLwatcher 能识别的原始编号。
 * 收藏 API 返回的可能是翻译版编号，DLwatcher 不收录，所以改用 DOM 解析。
 */
function parseFavoriteCodesFromDom(): string[] {
  // 同时匹配 RJ 和 BJ 作品链接
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="product_id/"]');
  const codeSet = new Set<string>();

  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const matched = href.match(/product_id\/([RB]J\d{6,})/i);
    if (matched) {
      codeSet.add(matched[1].toUpperCase());
    }
  }

  console.log(`[DLTracker] parseFavoriteCodesFromDom found ${codeSet.size} codes`);
  return [...codeSet];
}

function injectFavoriteImportBox(): void {
  if (document.querySelector('.dltracker-import-box')) {
    return;
  }

  const h1 = document.querySelector('#main_inner > div.base_title > h1');
  const anchor = h1?.parentElement || document.body;
  const box = document.createElement('div');
  box.className = 'dltracker-import-box';

  const text = document.createElement('span');
  text.textContent = 'DL Price Tracker：可导入收藏并抓取史低价';

  const button = document.createElement('button');
  button.textContent = '导入收藏';

  const status = document.createElement('span');
  status.textContent = '';

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '正在获取收藏列表...';

    try {
      // 优先从 DOM 提取原始 product_id（DLwatcher 可识别）
      let codes = parseFavoriteCodesFromDom();

      // DOM 中没有时降级为 API（可能在非列表视图）
      if (!codes.length) {
        console.log('[DLTracker] DOM 无链接，降级到收藏 API');
        codes = await fetchFavoriteCodesFromApi();
      }
      if (!codes.length) {
        status.textContent = '未获取到收藏作品';
        return;
      }

      status.textContent = `已获取 ${codes.length} 个收藏，正在同步史低...`;

      const response = await sendMessage<{ imported: number }>({
        type: 'IMPORT_FAVORITES',
        payload: { rjCodes: codes },
      });

      if (!response.ok) {
        status.textContent = `导入失败：${response.error ?? '未知错误'}`;
        return;
      }

      status.textContent = `导入完成：成功同步 ${response.data?.imported ?? 0} 条`;
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      status.textContent = `导入失败：${message}`;
    } finally {
      button.disabled = false;
    }
  });

  box.appendChild(text);
  box.appendChild(button);
  box.appendChild(status);

  // 插入到 <h1> 后面
  if (h1 && h1.nextSibling) {
    anchor.insertBefore(box, h1.nextSibling);
  } else if (h1) {
    anchor.appendChild(box);
  } else {
    anchor.prepend(box);
  }
}

/**
 * 为收藏夹页面的每张作品卡片注入史低价信息。
 * 从卡片链接中提取原始 product_id，向后台查询本地/远程史低。
 */
async function enhanceWishlistCards(): Promise<void> {
  const cards = document.querySelectorAll<HTMLElement>(
    '#wishlist_work article',
  );

  if (!cards.length) {
    console.log('[DLTracker] wishlist: no article cards found');
    return;
  }

  console.log(`[DLTracker] wishlist: enhancing ${cards.length} cards`);

  for (const card of cards) {
    const priceHost = card.querySelector<HTMLElement>('div.primary dl dd.work_price_wrap');
    if (!priceHost) continue;

    // 已经注入过则跳过
    if (priceHost.querySelector(`.${UI_CLASSNAME}`)) continue;

    // 从卡片内的作品链接提取原始编号（RJ 或 BJ）
    const link = card.querySelector<HTMLAnchorElement>('a[href*="product_id/"]');
    const href = link?.getAttribute('href') || '';
    const matched = href.match(/product_id\/([RB]J\d{6,})/i);
    if (!matched) continue;

    const rjCode = matched[1].toUpperCase();
    const title = link?.textContent?.trim() || rjCode;

    renderLoadingCard(priceHost);

    // 不 await 每张卡片，并发发起请求
    void sendMessage<PriceRecord | null>({
      type: 'GET_OR_FETCH_PRICE',
      payload: { rjCode, title },
    }).then((response) => {
      if (!response.ok || !response.data) {
        renderPriceCard(null, priceHost);
        return;
      }
      renderPriceCard(response.data, priceHost);
    });
  }
}

async function bootstrap(): Promise<void> {
  const url = location.href;

  console.log('[DLTracker] bootstrap', {
    url,
    isProduct: isProductPage(url),
    isFavorite: isFavoritePage(url),
    anchorExists: !!document.querySelector('#main_inner > div.base_title'),
  });

  if (isProductPage(url)) {
    await enhanceProductPage();
  }

  if (isFavoritePage(url)) {
    injectFavoriteImportBox();
    await enhanceWishlistCards();
  }
}

// ---- SPA 路由变化监听 ----
// DLsite 可能使用多种方式切换页面（pushState / replaceState / 传统导航），
// 为确保兼容，同时使用 history API 拦截 + URL 轮询 + popstate。
let lastUrl = location.href;

function onUrlChange(): void {
  const currentUrl = location.href;
  if (currentUrl === lastUrl) return;

  console.log('[DLTracker] URL changed', { from: lastUrl, to: currentUrl });
  lastUrl = currentUrl;

  // 等待 DOM 更新完成后再注入
  waitForElement(currentUrl).then(() => void bootstrap());
}

/**
 * 等待页面关键元素出现（最多 5 秒），确保 DOM 已渲染完成。
 * 作品页等待 #work_price，收藏页等待 #wishlist_work。
 */
function waitForElement(url: string): Promise<void> {
  const selector = isProductPage(url)
    ? '#work_price'
    : isFavoritePage(url)
      ? '#wishlist_work'
      : null;

  if (!selector) return Promise.resolve();

  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve();
      return;
    }

    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 5000);
  });
}

// 方式一：拦截 pushState / replaceState
const originalPushState = history.pushState.bind(history);
const originalReplaceState = history.replaceState.bind(history);

history.pushState = function (...args) {
  originalPushState(...args);
  onUrlChange();
};

history.replaceState = function (...args) {
  originalReplaceState(...args);
  onUrlChange();
};

// 方式二：popstate 捕获浏览器前进/后退
window.addEventListener('popstate', () => onUrlChange());

// 方式三：URL 轮询兜底（每 500ms 检查一次），
// 确保即使 DLsite 使用了其他导航方式也能捕获到。
setInterval(() => onUrlChange(), 500);

// 方式四：监听 DOM 变化，当 #work_price 出现但尚未注入时触发
const domObserver = new MutationObserver(() => {
  const url = location.href;
  if (isProductPage(url)) {
    const host = document.querySelector('#work_price .work_buy_container') || document.querySelector('#work_price');
    if (host && !host.querySelector(`.${UI_CLASSNAME}`)) {
      console.log('[DLTracker] DOM observer: detected uninjected product page');
      void bootstrap();
    }
  }
});

domObserver.observe(document.body, { childList: true, subtree: true });

void bootstrap();
