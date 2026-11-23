(() => {
  if (/^(just a moment|attention required)\b/i.test(document.title.trim()) ||
      document.querySelector('#challenge-form, #cf-challenge-running, #cf-please-wait')) return null;
  const visible = node => node.getClientRects().length > 0 &&
    !node.closest('[hidden], [aria-hidden="true"], script, style, template, noscript') &&
    getComputedStyle(node).visibility === 'visible';
  const normalize = value => value.normalize('NFKC').replace(/[\s\uFEFF]+/g, '').replace(/[。.]+$/, '');
  const emptyTexts = ['該当件数:0件', '該当件数:0件中', '該当する商品がありません', '該当する商品はありません', '該当する商品が見つかりませんでした'];
  const notices = document.querySelectorAll('#search_header .hit, #search_result > p, #search_result > h2, #search_result > .notice');
  if ([...notices].some(node => visible(node) && emptyTexts.includes(normalize(node.textContent)))) {
    return JSON.stringify({ pageUrl: location.href, items: [] });
  }
  const cards = [...document.querySelectorAll('#search_result .item_box .item')].filter(visible);
  if (cards.length === 0 || cards.length > 120) return null;
  const items = [];
  for (const card of cards) {
    const href = card.querySelector('.item_detail .title > a')?.getAttribute('href') ?? '';
    const text = selector => card.querySelector(selector)?.textContent.trim() ?? '';
    const name = text('.item_detail .product-name');
    if (!/^(https:\/\/www\.suruga-ya\.jp)?\/product\/detail\/[A-Za-z0-9]+(?:[/?#]|$)/.test(href) || !name) return null;
    const thumbnail = card.querySelector('.thum img');
    const image = thumbnail?.getAttribute('data-src') || thumbnail?.currentSrc || thumbnail?.getAttribute('src') || '';
    items.push({ href, name, image, price: text('.item_price .price_teika strong'), marketPrice: text('.item_price .mgnB5.mgnT5 strong') });
  }
  return JSON.stringify({ pageUrl: location.href, items });
})();
