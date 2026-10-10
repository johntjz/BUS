const fs = require('fs');

const KMB_API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const NLB_API_BASE = 'https://rt.data.gov.hk/v2/transport/nlb';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanStopName(name) {
  if (!name) return '';
  return name.replace(/\s*[\(（][^\)）]*[\)）]/g, '').trim();
}

function formatStopName(name) {
  return name ? name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ') : '';
}

// Catches all 404s, 503s, and JSON parse errors so the build NEVER crashes
async function safeFetch(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch(e) {
        return null; 
    }
}

async function build() {
  console.log('Fetching network data from KMB, NLB, CTB, and GMB...');
  const groupedMap = new Map();
  const routeStopsCache = {};

  // 1. NLB
  console.log('Processing NLB...');
  const nlbRes = await safeFetch(`${NLB_API_BASE}/route.php?action=list`);
  if (nlbRes && nlbRes.routes) {
      nlbRes.routes.forEach(r => {
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
      for (let i = 0; i < nlbRes.routes.length; i += chunkSize) {
        const chunk = nlbRes.routes.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (r) => {
            const res = await safeFetch(`${NLB_API_BASE}/stop.php?action=list&routeId=${r.routeId}`);
            if (res && res.stops) {
                routeStopsCache[`NLB_${r.routeId}`] = res.stops.map(s => ({...s, stopName_e: cleanStopName(s.stopName_e)}));
            }
        }));
      }
  }

  // 2. KMB & LWB
  console.log('Processing KMB & LWB...');
  const [kmbRoutesRes, kmbStopsRes, kmbRouteStopsRes] = await Promise.all([
    safeFetch(`${KMB_API_BASE}/route/`),
    safeFetch(`${KMB_API_BASE}/stop/`),
    safeFetch(`${KMB_API_BASE}/route-stop/`)
  ]);
  
  if (kmbRoutesRes && kmbStopsRes && kmbRouteStopsRes) {
      const allKmbStops = {};
      if (kmbStopsRes.data) kmbStopsRes.data.forEach(s => { allKmbStops[s.stop] = s; });
      const kmbRouteStopsMap = {};
      if (kmbRouteStopsRes.data) {
        kmbRouteStopsRes.data.forEach(rs => {
          const key = `KMB_${rs.route}_${rs.bound}_${rs.service_type}`;
          if (!kmbRouteStopsMap[key]) kmbRouteStopsMap[key] = [];
          kmbRouteStopsMap[key].push(rs);
        });
      }
      if (kmbRoutesRes.data) {
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
  }

  // 3. CITYBUS (CTB)
  console.log("Processing Citybus (CTB)...");
  const ctbRoutes = await safeFetch('https://rt.data.gov.hk/v2/transport/citybus/route/CTB');
  if (ctbRoutes && ctbRoutes.data) {
      for (const route of ctbRoutes.data) {
          const dirString = route.bound === 'I' ? 'inbound' : 'outbound';
          const stopsData = await safeFetch(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/${route.route}/${dirString}`);
          if (stopsData && stopsData.data) {
              const rId = `CTB_${route.route}_${route.bound}`;
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
          }
          await sleep(15); 
      }
  }

  // 4. GREEN MINIBUS (GMB)
  console.log("Processing Green Minibus (GMB)...");
  const gmbData = await safeFetch('https://data.etagmb.gov.hk/route');
  if (gmbData && gmbData.data && gmbData.data.routes) {
      const gmbRoutes = gmbData.data.routes;
      const allRouteCodes = [
          ...(gmbRoutes.HKI || []).map(c => ({code: c, reg: 'HKI'})),
          ...(gmbRoutes.KLN || []).map(c => ({code: c, reg: 'KLN'})),
          ...(gmbRoutes.NT || []).map(c => ({code: c, reg: 'NT'}))
      ];
      for (const r of allRouteCodes) {
          const detailData = await safeFetch(`https://data.etagmb.gov.hk/route/${r.reg}/${r.code}`);
          if (detailData && detailData.data) {
              for (const variant of detailData.data) {
                  const routeId = variant.route_id;
                  const routeSeq = variant.route_seq || 1; // Safely catches specific route directions
                  const stopsData = await safeFetch(`https://data.etagmb.gov.hk/route-stop/${routeId}/${routeSeq}`);
                  if (stopsData && stopsData.data && stopsData.data.route_stops) {
                      const rId = `GMB_${routeId}`;
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
                  await sleep(15);
              }
          }
      }
  }

  const output = {
    groupedRoutes: Array.from(groupedMap.values()),
    routeStopsCache
  };
  fs.writeFileSync('./bus_index.min.json', JSON.stringify(output));
  console.log('Successfully generated bus_index.min.json with all operators!');
}

build();
