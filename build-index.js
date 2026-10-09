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
