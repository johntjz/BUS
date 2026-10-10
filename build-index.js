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
  if (nlbRes && Array.isArray(nlbRes.routes)) {
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
            if (res && Array.isArray(res.stops)) {
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
      if (Array.isArray(kmbStopsRes.data)) kmbStopsRes.data.forEach(s => { allKmbStops[s.stop] = s; });
      const kmbRouteStopsMap = {};
      if (Array.isArray(kmbRouteStopsRes.data)) {
        kmbRouteStopsRes.data.forEach(rs => {
          const key = `KMB_${rs.route}_${rs.bound}_${rs.service_type}`;
          if (!kmbRouteStopsMap[key]) kmbRouteStopsMap[key] = [];
          kmbRouteStopsMap[key].push(rs);
        });
      }
      if (Array.isArray(kmbRoutesRes.data)) {
        kmbRoutesRes.data.forEach(r => {
          const rId = `KMB_${r.route}_${r.bound}_${r.service_type}`;
          const rsData = kmbRouteStopsMap[rId];
          if (!rsData) return;
          rsData.sort((a,b) => parseInt(a.seq) - parseInt(b.seq));
          routeStopsCache[rId] = rsData.map(rs => {
            const stopDetail = allKmbStops[rs.stop] || { name_en: 'Unknown', lat: '0', long: '0' };
            return { stopId: rs.stop, stopName_e: formatStopName(cleanStopName(stopDetail.name_en)), latitude: stopDetail.lat, longitude: stopDetail.long, seq: rs.seq };
          });
          const company = (r.route.startsWith('E') || r.route.startsWith('A') || r.route.startsWith('NA') || r.route.startsWith('S') || r.route.startsWith('R')) ? 'LWB' : 'KMB';
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
  console.log("Processing Citybus (CTB) GPS Coordinates...");
  const allCtbStops = {};
  const ctbStopsRes = await safeFetch('https://rt.data.gov.hk/v2/transport/citybus/stop');
  if (ctbStopsRes && Array.isArray(ctbStopsRes.data)) {
      ctbStopsRes.data.forEach(s => { allCtbStops[s.stop] = s; });
  }

  const ctbRoutes = await safeFetch('https://rt.data.gov.hk/v2/transport/citybus/route/CTB');
  if (ctbRoutes && Array.isArray(ctbRoutes.data)) {
      for (const route of ctbRoutes.data) {
          if(!route || !route.route) continue;
          const dirString = route.bound === 'I' ? 'inbound' : 'outbound';
          const stopsData = await safeFetch(`https://rt.data.gov.hk/v2/transport/citybus/route-stop/CTB/${route.route}/${dirString}`);
          if (stopsData && Array.isArray(stopsData.data)) {
              const rId = `CTB_${route.route}_${route.bound}`;
              
              const stopDetails = [];
              for (const rs of stopsData.data) {
                  let stopDetail = allCtbStops[rs.stop];
                  if (!stopDetail) stopDetail = { name_en: 'CTB Stop', lat: '0', long: '0' };
                  
                  stopDetails.push({ stopId: rs.stop, stopName_e: formatStopName(cleanStopName(stopDetail.name_en)), latitude: stopDetail.lat, longitude: stopDetail.long, seq: rs.seq });
              }
              routeStopsCache[rId] = stopDetails;
              
              const dest_e = route.dest_en ? formatStopName(cleanStopName(route.dest_en)) : 'Unknown';
              const groupKey = `CTB_${route.route}___${dest_e}`.replace(/[^a-zA-Z0-9_-]/g, '_');
              if (!groupedMap.has(groupKey)) {
                  groupedMap.set(groupKey, { key: groupKey, routeNo: route.route, dest_e: dest_e, routeIds: [rId], company: 'CTB' });
              } else {
                  groupedMap.get(groupKey).routeIds.push(rId);
              }
          }
          await sleep(5); 
      }
  }

  // 4. GREEN MINIBUS (GMB)
  console.log("Processing Green Minibus (GMB) Destinations and GPS...");
  const allGmbStops = {};
  const gmbData = await safeFetch('https://data.etagmb.gov.hk/route');
  if (gmbData && gmbData.data) {
      const gmbRoutes = gmbData.data.routes || gmbData.data; 
      const allRouteCodes = [
          ...(Array.isArray(gmbRoutes.HKI) ? gmbRoutes.HKI : []).map(c => ({code: c, reg: 'HKI'})),
          ...(Array.isArray(gmbRoutes.KLN) ? gmbRoutes.KLN : []).map(c => ({code: c, reg: 'KLN'})),
          ...(Array.isArray(gmbRoutes.NT) ? gmbRoutes.NT : []).map(c => ({code: c, reg: 'NT'}))
      ];
      for (const r of allRouteCodes) {
          const detailData = await safeFetch(`https://data.etagmb.gov.hk/route/${r.reg}/${r.code}`);
          if (detailData && Array.isArray(detailData.data)) {
              for (const variant of detailData.data) {
                  if(!variant || !variant.route_id) continue;
                  const routeId = variant.route_id;
                  
                  let directions = variant.directions || [];
                  if (directions.length === 0) directions = [{ route_seq: 1, dest_en: variant.dest_en || 'Unknown' }];
                  
                  for (const dir of directions) {
                      const routeSeq = dir.route_seq;
                      const dest_e = formatStopName(cleanStopName(dir.dest_en || variant.dest_en || 'Unknown'));
                      
                      const stopsData = await safeFetch(`https://data.etagmb.gov.hk/route-stop/${routeId}/${routeSeq}`);
                      if (stopsData && stopsData.data && Array.isArray(stopsData.data.route_stops)) {
                          const rId = `GMB_${routeId}_${routeSeq}`;
                          
                          const stopDetails = [];
                          for (const rs of stopsData.data.route_stops) {
                              let stopDetail = allGmbStops[rs.stop_id];
                              if (!stopDetail) {
                                  const res = await safeFetch(`https://data.etagmb.gov.hk/stop/${rs.stop_id}`);
                                  if (res && res.data) {
                                      stopDetail = res.data;
                                      allGmbStops[rs.stop_id] = stopDetail;
                                  }
                                  await sleep(5);
                              }
                              
                              // Correctly dive into the nested WGS84 structure specific to the Hong Kong Transport API
                              let lat = stopDetail?.coordinates?.wgs84?.lat || stopDetail?.coordinates?.wgs84?.latitude || rs?.location?.lat || rs?.lat || '0';
                              let lon = stopDetail?.coordinates?.wgs84?.long || stopDetail?.coordinates?.wgs84?.longitude || rs?.location?.lng || rs?.long || '0';
                              
                              let name_en = stopDetail?.name_en || rs?.name_en || 'GMB Stop';
                              
                              stopDetails.push({ stopId: rs.stop_id, stopName_e: formatStopName(cleanStopName(name_en)), latitude: lat, longitude: lon, seq: rs.stop_seq });
                          }
                          routeStopsCache[rId] = stopDetails;
                          
                          const groupKey = `GMB_${r.code}___${dest_e}`.replace(/[^a-zA-Z0-9_-]/g, '_');
                          if (!groupedMap.has(groupKey)) {
                              groupedMap.set(groupKey, { key: groupKey, routeNo: r.code, dest_e: dest_e, routeIds: [rId], company: 'GMB' });
                          } else {
                              groupedMap.get(groupKey).routeIds.push(rId);
                          }
                      }
                      await sleep(5);
                  }
              }
          }
      }
  }

  const output = {
    groupedRoutes: Array.from(groupedMap.values()),
    routeStopsCache
  };
  fs.writeFileSync('./bus_index.min.json', JSON.stringify(output));
  console.log('Successfully generated bus_index.min.json with complete network coordinates!');
}

build();
