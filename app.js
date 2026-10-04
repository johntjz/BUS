const API_BASE = 'https://rt.data.gov.hk/v2/transport/nlb';
const REFRESH_INTERVAL = 15; 
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

let currentLang = localStorage.getItem('pulse_lang') || 'en';
document.getElementById('langSelect').value = currentLang;

const i18n = {
  en: {
    allLines: "All Lines (Network-Wide)", loadingIndex: "Loading station index...",
    syncing: "Syncing Network Mappings...", building: "Building Station Index...",
    liveETA: "Fetching live arrivals...", locating: "Locating...", nearest: "Nearest:",
    noStops: "No stops found", gpsDenied: "GPS Denied / Failed",
    gpsNotSupported: "GPS Not Supported", noBuses: "No active buses depart from here currently.",
    to: "To", due: "Due", min: "m", refresh: "Refresh in", refreshing: "Refreshing...",
    official: "Official", actual: "Actual ETA"
  },
  tc: {
    allLines: "所有路線", loadingIndex: "載入車站索引...",
    syncing: "同步網絡數據...", building: "建立車站索引...",
    liveETA: "獲取實時班次...", locating: "定位中...", nearest: "最近:",
    noStops: "找不到車站", gpsDenied: "定位失敗/被拒絕",
    gpsNotSupported: "不支援定位", noBuses: "目前沒有巴士從此站開出。",
    to: "往", due: "即將到達", min: "分鐘", refresh: "更新:", refreshing: "更新中...",
    official: "官方", actual: "實際預計"
  },
  sc: {
    allLines: "所有路线", loadingIndex: "载入车站索引...",
    syncing: "同步网络数据...", building: "建立车站索引...",
    liveETA: "获取实时班次...", locating: "定位中...", nearest: "最近:",
    noStops: "找不到车站", gpsDenied: "定位失败/被拒绝",
    gpsNotSupported: "不支持定位", noBuses: "目前没有巴士从此站开出。",
    to: "往", due: "即将到达", min: "分钟", refresh: "更新:", refreshing: "更新中...",
    official: "官方", actual: "实际预计"
  }
};

const getT = (key) => i18n[currentLang][key];

let currentRouteKey = 'ALL';
let currentStopName_e = '';
let countdown = REFRESH_INTERVAL;
let timerInterval;

let allStops = [];
let rawRoutes = [];
let groupedRoutes = []; 
let routeStopsCache = {};
const busStateMap = {}; 

class KalmanFilter1D {
  constructor(processNoise, measurementNoise, initialEstimate, initialError) {
    this.q = processNoise; 
    this.r = measurementNoise; 
    this.x = initialEstimate; 
    this.p = initialError; 
  }

  update(measurement, dt) {
    this.x = this.x - dt; 
    this.p = this.p + this.q; 
    const k = this.p / (this.p + this.r); 
    this.x = this.x + k * (measurement - this.x); 
    this.p = (1 - k) * this.p; 
    return Math.max(0, this.x); 
  }
}

function generateDeterministicNoise(busId, currentStopIndex, timestamp) {
  const timeBlock = Math.floor(timestamp / 300000); 
  const seed = `${busId}-${currentStopIndex}-${timeBlock}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0; 
  }
  const normalized = (Math.abs(hash) % 100) / 100;
  return (normalized * 6) - 3;
}

setInterval(() => {
  document.getElementById('liveClock').innerText = new Date().toLocaleTimeString(
    currentLang === 'en' ? 'en-US' : 'zh-HK', 
    { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: currentLang==='en' }
  );
}, 1000);

async function fetchJSON(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`);
  if (!response.ok) throw new Error('API offline');
  return await response.json();
}

function changeLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('pulse_lang', lang);
  populateRouteDropdown();
  const targetGroup = groupedRoutes.find(g => g.key === currentRouteKey);
  populateStopDropdown(targetGroup && currentRouteKey !== 'ALL' ? getStopsForGroup(targetGroup) : allStops);
  updateNetworkTelemetry();
}

function getLocalizedName(obj, prefix) {
  if (currentLang === 'tc') return obj[`${prefix}_c`];
  if (currentLang === 'sc') return obj[`${prefix}_s`];
  return obj[`${prefix}_e`];
}

async function initApp() {
  try {
    document.getElementById('loadingText').innerText = getT('loadingIndex');
    
    const cachedGrouped = localStorage.getItem('nlb_grouped_routes_v3');
    const cachedStops = localStorage.getItem('nlb_stops_v3');
    const cacheTime = localStorage.getItem('nlb_cache_time_v3');
    const now = Date.now();

    if (cachedGrouped && cachedStops && cacheTime && (now - parseInt(cacheTime) < CACHE_EXPIRY_MS)) {
      groupedRoutes = JSON.parse(cachedGrouped);
      routeStopsCache = JSON.parse(cachedStops);
    } else {
      document.getElementById('loadingText').innerText = getT('syncing');
      const rData = await fetchJSON('/route.php?action=list');
      rawRoutes = rData.routes || [];
      
      const groupedMap = new Map();
      rawRoutes.forEach(r => {
        const dest_e = r.routeName_e ? r.routeName_e.split('>').pop().trim() : '';
        const dest_c = r.routeName_c ? r.routeName_c.split(/[>＞]/).pop().trim() : '';
        const dest_s = r.routeName_s ? r.routeName_s.split(/[>＞]/).pop().trim() : '';
        const cleanDest = dest_e.replace(/\s*\([^)]*\)/g, '').trim(); 
        const key = `${r.routeNo}___${cleanDest}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        if (!groupedMap.has(key)) {
          groupedMap.set(key, { key, routeNo: r.routeNo, dest_e, dest_c, dest_s, routeIds: [r.routeId] });
        } else {
          groupedMap.get(key).routeIds.push(r.routeId);
        }
      });

      groupedRoutes = Array.from(groupedMap.values());
      routeStopsCache = {};
      
      const chunkSize = 6;
      for (let i = 0; i < rawRoutes.length; i += chunkSize) {
        const chunk = rawRoutes.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (r) => {
          try {
            const res = await fetchJSON(`/stop.php?action=list&routeId=${r.routeId}`);
            routeStopsCache[r.routeId] = res.stops || [];
          } catch(e) { routeStopsCache[r.routeId] = []; }
        }));
        document.getElementById('loadingText').innerText = `${getT('building')} (${Math.round((i/rawRoutes.length)*100)}%)`;
      }
      
      try {
        localStorage.setItem('nlb_grouped_routes_v3', JSON.stringify(groupedRoutes));
        localStorage.setItem('nlb_stops_v3', JSON.stringify(routeStopsCache));
        localStorage.setItem('nlb_cache_time_v3', now.toString());
      } catch (e) {}
    }
    
    buildAllStopsList();
    populateRouteDropdown();
    
    const savedStop = localStorage.getItem('pulse_stop');
    const savedRoute = localStorage.getItem('pulse_route');
    
    if (savedRoute) currentRouteKey = savedRoute;
    document.getElementById('routeSelect').value = currentRouteKey;
    
    if (savedRoute !== 'ALL' && savedRoute != null) {
        const targetGroup = groupedRoutes.find(g => g.key === savedRoute);
        populateStopDropdown(targetGroup ? getStopsForGroup(targetGroup) : allStops);
    } else {
        populateStopDropdown(allStops); 
    }
    
    if (savedStop && allStops.some(s => s.stopName_e === savedStop)) {
      currentStopName_e = savedStop;
      document.getElementById('stopSelect').value = currentStopName_e;
      startAppLoop();
    } else {
      locateNearestStop(true, false); 
    }
  } catch (err) {
    document.getElementById('loadingText').innerText = "Network Error: Could not connect to API.";
  }
}

function populateRouteDropdown() {
  const rSelect = document.getElementById('routeSelect');
  rSelect.innerHTML = `<option value="ALL">${getT('allLines')}</option>`;
  groupedRoutes.forEach(g => {
      const dest = getLocalizedName(g, 'dest');
      rSelect.insertAdjacentHTML('beforeend', `<option value="${g.key}">${g.routeNo} (${getT('to')} ${dest})</option>`);
  });
  rSelect.value = currentRouteKey;
}

function getStopsForGroup(group) {
  const uniqueMap = new Map();
  group.routeIds.forEach(id => {
    (routeStopsCache[id] || []).forEach(s => {
      if (s && s.stopName_e && !uniqueMap.has(s.stopName_e)) uniqueMap.set(s.stopName_e, s);
    });
  });
  return Array.from(uniqueMap.values());
}

function buildAllStopsList() {
  const uniqueStops = new Map();
  Object.values(routeStopsCache).flat().forEach(s => {
    if (s && s.stopName_e && !uniqueStops.has(s.stopName_e)) uniqueStops.set(s.stopName_e, s);
  });
  allStops = Array.from(uniqueStops.values()).sort((a, b) => a.stopName_e.localeCompare(b.stopName_e));
}

function populateStopDropdown(stopsList) {
  const sSelect = document.getElementById('stopSelect');
  sSelect.innerHTML = '';
  
  if (!stopsList || stopsList.length === 0) return;

  const unique = [];
  const seen = new Set();
  for (const s of stopsList) {
      if (s && s.stopName_e && !seen.has(s.stopName_e)) {
          seen.add(s.stopName_e); unique.push(s);
      }
  }
  
  unique.forEach(s => {
      const displayName = getLocalizedName(s, 'stopName');
      sSelect.insertAdjacentHTML('beforeend', `<option value="${s.stopName_e}">${displayName}</option>`);
  });

  if (sSelect.options.length > 0) {
    if (!currentStopName_e || !seen.has(currentStopName_e)) currentStopName_e = sSelect.options[0].value;
    sSelect.value = currentStopName_e;
  }
}

function handleRouteChange(val) {
  currentRouteKey = val;
  localStorage.setItem('pulse_route', currentRouteKey);
  if (val === 'ALL') {
      populateStopDropdown(allStops);
      locateNearestStop(false, true); 
  } else {
      const targetGroup = groupedRoutes.find(g => g.key === val);
      populateStopDropdown(targetGroup ? getStopsForGroup(targetGroup) : allStops);
      ensureValidStopAndFetch();
  }
}

function handleStopChange(val) {
  if (!val || val.trim() === '') return;
  currentStopName_e = val.trim();
  localStorage.setItem('pulse_stop', currentStopName_e);
  resetAndFetch();
}

function ensureValidStopAndFetch() {
  const sSelect = document.getElementById('stopSelect');
  if (!Array.from(sSelect.options).some(opt => opt.value === currentStopName_e) && sSelect.options.length > 0) {
      currentStopName_e = sSelect.options[0].value;
      localStorage.setItem('pulse_stop', currentStopName_e);
  } 
  sSelect.value = currentStopName_e;
  resetAndFetch();
}

function resetAndFetch() {
  document.getElementById('gpsStatus').innerText = ''; 
  document.getElementById('routeList').innerHTML = `<div style="padding: 20px; color: var(--text-secondary);" id="loadingText">${getT('liveETA')}</div>`;
  for (let key in busStateMap) delete busStateMap[key];
  countdown = REFRESH_INTERVAL;
  updateNetworkTelemetry();
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function locateNearestStop(isAutoInit = false, isFromDropdown = false) {
  if (!navigator.geolocation) return handleGPSFailure(isAutoInit, isFromDropdown, getT('gpsNotSupported'));
  
  document.getElementById('gpsStatus').innerText = getT('locating');
  navigator.geolocation.getCurrentPosition((pos) => {
    let closest = null, minDistance = Infinity;
    allStops.forEach(s => {
      const d = calculateDistanceKm(pos.coords.latitude, pos.coords.longitude, parseFloat(s.latitude), parseFloat(s.longitude));
      if (d < minDistance) { minDistance = d; closest = s; }
    });
    
    if (closest) {
      currentRouteKey = 'ALL';
      document.getElementById('routeSelect').value = 'ALL';
      localStorage.setItem('pulse_route', 'ALL');
      populateStopDropdown(allStops);

      currentStopName_e = closest.stopName_e;
      document.getElementById('stopSelect').value = currentStopName_e;
      localStorage.setItem('pulse_stop', currentStopName_e);
      
      document.getElementById('gpsStatus').innerText = `${getT('nearest')} ${Math.round(minDistance * 1000)}m`;
      for (let key in busStateMap) delete busStateMap[key];
      isAutoInit ? startAppLoop() : resetAndFetch();
    } else {
      handleGPSFailure(isAutoInit, isFromDropdown, getT('noStops'));
    }
  }, () => handleGPSFailure(isAutoInit, isFromDropdown, getT('gpsDenied')), { enableHighAccuracy: true, timeout: 6000 });
}

function handleGPSFailure(isAutoInit, isFromDropdown, msg) {
  document.getElementById('gpsStatus').innerText = msg;
  if (isAutoInit) {
      currentRouteKey = 'ALL'; document.getElementById('routeSelect').value = 'ALL';
      populateStopDropdown(allStops);
      if (allStops.length > 0 && !allStops.some(s => s.stopName_e === currentStopName_e)) {
          currentStopName_e = 'Tung Chung Station Bus Terminus';
      }
      document.getElementById('stopSelect').value = currentStopName_e;
      for (let key in busStateMap) delete busStateMap[key];
      startAppLoop();
  } else if (isFromDropdown) {
      ensureValidStopAndFetch();
    }
}

function startAppLoop() {
  updateNetworkTelemetry();
  startTimer();
}

async function updateNetworkTelemetry() {
  if (!currentStopName_e) return;
  
  try {
    const groupsToCheck = currentRouteKey === 'ALL' ? groupedRoutes : groupedRoutes.filter(g => g.key === currentRouteKey);
    const relevantGroups = [];
    
    for (const group of groupsToCheck) {
      const matchDetails = [];
      for (const routeId of group.routeIds) {
        const stops = routeStopsCache[routeId] || [];
        const targetIndex = stops.findIndex(s => s.stopName_e === currentStopName_e);
        if (targetIndex !== -1) matchDetails.push({ routeId, stops, targetIndex });
      }
      if (matchDetails.length > 0) relevantGroups.push({ group, matchDetails });
    }

    const listEl = document.getElementById('routeList');
    if (document.getElementById('loadingText')) document.getElementById('loadingText').remove();

    if (relevantGroups.length === 0) {
      listEl.innerHTML = `<div style="padding: 20px; color: var(--text-secondary); text-align: center;">${getT('noBuses')}</div>`;
      return;
    }

    for (const item of relevantGroups) {
      const group = item.group;
      const cardId = `route-${group.key}`;
      const destName = getLocalizedName(group, 'dest');

      // Note: The text <span> has been completely removed from this template
      if (!document.getElementById(cardId)) {
        listEl.insertAdjacentHTML('beforeend', `
          <div class="route-card" id="${cardId}" data-smart-mins="9999">
            <div class="route-left">
              <div class="route-no">${group.routeNo}</div>
              <div class="route-info">
                <div class="route-dest">${getT('to')} ${destName}</div>
                <div class="compact-occupancy" id="occ-sec-${group.key}" style="display:none;">
                  <div class="bar-segments" id="bars-${group.key}">
                    ${Array(5).fill('<div class="segment"></div>').join('')}
                  </div>
                </div>
              </div>
            </div>
            <div class="eta-container">
              <div class="eta-box">
                <span class="eta-label" id="lbl-off-${group.key}">${getT('official')}</span>
                <span class="official-eta" id="off-${group.key}">--</span>
              </div>
              <div class="eta-box">
                <span class="eta-label" id="lbl-smart-${group.key}">${getT('actual')}</span>
                <span class="smart-eta" id="smart-${group.key}">--</span>
              </div>
            </div>
          </div>
        `);
      } else {
         document.querySelector(`#${cardId} .route-dest`).innerText = `${getT('to')} ${destName}`;
         document.getElementById(`lbl-off-${group.key}`).innerText = getT('official');
         document.getElementById(`lbl-smart-${group.key}`).innerText = getT('actual');
      }
    }

    const validCardIds = relevantGroups.map(i => `route-${i.group.key}`);
    document.querySelectorAll('.route-card').forEach(c => {
      if (!validCardIds.includes(c.id)) c.remove();
    });

    await Promise.all(relevantGroups.map(item => processSmartArrivals(item.group, item.matchDetails)));

    const cards = Array.from(listEl.querySelectorAll('.route-card'));
    cards.sort((a, b) => parseInt(a.dataset.smartMins, 10) - parseInt(b.dataset.smartMins, 10));
    cards.forEach(card => listEl.appendChild(card));

  } catch (err) {}
}

async function processSmartArrivals(group, matchDetails) {
  const groupKey = group.key;
  const cardEl = document.getElementById(`route-${groupKey}`);
  
  try {
    const offEl = document.getElementById(`off-${groupKey}`);
    const smartEl = document.getElementById(`smart-${groupKey}`);
    const occSecEl = document.getElementById(`occ-sec-${groupKey}`);

    let combinedArrivals = [];

    await Promise.all(matchDetails.map(async (m) => {
      const targetStop = m.stops[m.targetIndex];
      const targetEtaRes = await fetchJSON(`/stop.php?action=estimatedArrivals&routeId=${m.routeId}&stopId=${targetStop.stopId}&language=en`);
      
      if (targetEtaRes && targetEtaRes.estimatedArrivals) {
        targetEtaRes.estimatedArrivals.forEach(arr => {
          combinedArrivals.push({
            arrival: arr,
            targetStop,
            targetIndex: m.targetIndex,
            totalStops: m.stops.length
          });
        });
      }
    }));

    if (combinedArrivals.length === 0) {
      if(cardEl) cardEl.dataset.smartMins = 9999;
      offEl.innerText = '--';
      smartEl.innerText = '--';
      occSecEl.style.display = 'none';
      return;
    }

    combinedArrivals.sort((a, b) => new Date(a.arrival.estimatedArrivalTime.replace(/-/g, '/')) - new Date(b.arrival.estimatedArrivalTime.replace(/-/g, '/')));
    
    const activeItem = combinedArrivals[0];
    const activeBus = activeItem.arrival;
    const now = Date.now();
    const serverTime = new Date(activeBus.generateTime.replace(/-/g, '/'));
    const arrivalTime = new Date(activeBus.estimatedArrivalTime.replace(/-/g, '/'));
    const pseudoBusId = activeBus.estimatedArrivalTime.replace(/[^0-9]/g, ''); 
    
    let elapsedSinceGenerate = now - serverTime.getTime();
    if (elapsedSinceGenerate < 0 || elapsedSinceGenerate > 120000) elapsedSinceGenerate = 0; 

    const remainingMs = (arrivalTime.getTime() - serverTime.getTime()) - elapsedSinceGenerate;
    const rawEtaMins = Math.max(0, Math.floor(remainingMs / 60000));
    
    // --- LOAD FACTOR DETERMINATION ---
    const { pct, activeBars } = calculateOccupancy(group.routeNo, group.dest_e, combinedArrivals.map(c => c.arrival), activeItem.targetIndex, activeItem.totalStops, pseudoBusId, now);
    
    let colorClass = pct > 85 ? 'active-red' : (pct > 65 ? 'active-orange' : 'active-green');
    let barHtml = '';
    for (let i = 1; i <= 5; i++) barHtml += `<div class="segment ${i <= activeBars ? colorClass : ''}"></div>`;
    document.getElementById(`bars-${groupKey}`).innerHTML = barHtml;
    occSecEl.style.display = 'flex';

    // --- KALMAN FILTER EXECUTION ---
    let smartMins = rawEtaMins;
    
    if (rawEtaMins > 0) {
      if (!busStateMap[groupKey] || busStateMap[groupKey].pseudoBusId !== pseudoBusId) {
        busStateMap[groupKey] = {
           filter: new KalmanFilter1D(0.1, 2.0, rawEtaMins, 1.0),
           timestamp: now,
           pseudoBusId: pseudoBusId
        };
      }
      
      const state = busStateMap[groupKey];
      const dtMins = (now - state.timestamp) / 60000;
      
      if (dtMins > 0) {
         smartMins = Math.round(state.filter.update(rawEtaMins, dtMins));
         state.timestamp = now;
      } else {
         smartMins = Math.round(state.filter.x);
      }
      
    } else {
      smartMins = 0;
      delete busStateMap[groupKey]; 
    }

    cardEl.dataset.smartMins = smartMins;
    offEl.innerText = rawEtaMins === 0 ? getT('due') : `${rawEtaMins}${getT('min')}`;

    if (smartMins === 0) {
      smartEl.innerText = getT('due');
      smartEl.className = 'smart-eta';
    } else {
      smartEl.innerText = `${smartMins}${getT('min')}`;
      smartEl.className = smartMins > rawEtaMins ? 'smart-eta adjusted' : 'smart-eta';
    }

  } catch (err) {
    if (cardEl) cardEl.dataset.smartMins = 9999;
  }
}

function calculateOccupancy(routeNo, destName, estimatedArrivals, currentStopIndex, totalStops, busId, currentTimestamp) {
  const hour = new Date().getHours();
  const dest = destName.toLowerCase();
  let baseLoad = 40; 
  
  if (hour >= 7 && hour <= 9) baseLoad = (dest.includes('tung chung') || dest.includes('mui wo')) ? 80 : 45;
  else if (hour >= 17 && hour <= 19) baseLoad = (!dest.includes('tung chung')) ? 75 : 50;
  else if (hour >= 11 && hour <= 14) baseLoad = 35;

  let spatialMultiplier = 1 - Math.pow(Math.max(0, Math.min(1, currentStopIndex / Math.max(1, totalStops - 1))), 2.5);
  
  // --- STARTING STATION ACCURACY FIX ---
  // If at the terminus, a bus is empty until shortly before departure.
  if (currentStopIndex === 0 && estimatedArrivals && estimatedArrivals.length > 0) {
    const minToDeparture = Math.floor((new Date(estimatedArrivals[0].estimatedArrivalTime.replace(/-/g, '/')) - currentTimestamp) / 60000);
    if (minToDeparture > 10) spatialMultiplier = 0.1; // Mostly empty waiting
    else if (minToDeparture > 5) spatialMultiplier = 0.4; // Filling up
    else spatialMultiplier = 1.0; // Ready to depart, full base load
  }

  let headwayMultiplier = 1.0;
  if (estimatedArrivals && estimatedArrivals.length >= 2) {
    const serverTime = new Date(estimatedArrivals[0].generateTime.replace(/-/g, '/'));
    const t1 = Math.max(0, (new Date(estimatedArrivals[0].estimatedArrivalTime.replace(/-/g, '/')) - serverTime) / 60000);
    const t2 = Math.max(0, (new Date(estimatedArrivals[1].estimatedArrivalTime.replace(/-/g, '/')) - serverTime) / 60000);
    const gap = t2 - t1;
    headwayMultiplier = gap <= 8 ? 1.8 : 0.5 + (2.0 * (1 - Math.exp(-0.08 * gap)));
  }

  const stableNoise = generateDeterministicNoise(busId, currentStopIndex, currentTimestamp);
  let rawVolume = (baseLoad * spatialMultiplier * headwayMultiplier) + stableNoise;

  const strictSingle = ['1', '2', '11', '21', '34', '36', 'A35', 'N35'];
  const strictDouble = ['37M', '38', '39M', 'B2', 'B2P', 'B4', 'B6'];

  let capacityDivider = 1.0; 
  if (strictSingle.includes(routeNo)) capacityDivider = 0.6; 
  if (strictDouble.includes(routeNo)) capacityDivider = 1.3; 

  let pct = Math.min(100, Math.max(0, Math.round(rawVolume / capacityDivider)));
  const activeBars = Math.min(5, Math.max(1, Math.ceil(pct / 20)));
  
  return { pct, activeBars };
}

function startTimer() {
  clearInterval(timerInterval);
  countdown = REFRESH_INTERVAL;
  document.getElementById('refreshTimer').innerText = `${getT('refresh')} ${countdown}s`;
  
  timerInterval = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = REFRESH_INTERVAL;
      document.getElementById('refreshTimer').innerText = getT('refreshing');
      updateNetworkTelemetry();
    } else {
      document.getElementById('refreshTimer').innerText = `${getT('refresh')} ${countdown}s`;
    }
  }, 1000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    countdown = REFRESH_INTERVAL;
    document.getElementById('refreshTimer').innerText = getT('refreshing');
    updateNetworkTelemetry();
    startTimer();
  } else {
    clearInterval(timerInterval);
  }
});

initApp();
