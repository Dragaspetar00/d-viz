(function () {
  const GRAMS_PER_TROY_OUNCE = 31.1035;
  const PRICE_POLL_MS = 60_000;

  // Elements - Price
  const elPrice = document.getElementById('price');
  const elUpdatedAt = document.getElementById('updatedAt');
  const elXauTry = document.getElementById('xautry');
  const elSource = document.getElementById('source');
  const elRefresh = document.getElementById('refreshBtn');
  const elNetStatus = document.getElementById('netStatus');
  const elSwStatus = document.getElementById('swStatus');
  const elToast = document.getElementById('toast');

  // Alarm
  const elAlarmTarget = document.getElementById('alarmTarget');
  const elAlarmDirection = document.getElementById('alarmDirection');
  const elAlarmRepeat = document.getElementById('alarmRepeat');
  const elSaveAlarm = document.getElementById('saveAlarmBtn');
  const elDisableAlarm = document.getElementById('disableAlarmBtn');
  const elPermBtn = document.getElementById('permBtn');
  const elTestNotiBtn = document.getElementById('testNotiBtn');
  const elAlarmStatus = document.getElementById('alarmStatus');

  // Portfolio summary
  const elSumQty = document.getElementById('sumQty');
  const elAvgCost = document.getElementById('avgCost');
  const elPortfolioVal = document.getElementById('portfolioVal');
  const elRealizedPnL = document.getElementById('realizedPnL');
  const elUnrealizedPnL = document.getElementById('unrealizedPnL');
  const elTotalPnL = document.getElementById('totalPnL');

  // Trade form
  const elTxType = document.getElementById('txType');
  const elTxQty = document.getElementById('txQty');
  const elTxPrice = document.getElementById('txPrice');
  const elTxFee = document.getElementById('txFee');
  const elAddTx = document.getElementById('addTxBtn');
  const elClearAll = document.getElementById('clearAllBtn');
  const elFillCurrent = document.getElementById('fillCurrentBtn');
  const elTxTbody = document.getElementById('txTbody');

  // State
  let lastGramPrice = null;   // TRY/gram
  let lastXauTry = null;      // TRY/ounce

  const alarmKey = 'altintakip_alarm';
  const priceKey = 'altintakip_last_price_v4';
  const txKey = 'altintakip_txns_v1';

  // Utils
  function saveLocal(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function loadLocal(key, def = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  }
  function nowStr() {
    return new Date().toLocaleString('tr-TR');
  }
  function formatTRY(v, digits = 2) {
    if (v == null || Number.isNaN(v)) return '—';
    try {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: digits }).format(v);
    } catch {
      return (Math.round(v * 100) / 100).toFixed(digits) + ' ₺';
    }
  }
  function formatNum(v, digits = 3) {
    if (v == null || Number.isNaN(v)) return '—';
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(v);
  }
  function toast(msg) {
    elToast.textContent = msg;
    elToast.style.display = 'block';
    clearTimeout(elToast._t);
    elToast._t = setTimeout(() => {
      elToast.style.display = 'none';
    }, 2500);
  }
  function setOnlineStatus() {
    const online = navigator.onLine;
    elNetStatus.textContent = online ? 'Online' : 'Offline';
    elNetStatus.classList.toggle('online', online);
    elNetStatus.classList.toggle('offline', !online);
  }

  // Fetch helpers
  async function fetchJSON(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Primary: exchangerate.host XAU -> TRY (anahtarsız)
  async function tryExHostXAUTRY() {
    const d = await fetchJSON('https://api.exchangerate.host/convert?from=XAU&to=TRY');
    if (d && typeof d.result === 'number' && d.result > 0) {
      return { xauTry: d.result, source: 'exchangerate.host' };
    }
    throw new Error('exchangerate.host yok');
  }

  // Fallback: latest base=XAU
  async function tryExHostLatest() {
    const d = await fetchJSON('https://api.exchangerate.host/latest?base=XAU&symbols=TRY');
    const r = d?.rates?.TRY;
    if (typeof r === 'number' && r > 0) return { xauTry: r, source: 'exchangerate.host/latest' };
    throw new Error('exchangerate.host/latest yok');
  }

  // Last fallback: XAUUSD * USDTRY
  async function tryTwoStep() {
    const d1 = await fetchJSON('https://api.exchangerate.host/convert?from=XAU&to=USD');
    const xauusd = d1 && typeof d1.result === 'number' ? d1.result : null;
    if (!xauusd) throw new Error('XAUUSD yok');
    let usdtry = null;
    try {
      const d2 = await fetchJSON('https://api.exchangerate.host/convert?from=USD&to=TRY');
      if (d2 && typeof d2.result === 'number') usdtry = d2.result;
    } catch {}
    if (!usdtry) {
      const d3 = await fetchJSON('https://api.frankfurter.app/latest?from=USD&to=TRY');
      usdtry = d3?.rates?.TRY;
    }
    if (!usdtry) throw new Error('USDTRY yok');
    return { xauTry: xauusd * usdtry, source: 'XAUUSD*USDTRY' };
  }

  async function getXAU_TRY_Ounce() {
    const tries = [tryExHostXAUTRY, tryExHostLatest, tryTwoStep];
    for (const fn of tries) {
      try { return await fn(); } catch {}
    }
    throw new Error('Fiyat alınamadı');
  }

  async function refreshPrice() {
    try {
      const { xauTry, source } = await getXAU_TRY_Ounce(); // TRY/ons
      const gramTry = xauTry / GRAMS_PER_TROY_OUNCE;       // TRY/gram

      lastXauTry = xauTry;
      lastGramPrice = gramTry;

      elPrice.textContent = formatTRY(gramTry);
      elXauTry.textContent = formatTRY(xauTry, 2) + ' / ons';
      elUpdatedAt.textContent = `Son güncelleme: ${nowStr()}`;
      elSource.textContent = `Kaynak: ${source}`;
      document.title = `₺${(gramTry ?? 0).toFixed(2)} • AltınTakip`;

      saveLocal(priceKey, { xauTry, gramTry, source, ts: Date.now() });

      renderPortfolio();
      runAlarmCheck(gramTry);
    } catch (e) {
      const cached = loadLocal(priceKey);
      if (cached && typeof cached.gramTry === 'number') {
        lastXauTry = cached.xauTry;
        lastGramPrice = cached.gramTry;
        elPrice.textContent = formatTRY(cached.gramTry);
        elXauTry.textContent = formatTRY(cached.xauTry, 2) + ' / ons';
        elUpdatedAt.textContent = `Son güncelleme: ${new Date(cached.ts).toLocaleString('tr-TR')} (önbellek)`;
        elSource.textContent = `Kaynak: ${cached.source || 'önbellek'}`;
        renderPortfolio();
        toast('Ağ hatası: önbellek gösteriliyor');
      } else {
        elPrice.textContent = '—';
        elXauTry.textContent = '—';
        elSource.textContent = 'Kaynak: —';
        toast('Fiyat alınamadı.');
      }
    }
  }

  // Transactions
  function loadTxns() {
    return loadLocal(txKey, []);
  }
  function saveTxns(list) {
    saveLocal(txKey, list);
  }
  function addTxn(tx) {
    const list = loadTxns();
    list.push(tx);
    saveTxns(list);
  }
  function deleteTxn(id) {
    const list = loadTxns().filter(x => x.id !== id);
    saveTxns(list);
  }
  function clearAllTxns() {
    saveTxns([]);
  }

  function calcWAC(transactions) {
    let qty = 0, cost = 0, realized = 0;
    for (const t of transactions) {
      const fee = t.fee || 0;
      if (t.type === 'BUY') {
        qty += t.qty;
        cost += t.qty * t.unitPrice + fee;
      } else if (t.type === 'SELL') {
        if (qty <= 0) continue;
        const avg = cost / qty;
        realized += (t.unitPrice - avg) * t.qty - fee;
        qty -= t.qty;
        cost -= avg * t.qty;
      }
    }
    const avgCost = qty > 0 ? (cost / qty) : 0;
    return { qty, avgCost, realized, cost };
  }

  function renderTxTable() {
    const list = loadTxns().sort((a, b) => a.ts - b.ts);
    if (list.length === 0) {
      elTxTbody.innerHTML = '<tr><td colspan="7" class="empty">Henüz işlem yok</td></tr>';
      return;
    }
    const rows = list.map(t => {
      const total = t.unitPrice * t.qty;
      return `<tr>
        <td>${new Date(t.ts).toLocaleString('tr-TR')}</td>
        <td>${t.type === 'BUY' ? '<span class="tag-buy">Alış</span>' : '<span class="tag-sell">Satış</span>'}</td>
        <td>${formatNum(t.qty, 3)} g</td>
        <td>${formatTRY(t.unitPrice)}</td>
        <td>${formatTRY(total)}</td>
        <td>${t.fee ? formatTRY(t.fee) : '—'}</td>
        <td><button class="btn small" data-del="${t.id}">Sil</button></td>
      </tr>`;
    }).join('');
    elTxTbody.innerHTML = rows;
    elTxTbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del');
        deleteTxn(id);
        renderTxTable();
        renderPortfolio();
        toast('İşlem silindi');
      });
    });
  }

  function renderPortfolio() {
    const list = loadTxns().sort((a, b) => a.ts - b.ts);
    const { qty, avgCost, realized } = calcWAC(list);
    const cur = lastGramPrice;
    const value = (cur ?? 0) * qty;
    const unrealized = qty > 0 && cur != null ? (cur - avgCost) * qty : 0;
    const totalPnL = realized + unrealized;

    elSumQty.textContent = qty > 0 ? `${formatNum(qty, 3)} g` : '0 g';
    elAvgCost.textContent = qty > 0 ? formatTRY(avgCost) : '—';
    elPortfolioVal.textContent = formatTRY(value);
    setPnL(elRealizedPnL, realized);
    setPnL(elUnrealizedPnL, unrealized);
    setPnL(elTotalPnL, totalPnL);
  }

  function setPnL(el, v) {
    el.textContent = formatTRY(v);
    el.classList.remove('value-positive', 'value-negative');
    if (v > 0) el.classList.add('value-positive');
    else if (v < 0) el.classList.add('value-negative');
  }

  // Alarm logic
  function readAlarm() {
    return loadLocal(alarmKey, {
      active: false,
      target: null,
      direction: 'ABOVE',
      repeat: true,
      lastSide: null,
      lastNotifiedAt: null
    });
  }
  function writeAlarm(a) {
    saveLocal(alarmKey, a);
    renderAlarmStatus(a);
  }
  function renderAlarmStatus(a = readAlarm()) {
    if (!a.active || !a.target) {
      elAlarmStatus.textContent = 'Alarm: pasif';
      return;
    }
    const dirTxt = a.direction === 'ABOVE' ? 'üzerine çıkınca' : 'altına inince';
    const repeatTxt = a.repeat ? ' (tekrarlı)' : ' (tek sefer)';
    elAlarmStatus.textContent = `Alarm aktif: ${formatTRY(a.target)} ${dirTxt}${repeatTxt}`;
  }
  function currentSide(price, target) {
    if (price == null || target == null) return null;
    return price >= target ? 'ABOVE' : 'BELOW';
  }
  function notify(title, body) {
    if (Notification.permission === 'granted') {
      const n = new Notification(title, {
        body,
        icon: 'icons/icon.svg',
        vibrate: [80, 40, 80],
        tag: 'altintakip-price',
        renotify: true
      });
      setTimeout(() => n.close(), 6000);
    } else {
      toast(`${title} — ${body}`);
    }
  }
  function runAlarmCheck(price) {
    const a = readAlarm();
    if (!a.active || !a.target || typeof price !== 'number') return;

    const side = currentSide(price, a.target);
    if (!side) return;

    if (a.lastSide == null) {
      a.lastSide = side;
      writeAlarm(a);
      return;
    }

    const crossedAbove = a.lastSide === 'BELOW' && side === 'ABOVE';
    const crossedBelow = a.lastSide === 'ABOVE' && side === 'BELOW';

    if ((a.direction === 'ABOVE' && crossedAbove) || (a.direction === 'BELOW' && crossedBelow)) {
      notify('Altın Fiyat Alarmı', `Gram altın ${formatTRY(price)} oldu (hedef: ${formatTRY(a.target)})`);
      a.lastSide = side;
      a.lastNotifiedAt = Date.now();
      if (!a.repeat) a.active = false;
      writeAlarm(a);
    } else {
      if (a.lastSide !== side) {
        a.lastSide = side;
        writeAlarm(a);
      }
    }
  }

  // Event handlers
  elRefresh.addEventListener('click', refreshPrice);

  window.addEventListener('online', setOnlineStatus);
  window.addEventListener('offline', setOnlineStatus);

  elPermBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      toast('Tarayıcı bildirim desteği yok');
      return;
    }
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Bildirim izni verildi' : 'Bildirim izni reddedildi');
  });

  elTestNotiBtn.addEventListener('click', () => {
    notify('Test Bildirimi', 'Bildirimler çalışıyor.');
  });

  // Trade form actions
  elFillCurrent.addEventListener('click', () => {
    if (lastGramPrice) {
      elTxPrice.value = (Math.round(lastGramPrice * 100) / 100).toFixed(2);
      toast('Güncel fiyat dolduruldu');
    } else {
      toast('Güncel fiyat yok');
    }
  });

  elAddTx.addEventListener('click', () => {
    const type = elTxType.value; // BUY | SELL
    const qty = parseFloat(elTxQty.value);
    const unitPrice = parseFloat(elTxPrice.value || lastGramPrice);
    const fee = parseFloat(elTxFee.value || '0') || 0;

    if (!Number.isFinite(qty) || qty <= 0) { toast('Geçerli gram miktarı girin'); return; }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) { toast('Geçerli birim fiyat girin'); return; }

    const curList = loadTxns().sort((a, b) => a.ts - b.ts);
    const { qty: haveQty } = calcWAC(curList);
    if (type === 'SELL' && qty > haveQty + 1e-9) {
      toast(`Yetersiz gram. Elde: ${formatNum(haveQty, 3)} g`);
      return;
    }

    const tx = {
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      type,
      qty: Math.round(qty * 1000) / 1000, // 0.001g hassasiyet
      unitPrice: Math.round(unitPrice * 100) / 100,
      fee: Math.round(fee * 100) / 100,
      ts: Date.now()
    };
    addTxn(tx);
    elTxQty.value = '';
    elTxPrice.value = '';
    elTxFee.value = '0';

    renderTxTable();
    renderPortfolio();
    toast('İşlem eklendi');
  });

  elClearAll.addEventListener('click', () => {
    if (confirm('Tüm işlemleri silmek istiyor musunuz?')) {
      clearAllTxns();
      renderTxTable();
      renderPortfolio();
      toast('Tüm işlemler silindi');
    }
  });

  // Init
  (function init() {
    // Prefill price from cache
    const cached = loadLocal(priceKey);
    if (cached && typeof cached.gramTry === 'number') {
      lastXauTry = cached.xauTry;
      lastGramPrice = cached.gramTry;
      elPrice.textContent = formatTRY(cached.gramTry);
      elXauTry.textContent = formatTRY(cached.xauTry, 2) + ' / ons';
      elUpdatedAt.textContent = `Son güncelleme: ${new Date(cached.ts).toLocaleString('tr-TR')} (önbellek)`;
      elSource.textContent = `Kaynak: ${cached.source || 'önbellek'}`;
    }

    renderTxTable();
    renderPortfolio();

    // Network + SW
    setOnlineStatus();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
          .then(() => { elSwStatus.textContent = 'PWA aktif'; })
          .catch(() => { elSwStatus.textContent = 'PWA pasif'; });
      });
    } else {
      elSwStatus.textContent = 'PWA desteklenmiyor';
    }

    // First fetch + Poll
    refreshPrice();
    setInterval(refreshPrice, PRICE_POLL_MS);
  })();
})();