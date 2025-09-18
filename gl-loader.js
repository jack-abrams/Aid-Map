function parseCSV(text){
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows=[], row=[], len=text.length; let i=0, f="", q=false;
  while(i<len){
    const c=text[i];
    if(c==='\"'){ if(q && text[i+1]==='\"'){ f+='\"'; i+=2; continue; } q=!q; i++; continue; }
    if(!q && (c===',' || c==='\n' || c==='\r')){
      row.push(f); f="";
      if(c===','){ i++; continue; }
      if(c==='\r' && text[i+1]==='\n') i++;
      i++; rows.push(row.splice(0)); continue;
    }
    f+=c; i++;
  }
  row.push(f); if(row.length) rows.push(row);
  return rows.filter(r => r.length && r.some(x=>x!==""));
}
function recordsFromCSV(text){
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h=>h.trim());
  return rows.slice(1).map(r=>{
    const o={}; headers.forEach((h,i)=> o[h] = (r[i] ?? "").trim()); return o;
  });
}
function csvToGeoJSONRecs(recs){
  const feats=[];
  for (const o of recs){
    const lat = parseFloat(o.lat), lng = parseFloat(o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)){
      feats.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: o
      });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

(async function(){
  const STYLE_URL = "https://api.maptiler.com/maps/streets-v2/style.json?key=sfj85VORuGeFauZZw7Iy";

  const map = new maplibregl.Map({
    container: "map",
    style: STYLE_URL,
    center: [-118.2551, 34.1425],
    zoom: 11
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  const csvText = await fetch("foodbanks.csv", { cache: "no-store" }).then(r=>r.text());
  const records = recordsFromCSV(csvText);
  const geojson = csvToGeoJSONRecs(records);

  map.on("load", async () => {
    map.addSource("banks", { type: "geojson", data: geojson, cluster: true, clusterRadius: 50 });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: "banks",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"],
          "#a5b4fc", 10, "#818cf8", 25, "#6366f1", 50, "#4f46e5"
        ],
        "circle-radius": ["step", ["get", "point_count"],
          14, 10, 18, 25, 22, 50, 28
        ]
      }
    });

    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: "banks",
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#ffffff" }
    });

    map.addLayer({
      id: "unclustered",
      type: "circle",
      source: "banks",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 6,
        "circle-color": "#22c55e",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2
      }
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true });
    map.on("click", "unclustered", (e) => {
      const f = e.features[0];
      const p = f.properties || {};
      const name = p.name || "Food Bank";
      const addr = p.address || "";
      const phone = p.phone ? `<br>${p.phone}` : "";
      const hours = p.hours ? `<br>${p.hours}` : "";
      const web = p.website ? `<br><a href="${p.website}" target="_blank" rel="noopener">Website</a>` : "";
      const html = `<b>${name}</b><br>${addr}${phone}${hours}${web}`;
      popup.setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
    });

    map.on("click", "clusters", async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0].properties.cluster_id;
      const source = map.getSource("banks");
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });

    if (geojson.features.length){
      const b = new maplibregl.LngLatBounds();
      geojson.features.forEach(f => b.extend(f.geometry.coordinates));
      map.fitBounds(b, { padding: 24, maxZoom: 13, duration: 500 });
    }

    const q = document.getElementById("q");
    const reset = document.getElementById("reset");
    function applyFilter(){
      const s = (q.value || "").toLowerCase();
      if (!s){
        map.setFilter("unclustered", ["!", ["has", "point_count"]]);
        return;
      }
      map.setFilter("unclustered", [
        "all",
        ["!", ["has", "point_count"]],
        ["any",
          ["in", ["literal", s], ["downcase", ["get", "name"]]],
          ["in", ["literal", s], ["downcase", ["get", "address"]]],
          ["in", ["literal", s], ["downcase", ["get", "category"]]]
        ]
      ]);
    }
    q.addEventListener("input", applyFilter);
    reset.addEventListener("click", () => { q.value = ""; applyFilter(); });
  });
})();
