// File: data/routes/nlb/nlb_north.js

// Push North Lantau routes into the global NLB array
window.BusData.NLB.push(
  {
    company: "NLB",
    routeId: "37M", // NLB uses internal route IDs
    routeNo: "37M",
    dest_e: "Tung Chung Station",
    dest_c: "東涌站",
    dest_s: "东涌站",
    stops: [
      { stopId: "123", stopName_e: "Tung Chung Station", lat: 22.289, lon: 113.941 },
      { stopId: "124", stopName_e: "Ying Tung Estate", lat: 22.295, lon: 113.948 },
      // ... manually verified stop list
    ]
  },
  {
    company: "NLB",
    routeId: "38", 
    routeNo: "38",
    dest_e: "Yat Tung Estate",
    dest_c: "逸東邨",
    dest_s: "逸东邨",
    stops: [
      // ... manually verified stop list
    ]
  }
);
