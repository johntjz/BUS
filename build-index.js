// Add this helper function at the top of your script to prevent DDoS bans
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// CITYBUS (CTB) INGESTION
// ==========================================
async function fetchCitybus() {
    console.log("Fetching Citybus routes...");
    const routesRes = await fetch('https://rt.data.gov.hk/v2/transport/citybus/route/ctb');
    const routesData = await routesRes.json();
    
    for (const route of routesData.data) {
        // CTB uses 'inbound' and 'outbound' in the URL, but 'I' and 'O' in the data. We must map it.
        const dirString = route.bound === 'I' ? 'inbound' : 'outbound';
        
        try {
            const stopsRes = await fetch(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${route.route}/${dirString}`);
            const stopsData = await stopsRes.json();
            
            // Build your grouped route logic here, matching KMB's structure
            const groupId = `CTB_${route.route}`;
            // ... (Add to your global JSON array)
            
            await sleep(50); // PAUSE FOR 50ms so Citybus doesn't block GitHub
        } catch (e) {
            console.log(`Failed to fetch CTB ${route.route}`);
        }
    }
}

// ==========================================
// GREEN MINIBUS (GMB) INGESTION
// ==========================================
async function fetchGMB() {
    console.log("Fetching GMB routes...");
    const routesRes = await fetch('https://data.etagmb.gov.hk/route');
    const routesData = await routesRes.json();
    
    // GMB splits routes by region (HKI, KLN, NT). We combine them into one array.
    const allRouteCodes = [
        ...routesData.data.routes.HKI.map(c => ({code: c, reg: 'HKI'})),
        ...routesData.data.routes.KLN.map(c => ({code: c, reg: 'KLN'})),
        ...routesData.data.routes.NT.map(c => ({code: c, reg: 'NT'}))
    ];

    for (const r of allRouteCodes) {
        try {
            const detailRes = await fetch(`https://data.etagmb.gov.hk/route/${r.reg}/${r.code}`);
            const detailData = await detailRes.json();
            
            // GMB hides the actual route_id inside this second payload
            for (const variant of detailData.data) {
                const routeId = variant.route_id;
                // Fetch the physical stops for this specific GMB route
                const stopsRes = await fetch(`https://data.etagmb.gov.hk/route-stop/${routeId}/1`); // 1 = direction
                // ... (Format and push to your JSON array)
                
                await sleep(100); // GMB Firewall is strict. PAUSE FOR 100ms!
            }
        } catch (e) {
            console.log(`Failed GMB ${r.code}`);
        }
    }
}

const fs = require('fs');

const KMB_API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const NLB_API_BASE = 'https://rt.data.gov.hk/v2/transport/nlb';

function cleanStopName(name) {
  if (!name) return '';
  return name.replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

function formatStopName(name) {
  return name ? name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
}

async function build() {
  console.log('Fetching network data from KMB and NLB...');
  const groupedMap = new Map();
  const routeStopsCache = {};

  // 1. NLB Routes & Stops
  try {
    const nlbRes = await fetch(`${NLB_API_BASE}/route.php?action=list`).then(r => r.json());
    const rawNlbRoutes = nlbRes.routes || [];
    rawNlbRoutes.forEach(r => {
      const dest_e = r.routeName_e ? r.routeName_e.split('>').pop().trim() : '';
      const cleanDest = cleanStopName(dest_e);
      const key = `NLB_${r.routeNo}___${cleanDest}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!groupedMap.has(key)) {
        groupedMap.set(key, { key, routeNo: r.routeNo, dest_e: cleanDest, routeIds: [`NLB_${r.routeId}`], company: 'NLB' });
      } else {
        groupedMap.get(key).routeIds.push(`NLB_${r.routeId}`);
      }
    });

    const chunkSize = 15;
    for (let i = 0; i < rawNlbRoutes.length; i += chunkSize) {
      const chunk = rawNlbRoutes.slice(i, i + chunkSize);
      await Promise.all(chunk.map(async (r) => {
        try {
          const res = await fetch(`${NLB_API_BASE}/stop.php?action=list&routeId=${r.routeId}`).then(res => res.json());
          routeStopsCache[`NLB_${r.routeId}`] = (res.stops || []).map(s => ({...s, stopName_e: cleanStopName(s.stopName_e)}));
        } catch(e) {}
      }));
    }
  } catch(e) { console.error('Error fetching NLB:', e); }

  // 2. KMB Routes & Stops
  try {
    const [kmbRoutesRes, kmbStopsRes, kmbRouteStopsRes] = await Promise.all([
      fetch(`${KMB_API_BASE}/route/`).then(r => r.json()),
      fetch(`${KMB_API_BASE}/stop/`).then(r => r.json()),
      fetch(`${KMB_API_BASE}/route-stop/`).then(r => r.json())
    ]);

    const allKmbStops = {};
    if (kmbStopsRes?.data) kmbStopsRes.data.forEach(s => { allKmbStops[s.stop] = s; });

    const kmbRouteStopsMap = {};
    if (kmbRouteStopsRes?.data) {
      kmbRouteStopsRes.data.forEach(rs => {
        const key = `KMB_${rs.route}_${rs.bound}_${rs.service_type}`;
        if (!kmbRouteStopsMap[key]) kmbRouteStopsMap[key] = [];
        kmbRouteStopsMap[key].push(rs);
      });
    }

    if (kmbRoutesRes?.data) {
      kmbRoutesRes.data.forEach(r => {
        const rId = `KMB_${r.route}_${r.bound}_${r.service_type}`;
        const rsData = kmbRouteStopsMap[rId];
        if (!rsData) return;

        rsData.sort((a,b) => parseInt(a.seq) - parseInt(b.seq));
        routeStopsCache[rId] = rsData.map(rs => {
          const stopDetail = allKmbStops[rs.stop] || { name_en: 'Unknown', lat: '0', long: '0' };
          return { stopId: rs.stop, stopName_e: formatStopName(cleanStopName(stopDetail.name_en)), latitude: stopDetail.lat, longitude: stopDetail.long, seq: rs.seq };
        });

        const company = (r.route.startsWith('E') || r.route.startsWith('A') || r.route.startsWith('NA') || r.route.startsWith('S')) ? 'LWB' : 'KMB';
        const cleanDestE = formatStopName(cleanStopName(r.dest_en));
        const groupKey = `KMB_${r.route}___${cleanDestE}`.replace(/[^a-zA-Z0-9_-]/g, '_');

        if (!groupedMap.has(groupKey)) {
          groupedMap.set(groupKey, { key: groupKey, routeNo: r.route, dest_e: cleanDestE, routeIds: [rId], company });
        } else {
          groupedMap.get(groupKey).routeIds.push(rId);
        }
      });
    }
  } catch(e) { console.error('Error fetching KMB:', e); }

  const output = {
    groupedRoutes: Array.from(groupedMap.values()),
    routeStopsCache
  };

  fs.writeFileSync('./bus_index.min.json', JSON.stringify(output));
  console.log('Successfully generated bus_index.min.json!');
}

build();
