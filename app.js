(function () {
  const GRAMS_PER_TROY_OUNCE = 31.1035;
  const PRICE_POLL_MS = 60_000;

  // Elements
  const elPrice = document.getElementById('price');
  const elUpdatedAt = document.getElementById('updatedAt');
  const elXauusd = document.getElementById('xauusd');
  const elUsdtry = document.getElementById('usdtry');
  const elRefresh = document.getElementById('refreshBtn');
  const elNetStatus = document.getElementById('netStatus');
  const elSwStatus = document.getElementById('swStatus');
  const elToast = document.getElementById('toast');

  const elAlarmTarget = document.getElementById('alarmTarget');
  const elAlarmDirection = document.getElementById('alarmDirection');
  const elAlarmRepeat = document.getElementById('alarmRepeat');
  const elSaveAlarm = document.getElementById('saveAlarmBtn');
  const elDisableAlarm = document.getElementById('disableAlarmBtn');
  const elPermBtn = document.getElementById('permBtn');
  const elTestNotiBtn = document.getElementById('testNotiBtn');
  const elAlarmStatus = document.getElementById('alarmStatus');

  let lastPrice = null;
  let lastXauUsd = null;
  let lastUsdTry = null;
  let lastSide = null; // 'ABOVE' | 'BELOW'
  let pollTimer = null;

  const alarmKey = 'altintakip_alarm';
  const priceKey = 'altintakip_last_price';

  function saveLocal(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function loadLocal(key, def = null) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  }

  function formatTRY(v) {
    if (v == null || Number.isNaN(v)) return '—';
    try {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(v);
    } catch {
      return v.toFixed(2) + ' ₺';
    }
  }
  function formatNumber(v, digits = 2) {
    if (v == null || Number.isNaN(v)) return '—';
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits }).format(v);
  }
  function nowStr() {
    return new Date().toLocaleString('tr-TR');
  }

  async function fetchJSON(url, timeoutMs = 8000) {
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

  async function getXAUUSD() {
    // Primary: exchangerate.host convert
    try {
      const data = await fetchJSON('https://api.exchangerate.host/convert?from=XAU&to=USD');
      if (data && typeof data.result === 'number') return data.result;
    } catch {}
    // Fallback: latest base=USD, symbols=XAU -> invert
    try {
      const data = await fetchJSON('https://api.exchangerate.host/latest?base=USD&symbols=XAU');
      const r = data?.rates?.XAU;
      if (typeof r === 'number' && r > 0) return 1 / r;
    } catch {}
    throw new Error('XAUUSD alınamadı');
  }

  async function getUSDTRY() {
    // Primary: exchangerate.host convert
    try {
      const data = await fetchJSON('https://api.exchangerate.host/convert?from=USD&to=TRY');
      if (data && typeof data.result === 'number') return data.result;
    } catch {}
    // Fallback: frankfurter.app
    try {
      const data = await fetchJSON('https://api.frankfurter.app/latest?from=USD&to=TRY');
      const r = data?.rates?.TRY;
      if (typeof r === 'number') return r;
    } catch {}
    throw new Error('USDTRY alınamadı');
  }

  async function getGramTRY() {
    const [xauusd, usdtry] = await Promise.all([getXAUUSD(), getUSDTRY()]);
    const gramTry = (xauusd / GRAMS_PER_TROY_OUNCE) * usdtry;
    return { gramTry, xauusd, usdtry };
  }

  function setOnlineStatus() {
    const online = navigator.onLine;
    elNetStatus.textContent = online ? 'Online' : 'Offline';
    elNetStatus.classList.toggle('online', online);
    elNetStatus.classList.toggle('offline', !online);
  }

  function toast(msg) {
    elToast.textContent = msg;
    elToast.style.display = 'block';
    clearTimeout(elToast._t);
    elToast._t = setTimeout(() => {
      elToast.style.display = 'none';
    }, 2500);
  }

  function updateUI({ gramTry, xauusd, usdtry }, fromCache = false) {
    lastPrice = gramTry;
    lastXauUsd = xauusd;
    lastUsdTry = usdtry;

    elPrice.textContent = formatTRY(gramTry);
    elXauusd.textContent = xauusd ? `${formatNumber(xauusd, 2)} USD/ons` : '—';
    elUsdtry.textContent = usdtry ? formatNumber(usdtry, 4) : '—';
    elUpdatedAt.textContent = `Son güncelleme: ${nowStr()}${fromCache ? ' (önbellek)' : ''}`;
    document.title = `₺${(gramTry ?? 0).toFixed(2)} • AltınTakip`;

    // Persist last price
    saveLocal(priceKey, {
      gramTry, xauusd, usdtry, ts: Date.now()
    });

    // Alarm check
    runAlarmCheck(gramTry);
  }

  function loadLastPriceFromCache() {
    const cached = loadLocal(priceKey);
    if (cached && typeof cached.gramTry === 'number') {
      updateUI(cached, true);
    }
  }

  async function refreshPrice() {
    try {
      const data = await getGramTRY();
      updateUI(data, false);
    } catch (e) {
      toast('Fiyat alınamadı. Son veri gösteriliyor.');
      if (lastPrice == null) loadLastPriceFromCache();
    }
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
        icon: '/icons/icon.svg',
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
      if (!a.repeat) {
        a.active = false;
      }
      writeAlarm(a);
    } else {
      if (a.lastSide !== side) {
        a.lastSide = side;
        writeAlarm(a);
      }
    }
  }

  // UI events
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

  elSaveAlarm.addEventListener('click', () => {
    const target = parseFloat(elAlarmTarget.value);
    if (!Number.isFinite(target) || target <= 0) {
      toast('Geçerli bir hedef fiyat girin');
      return;
    }
    const a = readAlarm();
    a.active = true;
    a.target = target;
    a.direction = elAlarmDirection.value;
    a.repeat = !!elAlarmRepeat.checked;
    a.lastSide = currentSide(lastPrice, target);
    writeAlarm(a);
    toast('Alarm kaydedildi');
  });

  elDisableAlarm.addEventListener('click', () => {
    const a = readAlarm();
    a.active = false;
    writeAlarm(a);
    toast('Alarm kapatıldı');
  });

  // Prefill alarm UI from storage
  (function initAlarmUI() {
    const a = readAlarm();
    if (a.target) elAlarmTarget.value = a.target;
    elAlarmDirection.value = a.direction || 'ABOVE';
    elAlarmRepeat.checked = a.repeat !== false;
    renderAlarmStatus(a);
  })();

  // Init network status
  setOnlineStatus();

  // Try load cached price immediately
  loadLastPriceFromCache();

  // First fetch
  refreshPrice();

  // Poll
  pollTimer = setInterval(refreshPrice, PRICE_POLL_MS);

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(() => {
          elSwStatus.textContent = 'PWA aktif';
        })
        .catch(() => {
          elSwStatus.textContent = 'PWA pasif';
        });
    });
  } else {
    elSwStatus.textContent = 'PWA desteklenmiyor';
  }
})();