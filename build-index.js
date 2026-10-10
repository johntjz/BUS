const fs = require('fs');

const KMB_API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const NLB_API_BASE = 'https://rt.data.gov.hk/v2/transport/nlb';

// Helper function to prevent DDoS bans from government servers
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanStopName(name) {
  if (!name) return '';
  return name.replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

function formatStopName(name) {
  return name ? name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
}

async function build() {
  console.log('Fetching network data from KMB, NLB, CTB, and GMB...');
  const groupedMap = new Map();
  const routeStopsCache = {};

  // ==========================================
  // 1. NLB Routes & Stops
  // ==========================================
  try {
    console.log('Processing NLB...');
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

  // ==========================================
  // 2. KMB Routes & Stops
  // ==========================================
  try {
    console.log('Processing KMB & LWB...');
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

  // ==========================================
  // 3. CITYBUS (CTB) INGESTION
  // ==========================================
  try {
    console.log("Processing Citybus (CTB)...");
    const routesRes = await fetch('https://rt.data.gov.hk/v2/transport/citybus/route/ctb');
    const routesData = await routesRes.json();
    
    for (const route of routesData.data) {
        const dirString = route.bound === 'I' ? 'inbound' : 'outbound';
        
        try {
            const stopsRes = await fetch(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/ctb/${route.route}/${dirString}`);
            const stopsData = await stopsRes.json();
            
            const rId = `CTB_${route.route}_${route.bound}`;
            
            // Format stop coordinates (requires fetching individual stops, so we skip coords to save time, or set to 0 if unknown)
            // For a complete map, you would need to hit the stop detail endpoint, but for now we register the route.
            routeStopsCache[rId] = stopsData.data.map(rs => {
                return { stopId: rs.stop, stopName_e: 'CTB Stop', latitude: '0', longitude: '0', seq: rs.seq };
            });

            const cleanDestE = formatStopName(cleanStopName(route.dest_en));
            const groupKey = `CTB_${route.route}___${cleanDestE}`.replace(/[^a-zA-Z0-9_-]/g, '_');

            if (!groupedMap.has(groupKey)) {
                groupedMap.set(groupKey, { key: groupKey, routeNo: route.route, dest_e: cleanDestE, routeIds: [rId], company: 'CTB' });
            } else {
                groupedMap.get(groupKey).routeIds.push(rId);
            }
            
            await sleep(50); // PAUSE FOR 50ms
        } catch (e) {
            console.log(`Failed to fetch CTB ${route.route}`);
        }
    }
  } catch (e) { console.error('Error fetching CTB:', e); }

  // ==========================================
  // 4. GREEN MINIBUS (GMB) INGESTION
  // ==========================================
  try {
    console.log("Processing Green Minibus (GMB)...");
    const routesRes = await fetch('https://data.etagmb.gov.hk/route');
    const routesData = await routesRes.json();
    
    const allRouteCodes = [
        ...routesData.data.routes.HKI.map(c => ({code: c, reg: 'HKI'})),
        ...routesData.data.routes.KLN.map(c => ({code: c, reg: 'KLN'})),
        ...routesData.data.routes.NT.map(c => ({code: c, reg: 'NT'}))
    ];

    for (const r of allRouteCodes) {
        try {
            const detailRes = await fetch(`https://data.etagmb.gov.hk/route/${r.reg}/${r.code}`);
            const detailData = await detailRes.json();
            
            for (const variant of detailData.data) {
                const routeId = variant.route_id;
                const rId = `GMB_${routeId}`;
                
                const stopsRes = await fetch(`https://data.etagmb.gov.hk/route-stop/${routeId}/1`);
                const stopsData = await stopsRes.json();
                
                if (stopsData && stopsData.data && stopsData.data.route_stops) {
                    routeStopsCache[rId] = stopsData.data.route_stops.map(rs => {
                        return { stopId: rs.stop_id, stopName_e: cleanStopName(rs.name_en), latitude: '0', longitude: '0', seq: rs.stop_seq };
                    });

                    const dest_e = variant.dest_en || 'Unknown';
                    const groupKey = `GMB_${r.code}___${cleanStopName(dest_e)}`.replace(/[^a-zA-Z0-9_-]/g, '_');

                    if (!groupedMap.has(groupKey)) {
                        groupedMap.set(groupKey, { key: groupKey, routeNo: r.code, dest_e: dest_e, routeIds: [rId], company: 'GMB' });
                    } else {
                        groupedMap.get(groupKey).routeIds.push(rId);
                    }
                }
                await sleep(100); // PAUSE FOR 100ms
            }
        } catch (e) {
            // console.log(`Failed GMB ${r.code}`); // Silenced to keep logs clean
        }
    }
  } catch (e) { console.error('Error fetching GMB:', e); }

  // ==========================================
  // COMPILE AND SAVE
  // ==========================================
  const output = {
    groupedRoutes: Array.from(groupedMap.values()),
    routeStopsCache
  };

  fs.writeFileSync('./bus_index.min.json', JSON.stringify(output));
  console.log('Successfully generated bus_index.min.json with all operators!');
}

build();
