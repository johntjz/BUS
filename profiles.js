// profiles.js — Network Baseload & Spatial Turnover Profiles
window.PULSE_NETWORK_PROFILES = {
  // 1. Statutory & Public Holidays for Hong Kong (2026)
  holidays: [
    "2026-01-01", "2026-02-17", "2026-02-18", "2026-02-19",
    "2026-04-03", "2026-04-04", "2026-04-06", "2026-05-01",
    "2026-05-25", "2026-06-19", "2026-07-01", "2026-09-26",
    "2026-10-01", "2026-10-07", "2026-10-19", "2026-12-25", "2026-12-26"
  ],

  // 2. Fallback Generic Archetypes (24-Hour Demand Arrays: Hours 0 to 23)
  archetypes: {
    FEEDER: {
      WD:  [5, 0, 0, 0, 0, 20, 50, 90, 85, 60, 45, 45, 50, 45, 45, 55, 65, 85, 95, 80, 55, 40, 25, 10],
      SAT: [5, 0, 0, 0, 0, 15, 30, 50, 65, 70, 70, 70, 75, 75, 70, 70, 75, 80, 85, 75, 60, 45, 30, 15],
      PH:  [5, 0, 0, 0, 0, 10, 20, 35, 55, 70, 75, 80, 80, 80, 75, 70, 70, 75, 75, 70, 55, 40, 25, 10],
      curve: [{ progress: 0.0, factor: 0.2 }, { progress: 0.5, factor: 1.0 }, { progress: 1.0, factor: 0.1 }]
    },
    CROSS_DISTRICT: {
      WD:  [10, 0, 0, 0, 0, 15, 40, 85, 90, 70, 60, 60, 65, 60, 60, 70, 80, 95, 95, 85, 70, 50, 35, 20],
      SAT: [10, 0, 0, 0, 0, 10, 25, 45, 65, 75, 80, 80, 80, 80, 80, 80, 80, 85, 85, 80, 65, 50, 35, 15],
      PH:  [10, 0, 0, 0, 0, 10, 20, 35, 60, 75, 85, 90, 90, 85, 85, 85, 85, 85, 80, 75, 65, 45, 30, 15],
      curve: [{ progress: 0.0, factor: 0.2 }, { progress: 0.2, factor: 0.8 }, { progress: 0.5, factor: 1.0 }, { progress: 0.8, factor: 0.7 }, { progress: 1.0, factor: 0.1 }]
    }
  },

  // 3. Custom Line Profiles (Calibrated for 3M, 1, and E36)
  custom: {
    // -------------------------------------------------------------
    // NLB 3M: Tung Chung Station <-> Mui Wo Ferry Pier
    // Capacity Divider: 1.25 (Mixed / Double Decker)
    // -------------------------------------------------------------
    "3M_OUTBOUND": { // Tung Chung -> Mui Wo
      WD:  [5, 0, 0, 0, 0, 10, 20, 25, 25, 25, 30, 30, 30, 30, 35, 50, 65, 95, 100, 95, 80, 50, 30, 15],
      SAT: [5, 0, 0, 0, 0, 10, 25, 40, 70, 85, 90, 85, 75, 70, 65, 60, 55, 60,  65, 65, 50, 35, 25, 10],
      PH:  [5, 0, 0, 0, 0, 10, 20, 45, 80, 95, 95, 90, 80, 75, 70, 60, 55, 55,  60, 55, 45, 30, 20, 10],
      // Rapid loading at Terminus & Yu Tung Court, plateau over the pass, alighting at Pui O -> Mui Wo
      curve: [
        { progress: 0.00, factor: 0.35 },
        { progress: 0.08, factor: 1.00 }, // Yu Tung Court: near max capacity
        { progress: 0.50, factor: 0.95 }, // South Lantau Rd
        { progress: 0.80, factor: 0.85 }, // Pui O
        { progress: 1.00, factor: 0.10 }  // Mui Wo Terminus
      ]
    },
    "3M_INBOUND": { // Mui Wo -> Tung Chung
      WD:  [5, 0, 0, 0, 0, 15, 40, 95, 100, 75, 40, 35, 35, 35, 35, 40, 45, 45, 40, 35, 30, 20, 10, 5],
      SAT: [5, 0, 0, 0, 0, 10, 20, 30, 40,  45, 45, 45, 50, 55, 60, 75, 85, 95, 90, 80, 60, 40, 25, 10],
      PH:  [5, 0, 0, 0, 0, 10, 15, 25, 35,  40, 45, 45, 50, 55, 65, 80, 95, 100, 95, 85, 65, 45, 25, 10],
      curve: [
        { progress: 0.00, factor: 0.40 }, // Mui Wo Pier
        { progress: 0.25, factor: 1.00 }, // Pui O pickup: completely full
        { progress: 0.70, factor: 0.95 }, // Over the pass
        { progress: 0.90, factor: 0.40 }, // Hospital & Yat Tung drop-off
        { progress: 1.00, factor: 0.05 }  // Tung Chung MTR
      ]
    },

    // -------------------------------------------------------------
    // NLB 1: Mui Wo Ferry Pier <-> Tai O
    // Capacity Divider: 0.60 (Strict Single Decker)
    // -------------------------------------------------------------
    "1_OUTBOUND": { // Mui Wo -> Tai O
      WD:  [0, 0, 0, 0, 0, 5, 15, 25, 25, 30, 35, 35, 35, 35, 30, 25, 20, 20, 15, 10, 5, 5, 0, 0],
      SAT: [0, 0, 0, 0, 0, 5, 15, 35, 50, 65, 75, 80, 75, 70, 55, 40, 30, 20, 15, 10, 5, 5, 0, 0],
      PH:  [0, 0, 0, 0, 0, 5, 20, 45, 70, 90, 100, 95, 90, 80, 65, 45, 30, 20, 15, 10, 5, 5, 0, 0],
      curve: [
        { progress: 0.00, factor: 0.40 }, // Ferry arrival boards
        { progress: 0.20, factor: 0.90 }, // Pui O
        { progress: 0.50, factor: 1.00 }, // Cheung Sha / Tong Fuk
        { progress: 0.85, factor: 0.60 }, // Shek Pik
        { progress: 1.00, factor: 0.05 }  // Tai O Terminus
      ]
    },
    "1_INBOUND": { // Tai O -> Mui Wo
      WD:  [0, 0, 0, 0, 0, 5, 25, 30, 25, 20, 20, 20, 20, 20, 25, 30, 30, 25, 15, 10, 5, 0, 0, 0],
      SAT: [0, 0, 0, 0, 0, 5, 10, 15, 20, 25, 35, 45, 55, 65, 75, 85, 80, 65, 45, 25, 10, 5, 0, 0],
      PH:  [0, 0, 0, 0, 0, 5, 10, 15, 25, 30, 40, 50, 65, 80, 95, 100, 95, 75, 50, 25, 10, 5, 0, 0],
      curve: [
        { progress: 0.00, factor: 0.85 }, // Fills almost immediately at Tai O
        { progress: 0.30, factor: 1.00 }, // Keung Shan Road
        { progress: 0.65, factor: 0.90 }, // Tong Fuk / Cheung Sha
        { progress: 0.85, factor: 0.40 }, // Pui O drop-off
        { progress: 1.00, factor: 0.05 }  // Mui Wo Ferry Pier
      ]
    },

    // -------------------------------------------------------------
    // LWB E36: Yuen Long (Pa Kwo Tung) <-> Airport (GTC / AsiaWorld-Expo)
    // Capacity Divider: 1.30 (Double Decker)
    // -------------------------------------------------------------
    "E36_OUTBOUND": { // Yuen Long -> Airport
      WD:  [10, 0, 0, 0, 0, 55, 115, 120, 90, 65, 65, 60, 60, 65, 70, 75, 85, 80, 70, 60, 55, 45, 30, 15],
      SAT: [10, 0, 0, 0, 0, 35, 75,  95,  85, 75, 75, 70, 70, 75, 75, 75, 70, 65, 60, 55, 50, 40, 30, 15],
      PH:  [10, 0, 0, 0, 0, 25, 55,  85,  90, 80, 80, 75, 75, 75, 70, 70, 65, 60, 55, 50, 45, 35, 25, 10],
      // Pick up through Yuen Long town, holds across highway, drops along Tung Chung North & Airport
      curve: [
        { progress: 0.00, factor: 0.25 }, // Pa Kwo Tung / Long Ping
        { progress: 0.20, factor: 0.75 }, // Yuen Long Plaza / Castle Peak Rd
        { progress: 0.35, factor: 1.00 }, // Yoho Mall / Tai Lam Tunnel (Peak load)
        { progress: 0.75, factor: 1.00 }, // Across highway (Lantau Link)
        { progress: 0.85, factor: 0.65 }, // Tung Chung North drop-off
        { progress: 0.95, factor: 0.30 }, // Aircraft Catering / Cargo
        { progress: 1.00, factor: 0.05 }  // Airport GTC
      ]
    },
    "E36_INBOUND": { // Airport -> Yuen Long
      WD:  [15, 0, 0, 0, 0, 15, 35, 45, 40, 40, 45, 45, 50, 50, 60, 80, 115, 125, 110, 85, 65, 55, 50, 30],
      SAT: [15, 0, 0, 0, 0, 15, 25, 35, 40, 45, 50, 55, 60, 65, 70, 80, 95,  100, 90,  75, 60, 50, 45, 25],
      PH:  [15, 0, 0, 0, 0, 10, 20, 30, 35, 40, 45, 50, 55, 60, 70, 85, 95,  100, 90,  75, 60, 50, 40, 20],
      // Pick up from Airport terminals & Tung Chung North, highway transit, progressive drop-off in Yuen Long
      curve: [
        { progress: 0.00, factor: 0.40 }, // Airport Passenger GTC
        { progress: 0.15, factor: 0.70 }, // Cathay City & Cargo Terminals
        { progress: 0.25, factor: 1.00 }, // Tung Chung North pickups (Peak load)
        { progress: 0.65, factor: 1.00 }, // Highway transit
        { progress: 0.75, factor: 0.70 }, // Tai Lam Tunnel interchange
        { progress: 0.85, factor: 0.45 }, // Yoho Mall
        { progress: 0.95, factor: 0.20 }, // Yuen Long Plaza
        { progress: 1.00, factor: 0.05 }  // Pa Kwo Tung
      ]
    }
  },

  // 4. Exact Route & Direction Resolver
  getProfile: function(routeNo, destName) {
    const dest = (destName || '').toLowerCase();
    const r = (routeNo || '').trim().toUpperCase();

    let key = null;
    if (r === '3M') {
      key = dest.includes('tung chung') ? '3M_INBOUND' : '3M_OUTBOUND';
    } else if (r === '1') {
      key = (dest.includes('mui wo') || dest.includes('梅窩')) ? '1_INBOUND' : '1_OUTBOUND';
    } else if (r === 'E36') {
      key = (dest.includes('yuen long') || dest.includes('元朗') || dest.includes('long ping') || dest.includes('朗屏')) ? 'E36_INBOUND' : 'E36_OUTBOUND';
    } else {
      const isCityInbound = dest.includes('tung chung') || dest.includes('kowloon') || dest.includes('hong kong') || dest.includes('yuen long') || dest.includes('airport');
      key = `${r}_${isCityInbound ? 'INBOUND' : 'OUTBOUND'}`;
    }

    return this.custom[key] || this.archetypes.CROSS_DISTRICT;
  }
};
